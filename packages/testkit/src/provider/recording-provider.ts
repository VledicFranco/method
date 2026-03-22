/**
 * RecordingProvider — wraps MockAgentProvider to capture all commissions and results.
 */

import { Effect, Layer } from "effect";
import {
  AgentProvider,
  type AgentResult,
  type AgentError,
  type AgentCommission,
  type MockAgentProviderConfig,
} from "@method/methodts";

/** A recorded agent interaction. */
export type Recording = {
  readonly commission: AgentCommission;
  readonly result: AgentResult | null;
  readonly error: AgentError | null;
  readonly timestamp: Date;
};

export type RecordingProviderResult = {
  /** Effect Layer to provide to your methodology run. */
  readonly layer: Layer.Layer<AgentProvider>;
  /** Mutable array of recordings — inspect after execution. */
  readonly recordings: Recording[];
};

/**
 * Create a RecordingProvider that captures every agent interaction.
 *
 * @example
 * ```ts
 * const { layer, recordings } = RecordingProvider({
 *   responses: [
 *     { match: c => c.prompt.includes("triage"), result: { raw: "done", cost: { tokens: 100, usd: 0.01, duration_ms: 500 } } },
 *   ],
 *   fallback: { raw: "{}", cost: { tokens: 0, usd: 0, duration_ms: 0 } },
 * });
 *
 * const result = await Effect.runPromise(
 *   runMethodology(methodology, state).pipe(Effect.provide(layer))
 * );
 *
 * expect(recordings).toHaveLength(1);
 * expect(recordings[0].commission.prompt).toContain("triage");
 * ```
 */
export function RecordingProvider(config: MockAgentProviderConfig): RecordingProviderResult {
  const recordings: Recording[] = [];

  const layer = Layer.succeed(AgentProvider, {
    execute: (commission: AgentCommission) => {
      // 1. Check failOn
      if (config.failOn) {
        for (const f of config.failOn) {
          if (f.match(commission)) {
            recordings.push({ commission, result: null, error: f.error, timestamp: new Date() });
            return Effect.fail(f.error);
          }
        }
      }
      // 2. Find matching response
      for (const resp of config.responses) {
        if (resp.match(commission)) {
          recordings.push({ commission, result: resp.result, error: null, timestamp: new Date() });
          return Effect.succeed(resp.result);
        }
      }
      // 3. Fallback
      if (config.fallback) {
        recordings.push({ commission, result: config.fallback, error: null, timestamp: new Date() });
        return Effect.succeed(config.fallback);
      }
      // 4. No match
      const error: AgentError = {
        _tag: "AgentSpawnFailed" as const,
        message: "No mock response matched (RecordingProvider)",
        cause: undefined,
      };
      recordings.push({ commission, result: null, error, timestamp: new Date() });
      return Effect.fail(error);
    },
  });

  return { layer, recordings };
}

/**
 * Create a SequenceProvider that returns responses in order.
 * Simpler than match-based config when you just want sequential responses.
 *
 * @example
 * ```ts
 * const { layer, recordings } = SequenceProvider([
 *   { raw: '{"severity":"sev1"}', cost: { tokens: 100, usd: 0.001, duration_ms: 500 } },
 *   { raw: '{"action":"restart"}', cost: { tokens: 80, usd: 0.001, duration_ms: 400 } },
 * ]);
 * ```
 */
export function SequenceProvider(
  responses: AgentResult[],
  fallback?: AgentResult,
): RecordingProviderResult {
  let index = 0;
  const recordings: Recording[] = [];

  const layer = Layer.succeed(AgentProvider, {
    execute: (commission: AgentCommission) => {
      if (index < responses.length) {
        const result = responses[index++];
        recordings.push({ commission, result, error: null, timestamp: new Date() });
        return Effect.succeed(result);
      }
      if (fallback) {
        recordings.push({ commission, result: fallback, error: null, timestamp: new Date() });
        return Effect.succeed(fallback);
      }
      const error: AgentError = {
        _tag: "AgentSpawnFailed" as const,
        message: `SequenceProvider exhausted after ${responses.length} responses`,
        cause: undefined,
      };
      recordings.push({ commission, result: null, error, timestamp: new Date() });
      return Effect.fail(error);
    },
  });

  return { layer, recordings };
}

/**
 * Silent provider for script-only execution. Zero ceremony.
 *
 * If an agent step accidentally invokes this provider, it fails with a clear
 * error message rather than returning `{}` which would silently produce wrong state.
 */
export function silentProvider(): Layer.Layer<AgentProvider> {
  return Layer.succeed(AgentProvider, {
    execute: (commission: AgentCommission) =>
      Effect.fail<AgentError>({
        _tag: "AgentSpawnFailed",
        message:
          `silentProvider received an agent commission but has no configured responses. ` +
          `This usually means a methodology has agent steps but runMethodologyIsolated/runMethodIsolated ` +
          `was called without agentResponses or a provider. ` +
          `Prompt preview: "${commission.prompt.slice(0, 100)}..."`,
        cause: undefined,
      }),
  });
}
