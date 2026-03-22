/**
 * Tests for compilation gates G1-G6.
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import {
  G1_domain,
  G2_objective,
  G3_roles,
  G4_dag,
  G5_guidance,
  G6_serializable,
  compilationGates,
} from "../gates.js";
import type { DesignState } from "../types.js";

/** A valid DesignState where all gates should pass. */
const validState: DesignState = {
  domainKnowledge: "full domain knowledge",
  candidateComponents: ["DomainTheory", "Objective", "Measure", "Roles", "StepDAG"],
  gateVerdicts: {},
  sufficiencyDecision: "proceed",
  guidanceFinalized: true,
  compiled: true,
};

/** An empty DesignState where most gates should fail. */
const emptyState: DesignState = {
  domainKnowledge: "",
  candidateComponents: [],
  gateVerdicts: {},
  sufficiencyDecision: null,
  guidanceFinalized: false,
  compiled: false,
};

describe("compilationGates", () => {
  it("has 6 gates", () => {
    expect(compilationGates).toHaveLength(6);
  });
});

describe("G1_domain", () => {
  it("passes when DomainTheory is in candidateComponents", () => {
    const result = Effect.runSync(G1_domain.evaluate(validState));
    expect(result.passed).toBe(true);
  });

  it("fails when DomainTheory is not in candidateComponents", () => {
    const result = Effect.runSync(G1_domain.evaluate(emptyState));
    expect(result.passed).toBe(false);
  });
});

describe("G2_objective", () => {
  it("passes when Objective is in candidateComponents", () => {
    const result = Effect.runSync(G2_objective.evaluate(validState));
    expect(result.passed).toBe(true);
  });

  it("fails when Objective is not in candidateComponents", () => {
    const result = Effect.runSync(G2_objective.evaluate(emptyState));
    expect(result.passed).toBe(false);
  });
});

describe("G3_roles", () => {
  it("passes when Roles is in candidateComponents", () => {
    const result = Effect.runSync(G3_roles.evaluate(validState));
    expect(result.passed).toBe(true);
  });

  it("fails when Roles is not in candidateComponents", () => {
    const result = Effect.runSync(G3_roles.evaluate(emptyState));
    expect(result.passed).toBe(false);
  });
});

describe("G4_dag", () => {
  it("passes when StepDAG is in candidateComponents", () => {
    const result = Effect.runSync(G4_dag.evaluate(validState));
    expect(result.passed).toBe(true);
  });

  it("fails when StepDAG is not in candidateComponents", () => {
    const result = Effect.runSync(G4_dag.evaluate(emptyState));
    expect(result.passed).toBe(false);
  });
});

describe("G5_guidance", () => {
  it("passes when guidanceFinalized is true", () => {
    const result = Effect.runSync(G5_guidance.evaluate(validState));
    expect(result.passed).toBe(true);
  });

  it("fails when guidanceFinalized is false", () => {
    const result = Effect.runSync(G5_guidance.evaluate(emptyState));
    expect(result.passed).toBe(false);
  });
});

describe("G6_serializable", () => {
  it("passes for a valid serializable state", () => {
    const result = Effect.runSync(G6_serializable.evaluate(validState));
    expect(result.passed).toBe(true);
  });

  it("passes for empty state (still serializable)", () => {
    const result = Effect.runSync(G6_serializable.evaluate(emptyState));
    expect(result.passed).toBe(true);
  });
});

describe("gate metadata", () => {
  it("each gate has a unique id", () => {
    const ids = compilationGates.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each gate has a description", () => {
    for (const gate of compilationGates) {
      expect(gate.description.length).toBeGreaterThan(0);
    }
  });

  it("gates are in G1-G6 order", () => {
    expect(compilationGates.map((g) => g.id)).toEqual([
      "G1-domain",
      "G2-objective",
      "G3-roles",
      "G4-dag",
      "G5-guidance",
      "G6-serializable",
    ]);
  });
});
