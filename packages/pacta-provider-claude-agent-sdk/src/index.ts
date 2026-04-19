// SPDX-License-Identifier: Apache-2.0
/**
 * @methodts/pacta-provider-claude-agent-sdk
 *
 * Pacta agent provider that delegates the inner agent loop to
 * @anthropic-ai/claude-agent-sdk while preserving pacta's Pact
 * contract and middleware stack.
 *
 * Two modes:
 *  - Direct: non-Cortex; `apiKey` from config or env, SDK calls the
 *    Anthropic API directly.
 *  - Cortex: inject a transport from `@methodts/pacta-provider-cortex/
 *    anthropic-transport` to route every SDK turn through ctx.llm
 *    budget enforcement.
 *
 * Wave 0 surface — implementation lands in C-1 (direct mode) and C-3
 * (streaming).
 */

import type {
  AgentProvider,
  Streamable,
  Pact,
  AgentRequest,
  AgentResult,
  ToolProvider,
} from '@methodts/pacta';

export type { AnthropicSdkTransport } from './transport.js';
import type { AnthropicSdkTransport } from './transport.js';

/**
 * S-CLAUDE-SDK-PROVIDER — public surface (PRD §S2).
 */
export interface ClaudeAgentSdkProviderOptions {
  /** Default model (e.g. 'claude-sonnet-4-6'). Overridable per pact. */
  defaultModel?: string;

  /**
   * HTTP transport for SDK API calls. Default: a direct-mode transport
   * built from `apiKey`. Cortex tenants pass `cortexAnthropicTransport(ctx)`.
   * Conforms to S-ANTHROPIC-SDK-TRANSPORT.
   */
  transport?: AnthropicSdkTransport;

  /**
   * API key. Used only when `transport` is unset (direct mode).
   * Falls back to `ANTHROPIC_API_KEY` env var.
   */
  apiKey?: string;

  /** Tool provider. Tenant-supplied tools merge with SDK's internal set. */
  toolProvider?: ToolProvider;

  /**
   * Max agentic turns per invocation. Defaults to
   * `pact.budget?.maxTurns ?? 25`.
   */
  maxTurns?: number;
}

export type ClaudeAgentSdkProvider = AgentProvider & Streamable;

/**
 * Create a pacta `AgentProvider` over `@anthropic-ai/claude-agent-sdk`.
 *
 * Wave 0 stub: signature only. Wave 1 (C-1) supplies the body.
 */
export function claudeAgentSdkProvider(
  _options: ClaudeAgentSdkProviderOptions = {},
): ClaudeAgentSdkProvider {
  const stub = (): never => {
    throw new Error(
      '[Wave 0 stub] claudeAgentSdkProvider implementation lands in C-1 (Wave 1). ' +
      'See .method/sessions/fcd-plan-20260419-2300-pacta-claude-agent-sdk/realize-plan.md',
    );
  };
  return {
    name: 'claude-agent-sdk',
    capabilities: stub,
    invoke<T>(_pact: Pact<T>, _request: AgentRequest): Promise<AgentResult<T>> {
      return stub();
    },
    stream() {
      stub();
      // Unreachable; satisfy TS narrowing.
      return (async function* () { /* never */ })();
    },
  };
}
