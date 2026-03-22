/**
 * Predicate assertions — fail with diagnostic EvalTrace on error.
 */

import {
  type Predicate,
  evaluate,
  evaluateWithTrace,
} from "@method/methodts";
import { formatTraceWithFailures } from "../diagnostics/trace-printer.js";

/**
 * Assert that a predicate holds for the given state.
 * On failure, throws with a formatted EvalTrace showing which sub-predicates failed.
 *
 * @example
 * ```ts
 * assertHolds(isDetected, STATES.detected);
 * ```
 */
export function assertHolds<A>(pred: Predicate<A>, value: A, message?: string): void {
  if (!evaluate(pred, value)) {
    const trace = evaluateWithTrace(pred, value);
    const traceStr = formatTraceWithFailures(trace);
    const label = getPredicateLabel(pred);
    throw new AssertionError(
      `${message ?? `Predicate "${label}" rejected state`}\n\nTrace:\n${traceStr}`,
    );
  }
}

/**
 * Assert that a predicate does NOT hold for the given state.
 * On failure, throws with the EvalTrace showing why it unexpectedly passed.
 *
 * @example
 * ```ts
 * assertRejects(isDetected, STATES.triaged);
 * ```
 */
export function assertRejects<A>(pred: Predicate<A>, value: A, message?: string): void {
  if (evaluate(pred, value)) {
    const trace = evaluateWithTrace(pred, value);
    const traceStr = formatTraceWithFailures(trace);
    const label = getPredicateLabel(pred);
    throw new AssertionError(
      `${message ?? `Expected predicate "${label}" to reject state, but it passed`}\n\nTrace:\n${traceStr}`,
    );
  }
}

/**
 * Assert that two predicates are equivalent over a set of test values.
 * Useful for verifying predicate refactoring doesn't change behavior.
 */
export function assertEquivalent<A>(
  predA: Predicate<A>,
  predB: Predicate<A>,
  testValues: A[],
  message?: string,
): void {
  for (let i = 0; i < testValues.length; i++) {
    const value = testValues[i];
    const resultA = evaluate(predA, value);
    const resultB = evaluate(predB, value);
    if (resultA !== resultB) {
      const traceA = evaluateWithTrace(predA, value);
      const traceB = evaluateWithTrace(predB, value);
      const labelA = getPredicateLabel(predA);
      const labelB = getPredicateLabel(predB);
      throw new AssertionError(
        `${message ?? "Predicates are not equivalent"}\n` +
        `Test value index ${i}: "${labelA}" = ${resultA}, "${labelB}" = ${resultB}\n\n` +
        `Trace A:\n${formatTraceWithFailures(traceA)}\n\n` +
        `Trace B:\n${formatTraceWithFailures(traceB)}`,
      );
    }
  }
}

function getPredicateLabel<A>(pred: Predicate<A>): string {
  switch (pred.tag) {
    case "val": return `literal(${pred.value})`;
    case "check": return pred.label;
    case "and": return "AND";
    case "or": return "OR";
    case "not": return "NOT";
    case "implies": return "IMPLIES";
    case "forall": return `FORALL(${pred.label})`;
    case "exists": return `EXISTS(${pred.label})`;
  }
}

class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}
