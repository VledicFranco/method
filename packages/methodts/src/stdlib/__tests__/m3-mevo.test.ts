/**
 * Tests for M3_MEVO — Method Evolution from Execution Evidence.
 */

import { describe, it, expect } from "vitest";
import { M3_MEVO } from "../methods/m3-mevo.js";
import { topologicalOrder } from "../../method/dag.js";
import { compileMethod } from "../../meta/compile.js";
import type { EvolutionState } from "../types.js";

describe("M3_MEVO", () => {
  it("has 6 steps", () => {
    expect(M3_MEVO.dag.steps).toHaveLength(6);
  });

  it("has 3 roles (analyst, evolver, compiler)", () => {
    expect(M3_MEVO.roles).toHaveLength(3);
    const roleIds = M3_MEVO.roles.map((r) => r.id);
    expect(roleIds).toContain("analyst");
    expect(roleIds).toContain("evolver");
    expect(roleIds).toContain("compiler");
  });

  it("DAG has 5 edges (linear chain)", () => {
    expect(M3_MEVO.dag.edges).toHaveLength(5);
  });

  it("topologicalOrder returns 6 steps in sigma_0 through sigma_5 order", () => {
    const order = topologicalOrder(M3_MEVO.dag);
    expect(order).toHaveLength(6);
    expect(order.map((s) => s.id)).toEqual([
      "sigma_0",
      "sigma_1",
      "sigma_2",
      "sigma_3",
      "sigma_4",
      "sigma_5",
    ]);
  });

  it("DAG is acyclic (topologicalOrder does not throw)", () => {
    expect(() => topologicalOrder(M3_MEVO.dag)).not.toThrow();
  });

  it("objective is a Predicate with tag 'check'", () => {
    expect(M3_MEVO.objective.tag).toBe("check");
  });

  it("objective evaluates to true when recompiled", () => {
    const state: EvolutionState = {
      targetMethod: "M1-TEST",
      gaps: [{ name: "gap-1", severity: "HIGH" }],
      evidenceSummary: "3 sessions reviewed",
      proposedChanges: ["fix guidance at sigma_3"],
      recompiled: true,
    };
    if (M3_MEVO.objective.tag === "check") {
      expect(M3_MEVO.objective.check(state)).toBe(true);
    }
  });

  it("objective evaluates to false when not recompiled", () => {
    const state: EvolutionState = {
      targetMethod: "M1-TEST",
      gaps: [{ name: "gap-1", severity: "HIGH" }],
      evidenceSummary: "3 sessions reviewed",
      proposedChanges: ["fix guidance at sigma_3"],
      recompiled: false,
    };
    if (M3_MEVO.objective.tag === "check") {
      expect(M3_MEVO.objective.check(state)).toBe(false);
    }
  });

  it("has initial step sigma_0 and terminal step sigma_5", () => {
    expect(M3_MEVO.dag.initial).toBe("sigma_0");
    expect(M3_MEVO.dag.terminal).toBe("sigma_5");
  });

  it("has 3 measures (gap_coverage, refinement_completeness, compilation_passage)", () => {
    expect(M3_MEVO.measures).toHaveLength(3);
    expect(M3_MEVO.measures[0].id).toBe("mu_gap_coverage");
    expect(M3_MEVO.measures[1].id).toBe("mu_refinement_completeness");
    expect(M3_MEVO.measures[2].id).toBe("mu_compilation_passage");
  });

  describe("compileMethod", () => {
    const emptyState: EvolutionState = {
      targetMethod: "",
      gaps: [],
      evidenceSummary: "",
      proposedChanges: [],
      recompiled: false,
    };

    const fullState: EvolutionState = {
      targetMethod: "M1-IMPL",
      gaps: [{ name: "sigma_3 output schema missing coverage_claim", severity: "HIGH" }],
      evidenceSummary: "5 sessions reviewed, 3 gap candidates identified",
      proposedChanges: ["CHG-001: revise sigma_3 guidance to emphasize coverage_claim field"],
      recompiled: true,
    };

    it("compiles with full state (no agent steps => compiled)", () => {
      const report = compileMethod(M3_MEVO, [fullState]);
      expect(report.overall).toBe("compiled");
      expect(report.methodId).toBe("M3-MEVO");
    });

    it("compiles with empty state (composability may fail but no crash)", () => {
      const report = compileMethod(M3_MEVO, [emptyState]);
      expect(["compiled", "failed", "needs_review"]).toContain(report.overall);
      expect(report.gates).toHaveLength(6);
    });

    it("compiles with both test states", () => {
      const report = compileMethod(M3_MEVO, [emptyState, fullState]);
      expect(report.gates).toHaveLength(6);
      expect(report.methodId).toBe("M3-MEVO");
    });
  });
});
