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
 * C-1 (this commission) ships direct mode + the cost-suppression
 * defaults documented in `spike-2-overhead.md`. C-3 will add streaming
 * via `Streamable.stream()`.
 */

// Public surface re-exports — keep this list in sync with PRD §S2/S3.
export type { AnthropicSdkTransport } from './transport.js';
export {
  claudeAgentSdkProvider,
  pactToSdkOptions,
  type ClaudeAgentSdkProvider,
  type ClaudeAgentSdkProviderOptions,
} from './factory.js';
export { directTransport } from './direct-transport.js';
export type { DirectTransportOptions } from './direct-transport.js';
