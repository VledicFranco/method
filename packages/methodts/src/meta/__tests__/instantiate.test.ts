import { describe, it, expect } from "vitest";
import { instantiate, instantiateMethodology, validateCardCompatibility } from "../instantiate.js";
import type { Method } from "../../method/method.js";
import type { Methodology, Arm } from "../../methodology/methodology.js";
import type { Role } from "../../domain/role.js";
import type { ProjectCard } from "../project-card.js";
import { TRUE, check } from "../../predicate/predicate.js";
import { Effect } from "effect";

// ── Test state type ──

type TestState = { phase: string; done: boolean };

// ── Fixtures ──

function makeRole(id: string, description: string): Role<TestState> {
  return {
    id,
    description,
    observe: (s) => s,
    authorized: [],
    notAuthorized: [],
  };
}

function makeMethod(roles: Role<TestState, any>[]): Method<TestState> {
  return {
    id: "M-inst",
    name: "Instantiation Test Method",
    domain: {
      id: "D-inst",
      signature: {
        sorts: [{ name: "Phase", description: "Phase name", cardinality: "finite" }],
        functionSymbols: [],
        predicates: {},
      },
      axioms: {},
    },
    roles,
    dag: {
      steps: [
        {
          id: "step-1",
          name: "Step 1",
          role: roles[0]?.id ?? "default",
          precondition: TRUE,
          postcondition: TRUE,
          execution: {
            tag: "script",
            execute: (s) => Effect.succeed({ ...s, done: true }),
          },
        },
      ],
      edges: [],
      initial: "step-1",
      terminal: "step-1",
    },
    objective: check<TestState>("isDone", (s) => s.done),
    measures: [],
  };
}

function makeCard(overrides?: Partial<ProjectCard>): ProjectCard {
  return {
    id: "card-test",
    name: "Test Project",
    deliveryRules: [{ id: "DR-01", description: "Do not break things" }],
    roleNotes: {},
    contextBindings: {},
    ...overrides,
  };
}

// ── Tests ──

describe("validateCardCompatibility", () => {
  it("valid card with matching roles returns valid", () => {
    const method = makeMethod([makeRole("engineer", "The engineer")]);
    const card = makeCard({ roleNotes: { engineer: "Focus on TypeScript" } });

    const result = validateCardCompatibility(card, method);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("card referencing non-existent role returns error", () => {
    const method = makeMethod([makeRole("engineer", "The engineer")]);
    const card = makeCard({ roleNotes: { reviewer: "Be thorough" } });

    const result = validateCardCompatibility(card, method);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("reviewer");
    expect(result.errors[0]).toContain("non-existent role");
  });

  it("card with no role notes is always valid", () => {
    const method = makeMethod([makeRole("engineer", "The engineer")]);
    const card = makeCard({ roleNotes: {} });

    const result = validateCardCompatibility(card, method);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("detects multiple invalid role references", () => {
    const method = makeMethod([makeRole("engineer", "The engineer")]);
    const card = makeCard({
      roleNotes: { reviewer: "Be thorough", manager: "Approve quickly" },
    });

    const result = validateCardCompatibility(card, method);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
});

describe("instantiate", () => {
  it("applies role notes to role descriptions", () => {
    const method = makeMethod([
      makeRole("engineer", "Writes code"),
      makeRole("reviewer", "Reviews code"),
    ]);
    const card = makeCard({
      roleNotes: { engineer: "Use TypeScript strict mode" },
    });

    const result = instantiate(method, card);

    const engineer = result.roles.find((r) => r.id === "engineer");
    expect(engineer).toBeDefined();
    expect(engineer!.description).toContain("Writes code");
    expect(engineer!.description).toContain("Project note: Use TypeScript strict mode");

    // Reviewer should be unchanged
    const reviewer = result.roles.find((r) => r.id === "reviewer");
    expect(reviewer!.description).toBe("Reviews code");
  });

  it("returns unchanged method when card has no role notes", () => {
    const method = makeMethod([makeRole("engineer", "Writes code")]);
    const card = makeCard({ roleNotes: {} });

    const result = instantiate(method, card);

    expect(result.roles[0].description).toBe("Writes code");
  });

  it("preserves method id and other fields", () => {
    const method = makeMethod([makeRole("engineer", "Writes code")]);
    const card = makeCard({ roleNotes: { engineer: "note" } });

    const result = instantiate(method, card);

    expect(result.id).toBe(method.id);
    expect(result.name).toBe(method.name);
    expect(result.dag).toBe(method.dag);
    expect(result.objective).toBe(method.objective);
  });
});

describe("instantiateMethodology", () => {
  it("applies card to methods in arms", () => {
    const method = makeMethod([makeRole("engineer", "Writes code")]);
    const methodology: Methodology<TestState> = {
      id: "PHI-test",
      name: "Test Methodology",
      domain: method.domain,
      arms: [
        {
          priority: 1,
          label: "execute",
          condition: TRUE,
          selects: method,
          rationale: "Always execute",
        },
        {
          priority: 2,
          label: "terminate",
          condition: check<TestState>("done", (s) => s.done),
          selects: null,
          rationale: "Stop when done",
        },
      ],
      objective: check<TestState>("done", (s) => s.done),
      terminationCertificate: { measure: () => 1, decreases: "Trivial" },
      safety: {
        maxLoops: 5,
        maxTokens: 100000,
        maxCostUsd: 10,
        maxDurationMs: 60000,
        maxDepth: 3,
      },
    };

    const card = makeCard({ roleNotes: { engineer: "Use pnpm, not npm" } });
    const result = instantiateMethodology(methodology, card);

    // First arm should have enriched roles
    const arm1 = result.arms[0];
    expect(arm1.selects).not.toBeNull();
    const engineer = arm1.selects!.roles.find((r) => r.id === "engineer");
    expect(engineer!.description).toContain("Project note: Use pnpm, not npm");

    // Second arm (terminate) selects null — should stay null
    expect(result.arms[1].selects).toBeNull();
  });

  it("preserves methodology metadata", () => {
    const method = makeMethod([makeRole("engineer", "Writes code")]);
    const methodology: Methodology<TestState> = {
      id: "PHI-test",
      name: "Test Methodology",
      domain: method.domain,
      arms: [
        {
          priority: 1,
          label: "execute",
          condition: TRUE,
          selects: method,
          rationale: "Always execute",
        },
      ],
      objective: check<TestState>("done", (s) => s.done),
      terminationCertificate: { measure: () => 1, decreases: "Trivial" },
      safety: {
        maxLoops: 5,
        maxTokens: 100000,
        maxCostUsd: 10,
        maxDurationMs: 60000,
        maxDepth: 3,
      },
    };

    const card = makeCard();
    const result = instantiateMethodology(methodology, card);

    expect(result.id).toBe("PHI-test");
    expect(result.name).toBe("Test Methodology");
    expect(result.objective).toBe(methodology.objective);
    expect(result.safety).toBe(methodology.safety);
  });
});
