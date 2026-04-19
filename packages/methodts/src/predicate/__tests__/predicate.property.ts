// SPDX-License-Identifier: Apache-2.0
/**
 * Property-based tests for Predicate algebra.
 *
 * Uses fast-check to verify logical equivalences hold for arbitrary
 * Predicate<number> trees up to depth 3.
 *
 * @see F1-FTH Definition 1.1 — logical equivalences over Sigma-sentences
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { Predicate } from "../../predicate/predicate.js";
import {
  TRUE,
  FALSE,
  check,
  and,
  or,
  not,
  implies,
} from "../../predicate/predicate.js";
import { evaluate } from "../../predicate/evaluate.js";

// ── Arbitrary Predicate<number> generator ──

/**
 * Generates arbitrary Predicate<number> trees with depth capped at 3.
 * Uses fc.letrec for recursive structure with a depth-limited base case.
 *
 * Avoids forall/exists in generated trees to keep evaluation tractable
 * (they require element functions that would make equivalence checking complex).
 */
function arbPredicate(maxDepth: number = 3): fc.Arbitrary<Predicate<number>> {
  return fc.letrec<{ pred: Predicate<number> }>((tie) => ({
    pred:
      maxDepth <= 0
        ? fc.oneof(
            fc.constant(TRUE as Predicate<number>),
            fc.constant(FALSE as Predicate<number>),
            fc.integer({ min: -100, max: 100 }).map(
              (threshold) =>
                check<number>(`gt(${threshold})`, (n) => n > threshold),
            ),
          )
        : fc.oneof(
            // Leaves
            fc.constant(TRUE as Predicate<number>),
            fc.constant(FALSE as Predicate<number>),
            fc.integer({ min: -100, max: 100 }).map(
              (threshold) =>
                check<number>(`gt(${threshold})`, (n) => n > threshold),
            ),
            // Recursive — use a smaller generator to cap depth
            arbPredicate(maxDepth - 1).chain((inner) =>
              fc.constant(not(inner)),
            ),
            fc
              .tuple(arbPredicate(maxDepth - 1), arbPredicate(maxDepth - 1))
              .map(([l, r]) => and(l, r)),
            fc
              .tuple(arbPredicate(maxDepth - 1), arbPredicate(maxDepth - 1))
              .map(([l, r]) => or(l, r)),
            fc
              .tuple(arbPredicate(maxDepth - 1), arbPredicate(maxDepth - 1))
              .map(([l, r]) => implies(l, r)),
          ),
  })).pred;
}

const arbPred = arbPredicate(3);
const arbValue = fc.integer({ min: -1000, max: 1000 });

// ── Property Tests ──

describe("Predicate algebra — property tests", () => {
  it("De Morgan: NOT(AND(p, q)) === OR(NOT(p), NOT(q))", () => {
    fc.assert(
      fc.property(arbPred, arbPred, arbValue, (p, q, x) => {
        const lhs = evaluate(not(and(p, q)), x);
        const rhs = evaluate(or(not(p), not(q)), x);
        expect(lhs).toBe(rhs);
      }),
      { numRuns: 200 },
    );
  });

  it("De Morgan dual: NOT(OR(p, q)) === AND(NOT(p), NOT(q))", () => {
    fc.assert(
      fc.property(arbPred, arbPred, arbValue, (p, q, x) => {
        const lhs = evaluate(not(or(p, q)), x);
        const rhs = evaluate(and(not(p), not(q)), x);
        expect(lhs).toBe(rhs);
      }),
      { numRuns: 200 },
    );
  });

  it("Double negation: NOT(NOT(p)) === p", () => {
    fc.assert(
      fc.property(arbPred, arbValue, (p, x) => {
        const lhs = evaluate(not(not(p)), x);
        const rhs = evaluate(p, x);
        expect(lhs).toBe(rhs);
      }),
      { numRuns: 200 },
    );
  });

  it("Implication equivalence: IMPLIES(p, q) === OR(NOT(p), q)", () => {
    fc.assert(
      fc.property(arbPred, arbPred, arbValue, (p, q, x) => {
        const lhs = evaluate(implies(p, q), x);
        const rhs = evaluate(or(not(p), q), x);
        expect(lhs).toBe(rhs);
      }),
      { numRuns: 200 },
    );
  });

  it("val(true) is identity for AND: AND(TRUE, p) === p", () => {
    fc.assert(
      fc.property(arbPred, arbValue, (p, x) => {
        const lhs = evaluate(and(TRUE, p), x);
        const rhs = evaluate(p, x);
        expect(lhs).toBe(rhs);
      }),
      { numRuns: 200 },
    );
  });

  it("val(false) is identity for OR: OR(FALSE, p) === p", () => {
    fc.assert(
      fc.property(arbPred, arbValue, (p, x) => {
        const lhs = evaluate(or(FALSE, p), x);
        const rhs = evaluate(p, x);
        expect(lhs).toBe(rhs);
      }),
      { numRuns: 200 },
    );
  });
});
