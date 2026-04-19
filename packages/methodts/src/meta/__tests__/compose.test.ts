// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { mergeDomainTheories, composeDAGs, compose } from "../compose.js";
import type { Method } from "../../method/method.js";
import type { Step } from "../../method/step.js";
import type { DomainTheory } from "../../domain/domain-theory.js";
import type { StepDAG } from "../../method/dag.js";
import type { Role } from "../../domain/role.js";
import { TRUE, check } from "../../predicate/predicate.js";
import { evaluate } from "../../predicate/evaluate.js";
import { Effect } from "effect";

// ── Test state type ──

type TestState = { score: number; reviewed: boolean; quality: number };

// ── Fixtures ──

function makeDomain(
  id: string,
  overrides?: Partial<DomainTheory<TestState>>,
): DomainTheory<TestState> {
  return {
    id,
    signature: {
      sorts: [
        { name: "Score", description: "Numeric score", cardinality: "unbounded" },
      ],
      functionSymbols: [
        { name: "getScore", inputSorts: [], outputSort: "Score", totality: "total" },
      ],
      predicates: {
        hasScore: check<TestState>("hasScore", (s) => s.score > 0),
      },
    },
    axioms: {
      scoreNonNeg: check<TestState>("scoreNonNeg", (s) => s.score >= 0),
    },
    ...overrides,
  };
}

