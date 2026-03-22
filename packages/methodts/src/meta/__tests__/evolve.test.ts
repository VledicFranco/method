import { describe, it, expect } from "vitest";
import {
  aggregateEvidence,
  diffDomainTheory,
  classifyDomainChanges,
  type DomainChange,
} from "../evolve.js";
import type { DomainTheory } from "../../domain/domain-theory.js";
import type { MethodologyRetro } from "../../runtime/retro.js";
import { TRUE } from "../../predicate/predicate.js";

// ── Test state type ──

type TestState = { value: number };

// ── Fixtures ──

function makeRetro(overrides?: Partial<MethodologyRetro>): MethodologyRetro {
  const now = new Date();
  return {
    timing: {
      startedAt: now,
      completedAt: now,
      durationMs: 5000,
    },
    cost: {
      totalTokens: 10000,
      totalCostUsd: 0.5,
      perMethod: [{ methodId: "M-1", tokens: 10000, usd: 0.5 }],
    },
    routing: {
      totalLoops: 1,
      methodSequence: ["M-1"],
    },
    steps: {
      total: 3,
      completed: 3,
      failed: 0,
      totalRetries: 0,
      hardestStep: null,
    },
    safety: {
      bounds: { maxLoops: 10, maxTokens: 100000, maxCostUsd: 50, maxDurationMs: 3600000 },
      headroom: { loops: 9, tokens: 90000, costUsd: 49.5, durationMs: 3595000 },
      violated: false,
      violatedBound: null,
    },
    status: "completed",
    ...overrides,
  };
}

function makeDomain(overrides?: Partial<DomainTheory<TestState>>): DomainTheory<TestState> {
  return {
    id: "D-test",
    signature: {
      sorts: [{ name: "Value", description: "A value", cardinality: "unbounded" }],
      functionSymbols: [
        { name: "getValue", inputSorts: [], outputSort: "Value", totality: "total" },
      ],
      predicates: {
        isPositive: { tag: "check", label: "isPositive", check: (s: TestState) => s.value > 0 },
      },
    },
    axioms: {
      bounded: { tag: "check", label: "bounded", check: (s: TestState) => s.value < 1000 },
    },
    ...overrides,
  };
}

// ── Tests ──

describe("aggregateEvidence", () => {
  it("3 retros produces correct averages and failure rate", () => {
    const retros = [
      makeRetro({ cost: { totalTokens: 10000, totalCostUsd: 1.0, perMethod: [] }, status: "completed" }),
      makeRetro({ cost: { totalTokens: 20000, totalCostUsd: 2.0, perMethod: [] }, status: "completed" }),
      makeRetro({ cost: { totalTokens: 15000, totalCostUsd: 1.5, perMethod: [] }, status: "failed" }),
    ];

    const summary = aggregateEvidence(retros);

    expect(summary.totalRuns).toBe(3);
    expect(summary.avgCostUsd).toBeCloseTo(1.5);
    expect(summary.failureRate).toBeCloseTo(1 / 3);
  });

  it("empty retros returns zeroes", () => {
    const summary = aggregateEvidence([]);

    expect(summary.totalRuns).toBe(0);
    expect(summary.avgCostUsd).toBe(0);
    expect(summary.failureRate).toBe(0);
    expect(summary.stepFailureRates).toEqual({});
  });

  it("all completed retros yield zero failure rate", () => {
    const retros = [
      makeRetro({ status: "completed" }),
      makeRetro({ status: "completed" }),
    ];

    const summary = aggregateEvidence(retros);

    expect(summary.failureRate).toBe(0);
  });

  it("safety_violation counts as failure", () => {
    const retros = [
      makeRetro({ status: "safety_violation" }),
    ];

    const summary = aggregateEvidence(retros);

    expect(summary.failureRate).toBe(1);
  });
});

