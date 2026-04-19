// SPDX-License-Identifier: Apache-2.0
/**
 * StepDAG<S> tests — topological ordering and composability checking.
 *
 * F1-FTH Definition 4.4: Gamma = (V, E, sigma_init, sigma_term)
 * F1-FTH Definition 4.3: composability — post(A) subset pre(B)
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import type { Step } from "../step.js";
import type { StepDAG } from "../dag.js";
import { topologicalOrder, checkComposability } from "../dag.js";
import { TRUE, FALSE, check } from "../../predicate/predicate.js";

type TestState = { readonly phase: number };

/** Helper: create a minimal script step with given pre/post conditions. */
function makeStep(
  id: string,
  pre = TRUE as import("../../predicate/predicate.js").Predicate<TestState>,
  post = TRUE as import("../../predicate/predicate.js").Predicate<TestState>,
): Step<TestState> {
  return {
    id,
    name: id,
    role: "system",
    precondition: pre,
    postcondition: post,
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  };
}

describe("topologicalOrder — Kahn's algorithm (F1-FTH Def 4.4)", () => {
  it("linear DAG (A->B->C) returns [A, B, C]", () => {
    const a = makeStep("A");
    const b = makeStep("B");
    const c = makeStep("C");

    const dag: StepDAG<TestState> = {
      steps: [a, b, c],
      edges: [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
      ],
      initial: "A",
      terminal: "C",
    };

    const order = topologicalOrder(dag);
    expect(order.map((s) => s.id)).toEqual(["A", "B", "C"]);
  });

  it("diamond DAG (A->B, A->C, B->D, C->D) returns valid topo order", () => {
    const a = makeStep("A");
    const b = makeStep("B");
    const c = makeStep("C");
    const d = makeStep("D");

    const dag: StepDAG<TestState> = {
      steps: [a, b, c, d],
      edges: [
        { from: "A", to: "B" },
        { from: "A", to: "C" },
        { from: "B", to: "D" },
        { from: "C", to: "D" },
      ],
      initial: "A",
      terminal: "D",
    };

    const order = topologicalOrder(dag);
    const ids = order.map((s) => s.id);

    // A must be first, D must be last
    expect(ids[0]).toBe("A");
    expect(ids[ids.length - 1]).toBe("D");

    // B and C must both come after A and before D
    expect(ids.indexOf("B")).toBeGreaterThan(ids.indexOf("A"));
    expect(ids.indexOf("C")).toBeGreaterThan(ids.indexOf("A"));
    expect(ids.indexOf("B")).toBeLessThan(ids.indexOf("D"));
    expect(ids.indexOf("C")).toBeLessThan(ids.indexOf("D"));

    // All four steps present
    expect(ids).toHaveLength(4);
  });

  it("single node DAG returns [A]", () => {
    const a = makeStep("A");

    const dag: StepDAG<TestState> = {
      steps: [a],
      edges: [],
      initial: "A",
      terminal: "A",
    };

    const order = topologicalOrder(dag);
    expect(order.map((s) => s.id)).toEqual(["A"]);
  });

  it("throws on cyclic DAG", () => {
    const a = makeStep("A");
    const b = makeStep("B");

    const cyclicDag: StepDAG<TestState> = {
      steps: [a, b],
      edges: [{ from: "A", to: "B" }, { from: "B", to: "A" }],
      initial: "A",
      terminal: "B",
    };

    expect(() => topologicalOrder(cyclicDag)).toThrow(/[Cc]ycle/);
  });

  it("parallel branches (A->C, B->C) accepts both valid orderings", () => {
    const a = makeStep("A");
    const b = makeStep("B");
    const c = makeStep("C");

    const dag: StepDAG<TestState> = {
      steps: [a, b, c],
      edges: [
        { from: "A", to: "C" },
        { from: "B", to: "C" },
      ],
      initial: "A",
      terminal: "C",
    };

    const order = topologicalOrder(dag);
    const ids = order.map((s) => s.id);

    // C must be last (depends on both A and B)
    expect(ids[ids.length - 1]).toBe("C");

    // A and B can be in either order, but both before C
    expect(ids.indexOf("A")).toBeLessThan(ids.indexOf("C"));
    expect(ids.indexOf("B")).toBeLessThan(ids.indexOf("C"));
    expect(ids).toHaveLength(3);
  });
});

describe("checkComposability — post(A) subset pre(B) (F1-FTH Def 4.3)", () => {
  it("composable pair: postcondition implies precondition over all test states", () => {
    // stepA postcondition: phase >= 1
    // stepB precondition: phase >= 1
    // When post(A) holds, pre(B) also holds => composable
    const stepA = makeStep(
      "A",
      TRUE,
      check<TestState>("phase>=1", (s) => s.phase >= 1),
    );
    const stepB = makeStep(
      "B",
      check<TestState>("phase>=1", (s) => s.phase >= 1),
      TRUE,
    );

    const testStates: TestState[] = [
      { phase: 0 },
      { phase: 1 },
      { phase: 2 },
      { phase: 3 },
    ];

    const result = checkComposability(stepA, stepB, testStates);
    expect(result).toEqual({ composable: true, counterexample: null });
  });

  it("non-composable pair: postcondition holds but precondition fails", () => {
    // stepA postcondition: phase >= 1
    // stepB precondition: phase >= 2
    // State { phase: 1 }: post(A) is true but pre(B) is false => counterexample
    const stepA = makeStep(
      "A",
      TRUE,
      check<TestState>("phase>=1", (s) => s.phase >= 1),
    );
    const stepB = makeStep(
      "B",
      check<TestState>("phase>=2", (s) => s.phase >= 2),
      TRUE,
    );

    const testStates: TestState[] = [
      { phase: 0 },
      { phase: 1 },
      { phase: 2 },
    ];

    const result = checkComposability(stepA, stepB, testStates);
    expect(result.composable).toBe(false);
    expect(result.counterexample).toEqual({ phase: 1 });
  });

  it("vacuously composable: postcondition never true over test states", () => {
    // stepA postcondition is FALSE — never holds
    // Therefore the implication post(A) => pre(B) is vacuously true
    const stepA = makeStep("A", TRUE, FALSE);
    const stepB = makeStep("B", FALSE, TRUE);

    const testStates: TestState[] = [
      { phase: 0 },
      { phase: 1 },
      { phase: 2 },
    ];

    const result = checkComposability(stepA, stepB, testStates);
    expect(result).toEqual({ composable: true, counterexample: null });
  });

  it("composable with empty test states (vacuously)", () => {
    const stepA = makeStep("A", TRUE, TRUE);
    const stepB = makeStep("B", FALSE, TRUE);

    const result = checkComposability(stepA, stepB, []);
    expect(result).toEqual({ composable: true, counterexample: null });
  });
});
