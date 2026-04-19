// SPDX-License-Identifier: Apache-2.0
/**
 * Sample Cortex tenant app (C-4) — incident triage with the SDK provider.
 *
 * This is the SDK-backed sibling of `samples/cortex-incident-triage-agent`.
 * The composition is identical at the tenant boundary
 * (`createMethodAgent({ ctx, pact, ... })`) but the inner provider is
 * `@methodts/pacta-provider-claude-agent-sdk` instead of the manual
 * `pacta-provider-anthropic` loop. The SDK owns turn pacing, system-prompt
 * assembly, and tool invocation; pacta owns the contract (Pact, budget,
 * schema validation); Cortex owns the budget/audit/auth ports.
 *
 * Composition pipeline (outer → inner):
 *
 *   createMethodAgent
 *     └─ tokenExchange  →  audit  →  budgetEnforcer(predictive)  →  outputValidator
 *           └─ claudeAgentSdkProvider
 *                 └─ cortexAnthropicTransport       (HTTP proxy on 127.0.0.1)
 *                       └─ ctx.llm.reserve/.settle  (degraded: skip until Cortex O1)
 *                       └─ ctx.audit.event          (per-turn transport audit)
 *                       └─ upstream Anthropic API   (real fetch)
 *                 └─ @anthropic-ai/claude-agent-sdk (spawns `claude` CLI)
 *
 * Status: **degraded mode**. `ctx.llm.reserve` / `.settle` (Cortex O1)
 * do not yet exist on the structural `CortexLlmCtx`, so the transport
 * skips pre-flight reservation and emits a single audit event per turn
 * with the actual cost only. When Cortex O1 lands, the transport flips
 * to full mode with no surface change here.
 */

import {
  createMethodAgent,
  assertCtxCompatibility,
  type AgentEvent,
  type AgentProvider,
  type CortexCtx,
  type MethodAgentResult,
} from '@methodts/agent-runtime';
import { claudeAgentSdkProvider } from '@methodts/pacta-provider-claude-agent-sdk';
import {
  cortexAnthropicTransport,
  type CortexAnthropicTransportConfig,
  type CortexAuditCtx,
  type CortexLlmCtx,
} from '@methodts/pacta-provider-cortex';

import { incidentTriagePact } from './pacts/incident-triage.js';
import type { TriageOutput } from './types.js';

// ── Public result shape ──────────────────────────────────────────

export interface AgentRunResult {
  readonly ok: boolean;
  readonly output?: TriageOutput;
  readonly costUsd: number;
  readonly auditEventCount: number;
  readonly stopReason: MethodAgentResult<TriageOutput>['stopReason'];
}

// ── adaptCtx — nested CortexCtx → flat ctx the transport needs ───
//
// The C-2 transport's ctx parameter was frozen as a flat
// `CortexLlmCtx & CortexAuditCtx` intersection (i.e. `complete`,
// `structured`, `embed`, `event` co-located on a single object) per the
// Wave 0 deviation noted in PR #193. The `createMethodAgent` factory's
// public surface uses the **nested** `CortexCtx` shape
// (`ctx.llm.complete`, `ctx.audit.event`, ...). This helper bridges the
// two without changing either contract.
//
// Two structural-typing wrinkles forced a controlled cast at the seam:
//   1. `@methodts/agent-runtime`'s `CortexLlmFacade.complete` has an
//      open `[k: string]: unknown` index signature on its request type;
//      `@methodts/pacta-provider-cortex`'s `CortexLlmCtx.complete` has a
//      sealed `CompletionRequest`. Each is the **deliberate narrow**
//      shape its package's consumer relies on — see the gate comment in
//      `pacta-provider-cortex/src/ctx-types.ts`.
//   2. The transport requires `structured` and `embed`; the runtime
//      facade marks them optional. We provide throwing stubs because the
//      transport's code path here (proxy → upstream Anthropic) never
//      calls them in degraded mode.
//
// Both packages flow into a real Cortex `ctx` at runtime, so the cast is
// sound; the structural mismatch is purely a type-system seam between
// two narrow re-declarations of the same upstream surface.
//
// When the C-2 ctx shape is harmonised with `CortexCtx` (a Wave 3
// cleanup PRD), this helper collapses to `(ctx) => ctx.llm` — type cast
// gone.

