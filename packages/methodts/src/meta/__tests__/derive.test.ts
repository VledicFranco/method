// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { deriveIDD, checkFaithfulness } from "../derive.js";
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

function makeScriptStep(
  id: string,
  role: string,
  pre: typeof TRUE = TRUE,
  post: typeof TRUE = TRUE,
  tools?: readonly string[],
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
    tools,
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
  const stepC = makeScriptStep("step-c", "engineer");

  return {
    id: "M-test",
    name: "Test Method",
    domain: makeDomain(),
    roles: [makeRole("engineer")],
    dag: {
      steps: [stepA, stepB, stepC],
      edges: [
        { from: "step-a", to: "step-b" },
        { from: "step-b", to: "step-c" },
      ],
      initial: "step-a",
      terminal: "step-c",
    },
    objective: check<TestState>("scoreAboveZero", (s) => s.score > 0),
    measures: [],
    ...overrides,
  };
}

// ── deriveIDD tests ──

describe("deriveIDD", () => {
  it("method with 3 steps produces IDD with 3 sections in topo order", () => {
    const method = makeMethod();
    const idd = deriveIDD(method);

    expect(idd.methodId).toBe("M-test");
    expect(idd.methodName).toBe("Test Method");
    expect(idd.sections).toHaveLength(3);
    // Topo order: step-a → step-b → step-c
    expect(idd.sections[0].stepId).toBe("step-a");
    expect(idd.sections[1].stepId).toBe("step-b");
    expect(idd.sections[2].stepId).toBe("step-c");
  });

  it("sections have correct stepId, stepName, role", () => {
    const method = makeMethod();
    const idd = deriveIDD(method);

    const first = idd.sections[0];
    expect(first.stepId).toBe("step-a");
    expect(first.stepName).toBe("Step step-a");
    expect(first.role).toBe("engineer");
  });

  it("agent step produces 'Agent step' in implementation notes", () => {
    const agentStep = makeAgentStep("step-agent", "engineer");
    const method = makeMethod({
      dag: {
        steps: [agentStep],
        edges: [],
        initial: "step-agent",
        terminal: "step-agent",
      },
    });
    const idd = deriveIDD(method);

    expect(idd.sections[0].implementationNotes).toContain("Agent step");
    expect(idd.sections[0].implementationNotes).toContain("role=engineer");
  });

  it("script step produces 'Script step' in implementation notes", () => {
    const method = makeMethod();
    const idd = deriveIDD(method);

    expect(idd.sections[0].implementationNotes).toContain("Script step");
    expect(idd.sections[0].implementationNotes).toContain("deterministic");
  });

  it("precondition/postcondition labels extracted correctly from check predicates", () => {
    const pre = check<TestState>("inputValid", (s) => s.score >= 0);
    const post = check<TestState>("outputReady", (s) => s.reviewed);
    const step = makeScriptStep("step-labeled", "engineer", pre, post);

    const method = makeMethod({
      dag: {
        steps: [step],
        edges: [],
        initial: "step-labeled",
        terminal: "step-labeled",
      },
    });
    const idd = deriveIDD(method);

    expect(idd.sections[0].precondition).toBe("inputValid");
    expect(idd.sections[0].postcondition).toBe("outputReady");
  });

  it("TRUE literal predicates produce 'val' tag string", () => {
    const method = makeMethod();
    const idd = deriveIDD(method);

    // Default steps use TRUE for pre/post, which has tag "val"
    expect(idd.sections[0].precondition).toBe("val");
    expect(idd.sections[0].postcondition).toBe("val");
  });

  it("tools are captured in sections", () => {
    const stepWithTools = makeScriptStep("step-tools", "engineer", TRUE, TRUE, ["git", "npm"]);
    const method = makeMethod({
      dag: {
        steps: [stepWithTools],
        edges: [],
        initial: "step-tools",
        terminal: "step-tools",
      },
    });
    const idd = deriveIDD(method);

    expect(idd.sections[0].tools).toEqual(["git", "npm"]);
  });

  it("steps without tools produce empty tools array", () => {
    const method = makeMethod();
    const idd = deriveIDD(method);

    expect(idd.sections[0].tools).toEqual([]);
  });

  it("generatedAt is a Date", () => {
    const method = makeMethod();
    const idd = deriveIDD(method);

    expect(idd.generatedAt).toBeInstanceOf(Date);
  });
});

// ── checkFaithfulness tests ──

