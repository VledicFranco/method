/**
 * Retraction pair assertions — verify project ∘ embed = id.
 */

import { type Retraction, verifyRetraction } from "../../index.js";

/**
 * Assert that a retraction pair satisfies project(embed(s)) = s
 * for all test states (on the touched dimensions).
 *
 * @param retraction  The retraction pair to verify
 * @param testStates  Representative parent states
 * @param compare     Optional custom equality (default: JSON deep equality)
 *
 * @example
 * ```ts
 * assertRetracts(triageRetraction, allStates, (a, b) =>
 *   a.severity === b.severity && a.status === b.status,
 * );
 * ```
 */
export function assertRetracts<P, C>(
  retraction: Retraction<P, C>,
  testStates: P[],
  compare?: (original: P, roundTripped: P) => boolean,
): void {
  const result = verifyRetraction(retraction, testStates, compare);
  if (!result.valid) {
    throw new Error(
      `Retraction "${retraction.id}" failed: project(embed(s)) ≠ s\n` +
      `Counterexample: ${JSON.stringify(result.counterexample, null, 2)}`,
    );
  }
}
