/**
 * Tests for M5_MCOM — Method Composition method.
 *
 * Validates: step count, role count, linear DAG, acyclicity,
 * objective evaluation, and compileMethod compatibility.
 */

import { describe, it, expect } from "vitest";
import { M5_MCOM } from "../methods/m5-mcom.js";
import { topologicalOrder } from "../../method/dag.js";
import { compileMethod } from "../../meta/compile.js";
import { evaluate } from "../../predicate/evaluate.js";
import type { CompositionState } from "../types.js";

describe("M5_MCOM", () => {
  it("has 7 steps", () => {
    expect(M5_MCOM.dag.steps).toHaveLength(7);
  });

  it("has 2 roles (composer, compiler)", () => {
    expect(M5_MCOM.roles).toHaveLength(2);
    const roleIds = M5_MCOM.roles.map((r) => r.id);
    expect(roleIds).toContain("composer");
    expect(roleIds).toContain("compiler");
  });

  it("DAG has 6 edges (linear chain)", () => {
    expect(M5_MCOM.dag.edges).toHaveLength(6);
  });

  it("topologicalOrder returns 7 steps in sigma_0 through sigma_6 order", () => {
    const order = topologicalOrder(M5_MCOM.dag);
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

  it("DAG is acyclic (topologicalOrder does not throw)", () => {
    expect(() => topologicalOrder(M5_MCOM.dag)).not.toThrow();
  });

  it("has initial step sigma_0 and terminal step sigma_6", () => {
    expect(M5_MCOM.dag.initial).toBe("sigma_0");
    expect(M5_MCOM.dag.terminal).toBe("sigma_6");
  });

  it("objective is a Predicate with tag 'check'", () => {
    expect(M5_MCOM.objective.tag).toBe("check");
  });

  it("objective evaluates to true when compiled", () => {
    const state: CompositionState = {
      methodA: "M1-MDES",
      methodB: "M4-MINS",
      mergedDomain: true,
      composedDAG: true,
      unifiedRoles: true,
      compiled: true,
    };
    expect(evaluate(M5_MCOM.objective, state)).toBe(true);
  });

  it("objective evaluates to false when not compiled", () => {
    const state: CompositionState = {
      methodA: "M1-MDES",
      methodB: "M4-MINS",
      mergedDomain: true,
      composedDAG: true,
      unifiedRoles: true,
      compiled: false,
    };
    expect(evaluate(M5_MCOM.objective, state)).toBe(false);
  });

  it("has 3 measures", () => {
    expect(M5_MCOM.measures).toHaveLength(3);
    expect(M5_MCOM.measures[0].id).toBe("mu_interface_completeness");
    expect(M5_MCOM.measures[1].id).toBe("mu_structural_assembly");
    expect(M5_MCOM.measures[2].id).toBe("mu_compilation_gate_passage");
  });

  describe("compileMethod", () => {
    const emptyState: CompositionState = {
      methodA: "",
      methodB: "",
      mergedDomain: false,
      composedDAG: false,
      unifiedRoles: false,
      compiled: false,
    };

    const fullState: CompositionState = {
      methodA: "M1-MDES",
      methodB: "M4-MINS",
      mergedDomain: true,
      composedDAG: true,
      unifiedRoles: true,
      compiled: true,
    };

    it("compiles with full state (no agent steps => compiled)", () => {
      const report = compileMethod(M5_MCOM, [fullState]);
      expect(report.overall).toBe("compiled");
      expect(report.methodId).toBe("M5-MCOM");
    });

    it("compiles with empty state (may fail composability but no crash)", () => {
      const report = compileMethod(M5_MCOM, [emptyState]);
      expect(["compiled", "failed", "needs_review"]).toContain(report.overall);
      expect(report.gates).toHaveLength(6);
    });

    it("compiles with both test states", () => {
      const report = compileMethod(M5_MCOM, [emptyState, fullState]);
      expect(report.gates).toHaveLength(6);
      expect(report.methodId).toBe("M5-MCOM");
    });
  });
});
