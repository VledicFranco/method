// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for P_GH methodology — GitHub Operations Methodology.
 *
 * Validates:
 * - P_GH structural properties (id, name, arm count, priorities, safety bounds)
 * - Domain theory D_GH (sorts, function symbols, predicates, axioms)
 * - Transition routing via evaluateTransition for each arm
 * - Termination certificate measure decrease through lifecycle
 * - Method structural tests (M1-TRIAGE, M2-REVIEW, M3-RESOLVE, M4-WORK)
 */

import { describe, it, expect } from "vitest";
import {
  assertRoutesTo,
  assertCoherent,
  assertCompiles,
  assertHolds,
  assertSignatureValid,
  assertRolesCovered,
  assertTerminates,
  assertRoutingTotal,
  assertAxiomsSatisfied,
  evaluateTransition,
} from "../../testkit/index.js";
import {
  P_GH,
  D_GH,
  GH_ARMS,
  arm_conflict,
  arm_review,
  arm_triage,
  arm_work,
  arm_terminate,
  arm_executing,
  type GHState,
} from "../methodologies/p-gh.js";
import { M1_TRIAGE } from "../methods/pgh/m1-triage.js";
import { M2_REVIEW_GH } from "../methods/pgh/m2-review.js";
import { M3_RESOLVE } from "../methods/pgh/m3-resolve.js";
import { M4_WORK } from "../methods/pgh/m4-work.js";

// ── Test states ──

/** Conflict challenge — should route to M3-RESOLVE (arm 1). */
const stateConflict: GHState = {
  challengeType: "conflict",
  challengeAction: null,
  selectedMethod: null,
  result: null,
  completed: false,
};

/** PR review challenge — should route to M2-REVIEW (arm 2). */
const statePullRequest: GHState = {
  challengeType: "pull_request",
  challengeAction: null,
  selectedMethod: null,
  result: null,
  completed: false,
};

/** Issue triage challenge — should route to M1-TRIAGE (arm 3). */
const stateIssueTriage: GHState = {
  challengeType: "issue",
  challengeAction: "triage",
  selectedMethod: null,
  result: null,
  completed: false,
};

/** Issue work challenge — should route to M4-WORK (arm 4). */
const stateIssueWork: GHState = {
  challengeType: "issue",
  challengeAction: "work",
  selectedMethod: null,
  result: null,
  completed: false,
};

/** Completed state — should terminate (arm 5). */
const stateCompleted: GHState = {
  challengeType: "issue",
  challengeAction: "work",
  selectedMethod: "M4-WORK",
  result: "Issue resolved, PR merged",
  completed: true,
};

/** Executing state — method running, no re-evaluation (arm 6). */
const stateExecuting: GHState = {
  challengeType: "conflict",
  challengeAction: null,
  selectedMethod: "M3-RESOLVE",
  result: null,
  completed: false,
};

/** All test states for coherence/totality checks. */
const allStates: GHState[] = [
  stateConflict,
  statePullRequest,
  stateIssueTriage,
  stateIssueWork,
  stateCompleted,
  stateExecuting,
];

// ── P_GH structural tests ──

