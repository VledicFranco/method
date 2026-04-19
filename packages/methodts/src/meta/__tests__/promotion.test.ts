// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { evaluatePromotion } from "../promotion.js";
import type { Method } from "../../method/method.js";
import type { MethodologyRetro } from "../../runtime/retro.js";
import type { DomainTheory } from "../../domain/domain-theory.js";
import type { Role } from "../../domain/role.js";
import type { Step } from "../../method/step.js";
import { TRUE, check } from "../../predicate/predicate.js";
import { Effect } from "effect";

// ── Test state type ──

type TestState = { score: number; reviewed: boolean };

// ── Fixtures ──

function makeDomain(): DomainTheory<TestState> {
  return {
    id: "D-test",
    signature: {
      sorts: [
        { name: "Score", description: "Numeric score", cardinality: "unbounded" },
        { name: "Flag", description: "Boolean flag", cardinality: "finite" },
      ],
      functionSymbols: [
        { name: "getScore", inputSorts: [], outputSort: "Score", totality: "total" },
      ],
      predicates: {
        isReviewed: check<TestState>("isReviewed", (s) => s.reviewed),
      },
    },
    axioms: {
      scoreNonNegative: check<TestState>("scoreNonNegative", (s) => s.score >= 0),
    },
  };
}

function makeStep(id: string, role: string): Step<TestState> {
  return {
    id,
    name: `Step ${id}`,
    role,
    precondition: TRUE,
    postcondition: TRUE,
    execution: {
      tag: "script",
      execute: (s) => Effect.succeed({ ...s, score: s.score + 1 }),
    },
  };
}

function makeRole(id: string): Role<TestState> {
  return {
    id,
    description: `Role ${id}`,
    observe: (s) => s,
    authorized: [],
    notAuthorized: [],
  };
}

function makeMethod(): Method<TestState> {
  const stepA = makeStep("step-a", "engineer");
  return {
    id: "M-test",
    name: "Test Method",
    domain: makeDomain(),
    roles: [makeRole("engineer")],
    dag: {
      steps: [stepA],
      edges: [],
      initial: "step-a",
      terminal: "step-a",
    },
    objective: check<TestState>("scoreAboveZero", (s) => s.score > 0),
    measures: [],
  };
}

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
      perMethod: [{ methodId: "M-test", tokens: 10000, usd: 0.5 }],
    },
    routing: {
      totalLoops: 1,
      methodSequence: ["M-test"],
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

// ── Tests ──

describe("evaluatePromotion", () => {
  it("5 successful retros: eligible, all criteria met, recommend promote", () => {
    const method = makeMethod();
    const retros = Array.from({ length: 5 }, () => makeRetro());

    const result = evaluatePromotion(method, retros);

    expect(result.eligible).toBe(true);
    expect(result.recommendation).toBe("promote");
    expect(result.criteria.every((c) => c.met)).toBe(true);
  });

  it("only 1 retro: insufficient_evidence", () => {
    const method = makeMethod();
    const retros = [makeRetro()];

    const result = evaluatePromotion(method, retros);

    expect(result.eligible).toBe(false);
    expect(result.recommendation).toBe("insufficient_evidence");

    const minRuns = result.criteria.find((c) => c.name === "minimum_runs");
    expect(minRuns).toBeDefined();
    expect(minRuns!.met).toBe(false);
    expect(minRuns!.detail).toBe("1/3 runs completed");
  });

  it("low success rate: needs_work", () => {
    const method = makeMethod();
    const retros = [
      makeRetro({ status: "completed" }),
      makeRetro({ status: "failed" }),
      makeRetro({ status: "failed" }),
      makeRetro({ status: "failed" }),
    ];

    const result = evaluatePromotion(method, retros);

    expect(result.eligible).toBe(false);
    expect(result.recommendation).toBe("needs_work");

    const successRate = result.criteria.find((c) => c.name === "success_rate");
    expect(successRate).toBeDefined();
    expect(successRate!.met).toBe(false);
    expect(successRate!.detail).toContain("25%");
  });

  it("high avg cost: needs_work", () => {
    const method = makeMethod();
    const retros = [
      makeRetro({ cost: { totalTokens: 100000, totalCostUsd: 25.0, perMethod: [] } }),
      makeRetro({ cost: { totalTokens: 100000, totalCostUsd: 30.0, perMethod: [] } }),
      makeRetro({ cost: { totalTokens: 100000, totalCostUsd: 20.0, perMethod: [] } }),
    ];

    const result = evaluatePromotion(method, retros);

    expect(result.eligible).toBe(false);
    expect(result.recommendation).toBe("needs_work");

    const avgCost = result.criteria.find((c) => c.name === "average_cost");
    expect(avgCost).toBeDefined();
    expect(avgCost!.met).toBe(false);
    expect(avgCost!.detail).toContain("$25.00");
  });

  it("safety violations: needs_work", () => {
    const method = makeMethod();
    const retros = [
      makeRetro({
        status: "safety_violation",
        safety: {
          bounds: { maxLoops: 10, maxTokens: 100000, maxCostUsd: 50, maxDurationMs: 3600000 },
          headroom: { loops: 0, tokens: 0, costUsd: 0, durationMs: 0 },
          violated: true,
          violatedBound: "maxLoops",
        },
      }),
      makeRetro(),
      makeRetro(),
    ];

    const result = evaluatePromotion(method, retros);

    expect(result.eligible).toBe(false);
    expect(result.recommendation).toBe("needs_work");

    const safetyCheck = result.criteria.find((c) => c.name === "no_safety_violations");
    expect(safetyCheck).toBeDefined();
    expect(safetyCheck!.met).toBe(false);
    expect(safetyCheck!.detail).toContain("1 safety violation");
  });

  it("custom config thresholds", () => {
    const method = makeMethod();
    // 2 retros with $8 avg cost
    const retros = [
      makeRetro({ cost: { totalTokens: 10000, totalCostUsd: 6.0, perMethod: [] } }),
      makeRetro({ cost: { totalTokens: 10000, totalCostUsd: 10.0, perMethod: [] } }),
    ];

    // With minRuns=2, minSuccessRate=0.5, maxAvgCostUsd=8.0 — should pass
    const result = evaluatePromotion(method, retros, {
      minRuns: 2,
      minSuccessRate: 0.5,
      maxAvgCostUsd: 8.0,
    });

    expect(result.eligible).toBe(true);
    expect(result.recommendation).toBe("promote");

    const minRuns = result.criteria.find((c) => c.name === "minimum_runs");
    expect(minRuns!.met).toBe(true);
    expect(minRuns!.detail).toBe("2/2 runs completed");
  });

  it("empty retros: insufficient_evidence", () => {
    const method = makeMethod();

    const result = evaluatePromotion(method, []);

    expect(result.eligible).toBe(false);
    expect(result.recommendation).toBe("insufficient_evidence");

    // All criteria should report their zero states
    const minRuns = result.criteria.find((c) => c.name === "minimum_runs");
    expect(minRuns!.met).toBe(false);
    expect(minRuns!.detail).toBe("0/3 runs completed");

    const successRate = result.criteria.find((c) => c.name === "success_rate");
    expect(successRate!.detail).toContain("0%");

    const avgCost = result.criteria.find((c) => c.name === "average_cost");
    expect(avgCost!.met).toBe(true); // $0 avg <= $10 limit
  });
});
