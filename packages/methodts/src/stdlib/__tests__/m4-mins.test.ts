/**
 * Tests for M4_MINS — Method Instantiation method.
 *
 * Validates: step count, role count, linear DAG, acyclicity,
 * objective evaluation, and compileMethod compatibility.
 */

import { describe, it, expect } from "vitest";
import { M4_MINS } from "../methods/m4-mins.js";
import { topologicalOrder } from "../../method/dag.js";
import { compileMethod } from "../../meta/compile.js";
import { evaluate } from "../../predicate/evaluate.js";
import type { InstantiationState } from "../types.js";

describe("M4_MINS", () => {
  it("has 7 steps", () => {
    expect(M4_MINS.dag.steps).toHaveLength(7);
  });

  it("has 2 roles (instantiator, compiler)", () => {
    expect(M4_MINS.roles).toHaveLength(2);
    const roleIds = M4_MINS.roles.map((r) => r.id);
    expect(roleIds).toContain("instantiator");
    expect(roleIds).toContain("compiler");
  });

  it("DAG has 6 edges (linear chain)", () => {
    expect(M4_MINS.dag.edges).toHaveLength(6);
  });

  it("topologicalOrder returns 7 steps in sigma_0 through sigma_6 order", () => {
    const order = topologicalOrder(M4_MINS.dag);
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
    expect(() => topologicalOrder(M4_MINS.dag)).not.toThrow();
  });

  it("has initial step sigma_0 and terminal step sigma_6", () => {
    expect(M4_MINS.dag.initial).toBe("sigma_0");
    expect(M4_MINS.dag.terminal).toBe("sigma_6");
  });

  it("objective is a Predicate with tag 'check'", () => {
    expect(M4_MINS.objective.tag).toBe("check");
  });

  it("objective evaluates to true when validated", () => {
    const state: InstantiationState = {
      methodId: "M1-MDES",
      projectContext: "full context",
      domainMorphism: "embed-project",
      boundSteps: ["step-1"],
      roleFiles: ["role-1"],
      validated: true,
    };
    expect(evaluate(M4_MINS.objective, state)).toBe(true);
  });

  it("objective evaluates to false when not validated", () => {
    const state: InstantiationState = {
      methodId: "M1-MDES",
      projectContext: "full context",
      domainMorphism: "embed-project",
      boundSteps: ["step-1"],
      roleFiles: ["role-1"],
      validated: false,
    };
    expect(evaluate(M4_MINS.objective, state)).toBe(false);
  });

  it("has 3 measures", () => {
    expect(M4_MINS.measures).toHaveLength(3);
    expect(M4_MINS.measures[0].id).toBe("mu_morphism_completeness");
    expect(M4_MINS.measures[1].id).toBe("mu_specialization_coverage");
    expect(M4_MINS.measures[2].id).toBe("mu_compilation_gate_passage");
  });

  describe("compileMethod", () => {
    const emptyState: InstantiationState = {
      methodId: "",
      projectContext: "",
      domainMorphism: "",
      boundSteps: [],
      roleFiles: [],
      validated: false,
    };

    const fullState: InstantiationState = {
      methodId: "M1-MDES",
      projectContext: "full project context",
      domainMorphism: "embed-project-retraction",
      boundSteps: ["specialized-step-1"],
      roleFiles: ["role-file-1"],
      validated: true,
    };

    it("compiles with full state (no agent steps => compiled)", () => {
      const report = compileMethod(M4_MINS, [fullState]);
      expect(report.overall).toBe("compiled");
      expect(report.methodId).toBe("M4-MINS");
    });

    it("compiles with empty state (may fail composability but no crash)", () => {
      const report = compileMethod(M4_MINS, [emptyState]);
      expect(["compiled", "failed", "needs_review"]).toContain(report.overall);
      expect(report.gates).toHaveLength(6);
    });

    it("compiles with both test states", () => {
      const report = compileMethod(M4_MINS, [emptyState, fullState]);
      expect(report.gates).toHaveLength(6);
      expect(report.methodId).toBe("M4-MINS");
    });
  });
});
