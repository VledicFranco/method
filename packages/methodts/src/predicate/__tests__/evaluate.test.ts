// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for the predicate evaluation engine.
 *
 * Tests `evaluate` with concrete values across all 8 variants,
 * and `evaluateWithTrace` for correct diagnostic tree structure.
 *
 * @see F1-FTH section 1 — Mod(D) membership testing via axiom evaluation
 */

import { describe, it, expect } from "vitest";
import {
  TRUE,
  FALSE,
  check,
  and,
  or,
  not,
  implies,
  forall,
  exists,
} from "../../predicate/predicate.js";
import { evaluate, evaluateWithTrace } from "../../predicate/evaluate.js";
import type { EvalTrace } from "../../predicate/evaluate.js";

// ── evaluate: all 8 variants with concrete values ──

describe("evaluate", () => {
  it("val(true) returns true", () => {
    expect(evaluate(TRUE, "anything")).toBe(true);
  });

  it("val(false) returns false", () => {
    expect(evaluate(FALSE, "anything")).toBe(false);
  });

  it("check: string length > 3", () => {
    const p = check<string>("long", (s) => s.length > 3);
    expect(evaluate(p, "hello")).toBe(true);
    expect(evaluate(p, "hi")).toBe(false);
  });

  it("and: both checks must pass", () => {
    const gt0 = check<number>("gt0", (n) => n > 0);
    const lt10 = check<number>("lt10", (n) => n < 10);
    expect(evaluate(and(gt0, lt10), 5)).toBe(true);
    expect(evaluate(and(gt0, lt10), -1)).toBe(false);
    expect(evaluate(and(gt0, lt10), 15)).toBe(false);
  });

  it("or: at least one check must pass", () => {
    const isZero = check<number>("zero", (n) => n === 0);
    const isOne = check<number>("one", (n) => n === 1);
    expect(evaluate(or(isZero, isOne), 0)).toBe(true);
    expect(evaluate(or(isZero, isOne), 1)).toBe(true);
    expect(evaluate(or(isZero, isOne), 2)).toBe(false);
  });

  it("not: negates a check", () => {
    const even = check<number>("even", (n) => n % 2 === 0);
    expect(evaluate(not(even), 3)).toBe(true);
    expect(evaluate(not(even), 4)).toBe(false);
  });

  it("implies: material implication with concrete numbers", () => {
    // "if n > 10, then n > 5"
    const gt10 = check<number>("gt10", (n) => n > 10);
    const gt5 = check<number>("gt5", (n) => n > 5);
    const p = implies(gt10, gt5);
    expect(evaluate(p, 15)).toBe(true); // T -> T = T
    expect(evaluate(p, 3)).toBe(true); // F -> F = T
    expect(evaluate(p, 8)).toBe(true); // F -> T = T
    // Can't easily get T -> F with this predicate, so test with literals
    expect(evaluate(implies(TRUE, FALSE), 0)).toBe(false);
  });

  it("forall: checks body against all elements", () => {
    // "for all chars in string, char is lowercase"
    const p = forall<string>(
      "chars",
      (s) => s.split(""),
      check("lowercase", (c) => c === c.toLowerCase()),
    );
    expect(evaluate(p, "hello")).toBe(true);
    expect(evaluate(p, "Hello")).toBe(false);
  });

  it("exists: checks body against at least one element", () => {
    // "there exists a digit in the string"
    const p = exists<string>(
      "chars",
      (s) => s.split(""),
      check("digit", (c) => /\d/.test(c)),
    );
    expect(evaluate(p, "abc1")).toBe(true);
    expect(evaluate(p, "abcd")).toBe(false);
  });
});

// ── evaluateWithTrace: diagnostic tree structure ──

