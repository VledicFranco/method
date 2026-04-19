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
 *                 └─ cortexAnthropicTransportV2     (HTTP proxy on 127.0.0.1)
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
  cortexAnthropicTransportV2,
  type CortexAnthropicTransportConfig,
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

// ── ctx flows straight through to the transport ──────────────────
//
// Wave 3 cleanup (C-4 follow-up): the transport's ctx parameter has
// been harmonised with the nested `CortexCtx` shape used elsewhere.
// `cortexAnthropicTransportV2` accepts `{ llm, audit }` directly, so
// the previous `adaptCtx` helper (and its `unknown as` cast at the
// flat-intersection seam) has been removed.

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
      transport: cortexAnthropicTransportV2(
        { llm: ctx.llm, audit: ctx.audit },
        {
          handlers: options.transportHandlers ?? DEFAULT_TRANSPORT_HANDLERS,
          appId: ctx.app.id,
        },
      ),
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
