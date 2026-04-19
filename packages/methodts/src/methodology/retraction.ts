// SPDX-License-Identifier: Apache-2.0
/**
 * Retraction<P, C> — Domain retraction pairs.
 *
 * F1-FTH Definition 6.3: (embed, project) with project ∘ embed = id
 * on the touched subspace.
 *
 * @see theory-mapping.md — maps to (embed, project) with round-trip
 */

/** A domain retraction pair connecting parent state P to child state C. */
export type Retraction<P, C> = {
  readonly id: string;
  readonly embed: (parent: P) => C;
  readonly project: (child: C) => P;
};

/**
 * Test the retraction condition: project(embed(s)) should equal s
 * on the dimensions the child method touches.
 */
export function verifyRetraction<P, C>(
  retraction: Retraction<P, C>,
  testStates: P[],
  compare?: (original: P, roundTripped: P) => boolean,
): { valid: boolean; counterexample: P | null } {
  const eq = compare ?? ((a, b) => JSON.stringify(a) === JSON.stringify(b));
  for (const state of testStates) {
    const roundTripped = retraction.project(retraction.embed(state));
    if (!eq(state, roundTripped)) {
      return { valid: false, counterexample: state };
    }
  }
  return { valid: true, counterexample: null };
}
