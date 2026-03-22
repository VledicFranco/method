/**
 * Instantiation integration tests (SC13) and P2-SD routing tests (SC7).
 *
 * SC13: Tests method instantiation with project cards — role enrichment
 *       and card compatibility validation.
 * SC7:  Tests evaluateTransition with P2-SD-style routing scenarios.
 */

import { describe, it, expect } from "vitest";
import { instantiate, validateCardCompatibility, instantiateMethodology } from "../meta/instantiate.js";
import type { ProjectCard } from "../meta/project-card.js";
import type { Method } from "../method/method.js";
import type { Methodology, Arm } from "../methodology/methodology.js";
import { evaluateTransition, simulateRun } from "../methodology/transition.js";
import { check } from "../predicate/predicate.js";
import { M1_MDES } from "../stdlib/methods/m1-mdes.js";
import type { DesignState } from "../stdlib/types.js";

// ── SC13: Method instantiation ──

describe("Method instantiation (SC13)", () => {
  const testCard: ProjectCard = {
    id: "I2-METHOD",
    name: "Method Runtime Project",
    deliveryRules: [
      { id: "DR-01", description: "Registry files are production artifacts" },
      { id: "DR-03", description: "Core has zero transport dependencies" },
    ],
    roleNotes: {
      designer: "Focus on TypeScript type safety and Effect library patterns",
      compiler: "Run G1-G6 gates using compileMethod from meta/compile",
    },
    contextBindings: { project: "pv-method", language: "TypeScript" },
  };

  it("instantiate applies role notes to M1_MDES", () => {
    const instantiated = instantiate(M1_MDES, testCard);

    const designerRole = instantiated.roles.find((r) => r.id === "designer");
    expect(designerRole).toBeDefined();
    expect(designerRole!.description).toContain("Project note:");
    expect(designerRole!.description).toContain("TypeScript type safety");
    expect(designerRole!.description).toContain("Effect library patterns");

    const compilerRole = instantiated.roles.find((r) => r.id === "compiler");
    expect(compilerRole).toBeDefined();
    expect(compilerRole!.description).toContain("Project note:");
    expect(compilerRole!.description).toContain("G1-G6 gates");
  });

  it("instantiate preserves original role descriptions before the note", () => {
    const instantiated = instantiate(M1_MDES, testCard);

    const designerRole = instantiated.roles.find((r) => r.id === "designer");
    // Original description should be preserved at the start
    expect(designerRole!.description).toMatch(/^Designs the method/);
  });

  it("instantiate does not mutate the original method", () => {
    const originalDesigner = M1_MDES.roles.find((r) => r.id === "designer");
    const originalDescription = originalDesigner!.description;

    instantiate(M1_MDES, testCard);

    // Original method should be unchanged
    const afterDesigner = M1_MDES.roles.find((r) => r.id === "designer");
    expect(afterDesigner!.description).toBe(originalDescription);
    expect(afterDesigner!.description).not.toContain("Project note:");
  });

  it("instantiate with empty roleNotes leaves roles unchanged", () => {
    const emptyCard: ProjectCard = {
      id: "I-EMPTY",
      name: "Empty",
      deliveryRules: [],
      roleNotes: {},
      contextBindings: {},
    };

    const instantiated = instantiate(M1_MDES, emptyCard);

    for (const role of instantiated.roles) {
      const original = M1_MDES.roles.find((r) => r.id === role.id);
      expect(role.description).toBe(original!.description);
    }
  });

  it("instantiate with partial roleNotes only enriches matching roles", () => {
    const partialCard: ProjectCard = {
      id: "I-PARTIAL",
      name: "Partial",
      deliveryRules: [],
      roleNotes: { compiler: "Only compiler gets a note" },
      contextBindings: {},
    };

    const instantiated = instantiate(M1_MDES, partialCard);

    const designer = instantiated.roles.find((r) => r.id === "designer");
    const compiler = instantiated.roles.find((r) => r.id === "compiler");

    expect(designer!.description).not.toContain("Project note:");
    expect(compiler!.description).toContain("Project note:");
    expect(compiler!.description).toContain("Only compiler gets a note");
  });

  it("validateCardCompatibility: valid card for M1_MDES", () => {
    const result = validateCardCompatibility(testCard, M1_MDES);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validateCardCompatibility: card referencing non-existent role", () => {
    const badCard: ProjectCard = {
      ...testCard,
      roleNotes: { nonexistent: "this role does not exist" },
    };
    const result = validateCardCompatibility(badCard, M1_MDES);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("nonexistent");
  });

  it("validateCardCompatibility: mix of valid and invalid roles", () => {
    const mixedCard: ProjectCard = {
      ...testCard,
      roleNotes: {
        designer: "valid note",
        ghost_role: "invalid",
        phantom: "also invalid",
      },
    };
    const result = validateCardCompatibility(mixedCard, M1_MDES);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.some((e) => e.includes("ghost_role"))).toBe(true);
    expect(result.errors.some((e) => e.includes("phantom"))).toBe(true);
  });

  it("validateCardCompatibility: empty roleNotes is valid", () => {
    const emptyCard: ProjectCard = {
      id: "I-EMPTY",
      name: "Empty",
      deliveryRules: [],
      roleNotes: {},
      contextBindings: {},
    };
    const result = validateCardCompatibility(emptyCard, M1_MDES);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("preserves method id, name, domain, dag, objective, measures", () => {
    const instantiated = instantiate(M1_MDES, testCard);

    expect(instantiated.id).toBe(M1_MDES.id);
    expect(instantiated.name).toBe(M1_MDES.name);
    expect(instantiated.domain).toBe(M1_MDES.domain);
    expect(instantiated.dag).toBe(M1_MDES.dag);
    expect(instantiated.objective).toBe(M1_MDES.objective);
    expect(instantiated.measures).toBe(M1_MDES.measures);
  });
});

// ── SC7: P2-SD-style routing ──

type SDState = { taskType: "implement" | "review" | "plan" | "done"; scope: string };

/** Minimal domain theory for test methodology. */
const D_SD_TEST = {
  id: "D_SD_TEST",
  signature: {
    sorts: [{ name: "Task", description: "A task unit", cardinality: "finite" as const }],
    functionSymbols: [],
    predicates: {},
  },
  axioms: {},
};

const p2sd_simplified: Methodology<SDState> = {
  id: "P2-SD-simplified",
  name: "Simplified Software Delivery",
  domain: D_SD_TEST,
  arms: [
    {
      priority: 1,
      label: "implement",
      condition: check<SDState>("impl", (s) => s.taskType === "implement"),
      selects: null,
      rationale: "Implementation task",
    },
    {
      priority: 2,
      label: "review",
      condition: check<SDState>("review", (s) => s.taskType === "review"),
      selects: null,
      rationale: "Review task",
    },
    {
      priority: 3,
      label: "plan",
      condition: check<SDState>("plan", (s) => s.taskType === "plan"),
      selects: null,
      rationale: "Planning task",
    },
    {
      priority: 4,
      label: "terminate",
      condition: check<SDState>("done", (s) => s.taskType === "done"),
      selects: null,
      rationale: "All done",
    },
  ],
  objective: check<SDState>("done", (s) => s.taskType === "done"),
  terminationCertificate: { measure: () => 1, decreases: "Tasks complete" },
  safety: { maxLoops: 10, maxTokens: 100000, maxCostUsd: 10, maxDurationMs: 3600000, maxDepth: 3 },
};

describe("P2-SD routing (SC7)", () => {
  it("routes implement task to arm 1 (label: implement)", () => {
    const state: SDState = { taskType: "implement", scope: "feature" };
    const result = evaluateTransition(p2sd_simplified, state);
    expect(result.firedArm).not.toBeNull();
    expect(result.firedArm!.label).toBe("implement");
    expect(result.firedArm!.priority).toBe(1);
  });

  it("routes review task to arm 2 (label: review)", () => {
    const state: SDState = { taskType: "review", scope: "pr" };
    const result = evaluateTransition(p2sd_simplified, state);
    expect(result.firedArm).not.toBeNull();
    expect(result.firedArm!.label).toBe("review");
    expect(result.firedArm!.priority).toBe(2);
  });

  it("routes plan task to arm 3 (label: plan)", () => {
    const state: SDState = { taskType: "plan", scope: "sprint" };
    const result = evaluateTransition(p2sd_simplified, state);
    expect(result.firedArm).not.toBeNull();
    expect(result.firedArm!.label).toBe("plan");
    expect(result.firedArm!.priority).toBe(3);
  });

  it("routes done task to terminate arm (selects: null)", () => {
    const state: SDState = { taskType: "done", scope: "" };
    const result = evaluateTransition(p2sd_simplified, state);
    expect(result.firedArm).not.toBeNull();
    expect(result.firedArm!.label).toBe("terminate");
    expect(result.selectedMethod).toBeNull();
  });

  it("produces arm traces for all arms", () => {
    const state: SDState = { taskType: "implement", scope: "feature" };
    const result = evaluateTransition(p2sd_simplified, state);

    expect(result.armTraces).toHaveLength(4);
    expect(result.armTraces[0].label).toBe("implement");
    expect(result.armTraces[0].fired).toBe(true);
    expect(result.armTraces[0].trace.result).toBe(true);

    // Remaining arms are evaluated but don't fire (first match wins)
    expect(result.armTraces[1].label).toBe("review");
    expect(result.armTraces[1].fired).toBe(false);
    expect(result.armTraces[1].trace.result).toBe(false);
  });

  it("only one arm fires even if multiple conditions match", () => {
    // Build a methodology where multiple arms can match
    type MultiState = { ready: boolean; level: number };

    const multiMatch: Methodology<MultiState> = {
      id: "P-MULTI",
      name: "Multi-match test",
      domain: {
        id: "D_MULTI",
        signature: { sorts: [], functionSymbols: [], predicates: {} },
        axioms: {},
      },
      arms: [
        {
          priority: 1,
          label: "first",
          condition: check<MultiState>("ready", (s) => s.ready),
          selects: null,
          rationale: "First match",
        },
        {
          priority: 2,
          label: "second",
          condition: check<MultiState>("high_level", (s) => s.level > 5),
          selects: null,
          rationale: "Second match",
        },
      ],
      objective: check<MultiState>("done", () => false),
      terminationCertificate: { measure: () => 1, decreases: "n/a" },
      safety: { maxLoops: 5, maxTokens: 50000, maxCostUsd: 5, maxDurationMs: 1800000, maxDepth: 2 },
    };

    // Both conditions are true, but only priority 1 fires
    const result = evaluateTransition(multiMatch, { ready: true, level: 10 });
    expect(result.firedArm!.label).toBe("first");

    const firedCount = result.armTraces.filter((t) => t.fired).length;
    expect(firedCount).toBe(1);
  });

  it("returns null firedArm when no condition matches", () => {
    // Use a state type that won't match any SDState arm conditions
    // by creating a methodology with impossible conditions
    type NeverState = { x: number };

    const neverMatch: Methodology<NeverState> = {
      id: "P-NEVER",
      name: "Never match",
      domain: {
        id: "D_NEVER",
        signature: { sorts: [], functionSymbols: [], predicates: {} },
        axioms: {},
      },
      arms: [
        {
          priority: 1,
          label: "impossible",
          condition: check<NeverState>("nope", () => false),
          selects: null,
          rationale: "Never matches",
        },
      ],
      objective: check<NeverState>("done", () => false),
      terminationCertificate: { measure: () => 1, decreases: "n/a" },
      safety: { maxLoops: 5, maxTokens: 50000, maxCostUsd: 5, maxDurationMs: 1800000, maxDepth: 2 },
    };

    const result = evaluateTransition(neverMatch, { x: 42 });
    expect(result.firedArm).toBeNull();
    expect(result.selectedMethod).toBeNull();
  });

  it("simulateRun traces a sequence of state transitions", () => {
    const states = [
      { taskType: "plan" as const, scope: "sprint" },
      { taskType: "implement" as const, scope: "feature-a" },
      { taskType: "implement" as const, scope: "feature-b" },
      { taskType: "review" as const, scope: "pr-1" },
      { taskType: "done" as const, scope: "" },
    ] satisfies SDState[];

    const sim = simulateRun(p2sd_simplified, states);

    expect(sim.selections).toHaveLength(5);
    expect(sim.selections[0].firedArm!.label).toBe("plan");
    expect(sim.selections[1].firedArm!.label).toBe("implement");
    expect(sim.selections[2].firedArm!.label).toBe("implement");
    expect(sim.selections[3].firedArm!.label).toBe("review");
    expect(sim.selections[4].firedArm!.label).toBe("terminate");

    // All arms select null (no method), so methodSequence should be empty
    expect(sim.methodSequence).toHaveLength(0);

    // Terminate arm has selects: null, so terminatesAt reflects where selectedMethod is null
    // Since ALL arms have selects: null, terminatesAt = 0 (first entry has null method)
    expect(sim.terminatesAt).toBe(0);
  });

  it("priority order is respected regardless of arm array order", () => {
    // Define arms in reverse priority order
    const reversed: Methodology<SDState> = {
      ...p2sd_simplified,
      arms: [...p2sd_simplified.arms].reverse(),
    };

    // Should still route to "implement" (priority 1) even though it's last in array
    const state: SDState = { taskType: "implement", scope: "feature" };
    const result = evaluateTransition(reversed, state);
    expect(result.firedArm!.label).toBe("implement");
  });
});

// ── instantiateMethodology: integration with routing ──

describe("instantiateMethodology integration", () => {
  it("enriches method roles within methodology arms", () => {
    // Create a minimal method to embed in an arm
    const testMethod: Method<SDState> = {
      id: "M-TEST",
      name: "Test Method",
      domain: D_SD_TEST,
      roles: [
        {
          id: "engineer",
          description: "Implements features",
          observe: (s: SDState) => s,
          authorized: [],
          notAuthorized: [],
        },
      ],
      dag: { steps: [], edges: [], initial: "start", terminal: "end" },
      objective: check<SDState>("done", (s) => s.taskType === "done"),
      measures: [],
    };

    const methodology: Methodology<SDState> = {
      ...p2sd_simplified,
      arms: [
        { ...p2sd_simplified.arms[0], selects: testMethod },
        ...p2sd_simplified.arms.slice(1),
      ],
    };

    const card: ProjectCard = {
      id: "I-TEST",
      name: "Test",
      deliveryRules: [],
      roleNotes: { engineer: "Use Rust instead of TypeScript" },
      contextBindings: {},
    };

    const instantiated = instantiateMethodology(methodology, card);

    // The first arm's method should have enriched roles
    const firstArm = instantiated.arms[0];
    expect(firstArm.selects).not.toBeNull();
    const engineerRole = firstArm.selects!.roles.find((r) => r.id === "engineer");
    expect(engineerRole!.description).toContain("Project note:");
    expect(engineerRole!.description).toContain("Rust instead of TypeScript");

    // Arms without methods should remain null
    expect(instantiated.arms[1].selects).toBeNull();
  });
});