function makeScriptStep(id: string, role: string): Step<TestState> {
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

function makeDAG(steps: Step<TestState>[], edges: { from: string; to: string }[]): StepDAG<TestState> {
  return {
    steps,
    edges,
    initial: steps[0].id,
    terminal: steps[steps.length - 1].id,
  };
}

function makeMethod(
  id: string,
  name: string,
  domain: DomainTheory<TestState>,
  roles: Role<TestState>[],
  dag: StepDAG<TestState>,
  objective = check<TestState>("default-obj", (s) => s.score > 0),
): Method<TestState> {
  return { id, name, domain, roles, dag, objective, measures: [] };
}

// ── mergeDomainTheories ──

describe("mergeDomainTheories", () => {
  it("disjoint domains merge with all elements", () => {
    const a = makeDomain("D-a");
    const b: DomainTheory<TestState> = {
      id: "D-b",
      signature: {
        sorts: [
          { name: "Quality", description: "Quality metric", cardinality: "finite" },
        ],
        functionSymbols: [
          { name: "getQuality", inputSorts: [], outputSort: "Quality", totality: "total" },
        ],
        predicates: {
          isReviewed: check<TestState>("isReviewed", (s) => s.reviewed),
        },
      },
      axioms: {
        qualityBounded: check<TestState>("qualityBounded", (s) => s.quality >= 0 && s.quality <= 100),
      },
    };

    const { merged, conflicts } = mergeDomainTheories(a, b);

    expect(conflicts).toHaveLength(0);
    expect(merged.id).toBe("D-a+D-b");
    // Sorts: Score from a + Quality from b
    expect(merged.signature.sorts).toHaveLength(2);
    expect(merged.signature.sorts.map((s) => s.name)).toContain("Score");
    expect(merged.signature.sorts.map((s) => s.name)).toContain("Quality");
    // Function symbols: getScore from a + getQuality from b
    expect(merged.signature.functionSymbols).toHaveLength(2);
    expect(merged.signature.functionSymbols.map((f) => f.name)).toContain("getScore");
    expect(merged.signature.functionSymbols.map((f) => f.name)).toContain("getQuality");
    // Predicates: hasScore from a + isReviewed from b
    expect(Object.keys(merged.signature.predicates)).toHaveLength(2);
    expect(merged.signature.predicates).toHaveProperty("hasScore");
    expect(merged.signature.predicates).toHaveProperty("isReviewed");
    // Axioms: scoreNonNeg from a + qualityBounded from b
    expect(Object.keys(merged.axioms)).toHaveLength(2);
    expect(merged.axioms).toHaveProperty("scoreNonNeg");
    expect(merged.axioms).toHaveProperty("qualityBounded");
  });

  it("overlapping sort names with same cardinality merge without conflict", () => {
    const a = makeDomain("D-a");
    const b: DomainTheory<TestState> = {
      id: "D-b",
      signature: {
        sorts: [
          // Same name AND same cardinality as a's "Score"
          { name: "Score", description: "Also a score", cardinality: "unbounded" },
        ],
        functionSymbols: [],
        predicates: {},
      },
      axioms: {},
    };

    const { merged, conflicts } = mergeDomainTheories(a, b);

    expect(conflicts).toHaveLength(0);
    // Score appears only once (deduplicated)
    expect(merged.signature.sorts).toHaveLength(1);
    expect(merged.signature.sorts[0].name).toBe("Score");
  });

  it("conflicting sort cardinality produces conflict", () => {
    const a = makeDomain("D-a");
    const b: DomainTheory<TestState> = {
      id: "D-b",
      signature: {
        sorts: [
          // Same name "Score" but different cardinality
          { name: "Score", description: "Finite score", cardinality: "finite" },
        ],
        functionSymbols: [],
        predicates: {},
      },
      axioms: {},
    };

    const { conflicts } = mergeDomainTheories(a, b);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toBe("Sort conflict: Score");
  });

  it("conflicting function name produces conflict", () => {
    const a = makeDomain("D-a");
    const b: DomainTheory<TestState> = {
      id: "D-b",
      signature: {
        sorts: [],
        functionSymbols: [
          // Same name "getScore" as a
          { name: "getScore", inputSorts: ["Score"], outputSort: "Score", totality: "partial" },
        ],
        predicates: {},
      },
      axioms: {},
    };

    const { conflicts } = mergeDomainTheories(a, b);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toBe("Function conflict: getScore");
  });

  it("conflicting predicate name produces conflict", () => {
    const a = makeDomain("D-a");
    const b: DomainTheory<TestState> = {
      id: "D-b",
      signature: {
        sorts: [],
        functionSymbols: [],
        predicates: {
          // Same name "hasScore" as a
          hasScore: check<TestState>("hasScore-v2", (s) => s.score > 10),
        },
      },
      axioms: {},
    };

    const { conflicts } = mergeDomainTheories(a, b);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toBe("Predicate conflict: hasScore");
  });

  it("conflicting axiom name produces conflict", () => {
    const a = makeDomain("D-a");
    const b: DomainTheory<TestState> = {
      id: "D-b",
      signature: {
        sorts: [],
        functionSymbols: [],
        predicates: {},
      },
      axioms: {
        // Same name "scoreNonNeg" as a
        scoreNonNeg: check<TestState>("scoreNonNeg-v2", (s) => s.score >= 0),
      },
    };

    const { conflicts } = mergeDomainTheories(a, b);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toBe("Axiom conflict: scoreNonNeg");
  });
});

// ── composeDAGs ──

describe("composeDAGs", () => {
  it("A(2 steps) + B(2 steps) produces 4 steps with bridge edge", () => {
    const stepA1 = makeScriptStep("a1", "eng");
    const stepA2 = makeScriptStep("a2", "eng");
    const stepB1 = makeScriptStep("b1", "eng");
    const stepB2 = makeScriptStep("b2", "eng");

    const dagA = makeDAG([stepA1, stepA2], [{ from: "a1", to: "a2" }]);
    const dagB = makeDAG([stepB1, stepB2], [{ from: "b1", to: "b2" }]);

    const composed = composeDAGs(dagA, dagB);

    expect(composed.steps).toHaveLength(4);
    // Bridge edge from A.terminal to B.initial
    const bridgeEdge = composed.edges.find((e) => e.from === "a2" && e.to === "b1");
    expect(bridgeEdge).toBeDefined();
    // All original edges preserved
    expect(composed.edges.find((e) => e.from === "a1" && e.to === "a2")).toBeDefined();
    expect(composed.edges.find((e) => e.from === "b1" && e.to === "b2")).toBeDefined();
    // Total edges: 1 (a) + 1 (bridge) + 1 (b) = 3
    expect(composed.edges).toHaveLength(3);
  });

  it("initial = A.initial, terminal = B.terminal", () => {
    const stepA = makeScriptStep("a1", "eng");
    const stepB = makeScriptStep("b1", "eng");

    const dagA = makeDAG([stepA], []);
    const dagB = makeDAG([stepB], []);

    const composed = composeDAGs(dagA, dagB);

    expect(composed.initial).toBe("a1");
    expect(composed.terminal).toBe("b1");
  });
});

// ── compose ──

describe("compose", () => {
  it("two methods produce combined method with merged domain and composed DAG", () => {
    const domainA = makeDomain("D-a");
    const domainB: DomainTheory<TestState> = {
      id: "D-b",
      signature: {
        sorts: [
          { name: "Quality", description: "Quality metric", cardinality: "finite" },
        ],
        functionSymbols: [],
        predicates: {},
      },
      axioms: {},
    };

    const stepA = makeScriptStep("sa", "eng");
    const stepB = makeScriptStep("sb", "reviewer");

    const methodA = makeMethod(
      "M-a", "Method A", domainA,
      [makeRole("eng")],
      makeDAG([stepA], []),
    );
    const methodB = makeMethod(
      "M-b", "Method B", domainB,
      [makeRole("reviewer")],
      makeDAG([stepB], []),
    );

    const { method, conflicts } = compose(methodA, methodB);

    expect(conflicts).toHaveLength(0);
    expect(method.id).toBe("M-a+M-b");
    expect(method.name).toBe("Method A + Method B");
    // Domain merged
    expect(method.domain.id).toBe("D-a+D-b");
    expect(method.domain.signature.sorts.map((s) => s.name)).toContain("Score");
    expect(method.domain.signature.sorts.map((s) => s.name)).toContain("Quality");
    // DAG composed
    expect(method.dag.steps).toHaveLength(2);
    expect(method.dag.initial).toBe("sa");
    expect(method.dag.terminal).toBe("sb");
    // Bridge edge
    expect(method.dag.edges.find((e) => e.from === "sa" && e.to === "sb")).toBeDefined();
  });

  it("roles deduplicated by id (b wins on conflict)", () => {
    const domainA = makeDomain("D-a");
    const domainB: DomainTheory<TestState> = {
      id: "D-b",
      signature: { sorts: [], functionSymbols: [], predicates: {} },
      axioms: {},
    };

    const stepA = makeScriptStep("sa", "eng");
    const stepB = makeScriptStep("sb", "eng");

    const roleA: Role<TestState> = {
      id: "eng",
      description: "Engineer from A",
      observe: (s) => s,
      authorized: ["tool-a"],
      notAuthorized: [],
    };
    const roleB: Role<TestState> = {
      id: "eng",
      description: "Engineer from B",
      observe: (s) => s,
      authorized: ["tool-b"],
      notAuthorized: [],
    };

    const methodA = makeMethod("M-a", "A", domainA, [roleA], makeDAG([stepA], []));
    const methodB = makeMethod("M-b", "B", domainB, [roleB], makeDAG([stepB], []));

    const { method } = compose(methodA, methodB);

    // Only one "eng" role, and it should be roleB (b wins)
    expect(method.roles).toHaveLength(1);
    expect(method.roles[0].id).toBe("eng");
    expect(method.roles[0].description).toBe("Engineer from B");
  });

  it("objective is conjunction of both objectives", () => {
    const domainA = makeDomain("D-a");
    const domainB: DomainTheory<TestState> = {
      id: "D-b",
      signature: { sorts: [], functionSymbols: [], predicates: {} },
      axioms: {},
    };

    const stepA = makeScriptStep("sa", "eng");
    const stepB = makeScriptStep("sb", "eng");

    const objA = check<TestState>("scoreHigh", (s) => s.score > 5);
    const objB = check<TestState>("isReviewed", (s) => s.reviewed);

    const methodA = makeMethod("M-a", "A", domainA, [makeRole("eng")], makeDAG([stepA], []), objA);
    const methodB = makeMethod("M-b", "B", domainB, [makeRole("eng")], makeDAG([stepB], []), objB);

    const { method } = compose(methodA, methodB);

    // Conjunction: both must hold
    const passingState: TestState = { score: 10, reviewed: true, quality: 50 };
    expect(evaluate(method.objective, passingState)).toBe(true);

    // Fails if only one holds
    const scoreOnlyState: TestState = { score: 10, reviewed: false, quality: 50 };
    expect(evaluate(method.objective, scoreOnlyState)).toBe(false);

    const reviewOnlyState: TestState = { score: 1, reviewed: true, quality: 50 };
    expect(evaluate(method.objective, reviewOnlyState)).toBe(false);
  });

  it("conflicts propagated from domain merge", () => {
    const domainA = makeDomain("D-a");
    // Domain B has conflicting sort cardinality and conflicting function
    const domainB: DomainTheory<TestState> = {
      id: "D-b",
      signature: {
        sorts: [
          { name: "Score", description: "Finite score", cardinality: "finite" },
        ],
        functionSymbols: [
          { name: "getScore", inputSorts: ["Score"], outputSort: "Score", totality: "partial" },
        ],
        predicates: {},
      },
      axioms: {},
    };

    const stepA = makeScriptStep("sa", "eng");
    const stepB = makeScriptStep("sb", "eng");

    const methodA = makeMethod("M-a", "A", domainA, [makeRole("eng")], makeDAG([stepA], []));
    const methodB = makeMethod("M-b", "B", domainB, [makeRole("eng")], makeDAG([stepB], []));

    const { conflicts } = compose(methodA, methodB);

    expect(conflicts.length).toBeGreaterThanOrEqual(2);
    expect(conflicts).toContain("Sort conflict: Score");
    expect(conflicts).toContain("Function conflict: getScore");
  });

  it("measures are concatenated from both methods", () => {
    const domainA = makeDomain("D-a");
    const domainB: DomainTheory<TestState> = {
      id: "D-b",
      signature: { sorts: [], functionSymbols: [], predicates: {} },
      axioms: {},
    };

    const stepA = makeScriptStep("sa", "eng");
    const stepB = makeScriptStep("sb", "eng");

    const methodA: Method<TestState> = {
      ...makeMethod("M-a", "A", domainA, [makeRole("eng")], makeDAG([stepA], [])),
      measures: [{ id: "m1", name: "Score", compute: (s) => s.score, range: [0, 100], terminal: 100 }],
    };
    const methodB: Method<TestState> = {
      ...makeMethod("M-b", "B", domainB, [makeRole("eng")], makeDAG([stepB], [])),
      measures: [{ id: "m2", name: "Quality", compute: (s) => s.quality, range: [0, 100], terminal: 100 }],
    };

    const { method } = compose(methodA, methodB);

    expect(method.measures).toHaveLength(2);
    expect(method.measures[0].id).toBe("m1");
    expect(method.measures[1].id).toBe("m2");
  });
});
