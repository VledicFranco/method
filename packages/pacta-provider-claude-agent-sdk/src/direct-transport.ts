// SPDX-License-Identifier: Apache-2.0
/**
 * Default direct-mode `AnthropicSdkTransport`.
 *
 * Used when no custom transport is supplied to `claudeAgentSdkProvider`.
 * Resolves the API key from explicit config or `ANTHROPIC_API_KEY` env
 * var and lets the SDK call Anthropic's API directly. No proxy, no
 * teardown.
 *
 * For Cortex tenants — use `cortexAnthropicTransport(ctx)` from
 * `@methodts/pacta-provider-cortex/anthropic-transport` instead. That
 * transport spins up a localhost proxy to enforce `ctx.llm` budget per
 * SDK turn (see PRD §S4 + spike-findings.md).
 */

import type { AnthropicSdkTransport } from './transport.js';

export interface DirectTransportOptions {
  /**
   * API key. Falls back to `ANTHROPIC_API_KEY` env var when omitted.
   * If neither is set the transport returns an empty key — the SDK will
   * then fail at API call time with an auth error, which surfaces back
   * through pacta's error taxonomy.
   */
  apiKey?: string;
}

/**
 * Build a direct-mode transport. The result is safe to share across
 * concurrent invocations because `setup()` only reads config on each
 * call and returns a fresh setup record.
 */
export function directTransport(opts: DirectTransportOptions = {}): AnthropicSdkTransport {
  return {
    async setup() {
      const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
      return {
        env: { ANTHROPIC_API_KEY: apiKey },
        teardown: async () => {
          /* nothing to tear down for direct mode */
        },
      };
    },
  };
}
