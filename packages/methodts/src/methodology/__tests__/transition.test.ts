/**
 * Tests for evaluateTransition and simulateRun.
 *
 * F1-FTH: delta_Phi — deterministic transition function evaluated on priority-stack arms.
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { evaluateTransition, simulateRun } from "../transition.js";
import type { Methodology, Arm } from "../methodology.js";
import type { Method } from "../../method/method.js";
import type { DomainTheory } from "../../domain/domain-theory.js";
import type { StepDAG } from "../../method/dag.js";
import { TRUE, check } from "../../predicate/predicate.js";

// ── Test state type ──

type S = { phase: number; done: boolean };

// ── Shared fixtures ──

const testDomain: DomainTheory<S> = {
  id: "test-domain",
  signature: { sorts: [], functionSymbols: [], predicates: {} },
  axioms: {},
};

function makeStep(id: string) {
  return {
    id,
    name: id,
    role: "agent",
    precondition: TRUE as typeof TRUE,
    postcondition: TRUE as typeof TRUE,
    execution: { tag: "script" as const, execute: (s: S) => Effect.succeed(s) },
  };
}

function makeMethod(id: string): Method<S> {
  const step = makeStep(`${id}-step`);
  const dag: StepDAG<S> = {
    steps: [step],
    edges: [],
    initial: step.id,
    terminal: step.id,
  };
  return {
    id,
    name: `Method ${id}`,
    domain: testDomain,
    roles: [],
    dag,
    objective: TRUE,
    measures: [],
  };
}

const method1 = makeMethod("method-1");
const method2 = makeMethod("method-2");

const arms: readonly Arm<S>[] = [
  {
    priority: 1,
    label: "phase1",
    condition: check<S>("phase1", (s) => s.phase === 1),
    selects: method1,
    rationale: "Select method1 when phase is 1.",
  },
  {
    priority: 2,
    label: "phase2",
    condition: check<S>("phase2", (s) => s.phase === 2),
    selects: method2,
    rationale: "Select method2 when phase is 2.",
  },
  {
    priority: 3,
    label: "done",
    condition: check<S>("done", (s) => s.done === true),
    selects: null,
    rationale: "Terminate when done.",
  },
];

const methodology: Methodology<S> = {
  id: "test-methodology",
  name: "Test Methodology",
  domain: testDomain,
  arms,
  objective: check<S>("done", (s) => s.done),
  terminationCertificate: { measure: (s) => (s.done ? 0 : s.phase), decreases: "Phase decreases toward done." },
  safety: { maxLoops: 10, maxTokens: 100_000, maxCostUsd: 25, maxDurationMs: 600_000, maxDepth: 5 },
};

// ── evaluateTransition ──

describe("evaluateTransition", () => {
  it("selects method1 when state matches arm 1 (phase === 1)", () => {
    const result = evaluateTransition(methodology, { phase: 1, done: false });
    expect(result.firedArm?.label).toBe("phase1");
    expect(result.selectedMethod).toBe(method1);
  });

  it("selects method2 when state matches arm 2 (phase === 2)", () => {
    const result = evaluateTransition(methodology, { phase: 2, done: false });
    expect(result.firedArm?.label).toBe("phase2");
    expect(result.selectedMethod).toBe(method2);
  });

  it("selects null (terminate) when state matches arm 3 (done === true)", () => {
    const result = evaluateTransition(methodology, { phase: 3, done: true });
    expect(result.firedArm?.label).toBe("done");
    expect(result.selectedMethod).toBeNull();
  });

  it("returns null fired arm when no condition matches", () => {
    const result = evaluateTransition(methodology, { phase: 99, done: false });
    expect(result.firedArm).toBeNull();
    expect(result.selectedMethod).toBeNull();
  });

  it("evaluates all arms and records traces with correct fired flags", () => {
    const result = evaluateTransition(methodology, { phase: 1, done: false });

    expect(result.armTraces).toHaveLength(3);
    expect(result.armTraces[0].label).toBe("phase1");
    expect(result.armTraces[0].fired).toBe(true);
    expect(result.armTraces[0].trace.result).toBe(true);

    expect(result.armTraces[1].label).toBe("phase2");
    expect(result.armTraces[1].fired).toBe(false);
    expect(result.armTraces[1].trace.result).toBe(false);

    expect(result.armTraces[2].label).toBe("done");
    expect(result.armTraces[2].fired).toBe(false);
    expect(result.armTraces[2].trace.result).toBe(false);
  });

  it("respects priority ordering — lower priority number wins", () => {
    // Construct a methodology where arms are listed in reverse priority order
    // to confirm sorting works
    const reversedArms: readonly Arm<S>[] = [
      {
        priority: 3,
        label: "low-priority",
        condition: { tag: "val", value: true },
        selects: method2,
        rationale: "Lower priority — always true but should lose.",
      },
      {
        priority: 1,
        label: "high-priority",
        condition: { tag: "val", value: true },
        selects: method1,
        rationale: "Higher priority — always true, should win.",
      },
    ];

    const reversed: Methodology<S> = { ...methodology, arms: reversedArms };
    const result = evaluateTransition(reversed, { phase: 1, done: false });

    expect(result.firedArm?.label).toBe("high-priority");
    expect(result.selectedMethod).toBe(method1);

    // Both trace as true, but only the higher-priority one fires
    const highTrace = result.armTraces.find((t) => t.label === "high-priority");
    const lowTrace = result.armTraces.find((t) => t.label === "low-priority");
    expect(highTrace?.fired).toBe(true);
    expect(lowTrace?.fired).toBe(false);
    expect(lowTrace?.trace.result).toBe(true); // condition matched but didn't fire
  });
});

// ── simulateRun ──

describe("simulateRun", () => {
  it("simulates a sequence of states and returns method selections", () => {
    const states: S[] = [
      { phase: 1, done: false },
      { phase: 2, done: false },
      { phase: 1, done: false },
      { phase: 0, done: true },
    ];

    const result = simulateRun(methodology, states);

    expect(result.selections).toHaveLength(4);
    expect(result.selections[0].selectedMethod).toBe(method1);
    expect(result.selections[1].selectedMethod).toBe(method2);
    expect(result.selections[2].selectedMethod).toBe(method1);
    expect(result.selections[3].selectedMethod).toBeNull();
  });

  it("reports terminatesAt as the index of the first null selection", () => {
    const states: S[] = [
      { phase: 1, done: false },
      { phase: 2, done: false },
      { phase: 1, done: false },
      { phase: 0, done: true },
    ];

    const result = simulateRun(methodology, states);
    expect(result.terminatesAt).toBe(3);
  });

  it("reports terminatesAt as null when no state triggers termination", () => {
    const states: S[] = [
      { phase: 1, done: false },
      { phase: 2, done: false },
    ];

    const result = simulateRun(methodology, states);
    expect(result.terminatesAt).toBeNull();
  });

  it("builds methodSequence with IDs in selection order, excluding nulls", () => {
    const states: S[] = [
      { phase: 1, done: false },
      { phase: 2, done: false },
      { phase: 1, done: false },
      { phase: 0, done: true },
    ];

    const result = simulateRun(methodology, states);
    expect(result.methodSequence).toEqual(["method-1", "method-2", "method-1"]);
  });

  it("returns empty methodSequence when all states terminate immediately", () => {
    const states: S[] = [
      { phase: 0, done: true },
      { phase: 0, done: true },
    ];

    const result = simulateRun(methodology, states);
    expect(result.methodSequence).toEqual([]);
    expect(result.terminatesAt).toBe(0);
  });
});
