// SPDX-License-Identifier: Apache-2.0
/**
 * S-CORTEX-ANTHROPIC-TRANSPORT — Cortex-side production of
 * S-ANTHROPIC-SDK-TRANSPORT.
 *
 * Pairs with `@methodts/pacta-provider-claude-agent-sdk` to let a
 * Cortex tenant app use the Claude Agent SDK as its inner loop while
 * routing every API call through `ctx.llm` for budget enforcement.
 *
 * `setup()` per SDK invocation:
 *   1. Spins up a localhost HTTP proxy on a random port
 *   2. Returns { env: { ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY }, teardown }
 *
 * The proxy intercepts each `/v1/messages?beta=true` POST:
 *   1. Parses the Anthropic request body
 *   2. Calls ctx.llm.reserve(estimateCost(req))   // requires Cortex O1
 *   3. Forwards to api.anthropic.com using the resolved API key
 *   4. Parses response, computes actual cost from usage
 *   5. Calls ctx.llm.settle(handle, actualCost)   // requires Cortex O1
 *   6. Emits ctx.audit.event for the turn (PRD-065 schema)
 *   7. Streams the unmodified Response back to the SDK
 *
 * Wave 0 stub: signature only. Wave 2 (C-2) supplies the body.
 *
 * See realize-plan §C-2 for full deliverables and ACs.
 */

import type { AnthropicSdkTransport } from '@methodts/pacta-provider-claude-agent-sdk';
import type { CortexLlmCtx, CortexAuditCtx } from './ctx-types.js';

/** Composed ctx slice this transport requires. */
type CortexTransportCtx = CortexLlmCtx & CortexAuditCtx;

export interface BudgetEvent {
  readonly tenantAppId: string;
  readonly reservationId?: string;
  readonly costUsd: number;
  readonly maxCostUsd: number;
  readonly remainingUsd: number;
}

export interface AnthropicMessagesRequestShape {
  readonly model: string;
  readonly max_tokens: number;
  readonly messages: ReadonlyArray<{ role: string; content: unknown }>;
  readonly tools?: ReadonlyArray<unknown>;
  readonly system?: string | ReadonlyArray<unknown>;
}

export interface CortexAnthropicTransportConfig {
  /**
   * Where to fetch the Anthropic API key.
   * Defaults to ctx.secrets if available; otherwise reads
   * `ANTHROPIC_API_KEY` env var.
   */
  apiKey?:
    | { source: 'env'; name?: string }
    | { source: 'secret'; name: string }
    | { source: 'literal'; value: string };

  /**
   * Cost estimator: given an Anthropic request body, return the
   * predicted maxCostUsd to pass to ctx.llm.reserve().
   * Defaults to a conservative per-model upper bound based on
   * max_tokens.
   */
  estimateCost?: (req: AnthropicMessagesRequestShape) => number;

  /**
   * Mandatory budget handlers (matches CortexLLMProviderConfig).
   * Wired into the same handler taxonomy so a tenant app sees a
   * single consistent budget surface across providers.
   */
  handlers: {
    onBudgetWarning: (e: BudgetEvent) => void;
    onBudgetCritical: (e: BudgetEvent) => void;
    onBudgetExceeded: (e: BudgetEvent) => void;
  };
}

/**
 * Produce a Cortex-aware AnthropicSdkTransport.
 *
 * Wave 0 stub: signature only. Wave 2 (C-2) supplies the body.
 */
export function cortexAnthropicTransport(
  _ctx: CortexTransportCtx,
  _config: CortexAnthropicTransportConfig,
): AnthropicSdkTransport {
  return {
    setup() {
      throw new Error(
        '[Wave 0 stub] cortexAnthropicTransport implementation lands in C-2 (Wave 2). ' +
        'See .method/sessions/fcd-plan-20260419-2300-pacta-claude-agent-sdk/realize-plan.md',
      );
    },
  };
}
