import { describe, it, expect } from "vitest";
import { verifyRefinement } from "../refinement.js";
import type { Method } from "../../method/method.js";
import type { DomainTheory } from "../../domain/domain-theory.js";
import type { Role } from "../../domain/role.js";
import type { Step } from "../../method/step.js";
import { TRUE, check } from "../../predicate/predicate.js";
import { Effect } from "effect";

// ── Test state type ──

type TestState = { score: number; reviewed: boolean };

// ── Fixtures ──

function makeDomain(overrides?: Partial<DomainTheory<TestState>>): DomainTheory<TestState> {
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

function makeStep(
  id: string,
  role: string,
  pre = TRUE as typeof TRUE,
  post = TRUE as typeof TRUE,
): Step<TestState> {
  return {
    id,
    name: `Step ${id}`,
    role,
    precondition: pre,
    postcondition: post,
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

function makeMethod(overrides?: Partial<Method<TestState>>): Method<TestState> {
  const stepA = makeStep("step-a", "engineer");
  const stepB = makeStep("step-b", "engineer");

  return {
    id: "M-test",
    name: "Test Method",
    domain: makeDomain(),
    roles: [makeRole("engineer")],
    dag: {
      steps: [stepA, stepB],
      edges: [{ from: "step-a", to: "step-b" }],
      initial: "step-a",
      terminal: "step-b",
    },
    objective: check<TestState>("scoreAboveZero", (s) => s.score > 0),
    measures: [],
    ...overrides,
  };
}

const testStates: TestState[] = [
  { score: 0, reviewed: false },
  { score: 1, reviewed: false },
  { score: 5, reviewed: true },
  { score: 10, reviewed: true },
];

// ── Tests ──

describe("verifyRefinement", () => {
  it("identical methods: valid", () => {
    const method = makeMethod();

    const result = verifyRefinement(method, method, testStates);

    expect(result.valid).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it("refined adds steps: valid (preservation holds)", () => {
    const original = makeMethod();
    const refined = makeMethod({
      dag: {
        steps: [
          ...original.dag.steps,
          makeStep("step-c", "engineer"),
        ],
        edges: [
          ...original.dag.edges,
          { from: "step-b", to: "step-c" },
        ],
        initial: "step-a",
        terminal: "step-c",
      },
    });

    const result = verifyRefinement(original, refined, testStates);

    expect(result.valid).toBe(true);
    const stepCheck = result.checks.find((c) => c.name === "step_preservation");
    expect(stepCheck!.passed).toBe(true);
    expect(stepCheck!.detail).toBe("All original steps preserved");
  });

  it("refined removes a step: invalid (step_preservation fails)", () => {
    const original = makeMethod();
    // Refined only has step-a, missing step-b
    const refined = makeMethod({
      dag: {
        steps: [makeStep("step-a", "engineer")],
        edges: [],
        initial: "step-a",
        terminal: "step-a",
      },
    });

    const result = verifyRefinement(original, refined, testStates);

    expect(result.valid).toBe(false);
    const stepCheck = result.checks.find((c) => c.name === "step_preservation");
    expect(stepCheck!.passed).toBe(false);
    expect(stepCheck!.detail).toContain("step-b");
  });

  it("refined removes a sort: invalid (sort_preservation fails)", () => {
    const original = makeMethod();
    // Refined domain is missing the "Flag" sort
    const refined = makeMethod({
      domain: makeDomain({
        signature: {
          sorts: [
            { name: "Score", description: "Numeric score", cardinality: "unbounded" },
            // "Flag" removed
          ],
          functionSymbols: [
            { name: "getScore", inputSorts: [], outputSort: "Score", totality: "total" },
          ],
          predicates: {
            isReviewed: check<TestState>("isReviewed", (s) => s.reviewed),
          },
        },
      }),
    });

    const result = verifyRefinement(original, refined, testStates);

    expect(result.valid).toBe(false);
    const sortCheck = result.checks.find((c) => c.name === "sort_preservation");
    expect(sortCheck!.passed).toBe(false);
    expect(sortCheck!.detail).toContain("Flag");
  });

  it("refined weakens objective: invalid", () => {
    const original = makeMethod({
      // Original: score > 0 (easy to satisfy)
      objective: check<TestState>("scoreAboveZero", (s) => s.score > 0),
    });
    const refined = makeMethod({
      // Refined: score > 100 (harder — misses states where original would be satisfied)
      objective: check<TestState>("scoreAbove100", (s) => s.score > 100),
    });

    // testStates include { score: 5 } which satisfies original but not refined
    const result = verifyRefinement(original, refined, testStates);

    expect(result.valid).toBe(false);
    const objCheck = result.checks.find((c) => c.name === "objective_compatibility");
    expect(objCheck!.passed).toBe(false);
    expect(objCheck!.detail).toBe("Refined objective is weaker than original");
  });

  it("refined adds role: valid", () => {
    const original = makeMethod();
    const refined = makeMethod({
      roles: [makeRole("engineer"), makeRole("reviewer")],
    });

    const result = verifyRefinement(original, refined, testStates);

    expect(result.valid).toBe(true);
    const roleCheck = result.checks.find((c) => c.name === "role_preservation");
    expect(roleCheck!.passed).toBe(true);
    expect(roleCheck!.detail).toBe("All original roles preserved");
  });

  it("refined removes role: invalid", () => {
    const original = makeMethod({
      roles: [makeRole("engineer"), makeRole("reviewer")],
    });
    const refined = makeMethod({
      roles: [makeRole("engineer")],
      // reviewer removed
    });

    const result = verifyRefinement(original, refined, testStates);

    expect(result.valid).toBe(false);
    const roleCheck = result.checks.find((c) => c.name === "role_preservation");
    expect(roleCheck!.passed).toBe(false);
    expect(roleCheck!.detail).toContain("reviewer");
  });
});
