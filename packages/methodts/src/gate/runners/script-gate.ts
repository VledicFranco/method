/**
 * scriptGate — the simplest gate runner.
 *
 * Wraps a Predicate<S> into a Gate<S> whose evaluate function
 * is pure: it calls evaluateWithTrace, constructs a GateResult,
 * and returns via Effect.succeed. scriptGate never fails with
 * GateError because predicate evaluation is synchronous and total.
 *
 * @see PRD 021 Component 7 — scriptGate runner
 */

import { Effect } from "effect";
import type { Predicate } from "../../predicate/predicate.js";
import { evaluateWithTrace } from "../../predicate/evaluate.js";
import type { Gate, GateResult, GateError } from "../gate.js";

/**
 * Create a Gate from a Predicate.
 *
 * The evaluate function is pure — it never fails with GateError.
 * The witness field is populated when the predicate passes,
 * providing cryptographic-style evidence that the check held.
 *
 * @param id - Unique identifier for this gate
 * @param description - Human-readable description of what this gate checks
 * @param predicate - The predicate to evaluate
 * @param maxRetries - Maximum retry count (default 0, meaning no retries)
 * @returns A Gate that evaluates the predicate against a state
 */
export function scriptGate<S>(
  id: string,
  description: string,
  predicate: Predicate<S>,
  maxRetries: number = 0,
): Gate<S> {
  return {
    id,
    description,
    predicate,
    maxRetries,
    evaluate: (state: S): Effect.Effect<GateResult<S>, GateError, never> => {
      const start = Date.now();
      const trace = evaluateWithTrace(predicate, state);
      const passed = trace.result;
      const duration_ms = Date.now() - start;

      const result: GateResult<S> = {
        passed,
        witness: passed
          ? { predicate, evaluatedAt: new Date(), trace }
          : null,
        reason: trace.label,
        duration_ms,
      };

      return Effect.succeed(result);
    },
  };
}