type CortexTransportCtx = CortexLlmCtx & CortexAuditCtx;

function adaptCtx(ctx: CortexCtx): CortexTransportCtx {
  if (!ctx.llm) {
    throw new Error('adaptCtx: ctx.llm is required by the SDK transport');
  }
  if (!ctx.audit) {
    throw new Error('adaptCtx: ctx.audit is required by the SDK transport');
  }
  const llm = ctx.llm;
  const audit = ctx.audit;
  // Build a duck-typed flat object. Cast at the narrow seam — see
  // header comment for why this is sound.
  const flat = {
    complete: llm.complete.bind(llm),
    structured:
      llm.structured?.bind(llm) ??
      (async () => {
        throw new Error('ctx.llm.structured not provided');
      }),
    embed:
      llm.embed?.bind(llm) ??
      (async () => {
        throw new Error('ctx.llm.embed not provided');
      }),
    event: audit.event.bind(audit),
  };
  return flat as unknown as CortexTransportCtx;
}

// ── Tenant entry — createIncidentTriageAgent ─────────────────────

/**
 * Optional override hook for tests. Production callers omit this and
 * receive the standard composition.
 */
export interface CreateIncidentTriageAgentOptions {
  /**
   * Override the inner LLM provider. When set, the SDK + transport are
   * NOT instantiated — the override is passed straight to
   * `createMethodAgent`. Used by the e2e test to mock the SDK seam
   * without spawning the `claude` CLI subprocess.
   *
   * Production callers leave this undefined.
   */
  readonly providerOverride?: AgentProvider;

  /**
   * Optional transport-side budget threshold handlers. Defaults to
   * no-ops; tenant apps typically wire these to their alerting stack.
   */
  readonly transportHandlers?: CortexAnthropicTransportConfig['handlers'];
}

const DEFAULT_TRANSPORT_HANDLERS: CortexAnthropicTransportConfig['handlers'] = {
  onBudgetWarning: () => undefined,
  onBudgetCritical: () => undefined,
  onBudgetExceeded: () => undefined,
};

/**
 * Build the configured method-governed agent for the incident-triage
 * tenant app. Composition only — does not invoke. Callers are expected
 * to call `agent.invoke({ prompt })` and `agent.dispose()`.
 *
 * Pulled out of `runTriageAgent` so tests can construct the agent
 * directly with a stub provider and assert on the composed contract
 * without spawning a subprocess.
 */
export function createIncidentTriageAgent(
  ctx: CortexCtx,
  options: CreateIncidentTriageAgentOptions = {},
  onEvent?: (event: AgentEvent) => void,
) {
  // R1 (dual-ctx-drift) mitigation — guarded boot check.
  assertCtxCompatibility(ctx);

  const provider =
    options.providerOverride ??
    claudeAgentSdkProvider({
      transport: cortexAnthropicTransport(adaptCtx(ctx), {
        handlers: options.transportHandlers ?? DEFAULT_TRANSPORT_HANDLERS,
        appId: ctx.app.id,
      }),
    });

  return createMethodAgent({
    ctx,
    pact: incidentTriagePact,
    provider,
    onEvent,
  });
}

/**
 * Tenant entry — given a Cortex `ctx`, run an incident-triage agent
 * against the incident payload in `ctx.input.text`.
 *
 * Mirrors `runTriageAgent` from the manual-loop sibling sample so
 * tenant teams can diff the two. The only difference is the inner
 * provider.
 */
export async function runTriageAgent(
  ctx: CortexCtx,
  slackNotify?: (text: string) => void,
  options: CreateIncidentTriageAgentOptions = {},
): Promise<AgentRunResult> {
  const agent = createIncidentTriageAgent(ctx, options, (event: AgentEvent) => {
    if (event.type === 'text' && slackNotify) {
      slackNotify(event.content);
    }
    if (event.type === 'completed' && slackNotify) {
      slackNotify(`triage completed (turns=${event.turns})`);
    }
  });

  const prompt = ctx.input?.text ?? 'triage the latest incident';
  const result = await agent.invoke({ prompt });
  await agent.dispose();

  return {
    ok: result.completed,
    output: result.output,
    costUsd: result.cost.totalUsd,
    auditEventCount: result.auditEventCount,
    stopReason: result.stopReason,
  };
}
