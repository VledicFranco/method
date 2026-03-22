/**
 * MockAgentProvider — Test double for AgentProvider.
 *
 * Produces a Layer<AgentProvider> from a declarative config:
 * ordered response matchers, an optional fallback, and failure triggers.
 * First match wins, making test behavior deterministic and predictable.
 *
 * @see PRD 021 Component 13 — MockAgentProvider for testing
 */

import { Effect, Layer } from "effect";
import { AgentProvider, type AgentResult, type AgentError, type AgentCommission } from "./agent-provider.js";

/** A mock response configuration. */
export type MockResponse = {
  /** Predicate: does this response match the commission? */
  readonly match: (commission: AgentCommission) => boolean;
  /** The response to return when matched. */
  readonly result: AgentResult;
};

/** Configuration for MockAgentProvider. */
export type MockAgentProviderConfig = {
  /** Ordered list of responses. First match wins. */
  readonly responses: MockResponse[];
  /** Default response if no match found. */
  readonly fallback?: AgentResult;
  /** Commission prompts that should trigger a failure. */
  readonly failOn?: Array<{
    readonly match: (commission: AgentCommission) => boolean;
    readonly error: AgentError;
  }>;
};

/**
 * Create a MockAgentProvider Layer for testing.
 *
 * Evaluation order:
 * 1. Check `failOn` matchers — first match returns `Effect.fail(error)`.
 * 2. Check `responses` matchers — first match returns `Effect.succeed(result)`.
 * 3. Return `fallback` if provided.
 * 4. Fail with `AgentSpawnFailed` if nothing matched.
 */
export function MockAgentProvider(config: MockAgentProviderConfig): Layer.Layer<AgentProvider> {
  return Layer.succeed(AgentProvider, {
    execute: (commission) => {
      // 1. Check failOn first
      if (config.failOn) {
        for (const f of config.failOn) {
          if (f.match(commission)) return Effect.fail(f.error);
        }
      }
      // 2. Find matching response
      for (const resp of config.responses) {
        if (resp.match(commission)) return Effect.succeed(resp.result);
      }
      // 3. Fallback
      if (config.fallback) return Effect.succeed(config.fallback);
      // 4. No match — spawn failure
      return Effect.fail({
        _tag: "AgentSpawnFailed" as const,
        message: "No mock response matched",
        cause: undefined,
      });
    },
  });
}