describe("P_GH", () => {
  it("has correct id", () => {
    expect(P_GH.id).toBe("P-GH");
  });

  it("has correct name", () => {
    expect(P_GH.name).toBe("GitHub Operations Methodology");
  });

  it("has 6 arms matching the transition function", () => {
    expect(P_GH.arms).toHaveLength(6);
  });

  it("has arms with correct priority ordering (1-6)", () => {
    const priorities = P_GH.arms.map((a) => a.priority);
    expect(priorities).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("has correct arm labels in priority order", () => {
    const labels = P_GH.arms.map((a) => a.label);
    expect(labels).toEqual([
      "conflict",
      "review",
      "triage",
      "work",
      "terminate",
      "executing",
    ]);
  });

  it("has a domain with id D_Phi_GH", () => {
    expect(P_GH.domain.id).toBe("D_Phi_GH");
  });

  it("has safety bounds configured", () => {
    expect(P_GH.safety.maxLoops).toBe(20);
    expect(P_GH.safety.maxTokens).toBe(1_000_000);
    expect(P_GH.safety.maxCostUsd).toBe(50);
    expect(P_GH.safety.maxDurationMs).toBe(3_600_000);
    expect(P_GH.safety.maxDepth).toBe(3);
  });

  it("routing arms select actual methods, terminal arms select null", () => {
    expect(P_GH.arms[0].selects).not.toBeNull(); // M3-RESOLVE
    expect(P_GH.arms[1].selects).not.toBeNull(); // M2-REVIEW
    expect(P_GH.arms[2].selects).not.toBeNull(); // M1-TRIAGE
    expect(P_GH.arms[3].selects).not.toBeNull(); // M4-WORK
    expect(P_GH.arms[4].selects).toBeNull(); // terminate
    expect(P_GH.arms[5].selects).toBeNull(); // executing
  });

  it("is coherent over all test states", () => {
    assertCoherent(P_GH, allStates);
  });

  it("routing is total over all test states", () => {
    assertRoutingTotal(P_GH, allStates);
  });
});

// ── Domain theory tests ──

describe("D_GH", () => {
  it("has 14 sorts", () => {
    expect(D_GH.signature.sorts).toHaveLength(14);
  });

  it("has 5 function symbols", () => {
    expect(D_GH.signature.functionSymbols).toHaveLength(5);
  });

  it("has 6 predicates", () => {
    expect(Object.keys(D_GH.signature.predicates)).toHaveLength(6);
  });

  it("has 4 axioms", () => {
    const axiomKeys = Object.keys(D_GH.axioms);
    expect(axiomKeys).toHaveLength(4);
    expect(axiomKeys).toContain("Ax-1_challenge_type_uniqueness");
    expect(axiomKeys).toContain("Ax-2_routing_uniqueness");
    expect(axiomKeys).toContain("Ax-4_selection_before_completion");
    expect(axiomKeys).toContain("Ax-5_single_dispatch");
  });

  it("has a valid signature", () => {
    assertSignatureValid(D_GH);
  });

  it("axioms are satisfiable over test states", () => {
    assertAxiomsSatisfied(D_GH, allStates);
  });
});

// ── Transition routing tests ──

describe("evaluateTransition(P_GH, ...)", () => {
  it("routes conflict challenge to arm 1 (conflict)", () => {
    assertRoutesTo(P_GH, stateConflict, "conflict");
  });

  it("routes pull_request challenge to arm 2 (review)", () => {
    assertRoutesTo(P_GH, statePullRequest, "review");
  });

  it("routes issue triage challenge to arm 3 (triage)", () => {
    assertRoutesTo(P_GH, stateIssueTriage, "triage");
  });

  it("routes issue work challenge to arm 4 (work)", () => {
    assertRoutesTo(P_GH, stateIssueWork, "work");
  });

  it("routes completed state to arm 5 (terminate)", () => {
    assertRoutesTo(P_GH, stateCompleted, "terminate");
  });

  it("routes executing state to arm 6 (executing)", () => {
    assertRoutesTo(P_GH, stateExecuting, "executing");
  });

  it("evaluates all 6 arms and records traces", () => {
    const result = evaluateTransition(P_GH, stateConflict);
    expect(result.armTraces).toHaveLength(6);

    const firedTraces = result.armTraces.filter((t) => t.fired);
    expect(firedTraces).toHaveLength(1);
    expect(firedTraces[0].label).toBe("conflict");
  });
});

// ── Priority tests ──

describe("P_GH priority ordering", () => {
  it("conflict has higher priority than review (arm 1 > arm 2)", () => {
    expect(arm_conflict.priority).toBeLessThan(arm_review.priority);
  });

  it("review has higher priority than triage (arm 2 > arm 3)", () => {
    expect(arm_review.priority).toBeLessThan(arm_triage.priority);
  });

  it("triage has higher priority than work (arm 3 > arm 4)", () => {
    expect(arm_triage.priority).toBeLessThan(arm_work.priority);
  });
});

// ── Termination certificate tests ──

describe("P_GH terminationCertificate", () => {
  it("measure is 1 when not completed", () => {
    expect(P_GH.terminationCertificate.measure(stateConflict)).toBe(1);
    expect(P_GH.terminationCertificate.measure(stateExecuting)).toBe(1);
  });

  it("measure is 0 when completed", () => {
    expect(P_GH.terminationCertificate.measure(stateCompleted)).toBe(0);
  });

  it("measure strictly decreases through lifecycle", () => {
    const m = P_GH.terminationCertificate.measure;
    expect(m(stateConflict)).toBeGreaterThan(m(stateCompleted));
  });

  it("terminates along the conflict -> completed trajectory", () => {
    assertTerminates(P_GH, [stateConflict, stateCompleted]);
  });
});

// ── Method structural tests ──

describe("M1_TRIAGE", () => {
  it("has correct id and name", () => {
    expect(M1_TRIAGE.id).toBe("M1-TRIAGE");
    expect(M1_TRIAGE.name).toBe("Issue Triage Method");
  });

  it("has 5 steps in a linear DAG", () => {
    expect(M1_TRIAGE.dag.steps).toHaveLength(5);
    expect(M1_TRIAGE.dag.edges).toHaveLength(4);
  });

  it("has 1 role (triager)", () => {
    expect(M1_TRIAGE.roles).toHaveLength(1);
    expect(M1_TRIAGE.roles[0].id).toBe("triager");
  });

  it("has roles covering all steps", () => {
    assertRolesCovered(M1_TRIAGE);
  });

  it("has 2 measures", () => {
    expect(M1_TRIAGE.measures).toHaveLength(2);
  });

  it("has an objective predicate", () => {
    expect(M1_TRIAGE.objective).toBeDefined();
  });
});

describe("M2_REVIEW_GH", () => {
  it("has correct id and name", () => {
    expect(M2_REVIEW_GH.id).toBe("M2-REVIEW");
    expect(M2_REVIEW_GH.name).toBe("PR Review with Self-Fix Method");
  });

  it("has 6 steps in a DAG with conditional fix branch (6 edges, no back edges)", () => {
    expect(M2_REVIEW_GH.dag.steps).toHaveLength(6);
    expect(M2_REVIEW_GH.dag.edges).toHaveLength(6);
  });

  it("has 2 roles (reviewer, fixer)", () => {
    expect(M2_REVIEW_GH.roles).toHaveLength(2);
    const roleIds = M2_REVIEW_GH.roles.map((r) => r.id);
    expect(roleIds).toContain("reviewer");
    expect(roleIds).toContain("fixer");
  });

  it("has roles covering all steps", () => {
    assertRolesCovered(M2_REVIEW_GH);
  });

  it("has 2 measures", () => {
    expect(M2_REVIEW_GH.measures).toHaveLength(2);
  });
});

describe("M3_RESOLVE", () => {
  it("has correct id and name", () => {
    expect(M3_RESOLVE.id).toBe("M3-RESOLVE");
    expect(M3_RESOLVE.name).toBe("Merge Conflict Resolution Method");
  });

  it("has 5 steps in a linear DAG", () => {
    expect(M3_RESOLVE.dag.steps).toHaveLength(5);
    expect(M3_RESOLVE.dag.edges).toHaveLength(4);
  });

  it("has 1 role (resolver)", () => {
    expect(M3_RESOLVE.roles).toHaveLength(1);
    expect(M3_RESOLVE.roles[0].id).toBe("resolver");
  });

  it("has roles covering all steps", () => {
    assertRolesCovered(M3_RESOLVE);
  });

  it("has 2 measures", () => {
    expect(M3_RESOLVE.measures).toHaveLength(2);
  });
});

describe("M4_WORK", () => {
  it("has correct id and name", () => {
    expect(M4_WORK.id).toBe("M4-WORK");
    expect(M4_WORK.name).toBe("Issue Work Execution Method");
  });

  it("has 9 steps in a DAG with conditional branches (9 edges, no back edges)", () => {
    expect(M4_WORK.dag.steps).toHaveLength(9);
    expect(M4_WORK.dag.edges).toHaveLength(9);
  });

  it("has 3 roles (planner, implementor, reporter)", () => {
    expect(M4_WORK.roles).toHaveLength(3);
    const roleIds = M4_WORK.roles.map((r) => r.id);
    expect(roleIds).toContain("planner");
    expect(roleIds).toContain("implementor");
    expect(roleIds).toContain("reporter");
  });

  it("has roles covering all steps", () => {
    assertRolesCovered(M4_WORK);
  });

  it("has 3 measures", () => {
    expect(M4_WORK.measures).toHaveLength(3);
  });
});
