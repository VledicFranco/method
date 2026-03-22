/**
 * Tests for P2-SD methods — M1_IMPL, M2_DIMPL, M3_PHRV, M4_DDAG, M5_PLAN,
 * M6_ARFN, M7_PRDS.
 *
 * For each method: structural properties, domain theory, DAG validity,
 * objective shape, measures, and compilation via testkit assertions.
 */

import { describe, it, expect } from "vitest";
import {
  assertCompiles,
  assertSignatureValid,
  assertDAGAcyclic,
} from "@method/testkit";
import { topologicalOrder } from "../../method/dag.js";
import { compileMethod } from "../../meta/compile.js";
import { M1_IMPL } from "../methods/p2/m1-impl.js";
import { M2_DIMPL } from "../methods/p2/m2-dimpl.js";
import { M3_PHRV } from "../methods/p2/m3-phrv.js";
import { M4_DDAG } from "../methods/p2/m4-ddag.js";
import { M5_PLAN } from "../methods/p2/m5-plan.js";
import { M6_ARFN } from "../methods/p2/m6-arfn.js";
import { M7_PRDS } from "../methods/p2/m7-prds.js";

// ════════════════════════════════════════════════════════════════════════════
// M1_IMPL — Method for Implementing Software from Architecture and PRDs
// ════════════════════════════════════════════════════════════════════════════