describe("diffDomainTheory", () => {
  it("detects added sort", () => {
    const before = makeDomain();
    const after = makeDomain({
      signature: {
        ...before.signature,
        sorts: [
          ...before.signature.sorts,
          { name: "Extra", description: "Extra sort", cardinality: "finite" },
        ],
      },
    });

    const changes = diffDomainTheory(before, after);

    expect(changes).toContainEqual({ type: "sort_added", name: "Extra" });
  });

  it("detects removed sort", () => {
    const before = makeDomain();
    const after = makeDomain({
      signature: {
        ...before.signature,
        sorts: [], // removed "Value"
      },
    });

    const changes = diffDomainTheory(before, after);

    expect(changes).toContainEqual({ type: "sort_removed", name: "Value" });
  });

  it("detects added axiom", () => {
    const before = makeDomain();
    const after = makeDomain({
      axioms: {
        ...before.axioms,
        newAxiom: TRUE,
      },
    });

    const changes = diffDomainTheory(before, after);

    expect(changes).toContainEqual({ type: "axiom_added", name: "newAxiom" });
  });

  it("detects removed axiom", () => {
    const before = makeDomain();
    const after = makeDomain({
      axioms: {}, // removed "bounded"
    });

    const changes = diffDomainTheory(before, after);

    expect(changes).toContainEqual({ type: "axiom_removed", name: "bounded" });
  });

  it("detects added predicate", () => {
    const before = makeDomain();
    const after = makeDomain({
      signature: {
        ...before.signature,
        predicates: {
          ...before.signature.predicates,
          isNegative: { tag: "check", label: "isNegative", check: (s: TestState) => s.value < 0 },
        },
      },
    });

    const changes = diffDomainTheory(before, after);

    expect(changes).toContainEqual({ type: "predicate_added", name: "isNegative" });
  });

  it("detects removed predicate", () => {
    const before = makeDomain();
    const after = makeDomain({
      signature: {
        ...before.signature,
        predicates: {}, // removed "isPositive"
      },
    });

    const changes = diffDomainTheory(before, after);

    expect(changes).toContainEqual({ type: "predicate_removed", name: "isPositive" });
  });

  it("detects added function symbol", () => {
    const before = makeDomain();
    const after = makeDomain({
      signature: {
        ...before.signature,
        functionSymbols: [
          ...before.signature.functionSymbols,
          { name: "newFn", inputSorts: ["Value"], outputSort: "Value", totality: "total" },
        ],
      },
    });

    const changes = diffDomainTheory(before, after);

    expect(changes).toContainEqual({ type: "function_added", name: "newFn" });
  });

  it("detects removed function symbol", () => {
    const before = makeDomain();
    const after = makeDomain({
      signature: {
        ...before.signature,
        functionSymbols: [], // removed "getValue"
      },
    });

    const changes = diffDomainTheory(before, after);

    expect(changes).toContainEqual({ type: "function_removed", name: "getValue" });
  });

  it("identical domains produce empty diff", () => {
    const domain = makeDomain();
    const changes = diffDomainTheory(domain, domain);

    expect(changes).toHaveLength(0);
  });
});

describe("classifyDomainChanges", () => {
  it("additions only returns conservative_extension", () => {
    const changes: DomainChange[] = [
      { type: "sort_added", name: "Extra" },
      { type: "axiom_added", name: "newAxiom" },
      { type: "predicate_added", name: "newPred" },
      { type: "function_added", name: "newFn" },
    ];

    expect(classifyDomainChanges(changes)).toBe("conservative_extension");
  });

  it("removals present returns axiom_revision", () => {
    const changes: DomainChange[] = [
      { type: "sort_added", name: "Extra" },
      { type: "axiom_removed", name: "oldAxiom" },
    ];

    expect(classifyDomainChanges(changes)).toBe("axiom_revision");
  });

  it("only removals returns axiom_revision", () => {
    const changes: DomainChange[] = [
      { type: "sort_removed", name: "Old" },
    ];

    expect(classifyDomainChanges(changes)).toBe("axiom_revision");
  });

  it("empty changes returns no_change", () => {
    expect(classifyDomainChanges([])).toBe("no_change");
  });

  it("predicate_removed triggers axiom_revision", () => {
    const changes: DomainChange[] = [{ type: "predicate_removed", name: "x" }];

    expect(classifyDomainChanges(changes)).toBe("axiom_revision");
  });

  it("function_removed triggers axiom_revision", () => {
    const changes: DomainChange[] = [{ type: "function_removed", name: "x" }];

    expect(classifyDomainChanges(changes)).toBe("axiom_revision");
  });
});
