// SPDX-License-Identifier: Apache-2.0
/**
 * DomainMorphism<S, T> — Structure-preserving map between domain theories.
 *
 * F1-FTH Def 1.4: h: D_1 -> D_2 where h preserves sort membership,
 * function interpretation, and axiom satisfaction.
 *
 * @see theory-mapping.md — maps to h: D_1 -> D_2
 */

import type { DomainTheory } from "./domain-theory.js";
import { validateAxioms } from "./domain-theory.js";

/**
 * A structure-preserving map between two domain theories.
 *
 * S is the state type of the source domain, T is the state type of the target.
 * mapState transforms source states into target states.
 * mapSort records the correspondence between sort names.
 */
export type DomainMorphism<S, T> = {
  readonly id: string;
  readonly source: DomainTheory<S>;
  readonly target: DomainTheory<T>;
  readonly mapState: (s: S) => T;
  readonly mapSort: ReadonlyMap<string, string>;
};

/**
 * Compose two morphisms: h2 . h1 : D_1 -> D_3
 *
 * State mapping is function composition: (a) => h2.mapState(h1.mapState(a)).
 * Sort mapping is relational composition: sA -> sB -> sC.
 * Only sorts with a complete chain (sA mapped to sB, sB mapped to sC) appear
 * in the composed sort map.
 */
export function composeMorphisms<A, B, C>(
  h1: DomainMorphism<A, B>,
  h2: DomainMorphism<B, C>,
): DomainMorphism<A, C> {
  const composedSortMap = new Map<string, string>();
  for (const [sA, sB] of h1.mapSort) {
    const sC = h2.mapSort.get(sB);
    if (sC) composedSortMap.set(sA, sC);
  }
  return {
    id: `${h2.id}.${h1.id}`,
    source: h1.source,
    target: h2.target,
    mapState: (a: A) => h2.mapState(h1.mapState(a)),
    mapSort: composedSortMap,
  };
}

/**
 * Verify that a morphism preserves axiom satisfaction:
 * if s in Mod(D_1) then h(s) in Mod(D_2).
 *
 * Tests against a provided set of witness states. Returns valid: true if
 * every source-valid state maps to a target-valid state, or a counterexample
 * if preservation fails.
 */
export function verifyMorphism<S, T>(
  morphism: DomainMorphism<S, T>,
  testStates: S[],
): { valid: boolean; counterexample: S | null } {
  for (const state of testStates) {
    const sourceResult = validateAxioms(morphism.source, state);
    if (sourceResult.valid) {
      const mapped = morphism.mapState(state);
      const targetResult = validateAxioms(morphism.target, mapped);
      if (!targetResult.valid) {
        return { valid: false, counterexample: state };
      }
    }
  }
  return { valid: true, counterexample: null };
}

/**
 * Check that all source sorts have a corresponding target sort in the morphism.
 * Returns the list of unmapped sort names.
 */
export function verifySortMapping<S, T>(
  morphism: DomainMorphism<S, T>,
): { valid: boolean; unmapped: string[] } {
  const unmapped: string[] = [];
  for (const sort of morphism.source.signature.sorts) {
    if (!morphism.mapSort.has(sort.name)) {
      unmapped.push(sort.name);
    }
  }
  return { valid: unmapped.length === 0, unmapped };
}
