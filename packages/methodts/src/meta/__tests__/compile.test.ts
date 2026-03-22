import { describe, it, expect } from "vitest";
import { compileMethod, assertCompiled } from "../compile.js";
import type { Method } from "../../method/method.js";
import type { Step } from "../../method/step.js";
import type { DomainTheory } from "../../domain/domain-theory.js";
import type { Role } from "../../domain/role.js";
import { TRUE, check } from "../../predicate/predicate.js";
import { Prompt } from "../../prompt/prompt.js";
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

function makeScriptStep(
  id: string,
  role: string,
  pre: typeof TRUE = TRUE,
  post: typeof TRUE = TRUE,
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

function makeAgentStep(id: string, role: string): Step<TestState> {
  return {
    id,
    name: `Agent Step ${id}`,
    role,
    precondition: TRUE,
    postcondition: TRUE,
    execution: {
      tag: "agent",
      role,
      context: {},
      prompt: new Prompt(() => "Do the thing"),
      parse: (raw, current) => Effect.succeed({ ...current, reviewed: true }),
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
  const stepA = makeScriptStep("step-a", "engineer");
  const stepB = makeScriptStep("step-b", "engineer");

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

// ── Tests ──

describe("compileMethod", () => {
  it("valid method passes all gates, overall = compiled", () => {
    const method = makeMethod();
    const report = compileMethod(method, [{ score: 1, reviewed: false }]);

    expect(report.overall).toBe("compiled");
    expect(report.methodId).toBe("M-test");
    expect(report.gates).toHaveLength(6);

    // All gates pass (no agent steps, so G5 = pass, not needs_review)
    for (const gate of report.gates) {
      expect(gate.status).toBe("pass");
    }
  });

  it("broken composability fails G4", () => {
    // stepA postcondition says score > 10, but stepB precondition says score < 5
    // When post(A) holds but pre(B) does not, composability breaks.
    const stepA = makeScriptStep(
      "step-a",
      "engineer",
      TRUE,
      check<TestState>("scoreAbove10", (s) => s.score > 10),
    );
    const stepB = makeScriptStep(
      "step-b",
      "engineer",
      check<TestState>("scoreBelow5", (s) => s.score < 5),
      TRUE,
    );

    const method = makeMethod({
      dag: {
        steps: [stepA, stepB],
        edges: [{ from: "step-a", to: "step-b" }],
        initial: "step-a",
        terminal: "step-b",
      },
    });

    // Test state where post(A) holds (score > 10) but pre(B) does NOT (score >= 5)
    const report = compileMethod(method, [{ score: 15, reviewed: false }]);

    expect(report.overall).toBe("failed");
    const g4 = report.gates.find((g) => g.gate === "G4-dag");
    expect(g4).toBeDefined();
    expect(g4!.status).toBe("fail");
    expect(g4!.details).toContain("not composable");
  });

  it("uncovered role fails G3", () => {
    // Step references role "reviewer" but only "engineer" is defined
    const stepA = makeScriptStep("step-a", "reviewer");

    const method = makeMethod({
      dag: {
        steps: [stepA],
        edges: [],
        initial: "step-a",
        terminal: "step-a",
      },
    });

    const report = compileMethod(method, [{ score: 1, reviewed: false }]);

    expect(report.overall).toBe("failed");
    const g3 = report.gates.find((g) => g.gate === "G3-roles");
    expect(g3).toBeDefined();
    expect(g3!.status).toBe("fail");
    expect(g3!.details).toContain("reviewer");
  });

  it("agent steps yield G5 = needs_review", () => {
    const agentStep = makeAgentStep("step-agent", "engineer");

    const method = makeMethod({
      dag: {
        steps: [agentStep],
        edges: [],
        initial: "step-agent",
        terminal: "step-agent",
      },
    });

    const report = compileMethod(method, [{ score: 1, reviewed: false }]);

    // Overall is needs_review (not failed), because G5 is needs_review
    expect(report.overall).toBe("needs_review");
    const g5 = report.gates.find((g) => g.gate === "G5-guidance");
    expect(g5).toBeDefined();
    expect(g5!.status).toBe("needs_review");
    expect(g5!.details).toContain("1 agent steps");
  });

  it("axiom violation fails G1", () => {
    const method = makeMethod();

    // Negative score violates the scoreNonNegative axiom
    const report = compileMethod(method, [{ score: -5, reviewed: false }]);

    expect(report.overall).toBe("failed");
    const g1 = report.gates.find((g) => g.gate === "G1-domain");
    expect(g1).toBeDefined();
    expect(g1!.status).toBe("fail");
    expect(g1!.details).toContain("Axiom violations");
  });

  it("signature error fails G1", () => {
    const badDomain = makeDomain({
      signature: {
        sorts: [{ name: "Score", description: "Numeric score", cardinality: "unbounded" }],
        functionSymbols: [
          // References non-existent sort "Widget"
          { name: "badFn", inputSorts: ["Widget"], outputSort: "Score", totality: "total" },
        ],
        predicates: {},
      },
    });

    const method = makeMethod({ domain: badDomain });
    const report = compileMethod(method, [{ score: 1, reviewed: false }]);

    expect(report.overall).toBe("failed");
    const g1 = report.gates.find((g) => g.gate === "G1-domain");
    expect(g1!.status).toBe("fail");
    expect(g1!.details).toContain("Signature errors");
  });
});

describe("assertCompiled", () => {
  it("throws on failed compilation", () => {
    // Step references uncovered role
    const step = makeScriptStep("step-a", "ghost-role");
    const method = makeMethod({
      dag: {
        steps: [step],
        edges: [],
        initial: "step-a",
        terminal: "step-a",
      },
    });

    expect(() => assertCompiled(method, [{ score: 1, reviewed: false }])).toThrow(
      /Compilation failed for M-test/,
    );
  });

  it("returns report on success", () => {
    const method = makeMethod();
    const report = assertCompiled(method, [{ score: 1, reviewed: false }]);

    expect(report.overall).not.toBe("failed");
    expect(report.methodId).toBe("M-test");
  });

  it("does not throw on needs_review", () => {
    const agentStep = makeAgentStep("step-agent", "engineer");
    const method = makeMethod({
      dag: {
        steps: [agentStep],
        edges: [],
        initial: "step-agent",
        terminal: "step-agent",
      },
    });

    const report = assertCompiled(method, [{ score: 1, reviewed: false }]);
    expect(report.overall).toBe("needs_review");
  });
});