describe("checkFaithfulness", () => {
  it("well-formed method returns faithful: true with no gaps", () => {
    // Build a well-formed method: check predicates on non-initial/non-terminal steps
    const stepA = makeScriptStep("step-a", "engineer", TRUE, check<TestState>("postA", () => true));
    const stepB = makeScriptStep(
      "step-b",
      "engineer",
      check<TestState>("preB", () => true),
      check<TestState>("postB", () => true),
    );
    const stepC = makeScriptStep("step-c", "engineer", check<TestState>("preC", () => true), TRUE);

    const method = makeMethod({
      dag: {
        steps: [stepA, stepB, stepC],
        edges: [
          { from: "step-a", to: "step-b" },
          { from: "step-b", to: "step-c" },
        ],
        initial: "step-a",
        terminal: "step-c",
      },
    });

    const result = checkFaithfulness(method);
    expect(result.faithful).toBe(true);
    expect(result.gaps).toHaveLength(0);
  });

  it("missing role produces gap type 'missing_role'", () => {
    // Step references "reviewer" but only "engineer" is defined
    const step = makeScriptStep("step-a", "reviewer");
    const method = makeMethod({
      dag: {
        steps: [step],
        edges: [],
        initial: "step-a",
        terminal: "step-a",
      },
    });

    const result = checkFaithfulness(method);
    expect(result.faithful).toBe(false);
    const roleGap = result.gaps.find((g) => g.type === "missing_role");
    expect(roleGap).toBeDefined();
    expect(roleGap!.description).toContain("reviewer");
    expect(roleGap!.stepId).toBe("step-a");
  });

  it("trivial TRUE precondition on non-initial step produces gap", () => {
    // step-b has TRUE precondition but is not the initial step
    const stepA = makeScriptStep("step-a", "engineer");
    const stepB = makeScriptStep("step-b", "engineer"); // TRUE pre, TRUE post

    const method = makeMethod({
      dag: {
        steps: [stepA, stepB],
        edges: [{ from: "step-a", to: "step-b" }],
        initial: "step-a",
        terminal: "step-b",
      },
    });

    const result = checkFaithfulness(method);
    expect(result.faithful).toBe(false);
    const preGap = result.gaps.find((g) => g.type === "missing_precondition");
    expect(preGap).toBeDefined();
    expect(preGap!.stepId).toBe("step-b");
    expect(preGap!.description).toContain("trivial TRUE precondition");
  });

  it("trivial TRUE postcondition on non-terminal step produces gap", () => {
    // step-a has TRUE postcondition but is not the terminal step
    const stepA = makeScriptStep("step-a", "engineer"); // TRUE pre, TRUE post
    const stepB = makeScriptStep("step-b", "engineer");

    const method = makeMethod({
      dag: {
        steps: [stepA, stepB],
        edges: [{ from: "step-a", to: "step-b" }],
        initial: "step-a",
        terminal: "step-b",
      },
    });

    const result = checkFaithfulness(method);
    expect(result.faithful).toBe(false);
    const postGap = result.gaps.find((g) => g.type === "missing_postcondition");
    expect(postGap).toBeDefined();
    expect(postGap!.stepId).toBe("step-a");
    expect(postGap!.description).toContain("trivial TRUE postcondition");
  });

  it("initial step with TRUE precondition produces no gap", () => {
    // Initial step is allowed to have TRUE precondition
    const stepA = makeScriptStep("step-a", "engineer", TRUE, check<TestState>("postA", () => true));

    const method = makeMethod({
      dag: {
        steps: [stepA],
        edges: [],
        initial: "step-a",
        terminal: "step-a",
      },
    });

    const result = checkFaithfulness(method);
    const preGaps = result.gaps.filter((g) => g.type === "missing_precondition");
    expect(preGaps).toHaveLength(0);
  });

  it("terminal step with TRUE postcondition produces no gap", () => {
    // Terminal step is allowed to have TRUE postcondition
    const stepA = makeScriptStep("step-a", "engineer", check<TestState>("preA", () => true), TRUE);

    const method = makeMethod({
      dag: {
        steps: [stepA],
        edges: [],
        initial: "step-a",
        terminal: "step-a",
      },
    });

    const result = checkFaithfulness(method);
    const postGaps = result.gaps.filter((g) => g.type === "missing_postcondition");
    expect(postGaps).toHaveLength(0);
  });

  it("multiple gaps are all reported", () => {
    // step-a: wrong role, TRUE postcondition (non-terminal)
    // step-b: TRUE precondition (non-initial)
    const stepA = makeScriptStep("step-a", "ghost-role");
    const stepB = makeScriptStep("step-b", "engineer");

    const method = makeMethod({
      dag: {
        steps: [stepA, stepB],
        edges: [{ from: "step-a", to: "step-b" }],
        initial: "step-a",
        terminal: "step-b",
      },
    });

    const result = checkFaithfulness(method);
    expect(result.faithful).toBe(false);
    // Should have at least: missing_role for step-a, missing_postcondition for step-a, missing_precondition for step-b
    expect(result.gaps.length).toBeGreaterThanOrEqual(3);
    expect(result.gaps.some((g) => g.type === "missing_role")).toBe(true);
    expect(result.gaps.some((g) => g.type === "missing_postcondition")).toBe(true);
    expect(result.gaps.some((g) => g.type === "missing_precondition")).toBe(true);
  });
});
