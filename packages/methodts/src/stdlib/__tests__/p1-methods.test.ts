/**
 * Tests for P1-EXEC methods — M1_COUNCIL, M2_ORCH, M3_TMP, M4_ADVREV.
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
import { M1_COUNCIL, type CouncilState } from "../methods/p1/m1-council.js";
import { M2_ORCH, type OrchState } from "../methods/p1/m2-orch.js";
import { M3_TMP, type TmpState } from "../methods/p1/m3-tmp.js";
import { M4_ADVREV, type AdvrevState } from "../methods/p1/m4-advrev.js";

// ════════════════════════════════════════════════════════════════════════════
// M1_COUNCIL — Synthetic Agents Method
// ════════════════════════════════════════════════════════════════════════════

describe("M1_COUNCIL", () => {
  // ── Structural ──

  it("has correct id", () => {
    expect(M1_COUNCIL.id).toBe("M1-COUNCIL");
  });

  it("has correct name", () => {
    expect(M1_COUNCIL.name).toBe("Synthetic Agents Method");
  });

  it("has 4 steps", () => {
    expect(M1_COUNCIL.dag.steps).toHaveLength(4);
  });

  it("has 3 roles (leader, contrarian, product_owner)", () => {
    expect(M1_COUNCIL.roles).toHaveLength(3);
    const roleIds = M1_COUNCIL.roles.map((r) => r.id);
    expect(roleIds).toContain("rho_leader");
    expect(roleIds).toContain("rho_contrarian");
    expect(roleIds).toContain("rho_product_owner");
  });

  // ── Domain theory ──

  describe("D_COUNCIL", () => {
    const domain = M1_COUNCIL.domain;

    it("has id D_COUNCIL", () => {
      expect(domain.id).toBe("D_COUNCIL");
    });

    it("has 10 sorts", () => {
      expect(domain.signature.sorts).toHaveLength(10);
    });

    it("has 6 predicates", () => {
      expect(Object.keys(domain.signature.predicates)).toHaveLength(6);
    });

    it("signature is valid", () => {
      assertSignatureValid(domain);
    });
  });

  // ── DAG ──

  it("DAG has 3 edges (linear chain)", () => {
    expect(M1_COUNCIL.dag.edges).toHaveLength(3);
  });

  it("has initial step sigma_0 and terminal step sigma_3", () => {
    expect(M1_COUNCIL.dag.initial).toBe("sigma_0");
    expect(M1_COUNCIL.dag.terminal).toBe("sigma_3");
  });

  it("DAG is acyclic", () => {
    assertDAGAcyclic(M1_COUNCIL);
  });

  it("topologicalOrder returns 4 steps in sigma_0..sigma_3 order", () => {
    const order = topologicalOrder(M1_COUNCIL.dag);
    expect(order).toHaveLength(4);
    expect(order.map((s) => s.id)).toEqual([
      "sigma_0",
      "sigma_1",
      "sigma_2",
      "sigma_3",
    ]);
  });

  // ── Objective ──

  it("objective is a check predicate", () => {
    expect(M1_COUNCIL.objective.tag).toBe("check");
  });

  // ── Measures ──

  it("has 3 measures", () => {
    expect(M1_COUNCIL.measures).toHaveLength(3);
    const ids = M1_COUNCIL.measures.map((m) => m.id);
    expect(ids).toContain("mu_question_resolution");
    expect(ids).toContain("mu_adversarial_integrity");
    expect(ids).toContain("mu_escalation_precision");
  });

  // ── Compilation ──

  describe("compileMethod", () => {
    const emptyState: CouncilState = {
      challengeStatement: "",
      scopeConfirmed: false,
      castApproved: false,
      contrariansCount: 0,
      questionsDecided: 0,
      totalQuestions: 0,
      positionsUpdated: 0,
      allQuestionsResolved: false,
      artifactProduced: false,
    };

    const fullState: CouncilState = {
      challengeStatement: "Should we adopt microservices?",
      scopeConfirmed: true,
      castApproved: true,
      contrariansCount: 3,
      questionsDecided: 5,
      totalQuestions: 5,
      positionsUpdated: 3,
      allQuestionsResolved: true,
      artifactProduced: true,
    };

    it("compiles with full state", () => {
      const report = assertCompiles(M1_COUNCIL, [fullState]);
      expect(report.methodId).toBe("M1-COUNCIL");
    });

    it("compiles with empty state (no crash)", () => {
      const report = compileMethod(M1_COUNCIL, [emptyState]);
      expect(["compiled", "failed", "needs_review"]).toContain(report.overall);
      expect(report.gates).toHaveLength(6);
    });

    it("compiles with both test states", () => {
      const report = compileMethod(M1_COUNCIL, [emptyState, fullState]);
      expect(report.gates).toHaveLength(6);
      expect(report.methodId).toBe("M1-COUNCIL");
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// M2_ORCH — Orchestrator Execution Method
// ════════════════════════════════════════════════════════════════════════════

describe("M2_ORCH", () => {
  // ── Structural ──

  it("has correct id", () => {
    expect(M2_ORCH.id).toBe("M2-ORCH");
  });

  it("has correct name", () => {
    expect(M2_ORCH.name).toBe("Orchestrator Execution Method");
  });

  it("has 5 steps", () => {
    expect(M2_ORCH.dag.steps).toHaveLength(5);
  });

  it("has 2 roles (orchestrator, sub_agent)", () => {
    expect(M2_ORCH.roles).toHaveLength(2);
    const roleIds = M2_ORCH.roles.map((r) => r.id);
    expect(roleIds).toContain("orchestrator");
    expect(roleIds).toContain("sub_agent");
  });

  // ── Domain theory ──

  describe("D_ORCH", () => {
    const domain = M2_ORCH.domain;

    it("has id D_ORCH", () => {
      expect(domain.id).toBe("D_ORCH");
    });

    it("has 7 sorts", () => {
      expect(domain.signature.sorts).toHaveLength(7);
    });

    it("has 6 predicates", () => {
      expect(Object.keys(domain.signature.predicates)).toHaveLength(6);
    });

    it("signature is valid", () => {
      assertSignatureValid(domain);
    });
  });

  // ── DAG ──

  it("DAG has 4 edges (linear chain)", () => {
    expect(M2_ORCH.dag.edges).toHaveLength(4);
  });

  it("has initial step sigma_0 and terminal step sigma_4", () => {
    expect(M2_ORCH.dag.initial).toBe("sigma_0");
    expect(M2_ORCH.dag.terminal).toBe("sigma_4");
  });

  it("DAG is acyclic", () => {
    assertDAGAcyclic(M2_ORCH);
  });

  it("topologicalOrder returns 5 steps in sigma_0..sigma_4 order", () => {
    const order = topologicalOrder(M2_ORCH.dag);
    expect(order).toHaveLength(5);
    expect(order.map((s) => s.id)).toEqual([
      "sigma_0",
      "sigma_1",
      "sigma_2",
      "sigma_3",
      "sigma_4",
    ]);
  });

  // ── Objective ──

  it("objective is a check predicate", () => {
    expect(M2_ORCH.objective.tag).toBe("check");
  });

  // ── Measures ──

  it("has 2 measures", () => {
    expect(M2_ORCH.measures).toHaveLength(2);
    const ids = M2_ORCH.measures.map((m) => m.id);
    expect(ids).toContain("mu_task_coverage");
    expect(ids).toContain("mu_integration_coherence");
  });

  // ── Compilation ──

  describe("compileMethod", () => {
    const emptyState: OrchState = {
      challengeSummary: "",
      parallelDecomposable: null,
      subTaskCount: 0,
      subTasksCompleted: 0,
      allResultsReceived: false,
      integrationProduced: false,
      verificationOutcome: null,
    };

    const fullState: OrchState = {
      challengeSummary: "Implement auth, payments, and notifications",
      parallelDecomposable: true,
      subTaskCount: 3,
      subTasksCompleted: 3,
      allResultsReceived: true,
      integrationProduced: true,
      verificationOutcome: "PASS",
    };

    it("compiles with full state", () => {
      const report = assertCompiles(M2_ORCH, [fullState]);
      expect(report.methodId).toBe("M2-ORCH");
    });

    it("compiles with empty state (no crash)", () => {
      const report = compileMethod(M2_ORCH, [emptyState]);
      expect(["compiled", "failed", "needs_review"]).toContain(report.overall);
      expect(report.gates).toHaveLength(6);
    });

    it("compiles with both test states", () => {
      const report = compileMethod(M2_ORCH, [emptyState, fullState]);
      expect(report.gates).toHaveLength(6);
      expect(report.methodId).toBe("M2-ORCH");
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// M3_TMP — Traditional Meta-Prompting Method
// ════════════════════════════════════════════════════════════════════════════

describe("M3_TMP", () => {
  // ── Structural ──

  it("has correct id", () => {
    expect(M3_TMP.id).toBe("M3-TMP");
  });

  it("has correct name", () => {
    expect(M3_TMP.name).toBe("Traditional Meta-Prompting Method");
  });

  it("has 3 steps", () => {
    expect(M3_TMP.dag.steps).toHaveLength(3);
  });

  it("has 1 role (analyst)", () => {
    expect(M3_TMP.roles).toHaveLength(1);
    expect(M3_TMP.roles[0].id).toBe("analyst");
  });

  // ── Domain theory ──

  describe("D_TMP", () => {
    const domain = M3_TMP.domain;

    it("has id D_TMP", () => {
      expect(domain.id).toBe("D_TMP");
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

  it("DAG has 2 edges (linear chain)", () => {
    expect(M3_TMP.dag.edges).toHaveLength(2);
  });

  it("has initial step sigma_0 and terminal step sigma_2", () => {
    expect(M3_TMP.dag.initial).toBe("sigma_0");
    expect(M3_TMP.dag.terminal).toBe("sigma_2");
  });

  it("DAG is acyclic", () => {
    assertDAGAcyclic(M3_TMP);
  });

  it("topologicalOrder returns 3 steps in sigma_0..sigma_2 order", () => {
    const order = topologicalOrder(M3_TMP.dag);
    expect(order).toHaveLength(3);
    expect(order.map((s) => s.id)).toEqual([
      "sigma_0",
      "sigma_1",
      "sigma_2",
    ]);
  });

  // ── Objective ──

  it("objective is a check predicate", () => {
    expect(M3_TMP.objective.tag).toBe("check");
  });

  // ── Measures ──

  it("has 2 measures", () => {
    expect(M3_TMP.measures).toHaveLength(2);
    const ids = M3_TMP.measures.map((m) => m.id);
    expect(ids).toContain("mu_sub_question_coverage");
    expect(ids).toContain("mu_internal_consistency");
  });

  // ── Compilation ──

  describe("compileMethod", () => {
    const emptyState: TmpState = {
      challenge: "",
      subQuestions: [],
      answersCount: 0,
      responseComplete: false,
      responseConsistent: false,
      finalResponse: "",
    };

    const fullState: TmpState = {
      challenge: "How should we structure the API?",
      subQuestions: ["endpoints", "auth", "versioning"],
      answersCount: 3,
      responseComplete: true,
      responseConsistent: true,
      finalResponse: "Use REST with JWT auth and URL versioning.",
    };

    it("compiles with full state", () => {
      const report = assertCompiles(M3_TMP, [fullState]);
      expect(report.methodId).toBe("M3-TMP");
    });

    it("compiles with empty state (no crash)", () => {
      const report = compileMethod(M3_TMP, [emptyState]);
      expect(["compiled", "failed", "needs_review"]).toContain(report.overall);
      expect(report.gates).toHaveLength(6);
    });

    it("compiles with both test states", () => {
      const report = compileMethod(M3_TMP, [emptyState, fullState]);
      expect(report.gates).toHaveLength(6);
      expect(report.methodId).toBe("M3-TMP");
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// M4_ADVREV — Adversarial Review Pipeline Method
// ════════════════════════════════════════════════════════════════════════════

describe("M4_ADVREV", () => {
  // ── Structural ──

  it("has correct id", () => {
    expect(M4_ADVREV.id).toBe("M4-ADVREV");
  });

  it("has correct name", () => {
    expect(M4_ADVREV.name).toBe("Adversarial Review Pipeline Method");
  });

  it("has 7 steps", () => {
    expect(M4_ADVREV.dag.steps).toHaveLength(7);
  });

  it("has 2 roles (orchestrator, PO)", () => {
    expect(M4_ADVREV.roles).toHaveLength(2);
    const roleIds = M4_ADVREV.roles.map((r) => r.id);
    expect(roleIds).toContain("rho_orchestrator");
    expect(roleIds).toContain("rho_PO");
  });

  // ── Domain theory ──

  describe("D_ADVREV", () => {
    const domain = M4_ADVREV.domain;

    it("has id D_ADVREV", () => {
      expect(domain.id).toBe("D_ADVREV");
    });

    it("has 12 sorts", () => {
      expect(domain.signature.sorts).toHaveLength(12);
    });

    it("has 10 predicates", () => {
      expect(Object.keys(domain.signature.predicates)).toHaveLength(10);
    });

    it("signature is valid", () => {
      assertSignatureValid(domain);
    });
  });

  // ── DAG ──

  it("DAG has 6 edges (linear chain)", () => {
    expect(M4_ADVREV.dag.edges).toHaveLength(6);
  });

  it("has initial step sigma_0 and terminal step sigma_6", () => {
    expect(M4_ADVREV.dag.initial).toBe("sigma_0");
    expect(M4_ADVREV.dag.terminal).toBe("sigma_6");
  });

  it("DAG is acyclic", () => {
    assertDAGAcyclic(M4_ADVREV);
  });

  it("topologicalOrder returns 7 steps in sigma_0..sigma_6 order", () => {
    const order = topologicalOrder(M4_ADVREV.dag);
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

  // ── Objective ──

  it("objective is a check predicate", () => {
    expect(M4_ADVREV.objective.tag).toBe("check");
  });

  // ── Measures ──

  it("has 3 measures", () => {
    expect(M4_ADVREV.measures).toHaveLength(3);
    const ids = M4_ADVREV.measures.map((m) => m.id);
    expect(ids).toContain("mu_pipeline_progress");
    expect(ids).toContain("mu_finding_quality");
    expect(ids).toContain("mu_consensus_rate");
  });

  // ── Compilation ──

  describe("compileMethod", () => {
    const emptyState: AdvrevState = {
      artifactPath: "",
      artifactType: "",
      riskSurface: [],
      mandatoryDimensions: [],
      allMandatoryCovered: false,
      advisorCount: 0,
      advisorsDispatched: false,
      advisorsCollected: false,
      reviewReportComplete: false,
      synthesizerCount: 0,
      synthesizersDispatched: false,
      synthesizersCollected: false,
      actionPlanComplete: false,
      totalFindings: 0,
      findingsWithCitations: 0,
      criticalHighWithMitigations: 0,
      criticalHighTotal: 0,
      consensusReached: 0,
      nonMergedFindings: 0,
      iterationCount: 0,
      isDelegated: false,
    };

    const fullState: AdvrevState = {
      artifactPath: "packages/bridge/src/server.ts",
      artifactType: "source_code",
      riskSurface: ["security", "performance", "maintainability"],
      mandatoryDimensions: ["security"],
      allMandatoryCovered: true,
      advisorCount: 3,
      advisorsDispatched: true,
      advisorsCollected: true,
      reviewReportComplete: true,
      synthesizerCount: 3,
      synthesizersDispatched: true,
      synthesizersCollected: true,
      actionPlanComplete: true,
      totalFindings: 10,
      findingsWithCitations: 10,
      criticalHighWithMitigations: 2,
      criticalHighTotal: 2,
      consensusReached: 8,
      nonMergedFindings: 8,
      iterationCount: 1,
      isDelegated: true,
    };

    it("compiles with full state", () => {
      const report = assertCompiles(M4_ADVREV, [fullState]);
      expect(report.methodId).toBe("M4-ADVREV");
    });

    it("compiles with empty state (no crash)", () => {
      const report = compileMethod(M4_ADVREV, [emptyState]);
      expect(["compiled", "failed", "needs_review"]).toContain(report.overall);
      expect(report.gates).toHaveLength(6);
    });

    it("compiles with both test states", () => {
      const report = compileMethod(M4_ADVREV, [emptyState, fullState]);
      expect(report.gates).toHaveLength(6);
      expect(report.methodId).toBe("M4-ADVREV");
    });
  });
});