describe("M1_IMPL", () => {
  // ── Structural ──

  it("has correct id", () => {
    expect(M1_IMPL.id).toBe("M1-IMPL");
  });

  it("has correct name", () => {
    expect(M1_IMPL.name).toBe("Method for Implementing Software from Architecture and PRDs");
  });

  it("has 9 steps", () => {
    expect(M1_IMPL.dag.steps).toHaveLength(9);
  });

  it("has 2 roles (auditor, implementor)", () => {
    expect(M1_IMPL.roles).toHaveLength(2);
    const roleIds = M1_IMPL.roles.map((r) => r.id);
    expect(roleIds).toContain("auditor");
    expect(roleIds).toContain("implementor");
  });

  // ── Domain theory ──

  describe("D_SI", () => {
    const domain = M1_IMPL.domain;

    it("has id D_SI", () => {
      expect(domain.id).toBe("D_SI");
    });

    it("has 10 sorts", () => {
      expect(domain.signature.sorts).toHaveLength(10);
    });

    it("has 9 predicates", () => {
      expect(Object.keys(domain.signature.predicates)).toHaveLength(9);
    });

    it("signature is valid", () => {
      assertSignatureValid(domain);
    });
  });

  // ── DAG ──

  it("DAG has 8 edges (linear chain)", () => {
    expect(M1_IMPL.dag.edges).toHaveLength(8);
  });

  it("has initial step sigma_0 and terminal step sigma_8", () => {
    expect(M1_IMPL.dag.initial).toBe("sigma_0");
    expect(M1_IMPL.dag.terminal).toBe("sigma_8");
  });

  it("DAG is acyclic", () => {
    assertDAGAcyclic(M1_IMPL);
  });

  it("topologicalOrder returns 9 steps in sigma_0..sigma_8 order", () => {
    const order = topologicalOrder(M1_IMPL.dag);
    expect(order).toHaveLength(9);
    expect(order.map((s) => s.id)).toEqual([
      "sigma_0", "sigma_1", "sigma_2", "sigma_3",
      "sigma_4", "sigma_5", "sigma_6", "sigma_7", "sigma_8",
    ]);
  });

  // ── Objective ──

  it("objective is a check predicate", () => {
    expect(M1_IMPL.objective.tag).toBe("check");
  });

  // ── Measures ──

  it("has 3 measures", () => {
    expect(M1_IMPL.measures).toHaveLength(3);
    const ids = M1_IMPL.measures.map((m) => m.id);
    expect(ids).toContain("mu_compile_integrity");
    expect(ids).toContain("mu_test_stability");
    expect(ids).toContain("mu_impl_progress");
  });

  // ── Compilation ──

  describe("compileMethod", () => {
    const emptyState = {
      specCorpusItems: 0,
      sourceFilesRead: 0,
      discrepancyCount: 0,
      unresolvedCritical: 0,
      unresolvedHigh: 0,
      severityRechecked: false,
      confidenceScore: 0,
      goNoGoDecision: false,
      taskRef: "",
      filesChanged: [] as readonly string[],
      divergences: [] as readonly string[],
      decisions: [] as readonly string[],
      compileGate: "NOT_RUN" as const,
      testPassCount: 0,
      testFailCount: 0,
      sessionRecorded: false,
    };

    const fullState = {
      specCorpusItems: 12,
      sourceFilesRead: 8,
      discrepancyCount: 2,
      unresolvedCritical: 0,
      unresolvedHigh: 0,
      severityRechecked: true,
      confidenceScore: 0.95,
      goNoGoDecision: true,
      taskRef: "PRD-001/phase-1/task-1",
      filesChanged: ["src/server.ts", "src/handler.ts"] as readonly string[],
      divergences: [] as readonly string[],
      decisions: ["used adapter pattern for handler"] as readonly string[],
      compileGate: "PASS" as const,
      testPassCount: 42,
      testFailCount: 0,
      sessionRecorded: true,
    };

    it("compiles with full state", () => {
      const report = assertCompiles(M1_IMPL, [fullState]);
      expect(report.methodId).toBe("M1-IMPL");
    });

    it("compiles with empty state (no crash)", () => {
      const report = compileMethod(M1_IMPL, [emptyState]);
      expect(["compiled", "failed", "needs_review"]).toContain(report.overall);
      expect(report.gates).toHaveLength(6);
    });

    it("compiles with both test states", () => {
      const report = compileMethod(M1_IMPL, [emptyState, fullState]);
      expect(report.gates).toHaveLength(6);
      expect(report.methodId).toBe("M1-IMPL");
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// M2_DIMPL — Distributed Implementation Method
// ════════════════════════════════════════════════════════════════════════════

describe("M2_DIMPL", () => {
  // ── Structural ──

  it("has correct id", () => {
    expect(M2_DIMPL.id).toBe("M2-DIMPL");
  });

  it("has correct name", () => {
    expect(M2_DIMPL.name).toBe("Distributed Implementation Method");
  });

  it("has 5 steps", () => {
    expect(M2_DIMPL.dag.steps).toHaveLength(5);
  });

  it("has 4 roles (orchestrator, impl_sub_agent, qa_sub_agent, sec_arch_sub_agent)", () => {
    expect(M2_DIMPL.roles).toHaveLength(4);
    const roleIds = M2_DIMPL.roles.map((r) => r.id);
    expect(roleIds).toContain("orchestrator");
    expect(roleIds).toContain("impl_sub_agent");
    expect(roleIds).toContain("qa_sub_agent");
    expect(roleIds).toContain("sec_arch_sub_agent");
  });

  // ── Domain theory ──

  describe("D_DIMPL", () => {
    const domain = M2_DIMPL.domain;

    it("has id D_DIMPL", () => {
      expect(domain.id).toBe("D_DIMPL");
    });

    it("has 9 sorts", () => {
      expect(domain.signature.sorts).toHaveLength(9);
    });

    it("has 5 predicates", () => {
      expect(Object.keys(domain.signature.predicates)).toHaveLength(5);
    });

    it("signature is valid", () => {
      assertSignatureValid(domain);
    });
  });

  // ── DAG ──

  it("DAG has 4 edges (linear chain)", () => {
    expect(M2_DIMPL.dag.edges).toHaveLength(4);
  });

  it("has initial step sigma_0 and terminal step sigma_4", () => {
    expect(M2_DIMPL.dag.initial).toBe("sigma_0");
    expect(M2_DIMPL.dag.terminal).toBe("sigma_4");
  });

  it("DAG is acyclic", () => {
    assertDAGAcyclic(M2_DIMPL);
  });

  it("topologicalOrder returns 5 steps in sigma_0..sigma_4 order", () => {
    const order = topologicalOrder(M2_DIMPL.dag);
    expect(order).toHaveLength(5);
    expect(order.map((s) => s.id)).toEqual([
      "sigma_0", "sigma_1", "sigma_2", "sigma_3", "sigma_4",
    ]);
  });

  // ── Objective ──

  it("objective is a check predicate", () => {
    expect(M2_DIMPL.objective.tag).toBe("check");
  });

  // ── Measures ──

  it("has 2 measures", () => {
    expect(M2_DIMPL.measures).toHaveLength(2);
    const ids = M2_DIMPL.measures.map((m) => m.id);
    expect(ids).toContain("mu_gate_a_pass_rate");
    expect(ids).toContain("mu_dimpl_progress");
  });

  // ── Compilation ──

  describe("compileMethod", () => {
    const emptyState = {
      tasks: [] as readonly { readonly id: string; readonly description: string; readonly fileScope: readonly string[] }[],
      coverageVerified: false,
      independenceVerified: false,
      allResultsReceived: false,
      gateAResults: [] as readonly { readonly taskId: string; readonly verdict: "PASS" | "FAIL"; readonly patchCount: number }[],
      allGateAPass: false,
      terminalFailures: [] as readonly string[],
      gateBVerdict: null,
      gateBFindings: [] as readonly string[],
      sessionLogAssembled: false,
      compileExit: 0 as 0 | number,
      regressionCount: 0,
      outcome: null,
    };

    const fullState = {
      tasks: [
        { id: "t1", description: "Implement auth", fileScope: ["src/auth.ts"] as readonly string[] },
        { id: "t2", description: "Implement payments", fileScope: ["src/pay.ts"] as readonly string[] },
      ] as readonly { readonly id: string; readonly description: string; readonly fileScope: readonly string[] }[],
      coverageVerified: true,
      independenceVerified: true,
      allResultsReceived: true,
      gateAResults: [
        { taskId: "t1", verdict: "PASS" as const, patchCount: 0 },
        { taskId: "t2", verdict: "PASS" as const, patchCount: 0 },
      ] as readonly { readonly taskId: string; readonly verdict: "PASS" | "FAIL"; readonly patchCount: number }[],
      allGateAPass: true,
      terminalFailures: [] as readonly string[],
      gateBVerdict: "PASS" as const,
      gateBFindings: [] as readonly string[],
      sessionLogAssembled: true,
      compileExit: 0 as 0 | number,
      regressionCount: 0,
      outcome: "PASS" as const,
    };

    it("compiles with full state", () => {
      const report = assertCompiles(M2_DIMPL, [fullState]);
      expect(report.methodId).toBe("M2-DIMPL");
    });

    it("compiles with empty state (no crash)", () => {
      const report = compileMethod(M2_DIMPL, [emptyState]);
      expect(["compiled", "failed", "needs_review"]).toContain(report.overall);
      expect(report.gates).toHaveLength(6);
    });

    it("compiles with both test states", () => {
      const report = compileMethod(M2_DIMPL, [emptyState, fullState]);
      expect(report.gates).toHaveLength(6);
      expect(report.methodId).toBe("M2-DIMPL");
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// M3_PHRV — Phase Review Method
// ════════════════════════════════════════════════════════════════════════════

describe("M3_PHRV", () => {
  // ── Structural ──

  it("has correct id", () => {
    expect(M3_PHRV.id).toBe("M3-PHRV");
  });

  it("has correct name", () => {
    expect(M3_PHRV.name).toBe("Phase Review Method");
  });

  it("has 4 steps", () => {
    expect(M3_PHRV.dag.steps).toHaveLength(4);
  });

  it("has 1 role (reviewer)", () => {
    expect(M3_PHRV.roles).toHaveLength(1);
    expect(M3_PHRV.roles[0].id).toBe("reviewer");
  });

  // ── Domain theory ──

  describe("D_PHRV", () => {
    const domain = M3_PHRV.domain;

    it("has id D_PHRV", () => {
      expect(domain.id).toBe("D_PHRV");
    });

    it("has 7 sorts", () => {
      expect(domain.signature.sorts).toHaveLength(7);
    });

    it("has 5 predicates", () => {
      expect(Object.keys(domain.signature.predicates)).toHaveLength(5);
    });

    it("signature is valid", () => {
      assertSignatureValid(domain);
    });
  });

  // ── DAG ──

  it("DAG has 3 edges (linear chain)", () => {
    expect(M3_PHRV.dag.edges).toHaveLength(3);
  });

  it("has initial step sigma_0 and terminal step sigma_3", () => {
    expect(M3_PHRV.dag.initial).toBe("sigma_0");
    expect(M3_PHRV.dag.terminal).toBe("sigma_3");
  });

  it("DAG is acyclic", () => {
    assertDAGAcyclic(M3_PHRV);
  });

  it("topologicalOrder returns 4 steps in sigma_0..sigma_3 order", () => {
    const order = topologicalOrder(M3_PHRV.dag);
    expect(order).toHaveLength(4);
    expect(order.map((s) => s.id)).toEqual([
      "sigma_0", "sigma_1", "sigma_2", "sigma_3",
    ]);
  });

  // ── Objective ──

  it("objective is a check predicate", () => {
    expect(M3_PHRV.objective.tag).toBe("check");
  });

  // ── Measures ──

  it("has 2 measures", () => {
    expect(M3_PHRV.measures).toHaveLength(2);
    const ids = M3_PHRV.measures.map((m) => m.id);
    expect(ids).toContain("mu_coverage");
    expect(ids).toContain("mu_completeness");
  });

  // ── Compilation ──

  describe("compileMethod", () => {
    const emptyState = {
      acceptanceCriteria: [] as readonly string[],
      architectureDocs: [] as readonly string[],
      filesInScope: [] as readonly string[],
      criteriaResults: [] as readonly { readonly criterion: string; readonly result: "MET" | "GAP" }[],
      architectureFindings: [] as readonly string[],
      architectureAligned: false,
      reportComplete: false,
      verdict: null,
    };

    const fullState = {
      acceptanceCriteria: ["AC-1: API returns 200", "AC-2: Tests pass"] as readonly string[],
      architectureDocs: ["docs/arch/api.md"] as readonly string[],
      filesInScope: ["src/api.ts", "src/handler.ts"] as readonly string[],
      criteriaResults: [
        { criterion: "AC-1", result: "MET" as const },
        { criterion: "AC-2", result: "MET" as const },
      ] as readonly { readonly criterion: string; readonly result: "MET" | "GAP" }[],
      architectureFindings: ["No deviations found"] as readonly string[],
      architectureAligned: true,
      reportComplete: true,
      verdict: "PASS" as const,
    };

    it("compiles with full state", () => {
      const report = assertCompiles(M3_PHRV, [fullState]);
      expect(report.methodId).toBe("M3-PHRV");
    });

    it("compiles with empty state (no crash)", () => {
      const report = compileMethod(M3_PHRV, [emptyState]);
      expect(["compiled", "failed", "needs_review"]).toContain(report.overall);
      expect(report.gates).toHaveLength(6);
    });

    it("compiles with both test states", () => {
      const report = compileMethod(M3_PHRV, [emptyState, fullState]);
      expect(report.gates).toHaveLength(6);
      expect(report.methodId).toBe("M3-PHRV");
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// M4_DDAG — Drift Audit Method
// ════════════════════════════════════════════════════════════════════════════

describe("M4_DDAG", () => {
  // ── Structural ──

  it("has correct id", () => {
    expect(M4_DDAG.id).toBe("M4-DDAG");
  });

  it("has correct name", () => {
    expect(M4_DDAG.name).toBe("Drift Audit Method");
  });

  it("has 4 steps", () => {
    expect(M4_DDAG.dag.steps).toHaveLength(4);
  });

  it("has 1 role (drift_auditor)", () => {
    expect(M4_DDAG.roles).toHaveLength(1);
    expect(M4_DDAG.roles[0].id).toBe("drift_auditor");
  });

  // ── Domain theory ──

  describe("D_DDAG", () => {
    const domain = M4_DDAG.domain;

    it("has id D_DDAG", () => {
      expect(domain.id).toBe("D_DDAG");
    });

    it("has 8 sorts", () => {
      expect(domain.signature.sorts).toHaveLength(8);
    });

    it("has 4 predicates", () => {
      expect(Object.keys(domain.signature.predicates)).toHaveLength(4);
    });

    it("signature is valid", () => {
      assertSignatureValid(domain);
    });
  });

  // ── DAG ──

  it("DAG has 3 edges (linear chain)", () => {
    expect(M4_DDAG.dag.edges).toHaveLength(3);
  });

  it("has initial step sigma_0 and terminal step sigma_3", () => {
    expect(M4_DDAG.dag.initial).toBe("sigma_0");
    expect(M4_DDAG.dag.terminal).toBe("sigma_3");
  });

  it("DAG is acyclic", () => {
    assertDAGAcyclic(M4_DDAG);
  });

  it("topologicalOrder returns 4 steps in sigma_0..sigma_3 order", () => {
    const order = topologicalOrder(M4_DDAG.dag);
    expect(order).toHaveLength(4);
    expect(order.map((s) => s.id)).toEqual([
      "sigma_0", "sigma_1", "sigma_2", "sigma_3",
    ]);
  });

  // ── Objective ──

  it("objective is a check predicate", () => {
    expect(M4_DDAG.objective.tag).toBe("check");
  });

  // ── Measures ──

  it("has 2 measures", () => {
    expect(M4_DDAG.measures).toHaveLength(2);
    const ids = M4_DDAG.measures.map((m) => m.id);
    expect(ids).toContain("mu_phase_coverage");
    expect(ids).toContain("mu_remediation_coverage");
  });

  // ── Compilation ──

  describe("compileMethod", () => {
    const emptyState = {
      auditWindowSize: 0,
      phases: [] as readonly string[],
      architectureBaseline: [] as readonly string[],
      divergences: [] as readonly { readonly phaseSource: string; readonly location: string; readonly description: string }[],
      phasesExamined: 0,
      driftVectors: [] as readonly { readonly name: string; readonly severity: "STRUCTURAL" | "MODERATE" | "COSMETIC" }[],
      reportComplete: false,
    };

    const fullState = {
      auditWindowSize: 3,
      phases: ["phase-1", "phase-2", "phase-3"] as readonly string[],
      architectureBaseline: ["docs/arch/api.md", "docs/arch/db.md"] as readonly string[],
      divergences: [
        { phaseSource: "phase-2", location: "src/handler.ts:45", description: "Direct DB access bypassing repository" },
      ] as readonly { readonly phaseSource: string; readonly location: string; readonly description: string }[],
      phasesExamined: 3,
      driftVectors: [
        { name: "repository-bypass", severity: "MODERATE" as const },
      ] as readonly { readonly name: string; readonly severity: "STRUCTURAL" | "MODERATE" | "COSMETIC" }[],
      reportComplete: true,
    };

    it("compiles with full state", () => {
      const report = assertCompiles(M4_DDAG, [fullState]);
      expect(report.methodId).toBe("M4-DDAG");
    });

    it("compiles with empty state (no crash)", () => {
      const report = compileMethod(M4_DDAG, [emptyState]);
      expect(["compiled", "failed", "needs_review"]).toContain(report.overall);
      expect(report.gates).toHaveLength(6);
    });

    it("compiles with both test states", () => {
      const report = compileMethod(M4_DDAG, [emptyState, fullState]);
      expect(report.gates).toHaveLength(6);
      expect(report.methodId).toBe("M4-DDAG");
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// M5_PLAN — Phase Planning Method
// ════════════════════════════════════════════════════════════════════════════

describe("M5_PLAN", () => {
  // ── Structural ──

  it("has correct id", () => {
    expect(M5_PLAN.id).toBe("M5-PLAN");
  });

  it("has correct name", () => {
    expect(M5_PLAN.name).toBe("Phase Planning Method");
  });

  it("has 5 steps", () => {
    expect(M5_PLAN.dag.steps).toHaveLength(5);
  });

  it("has 1 role (planner)", () => {
    expect(M5_PLAN.roles).toHaveLength(1);
    expect(M5_PLAN.roles[0].id).toBe("planner");
  });

  // ── Domain theory ──

  describe("D_PLAN", () => {
    const domain = M5_PLAN.domain;

    it("has id D_PLAN", () => {
      expect(domain.id).toBe("D_PLAN");
    });

    it("has 5 sorts", () => {
      expect(domain.signature.sorts).toHaveLength(5);
    });

    it("has 5 predicates", () => {
      expect(Object.keys(domain.signature.predicates)).toHaveLength(5);
    });

    it("signature is valid", () => {
      assertSignatureValid(domain);
    });
  });

  // ── DAG ──

  it("DAG has 4 edges (linear chain)", () => {
    expect(M5_PLAN.dag.edges).toHaveLength(4);
  });

  it("has initial step sigma_0 and terminal step sigma_4", () => {
    expect(M5_PLAN.dag.initial).toBe("sigma_0");
    expect(M5_PLAN.dag.terminal).toBe("sigma_4");
  });

  it("DAG is acyclic", () => {
    assertDAGAcyclic(M5_PLAN);
  });

  it("topologicalOrder returns 5 steps in sigma_0..sigma_4 order", () => {
    const order = topologicalOrder(M5_PLAN.dag);
    expect(order).toHaveLength(5);
    expect(order.map((s) => s.id)).toEqual([
      "sigma_0", "sigma_1", "sigma_2", "sigma_3", "sigma_4",
    ]);
  });

  // ── Objective ──

  it("objective is a check predicate", () => {
    expect(M5_PLAN.objective.tag).toBe("check");
  });

  // ── Measures ──

  it("has 1 measure", () => {
    expect(M5_PLAN.measures).toHaveLength(1);
    expect(M5_PLAN.measures[0].id).toBe("mu_plan_progress");
  });

  // ── Compilation ──

  describe("compileMethod", () => {
    const emptyState = {
      prdSectionRef: "",
      archDocsInScope: [] as readonly string[],
      hasCarryover: false,
      inputsValidated: false,
      tasksExtracted: 0,
      rawTaskList: [] as readonly { readonly description: string; readonly acceptanceCriteria: readonly string[] }[],
      carryoverTasksMerged: 0,
      mergedTaskList: [] as readonly string[],
      allTasksScoped: false,
      allTasksRated: false,
      phaseDocComplete: false,
      coverageVerified: false,
    };

    const fullState = {
      prdSectionRef: "PRD-001/section-1",
      archDocsInScope: ["docs/arch/api.md"] as readonly string[],
      hasCarryover: true,
      inputsValidated: true,
      tasksExtracted: 5,
      rawTaskList: [
        { description: "Implement endpoint", acceptanceCriteria: ["returns 200"] as readonly string[] },
      ] as readonly { readonly description: string; readonly acceptanceCriteria: readonly string[] }[],
      carryoverTasksMerged: 1,
      mergedTaskList: ["task-1", "task-2", "task-3", "task-4", "task-5", "carry-1"] as readonly string[],
      allTasksScoped: true,
      allTasksRated: true,
      phaseDocComplete: true,
      coverageVerified: true,
    };

    it("compiles with full state", () => {
      const report = assertCompiles(M5_PLAN, [fullState]);
      expect(report.methodId).toBe("M5-PLAN");
    });

    it("compiles with empty state (no crash)", () => {
      const report = compileMethod(M5_PLAN, [emptyState]);
      expect(["compiled", "failed", "needs_review"]).toContain(report.overall);
      expect(report.gates).toHaveLength(6);
    });

    it("compiles with both test states", () => {
      const report = compileMethod(M5_PLAN, [emptyState, fullState]);
      expect(report.gates).toHaveLength(6);
      expect(report.methodId).toBe("M5-PLAN");
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// M6_ARFN — Architecture Refinement Method
// ════════════════════════════════════════════════════════════════════════════

describe("M6_ARFN", () => {
  // ── Structural ──

  it("has correct id", () => {
    expect(M6_ARFN.id).toBe("M6-ARFN");
  });

  it("has correct name", () => {
    expect(M6_ARFN.name).toBe("Architecture Refinement Method");
  });

  it("has 4 steps", () => {
    expect(M6_ARFN.dag.steps).toHaveLength(4);
  });

  it("has 1 role (architect)", () => {
    expect(M6_ARFN.roles).toHaveLength(1);
    expect(M6_ARFN.roles[0].id).toBe("architect");
  });

  // ── Domain theory ──

  describe("D_ARFN", () => {
    const domain = M6_ARFN.domain;

    it("has id D_ARFN", () => {
      expect(domain.id).toBe("D_ARFN");
    });

    it("has 8 sorts", () => {
      expect(domain.signature.sorts).toHaveLength(8);
    });

    it("has 4 predicates", () => {
      expect(Object.keys(domain.signature.predicates)).toHaveLength(4);
    });

    it("signature is valid", () => {
      assertSignatureValid(domain);
    });
  });

  // ── DAG ──

  it("DAG has 3 edges (linear chain)", () => {
    expect(M6_ARFN.dag.edges).toHaveLength(3);
  });

  it("has initial step sigma_0 and terminal step sigma_3", () => {
    expect(M6_ARFN.dag.initial).toBe("sigma_0");
    expect(M6_ARFN.dag.terminal).toBe("sigma_3");
  });

  it("DAG is acyclic", () => {
    assertDAGAcyclic(M6_ARFN);
  });

  it("topologicalOrder returns 4 steps in sigma_0..sigma_3 order", () => {
    const order = topologicalOrder(M6_ARFN.dag);
    expect(order).toHaveLength(4);
    expect(order.map((s) => s.id)).toEqual([
      "sigma_0", "sigma_1", "sigma_2", "sigma_3",
    ]);
  });

  // ── Objective ──

  it("objective is a check predicate", () => {
    expect(M6_ARFN.objective.tag).toBe("check");
  });

  // ── Measures ──

  it("has 2 measures", () => {
    expect(M6_ARFN.measures).toHaveLength(2);
    const ids = M6_ARFN.measures.map((m) => m.id);
    expect(ids).toContain("mu_resolution");
    expect(ids).toContain("mu_consistency");
  });

  // ── Compilation ──

  describe("compileMethod", () => {
    const emptyState = {
      impacts: [] as readonly { readonly requirementRef: string; readonly componentAffected: string; readonly nature: string }[],
      existingArchitectureSummary: "",
      decisions: [] as readonly { readonly impactRef: string; readonly chosenOption: string; readonly rationale: string }[],
      specFiles: [] as readonly { readonly path: string; readonly action: "created" | "updated"; readonly topic: string }[],
      readmeUpdated: false,
      consistencyResult: null,
      coverageVerified: false,
    };

    const fullState = {
      impacts: [
        { requirementRef: "PRD-001-R1", componentAffected: "AuthModule", nature: "new_dependency" },
      ] as readonly { readonly requirementRef: string; readonly componentAffected: string; readonly nature: string }[],
      existingArchitectureSummary: "Monolith with 3 modules: Auth, Payments, Notifications",
      decisions: [
        { impactRef: "PRD-001-R1", chosenOption: "adapter pattern", rationale: "maintains module boundaries" },
      ] as readonly { readonly impactRef: string; readonly chosenOption: string; readonly rationale: string }[],
      specFiles: [
        { path: "docs/arch/auth-adapter.md", action: "created" as const, topic: "Auth adapter pattern" },
      ] as readonly { readonly path: string; readonly action: "created" | "updated"; readonly topic: string }[],
      readmeUpdated: true,
      consistencyResult: "PASS" as const,
      coverageVerified: true,
    };

    it("compiles with full state", () => {
      const report = assertCompiles(M6_ARFN, [fullState]);
      expect(report.methodId).toBe("M6-ARFN");
    });

    it("compiles with empty state (no crash)", () => {
      const report = compileMethod(M6_ARFN, [emptyState]);
      expect(["compiled", "failed", "needs_review"]).toContain(report.overall);
      expect(report.gates).toHaveLength(6);
    });

    it("compiles with both test states", () => {
      const report = compileMethod(M6_ARFN, [emptyState, fullState]);
      expect(report.gates).toHaveLength(6);
      expect(report.methodId).toBe("M6-ARFN");
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// M7_PRDS — PRD Sectioning Method
// ════════════════════════════════════════════════════════════════════════════

describe("M7_PRDS", () => {
  // ── Structural ──

  it("has correct id", () => {
    expect(M7_PRDS.id).toBe("M7-PRDS");
  });

  it("has correct name", () => {
    expect(M7_PRDS.name).toBe("PRD Sectioning Method");
  });

  it("has 3 steps", () => {
    expect(M7_PRDS.dag.steps).toHaveLength(3);
  });

  it("has 1 role (sectioner)", () => {
    expect(M7_PRDS.roles).toHaveLength(1);
    expect(M7_PRDS.roles[0].id).toBe("sectioner");
  });

  // ── Domain theory ──

  describe("D_PRDS", () => {
    const domain = M7_PRDS.domain;

    it("has id D_PRDS", () => {
      expect(domain.id).toBe("D_PRDS");
    });

    it("has 6 sorts", () => {
      expect(domain.signature.sorts).toHaveLength(6);
    });

    it("has 3 predicates", () => {
      expect(Object.keys(domain.signature.predicates)).toHaveLength(3);
    });

    it("signature is valid", () => {
      assertSignatureValid(domain);
    });
  });

  // ── DAG ──

  it("DAG has 2 edges (linear chain)", () => {
    expect(M7_PRDS.dag.edges).toHaveLength(2);
  });

  it("has initial step sigma_0 and terminal step sigma_2", () => {
    expect(M7_PRDS.dag.initial).toBe("sigma_0");
    expect(M7_PRDS.dag.terminal).toBe("sigma_2");
  });

  it("DAG is acyclic", () => {
    assertDAGAcyclic(M7_PRDS);
  });

  it("topologicalOrder returns 3 steps in sigma_0..sigma_2 order", () => {
    const order = topologicalOrder(M7_PRDS.dag);
    expect(order).toHaveLength(3);
    expect(order.map((s) => s.id)).toEqual([
      "sigma_0", "sigma_1", "sigma_2",
    ]);
  });

  // ── Objective ──

  it("objective is a check predicate", () => {
    expect(M7_PRDS.objective.tag).toBe("check");
  });

  // ── Measures ──

  it("has 3 measures", () => {
    expect(M7_PRDS.measures).toHaveLength(3);
    const ids = M7_PRDS.measures.map((m) => m.id);
    expect(ids).toContain("mu_coverage");
    expect(ids).toContain("mu_scoping");
    expect(ids).toContain("mu_dag_validity");
  });

  // ── Compilation ──

  describe("compileMethod", () => {
    const emptyState = {
      featureClusters: [] as readonly { readonly name: string; readonly requirements: readonly string[] }[],
      architectureContext: [] as readonly string[],
      sections: [] as readonly { readonly id: string; readonly name: string; readonly scopeBoundary: string; readonly acceptanceCriteria: readonly string[] }[],
      coverageVerified: false,
      dependencies: [] as readonly { readonly from: string; readonly to: string; readonly reason: string }[],
      deliveryOrder: [] as readonly string[],
      sectionMapComplete: false,
    };

    const fullState = {
      featureClusters: [
        { name: "Authentication", requirements: ["R1", "R2"] as readonly string[] },
        { name: "Payments", requirements: ["R3", "R4"] as readonly string[] },
      ] as readonly { readonly name: string; readonly requirements: readonly string[] }[],
      architectureContext: ["docs/arch/api.md"] as readonly string[],
      sections: [
        { id: "S1", name: "Auth Section", scopeBoundary: "Auth module only", acceptanceCriteria: ["AC-1", "AC-2"] as readonly string[] },
        { id: "S2", name: "Payments Section", scopeBoundary: "Payments module only", acceptanceCriteria: ["AC-3", "AC-4"] as readonly string[] },
      ] as readonly { readonly id: string; readonly name: string; readonly scopeBoundary: string; readonly acceptanceCriteria: readonly string[] }[],
      coverageVerified: true,
      dependencies: [
        { from: "S1", to: "S2", reason: "Payments requires auth tokens" },
      ] as readonly { readonly from: string; readonly to: string; readonly reason: string }[],
      deliveryOrder: ["S1", "S2"] as readonly string[],
      sectionMapComplete: true,
    };

    it("compiles with full state", () => {
      const report = assertCompiles(M7_PRDS, [fullState]);
      expect(report.methodId).toBe("M7-PRDS");
    });

    it("compiles with empty state (no crash)", () => {
      const report = compileMethod(M7_PRDS, [emptyState]);
      expect(["compiled", "failed", "needs_review"]).toContain(report.overall);
      expect(report.gates).toHaveLength(6);
    });

    it("compiles with both test states", () => {
      const report = compileMethod(M7_PRDS, [emptyState, fullState]);
      expect(report.gates).toHaveLength(6);
      expect(report.methodId).toBe("M7-PRDS");
    });
  });
});
