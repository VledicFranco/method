/**
 * Tests for M1_MDES — Method Design method.
 */

import { describe, it, expect } from "vitest";
import { M1_MDES } from "../methods/m1-mdes.js";
import { topologicalOrder } from "../../method/dag.js";
import { compileMethod } from "../../meta/compile.js";
import type { DesignState } from "../types.js";

describe("M1_MDES", () => {
  it("has 7 steps", () => {
    expect(M1_MDES.dag.steps).toHaveLength(7);
  });

  it("has 2 roles (designer, compiler)", () => {
    expect(M1_MDES.roles).toHaveLength(2);
    const roleIds = M1_MDES.roles.map((r) => r.id);
    expect(roleIds).toContain("designer");
    expect(roleIds).toContain("compiler");
  });

  it("DAG has 6 edges (linear chain)", () => {
    expect(M1_MDES.dag.edges).toHaveLength(6);
  });

  it("topologicalOrder returns 7 steps in sigma_0 through sigma_6 order", () => {
    const order = topologicalOrder(M1_MDES.dag);
    expect(order).toHaveLength(7);
    expect(order.map((s) => s.id)).toEqual([
      "sigma_0",
      "sigma_1",
      "sigma_2",
      "sigma_3",
      "sigma_4",
      "sigma_5",
      "sigma_6",
    ]);
  });

  it("objective is a Predicate with tag 'check'", () => {
    expect(M1_MDES.objective.tag).toBe("check");
  });

  it("has initial step sigma_0 and terminal step sigma_6", () => {
    expect(M1_MDES.dag.initial).toBe("sigma_0");
    expect(M1_MDES.dag.terminal).toBe("sigma_6");
  });

  it("has 1 measure (mu_design_progress)", () => {
    expect(M1_MDES.measures).toHaveLength(1);
    expect(M1_MDES.measures[0].id).toBe("mu_design_progress");
  });

  describe("compileMethod", () => {
    const emptyState: DesignState = {
      domainKnowledge: "",
      candidateComponents: [],
      gateVerdicts: {},
      sufficiencyDecision: null,
      guidanceFinalized: false,
      compiled: false,
    };

    const fullState: DesignState = {
      domainKnowledge: "full",
      candidateComponents: ["DomainTheory", "Objective", "Measure", "Roles", "StepDAG"],
      gateVerdicts: {},
      sufficiencyDecision: "proceed",
      guidanceFinalized: true,
      compiled: true,
    };

    it("compiles with full state (no agent steps => compiled)", () => {
      const report = compileMethod(M1_MDES, [fullState]);
      // All steps are script steps so G5 passes => overall "compiled"
      expect(report.overall).toBe("compiled");
      expect(report.methodId).toBe("M1-MDES");
    });

    it("compiles with empty state (composability may fail but no crash)", () => {
      const report = compileMethod(M1_MDES, [emptyState]);
      // With empty state, composability check will find non-composable edges
      // (post of sigma_0 requires knowledge but empty state has none)
      expect(["compiled", "failed", "needs_review"]).toContain(report.overall);
      expect(report.gates).toHaveLength(6);
    });

    it("compiles with both test states", () => {
      const report = compileMethod(M1_MDES, [emptyState, fullState]);
      // The presence of emptyState may cause composability failures
      expect(report.gates).toHaveLength(6);
      expect(report.methodId).toBe("M1-MDES");
    });
  });
});
