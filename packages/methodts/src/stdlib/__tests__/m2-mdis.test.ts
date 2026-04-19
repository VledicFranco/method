// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for M2_MDIS — Method Discovery from Informal Practice.
 */

import { describe, it, expect } from "vitest";
import { M2_MDIS } from "../methods/m2-mdis.js";
import { topologicalOrder } from "../../method/dag.js";
import { compileMethod } from "../../meta/compile.js";
import type { DiscoveryState } from "../types.js";

describe("M2_MDIS", () => {
  it("has 5 steps", () => {
    expect(M2_MDIS.dag.steps).toHaveLength(5);
  });

  it("has 1 role (discoverer)", () => {
    expect(M2_MDIS.roles).toHaveLength(1);
    expect(M2_MDIS.roles[0].id).toBe("discoverer");
  });

  it("DAG has 4 edges (linear chain)", () => {
    expect(M2_MDIS.dag.edges).toHaveLength(4);
  });

  it("topologicalOrder returns 5 steps in sigma_0 through sigma_4 order", () => {
    const order = topologicalOrder(M2_MDIS.dag);
    expect(order).toHaveLength(5);
    expect(order.map((s) => s.id)).toEqual([
      "sigma_0",
      "sigma_1",
      "sigma_2",
      "sigma_3",
      "sigma_4",
    ]);
  });

  it("objective is a Predicate with tag 'check'", () => {
    expect(M2_MDIS.objective.tag).toBe("check");
  });

  it("has initial step sigma_0 and terminal step sigma_4", () => {
    expect(M2_MDIS.dag.initial).toBe("sigma_0");
    expect(M2_MDIS.dag.terminal).toBe("sigma_4");
  });

  it("has 1 measure (mu_lifecycle_progress)", () => {
    expect(M2_MDIS.measures).toHaveLength(1);
    expect(M2_MDIS.measures[0].id).toBe("mu_lifecycle_progress");
  });

  it("step names match YAML phase names", () => {
    const names = M2_MDIS.dag.steps.map((s) => s.name);
    expect(names).toEqual(["Recognize", "Draft", "Trial", "Evaluate", "Promote"]);
  });

  it("all steps are assigned to discoverer role", () => {
    for (const step of M2_MDIS.dag.steps) {
      expect(step.role).toBe("discoverer");
    }
  });

  describe("objective evaluation", () => {
    it("returns false when outcome is null", () => {
      const state: DiscoveryState = {
        informalPractice: "test",
        recognition: "recognized",
        draft: "drafted",
        trialResult: "success",
        evaluationResult: "promote",
        outcome: null,
        candidateComponents: [],
      };
      if (M2_MDIS.objective.tag === "check") {
        expect(M2_MDIS.objective.check(state)).toBe(false);
      }
    });

    it("returns true when outcome is set", () => {
      const state: DiscoveryState = {
        informalPractice: "test",
        recognition: "recognized",
        draft: "drafted",
        trialResult: "success",
        evaluationResult: "promote",
        outcome: "compiled_method",
        candidateComponents: [],
      };
      if (M2_MDIS.objective.tag === "check") {
        expect(M2_MDIS.objective.check(state)).toBe(true);
      }
    });
  });

  describe("progress measure", () => {
    it("returns 0 for initial state", () => {
      const state: DiscoveryState = {
        informalPractice: "",
        recognition: "",
        draft: "",
        trialResult: null,
        evaluationResult: null,
        outcome: null,
        candidateComponents: [],
      };
      expect(M2_MDIS.measures[0].compute(state)).toBe(0);
    });

    it("returns 1 for terminal state", () => {
      const state: DiscoveryState = {
        informalPractice: "practice",
        recognition: "recognized",
        draft: "drafted",
        trialResult: "success",
        evaluationResult: "promote",
        outcome: "compiled_method",
        candidateComponents: [],
      };
      expect(M2_MDIS.measures[0].compute(state)).toBe(1);
    });
  });

  describe("compileMethod", () => {
    const emptyState: DiscoveryState = {
      informalPractice: "",
      recognition: "",
      draft: "",
      trialResult: null,
      evaluationResult: null,
      outcome: null,
      candidateComponents: [],
    };

    const fullState: DiscoveryState = {
      informalPractice: "recurring retro pattern",
      recognition: "recognized as protocol candidate",
      draft: "protocol YAML drafted",
      trialResult: "success",
      evaluationResult: "promote",
      outcome: "compiled_method",
      candidateComponents: ["Protocol", "TrialEvidence", "Artifact"],
    };

    it("compiles with full state (no agent steps => compiled)", () => {
      const report = compileMethod(M2_MDIS, [fullState]);
      expect(report.overall).toBe("compiled");
      expect(report.methodId).toBe("M2-MDIS");
    });

    it("compiles with empty state (composability may fail but no crash)", () => {
      const report = compileMethod(M2_MDIS, [emptyState]);
      expect(["compiled", "failed", "needs_review"]).toContain(report.overall);
      expect(report.gates).toHaveLength(6);
    });

    it("compiles with both test states", () => {
      const report = compileMethod(M2_MDIS, [emptyState, fullState]);
      expect(report.gates).toHaveLength(6);
      expect(report.methodId).toBe("M2-MDIS");
    });
  });
});
