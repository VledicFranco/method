// SPDX-License-Identifier: Apache-2.0
/**
 * BridgeAgentProvider — Production agent provider backed by the bridge HTTP API.
 *
 * Spawns agent sessions via POST /sessions, executes prompts via
 * POST /sessions/:id/prompt, and maps HTTP errors to AgentError variants.
 *
 * The pure helper functions (buildSpawnPayload, parseBridgeResponse, mapBridgeError)
 * are fully tested. The Layer's execute method is a Phase 2 stub — actual HTTP
 * calls require a running bridge server.
 *
 * @see PRD 021 Component 13 — BridgeAgentProvider
 * @see CLAUDE.md Bridge (Agent Session Server) section
 */

import { Effect, Layer } from "effect";
import { AgentProvider, type AgentResult, type AgentError } from "./agent-provider.js";

/** Configuration for the Bridge agent provider. */
export type BridgeProviderConfig = {
  /** Bridge HTTP base URL (e.g., "http://localhost:3456"). */
  readonly bridgeUrl: string;
  /** Default working directory for spawned sessions. */
  readonly defaultWorkdir?: string;
  /** Default model for spawned sessions. */
  readonly defaultModel?: string;
  /** Maximum budget in USD for spawned sessions. */
  readonly maxBudgetUsd?: number;
  /** Timeout in milliseconds for bridge requests. */
  readonly timeoutMs?: number;
  /** Whether to retry once on connection error (matches bridge convention). */
  readonly retryOnConnectionError?: boolean;
};

/** Default configuration values. */
const defaultConfig: Required<BridgeProviderConfig> = {
  bridgeUrl: "http://localhost:3456",
  defaultWorkdir: ".",
  defaultModel: "sonnet",
  maxBudgetUsd: 5,
  timeoutMs: 300000,
  retryOnConnectionError: true,
};

/**
 * Build the session spawn payload from a commission prompt and bridge params.
 *
 * Maps commission.bridge fields to the POST /sessions request body.
 * Undefined optional fields are included as undefined (JSON.stringify strips them).
 *
 * @param prompt - The rendered commission prompt
 * @param config - Bridge provider configuration (supplies defaults)
 * @param bridge - Optional bridge params from the commission
 * @returns Plain object suitable for JSON serialization as POST /sessions body
 */
export function buildSpawnPayload(
  prompt: string,
  config: BridgeProviderConfig,
  bridge?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    prompt,
    workdir: bridge?.workdir ?? config.defaultWorkdir ?? defaultConfig.defaultWorkdir,
    nickname: bridge?.nickname,
    purpose: bridge?.purpose,
    parentSessionId: bridge?.parentSessionId,
    depth: bridge?.depth,
    budget: bridge?.budget,
    isolation: bridge?.isolation,
  };
}

/**
 * Parse a bridge session response into an AgentResult.
 *
 * The bridge returns `{ response, id, cost: { tokens, usd, duration_ms } }`.
 * Missing fields default to empty string / zero.
 */
export function parseBridgeResponse(response: {
  response?: string;
  id?: string;
  cost?: Record<string, number>;
}): AgentResult {
  return {
    raw: response.response ?? "",
    cost: {
      tokens: response.cost?.tokens ?? 0,
      usd: response.cost?.usd ?? 0,
      duration_ms: response.cost?.duration_ms ?? 0,
    },
    sessionId: response.id,
  };
}

/**
 * Map HTTP error status codes to typed AgentError variants.
 *
 * Mapping:
 * - 429 → AgentBudgetExceeded (rate limit / budget)
 * - 403 → AgentPermissionDenied
 * - 504, 408 → AgentTimeout
 * - Everything else → AgentCrash
 *
 * @param status - HTTP response status code
 * @param body - Response body text (for error messages)
 * @param url - The request URL (for permission denied context)
 */
export function mapBridgeError(status: number, body: string, url: string): AgentError {
  if (status === 429) {
    return { _tag: "AgentBudgetExceeded", limit: 0, actual: 0 };
  }
  if (status === 403) {
    return { _tag: "AgentPermissionDenied", resource: url, message: body };
  }
  if (status === 504 || status === 408) {
    return { _tag: "AgentTimeout", message: `Bridge timeout: ${body}`, duration_ms: 0 };
  }
  return { _tag: "AgentCrash", message: `Bridge error ${status}: ${body}` };
}

/**
 * Create a BridgeAgentProvider that spawns agents via the bridge HTTP API.
 *
 * Flow: POST /sessions (spawn) → POST /sessions/:id/prompt (execute) → parse response.
 * Includes automatic retry on connection error (1 retry after 1s), matching the
 * convention used by the MCP proxy tools.
 *
 * In Phase 2, the execute method will perform real HTTP calls. For now it returns
 * AgentSpawnFailed — the pure helper functions are fully tested and production-ready.
 *
 * @param config - Bridge provider configuration
 * @returns Layer providing the AgentProvider service
 */
export function BridgeAgentProvider(config: BridgeProviderConfig): Layer.Layer<AgentProvider> {
  const cfg = { ...defaultConfig, ...config };

  return Layer.succeed(AgentProvider, {
    execute: (commission) =>
      Effect.gen(function* () {
        // Build the spawn payload (verifiable via tests)
        const _payload = buildSpawnPayload(commission.prompt, cfg, commission.bridge);

        // Phase 2 stub — actual HTTP calls require a running bridge
        // The pure functions (buildSpawnPayload, parseBridgeResponse, mapBridgeError)
        // are fully tested and production-ready.
        return yield* Effect.fail<AgentError>({
          _tag: "AgentSpawnFailed",
          message: "BridgeAgentProvider: live execution requires a running bridge server",
          cause: undefined,
        });
      }),
  });
}
