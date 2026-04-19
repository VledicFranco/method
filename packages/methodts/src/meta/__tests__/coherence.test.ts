// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { checkCoherence } from "../coherence.js";
import type { Methodology, Arm } from "../../methodology/methodology.js";
import type { Method } from "../../method/method.js";
import type { Step } from "../../method/step.js";
import type { DomainTheory } from "../../domain/domain-theory.js";
import type { Role } from "../../domain/role.js";
import { TRUE, FALSE, check } from "../../predicate/predicate.js";
import { Effect } from "effect";

// ── Test state type ──

type TestState = { score: number; reviewed: boolean };

// ── Fixtures ──

function makeDomain(
  overrides?: Partial<DomainTheory<TestState>>,
): DomainTheory<TestState> {
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

function makeMethod(
  id: string,
  overrides?: Partial<Method<TestState>>,
): Method<TestState> {
  const step = makeScriptStep(`${id}-step`, "engineer");
  return {
    id,
    name: `Method ${id}`,
    domain: makeDomain(),
    roles: [makeRole("engineer")],
    dag: {
      steps: [step],
      edges: [],
      initial: `${id}-step`,
      terminal: `${id}-step`,
    },
    objective: check<TestState>("scoreAboveZero", (s) => s.score > 0),
    measures: [],
    ...overrides,
  };
}

function makeArm<S>(
  priority: number,
  label: string,
  condition: typeof TRUE,
  selects: Method<S> | null,
): Arm<S> {
  return {
    priority,
    label,
    condition,
    selects,
    rationale: `Arm ${label}`,
  };
}

function makeMethodology(
  overrides?: Partial<Methodology<TestState>>,
): Methodology<TestState> {
  const methodA = makeMethod("M-A");
  const methodB = makeMethod("M-B");

  return {
    id: "PHI-test",
    name: "Test Methodology",
    domain: makeDomain(),
    arms: [
      makeArm<TestState>(
        1,
        "terminate",
        check<TestState>("done", (s) => s.score >= 10),
        null,
      ),
      makeArm<TestState>(
        2,
        "select-A",
        check<TestState>("needsA", (s) => s.score < 5),
        methodA,
      ),
      makeArm<TestState>(
        3,
        "select-B",
        check<TestState>("needsB", (s) => s.score >= 5 && s.score < 10),
        methodB,
      ),
    ],
    objective: check<TestState>("complete", (s) => s.score >= 10),
    terminationCertificate: {
      measure: (s) => 10 - s.score,
      decreases: "Score increases toward 10",
    },
    safety: {
      maxLoops: 20,
      maxTokens: 1_000_000,
      maxCostUsd: 50,
      maxDurationMs: 3_600_000,
      maxDepth: 5,
    },
    ...overrides,
  };
}

// ── Tests ──

describe("checkCoherence", () => {
  it("well-formed 3-arm methodology is coherent", () => {
    const methodology = makeMethodology();
    // Test states covering all arm conditions
    const testStates: TestState[] = [
      { score: 0, reviewed: false }, // fires select-A
      { score: 7, reviewed: false }, // fires select-B
      { score: 10, reviewed: true }, // fires terminate
    ];

    const result = checkCoherence(methodology, testStates);

    expect(result.coherent).toBe(true);
    expect(result.checks).toHaveLength(5);
    for (const chk of result.checks) {
      expect(chk.passed).toBe(true);
    }
  });

  it("dead arm (condition never true) fails no_dead_arms", () => {
    const methodology = makeMethodology({
      arms: [
        makeArm<TestState>(
          1,
          "terminate",
          check<TestState>("done", (s) => s.score >= 10),
          null,
        ),
        makeArm<TestState>(2, "dead-arm", FALSE, makeMethod("M-dead")),
        makeArm<TestState>(
          3,
          "select-B",
          check<TestState>("needsB", (s) => s.score < 10),
          makeMethod("M-B"),
        ),
      ],
    });

    const testStates: TestState[] = [
      { score: 0, reviewed: false },
      { score: 10, reviewed: true },
    ];

    const result = checkCoherence(methodology, testStates);

    expect(result.coherent).toBe(false);
    const deadCheck = result.checks.find((c) => c.name === "no_dead_arms");
    expect(deadCheck).toBeDefined();
    expect(deadCheck!.passed).toBe(false);
    expect(deadCheck!.detail).toContain("dead-arm");
  });

  it("no terminate arm fails terminate_arm_exists", () => {
    const methodology = makeMethodology({
      arms: [
        makeArm<TestState>(
          1,
          "select-A",
          check<TestState>("needsA", (s) => s.score < 5),
          makeMethod("M-A"),
        ),
        makeArm<TestState>(
          2,
          "select-B",
          check<TestState>("needsB", (s) => s.score >= 5),
          makeMethod("M-B"),
        ),
      ],
    });

    const testStates: TestState[] = [
      { score: 0, reviewed: false },
      { score: 7, reviewed: false },
    ];

    const result = checkCoherence(methodology, testStates);

    expect(result.coherent).toBe(false);
    const termCheck = result.checks.find(
      (c) => c.name === "terminate_arm_exists",
    );
    expect(termCheck).toBeDefined();
    expect(termCheck!.passed).toBe(false);
    expect(termCheck!.detail).toContain("No terminate arm");
  });

  it("terminate arm unreachable fails terminate_reachable", () => {
    // Terminate condition requires score >= 100, but no test state reaches that
    const methodology = makeMethodology({
      arms: [
        makeArm<TestState>(
          1,
          "terminate",
          check<TestState>("done", (s) => s.score >= 100),
          null,
        ),
        makeArm<TestState>(
          2,
          "select-A",
          check<TestState>("always", () => true),
          makeMethod("M-A"),
        ),
      ],
    });

    const testStates: TestState[] = [
      { score: 0, reviewed: false },
      { score: 5, reviewed: false },
      { score: 10, reviewed: true },
    ];

    const result = checkCoherence(methodology, testStates);

    expect(result.coherent).toBe(false);
    const reachCheck = result.checks.find(
      (c) => c.name === "terminate_reachable",
    );
    expect(reachCheck).toBeDefined();
    expect(reachCheck!.passed).toBe(false);
    expect(reachCheck!.detail).toContain("never fires");
  });

  it("duplicate priorities fails unique_priorities", () => {
    const methodology = makeMethodology({
      arms: [
        makeArm<TestState>(
          1,
          "terminate",
          check<TestState>("done", (s) => s.score >= 10),
          null,
        ),
        makeArm<TestState>(
          1, // duplicate priority!
          "select-A",
          check<TestState>("needsA", (s) => s.score < 5),
          makeMethod("M-A"),
        ),
        makeArm<TestState>(
          2,
          "select-B",
          check<TestState>("needsB", (s) => s.score >= 5 && s.score < 10),
          makeMethod("M-B"),
        ),
      ],
    });

    const testStates: TestState[] = [
      { score: 0, reviewed: false },
      { score: 7, reviewed: false },
      { score: 10, reviewed: true },
    ];

    const result = checkCoherence(methodology, testStates);

    expect(result.coherent).toBe(false);
    const prioCheck = result.checks.find(
      (c) => c.name === "unique_priorities",
    );
    expect(prioCheck).toBeDefined();
    expect(prioCheck!.passed).toBe(false);
    expect(prioCheck!.detail).toContain("Duplicate priorities");
  });

  it("domain not satisfiable fails domain_satisfiable", () => {
    // Domain axiom requires score >= 0, but all test states have negative scores
    const methodology = makeMethodology();
    const testStates: TestState[] = [
      { score: -5, reviewed: false },
      { score: -1, reviewed: true },
    ];

    const result = checkCoherence(methodology, testStates);

    expect(result.coherent).toBe(false);
    const domainCheck = result.checks.find(
      (c) => c.name === "domain_satisfiable",
    );
    expect(domainCheck).toBeDefined();
    expect(domainCheck!.passed).toBe(false);
    expect(domainCheck!.detail).toContain("No test state satisfies");
  });

  it("all checks pass yields coherent: true", () => {
    const methodology = makeMethodology();
    const testStates: TestState[] = [
      { score: 0, reviewed: false },
      { score: 7, reviewed: false },
      { score: 10, reviewed: true },
    ];

    const result = checkCoherence(methodology, testStates);

    expect(result.coherent).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });
});
