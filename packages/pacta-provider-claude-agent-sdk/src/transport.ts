// SPDX-License-Identifier: Apache-2.0
/**
 * S-ANTHROPIC-SDK-TRANSPORT — pluggable seam between this provider and
 * any budget-tracking middleware (specifically Cortex).
 *
 * Why not fetch-shaped? See `spike-findings.md` —
 * `@anthropic-ai/claude-agent-sdk` spawns the `claude` CLI as a
 * subprocess and exposes no fetch hook. The CLI honors
 * `ANTHROPIC_BASE_URL` from its env, so the seam is
 * (process-env injection) + (parent-side HTTP proxy).
 *
 * Producer:  this package (defines the interface)
 * Consumers: @methodts/pacta-provider-cortex (Cortex transport),
 *            test code, future budget/audit/replay middleware
 * Status:    frozen (PRD §S3, revised post-spike 2026-04-19)
 */

export interface AnthropicSdkTransport {
  /**
   * Prepare the transport for an SDK invocation.
   *
   * Returns env vars to merge into `Options.env` (typically
   * `ANTHROPIC_BASE_URL` and `ANTHROPIC_API_KEY`) plus a teardown
   * function the provider invokes after the SDK call completes
   * (success or error).
   *
   * Implementations must be safe to call concurrently from multiple
   * agent invocations; each call returns an independent setup.
   */
  setup(): Promise<{
    env: Record<string, string>;
    teardown: () => Promise<void>;
  }>;
}
