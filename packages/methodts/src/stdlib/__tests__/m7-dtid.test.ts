// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for M7_DTID — Domain Theory to Implementation Derivation.
 */

import { describe, it, expect } from "vitest";
import { M7_DTID } from "../methods/m7-dtid.js";
import { topologicalOrder } from "../../method/dag.js";
import { compileMethod } from "../../meta/compile.js";
import { evaluate } from "../../predicate/evaluate.js";
import type { DerivationState } from "../types.js";

describe("M7_DTID", () => {
  it("has 5 steps", () => {
    expect(M7_DTID.dag.steps).toHaveLength(5);
  });

  it("has 4 roles (domain_reader, derivation_analyst, gap_analyst, idd_compiler)", () => {
    expect(M7_DTID.roles).toHaveLength(4);
    const roleIds = M7_DTID.roles.map((r) => r.id);
    expect(roleIds).toContain("domain_reader");
    expect(roleIds).toContain("derivation_analyst");
    expect(roleIds).toContain("gap_analyst");
    expect(roleIds).toContain("idd_compiler");
  });

  it("DAG has 5 edges (diamond shape)", () => {
    expect(M7_DTID.dag.edges).toHaveLength(5);
  });

  it("DAG is a diamond: sigma_A1 → {sigma_A2, sigma_A3} → sigma_A4 → sigma_A5", () => {
    const edges = M7_DTID.dag.edges;
    // sigma_A1 fans out to sigma_A2 and sigma_A3
    expect(edges).toContainEqual({ from: "sigma_A1", to: "sigma_A2" });
    expect(edges).toContainEqual({ from: "sigma_A1", to: "sigma_A3" });
    // Both converge to sigma_A4
    expect(edges).toContainEqual({ from: "sigma_A2", to: "sigma_A4" });
    expect(edges).toContainEqual({ from: "sigma_A3", to: "sigma_A4" });
    // sigma_A4 → sigma_A5
    expect(edges).toContainEqual({ from: "sigma_A4", to: "sigma_A5" });
  });

  it("topologicalOrder returns 5 steps in a valid order", () => {
    const order = topologicalOrder(M7_DTID.dag);
    expect(order).toHaveLength(5);

    const ids = order.map((s) => s.id);
    // sigma_A1 must come first
    expect(ids[0]).toBe("sigma_A1");
    // sigma_A2 and sigma_A3 must come before sigma_A4 (order between them is flexible)
    const idxA2 = ids.indexOf("sigma_A2");
    const idxA3 = ids.indexOf("sigma_A3");
    const idxA4 = ids.indexOf("sigma_A4");
    const idxA5 = ids.indexOf("sigma_A5");
    expect(idxA2).toBeLessThan(idxA4);
    expect(idxA3).toBeLessThan(idxA4);
    // sigma_A5 must come last
    expect(idxA5).toBe(4);
  });

  it("DAG is acyclic (topologicalOrder does not throw)", () => {
    expect(() => topologicalOrder(M7_DTID.dag)).not.toThrow();
  });

  it("objective is a compound Predicate with tag 'and'", () => {
    expect(M7_DTID.objective.tag).toBe("and");
  });

  it("has initial step sigma_A1 and terminal step sigma_A5", () => {
    expect(M7_DTID.dag.initial).toBe("sigma_A1");
    expect(M7_DTID.dag.terminal).toBe("sigma_A5");
  });

  it("has 2 measures (mu_axiom_coverage, mu_free_choice_documentation)", () => {
    expect(M7_DTID.measures).toHaveLength(2);
    expect(M7_DTID.measures[0].id).toBe("mu_axiom_coverage");
    expect(M7_DTID.measures[1].id).toBe("mu_free_choice_documentation");
  });

  it("step names match YAML step names", () => {
    const names = M7_DTID.dag.steps.map((s) => s.name);
    expect(names).toEqual([
      "Theory Intake",
      "Derivation Pass",
      "Gap Pass",
      "Faithfulness Check",
      "IDD Assembly",
    ]);
  });

  it("step roles match YAML role assignments", () => {
    const roleMap: Record<string, string> = {};
    for (const step of M7_DTID.dag.steps) {
      roleMap[step.id] = step.role;
    }
    expect(roleMap["sigma_A1"]).toBe("domain_reader");
    expect(roleMap["sigma_A2"]).toBe("derivation_analyst");
    expect(roleMap["sigma_A3"]).toBe("gap_analyst");
    expect(roleMap["sigma_A4"]).toBe("idd_compiler");
    expect(roleMap["sigma_A5"]).toBe("idd_compiler");
  });

  describe("objective evaluation", () => {
    it("returns false when faithfulness not checked", () => {
      const state: DerivationState = {
        sourceMethodId: "M1-MDES",
        domainAnalysis: "analyzed",
        implementationPlan: ["plan-item"],
        derivedArtifacts: ["artifact"],
        faithfulnessChecked: false,
        idd: "some IDD content",
      };
      expect(evaluate(M7_DTID.objective, state)).toBe(false);
    });

    it("returns false when idd is empty", () => {
      const state: DerivationState = {
        sourceMethodId: "M1-MDES",
        domainAnalysis: "analyzed",
        implementationPlan: ["plan-item"],
        derivedArtifacts: ["artifact"],
        faithfulnessChecked: true,
        idd: "",
      };
      expect(evaluate(M7_DTID.objective, state)).toBe(false);
    });

    it("returns true when both faithful and idd produced", () => {
      const state: DerivationState = {
        sourceMethodId: "M1-MDES",
        domainAnalysis: "analyzed",
        implementationPlan: ["plan-item"],
        derivedArtifacts: ["artifact"],
        faithfulnessChecked: true,
        idd: "complete IDD document",
      };
      expect(evaluate(M7_DTID.objective, state)).toBe(true);
    });
  });

  describe("progress measures", () => {
    it("axiom_coverage returns 0 for initial state", () => {
      const state: DerivationState = {
        sourceMethodId: "",
        domainAnalysis: "",
        implementationPlan: [],
        derivedArtifacts: [],
        faithfulnessChecked: false,
        idd: "",
      };
      expect(M7_DTID.measures[0].compute(state)).toBe(0);
    });

    it("axiom_coverage returns 1 for terminal state", () => {
      const state: DerivationState = {
        sourceMethodId: "M1-MDES",
        domainAnalysis: "full analysis",
        implementationPlan: ["forced-choice-1"],
        derivedArtifacts: ["free-choice-1"],
        faithfulnessChecked: true,
        idd: "complete IDD",
      };
      expect(M7_DTID.measures[0].compute(state)).toBe(1);
    });

    it("free_choice_documentation returns 0 for initial state", () => {
      const state: DerivationState = {
        sourceMethodId: "",
        domainAnalysis: "",
        implementationPlan: [],
        derivedArtifacts: [],
        faithfulnessChecked: false,
        idd: "",
      };
      expect(M7_DTID.measures[1].compute(state)).toBe(0);
    });

    it("free_choice_documentation returns 1 for terminal state", () => {
      const state: DerivationState = {
        sourceMethodId: "M1-MDES",
        domainAnalysis: "full analysis",
        implementationPlan: ["forced-choice-1"],
        derivedArtifacts: ["free-choice-1"],
        faithfulnessChecked: true,
        idd: "complete IDD",
      };
      expect(M7_DTID.measures[1].compute(state)).toBe(1);
    });
  });

  describe("compileMethod", () => {
    const emptyState: DerivationState = {
      sourceMethodId: "",
      domainAnalysis: "",
      implementationPlan: [],
      derivedArtifacts: [],
      faithfulnessChecked: false,
      idd: "",
    };

    const fullState: DerivationState = {
      sourceMethodId: "M1-MDES",
      domainAnalysis: "full analysis of D_DESIGN",
      implementationPlan: ["sort→entity for Component", "sort→entity for Gate"],
      derivedArtifacts: ["free-choice: guidance format"],
      faithfulnessChecked: true,
      idd: "IDD-D_DESIGN-v1.0 — forced table + free table + faithfulness certificate",
    };

    it("compiles with full state (no agent steps => compiled)", () => {
      const report = compileMethod(M7_DTID, [fullState]);
      expect(report.overall).toBe("compiled");
      expect(report.methodId).toBe("M7-DTID");
    });

    it("compiles with empty state (composability may fail but no crash)", () => {
      const report = compileMethod(M7_DTID, [emptyState]);
      expect(["compiled", "failed", "needs_review"]).toContain(report.overall);
      expect(report.gates).toHaveLength(6);
    });

    it("compiles with both test states", () => {
      const report = compileMethod(M7_DTID, [emptyState, fullState]);
      expect(report.gates).toHaveLength(6);
      expect(report.methodId).toBe("M7-DTID");
    });
  });
});