describe("evaluateWithTrace", () => {
  it("val produces leaf with correct label and no children", () => {
    const trace = evaluateWithTrace(TRUE, 0);
    expect(trace.label).toBe("literal(true)");
    expect(trace.result).toBe(true);
    expect(trace.children).toEqual([]);

    const traceFalse = evaluateWithTrace(FALSE, 0);
    expect(traceFalse.label).toBe("literal(false)");
    expect(traceFalse.result).toBe(false);
    expect(traceFalse.children).toEqual([]);
  });

  it("check produces leaf with label from predicate", () => {
    const p = check<number>("is-even", (n) => n % 2 === 0);
    const trace = evaluateWithTrace(p, 4);
    expect(trace.label).toBe("is-even");
    expect(trace.result).toBe(true);
    expect(trace.children).toEqual([]);
  });

  it("AND node has exactly 2 children", () => {
    const p = and(TRUE, FALSE);
    const trace = evaluateWithTrace(p, 0);
    expect(trace.label).toBe("AND");
    expect(trace.result).toBe(false);
    expect(trace.children).toHaveLength(2);
    expect(trace.children[0].result).toBe(true);
    expect(trace.children[1].result).toBe(false);
  });

  it("OR node has exactly 2 children", () => {
    const p = or(TRUE, FALSE);
    const trace = evaluateWithTrace(p, 0);
    expect(trace.label).toBe("OR");
    expect(trace.result).toBe(true);
    expect(trace.children).toHaveLength(2);
    expect(trace.children[0].result).toBe(true);
    expect(trace.children[1].result).toBe(false);
  });

  it("NOT node has exactly 1 child", () => {
    const p = not(TRUE);
    const trace = evaluateWithTrace(p, 0);
    expect(trace.label).toBe("NOT");
    expect(trace.result).toBe(false);
    expect(trace.children).toHaveLength(1);
    expect(trace.children[0].result).toBe(true);
  });

  it("IMPLIES node has exactly 2 children (antecedent, consequent)", () => {
    const p = implies(TRUE, FALSE);
    const trace = evaluateWithTrace(p, 0);
    expect(trace.label).toBe("IMPLIES");
    expect(trace.result).toBe(false);
    expect(trace.children).toHaveLength(2);
    // First child is antecedent
    expect(trace.children[0].label).toBe("literal(true)");
    expect(trace.children[0].result).toBe(true);
    // Second child is consequent
    expect(trace.children[1].label).toBe("literal(false)");
    expect(trace.children[1].result).toBe(false);
  });

  it("FORALL node has N children matching element count", () => {
    const p = forall<number>(
      "triple",
      (n) => [n - 1, n, n + 1],
      check("positive", (x) => x > 0),
    );
    const trace = evaluateWithTrace(p, 5);
    expect(trace.label).toBe("FORALL(triple)");
    expect(trace.result).toBe(true);
    expect(trace.children).toHaveLength(3); // 3 elements: [4, 5, 6]
    for (const child of trace.children) {
      expect(child.result).toBe(true);
      expect(child.children).toEqual([]); // leaf checks
    }
  });

  it("EXISTS node has N children matching element count", () => {
    const p = exists<number>(
      "pair",
      (n) => [n, n + 1],
      check("even", (x) => x % 2 === 0),
    );
    const trace = evaluateWithTrace(p, 3);
    expect(trace.label).toBe("EXISTS(pair)");
    expect(trace.result).toBe(true);
    expect(trace.children).toHaveLength(2); // 2 elements: [3, 4]
    expect(trace.children[0].result).toBe(false); // 3 is odd
    expect(trace.children[1].result).toBe(true); // 4 is even
  });

  it("FORALL with empty array has 0 children and result true", () => {
    const p = forall<number>("empty", () => [], TRUE);
    const trace = evaluateWithTrace(p, 0);
    expect(trace.label).toBe("FORALL(empty)");
    expect(trace.result).toBe(true);
    expect(trace.children).toHaveLength(0);
  });

  it("EXISTS with empty array has 0 children and result false", () => {
    const p = exists<number>("empty", () => [], TRUE);
    const trace = evaluateWithTrace(p, 0);
    expect(trace.label).toBe("EXISTS(empty)");
    expect(trace.result).toBe(false);
    expect(trace.children).toHaveLength(0);
  });

  it("nested tree: AND(check, NOT(check)) produces correct structure", () => {
    const even = check<number>("even", (n) => n % 2 === 0);
    const p = and(even, not(even));
    const trace = evaluateWithTrace(p, 4);

    expect(trace.label).toBe("AND");
    expect(trace.result).toBe(false); // even AND NOT(even) is always false
    expect(trace.children).toHaveLength(2);

    // Left child: check
    expect(trace.children[0].label).toBe("even");
    expect(trace.children[0].result).toBe(true);
    expect(trace.children[0].children).toEqual([]);

    // Right child: NOT
    const notChild = trace.children[1];
    expect(notChild.label).toBe("NOT");
    expect(notChild.result).toBe(false);
    expect(notChild.children).toHaveLength(1);
    expect(notChild.children[0].label).toBe("even");
    expect(notChild.children[0].result).toBe(true);
  });
});
