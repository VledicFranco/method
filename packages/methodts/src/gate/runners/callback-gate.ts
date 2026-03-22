/**
 * callbackGate — webhook-style external trigger gate.
 *
 * A gate that waits for an external callback to resolve. Used for
 * webhook-style triggers where an external system signals completion.
 * Returns a gate AND a resolve function. The caller triggers resolve()
 * when the external event arrives.
 *
 * @see PRD 021 Component 7 — callback gate runner
 */

import { Effect } from "effect";
import type { Gate, GateResult, GateError } from "../gate.js";
import { TRUE } from "../../predicate/predicate.js";

/** Configuration for creating a callback gate. */
export type CallbackGateConfig = {
  readonly id: string;
  readonly description: string;
  /** Timeout in milliseconds. If not set, the gate waits indefinitely. */
  readonly timeoutMs?: number;
};

/** Return type of callbackGate — the gate itself plus the resolve handle. */
export type CallbackGateHandle<S> = {
  readonly gate: Gate<S>;
  readonly resolve: (passed: boolean, reason: string) => void;
};

/**
 * Create a gate that waits for an external callback to resolve.
 *
 * The returned resolve function is the "webhook endpoint" — call it
 * when the external event arrives. If timeoutMs is configured and
 * elapses before resolve() is called, the gate fails with a timeout reason.
 *
 * @param config - Gate configuration (id, description, optional timeout)
 * @returns A handle containing the gate and the resolve function
 */
export function callbackGate<S>(config: CallbackGateConfig): CallbackGateHandle<S> {
  let resolveCallback: ((result: GateResult<S>) => void) | null = null;
  let startTime = 0;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const gate: Gate<S> = {
    id: config.id,
    description: config.description,
    predicate: TRUE,
    maxRetries: 0,
    evaluate: (_state: S): Effect.Effect<GateResult<S>, GateError, never> =>
      Effect.async<GateResult<S>, GateError>((resume) => {
        startTime = Date.now();

        resolveCallback = (result) => {
          if (timeoutHandle !== null) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
          }
          resume(Effect.succeed(result));
        };

        if (config.timeoutMs !== undefined) {
          const timeout = config.timeoutMs;
          timeoutHandle = setTimeout(() => {
            timeoutHandle = null;
            resolveCallback = null;
            resume(Effect.succeed({
              passed: false,
              witness: null,
              reason: `Callback gate timed out after ${timeout}ms`,
              duration_ms: timeout,
            }));
          }, timeout);
        }
      }),
  };

  const resolve = (passed: boolean, reason: string): void => {
    if (resolveCallback) {
      resolveCallback({
        passed,
        witness: null,
        reason,
        duration_ms: Date.now() - startTime,
      });
      resolveCallback = null;
    }
  };

  return { gate, resolve };
}
