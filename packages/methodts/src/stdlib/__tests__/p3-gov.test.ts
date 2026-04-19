// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for P3_GOV methodology — Governance Methodology.
 *
 * Validates:
 * - P3_GOV structural properties (id, name, arm count, priorities, safety bounds)
 * - Domain theory D_GOV (sorts, function symbols, predicates, axioms)
 * - Transition routing via evaluateTransition for each arm
 * - Termination certificate composite measure through RFC lifecycle
 * - Method structural tests (M1-DRAFT, M2-REVIEW, M3-APPROVE, M4-HANDOFF)
 */

import { describe, it, expect } from "vitest";
import {
  assertRoutesTo,
  assertCoherent,
  assertSignatureValid,
  assertRolesCovered,
  assertTerminates,
  assertRoutingTotal,
  assertAxiomsSatisfied,
  assertAxiomsHold,
  assertAxiomsViolated,
  evaluateTransition,
} from "../../testkit/index.js";
import {
  P3_GOV,
  D_GOV,
  GOV_ARMS,
  arm_draft_from_gap,
  arm_first_domain_review,
  arm_next_domain_review,
  arm_steering_review,
  arm_human_approval,
  arm_commission,
  arm_revision,
  arm_revision_exhausted,
  arm_terminal_handoff,
  arm_terminal_rejected,
  arm_terminal_withdrawn,
  type GovState,
} from "../methodologies/p3-gov.js";
import { M1_DRAFT } from "../methods/p3gov/m1-draft.js";
import { M2_REVIEW_GOV } from "../methods/p3gov/m2-review.js";
import { M3_APPROVE } from "../methods/p3gov/m3-approve.js";
import { M4_HANDOFF } from "../methods/p3gov/m4-handoff.js";

// ── Test states ──

/** Gap identified, no RFC — should route to M1-DRAFT (arm 1). */
const stateDraftFromGap: GovState = {
  gapIdentified: true,
  rfcExists: false,
  rfcPhase: null,
  rfcWellFormed: false,
  fullyReviewed: false,
  revisionCount: 0,
  maxRevisions: 3,
  commissionReady: false,
  completed: false,
};

/** Well-formed RFC in draft — should route to M2-REVIEW (arm 2). */
const stateFirstDomainReview: GovState = {
  gapIdentified: true,
  rfcExists: true,
  rfcPhase: "draft",
  rfcWellFormed: true,
  fullyReviewed: false,
  revisionCount: 0,
  maxRevisions: 3,
  commissionReady: false,
  completed: false,
};

/** Domain review in progress, not fully reviewed — should route to M2-REVIEW (arm 3). */
const stateNextDomainReview: GovState = {
  gapIdentified: true,
  rfcExists: true,
  rfcPhase: "domain_review",
  rfcWellFormed: true,
  fullyReviewed: false,
  revisionCount: 0,
  maxRevisions: 3,
  commissionReady: false,
  completed: false,
};

/** All domain reviews done, not yet accepted — should route to M2-REVIEW steering (arm 4). */
const stateSteeringReview: GovState = {
  gapIdentified: true,
  rfcExists: true,
  rfcPhase: "steering_review",
  rfcWellFormed: true,
  fullyReviewed: true,
  revisionCount: 0,
  maxRevisions: 3,
  commissionReady: false,
  completed: false,
};

/** Governance-approved RFC — should route to M3-APPROVE (arm 5). */
const stateHumanApproval: GovState = {
  gapIdentified: true,
  rfcExists: true,
  rfcPhase: "accepted",
  rfcWellFormed: true,
  fullyReviewed: true,
  revisionCount: 0,
  maxRevisions: 3,
  commissionReady: false,
  completed: false,
};

/** Human approved — should route to M4-HANDOFF (arm 6).
 * fullyReviewed must be false to avoid arm 4 (steering_review) firing first,
 * since steering_review checks fullyReviewed AND NOT(accepted) AND NOT(rejected),
 * which would match human_approved phase. */
const stateCommission: GovState = {
  gapIdentified: true,
  rfcExists: true,
  rfcPhase: "human_approved",
  rfcWellFormed: true,
  fullyReviewed: false,
  revisionCount: 0,
  maxRevisions: 3,
  commissionReady: false,
  completed: false,
};

/** Revision requested, budget remaining — should route to M1-DRAFT (arm 7). */
const stateRevision: GovState = {
  gapIdentified: true,
  rfcExists: true,
  rfcPhase: "revision_requested",
  rfcWellFormed: false,
  fullyReviewed: false,
  revisionCount: 1,
  maxRevisions: 3,
  commissionReady: false,
  completed: false,
};

/** Revision requested, budget exhausted — should terminate (arm 8). */
const stateRevisionExhausted: GovState = {
  gapIdentified: true,
  rfcExists: true,
  rfcPhase: "revision_requested",
  rfcWellFormed: false,
  fullyReviewed: false,
  revisionCount: 3,
  maxRevisions: 3,
  commissionReady: false,
  completed: false,
};

/** Handed off — terminal (arm 9).
 * fullyReviewed must be false to avoid arm 4 (steering_review) firing first. */
const stateHandedOff: GovState = {
  gapIdentified: true,
  rfcExists: true,
  rfcPhase: "handed_off",
  rfcWellFormed: true,
  fullyReviewed: false,
  revisionCount: 0,
  maxRevisions: 3,
  commissionReady: true,
  completed: true,
};

/** Rejected — terminal (arm 10). */
const stateRejected: GovState = {
  gapIdentified: true,
  rfcExists: true,
  rfcPhase: "rejected",
  rfcWellFormed: true,
  fullyReviewed: true,
  revisionCount: 0,
  maxRevisions: 3,
  commissionReady: false,
  completed: true,
};

/** Withdrawn — terminal (arm 11). */
const stateWithdrawn: GovState = {
  gapIdentified: true,
  rfcExists: true,
  rfcPhase: "withdrawn",
  rfcWellFormed: true,
  fullyReviewed: false,
  revisionCount: 0,
  maxRevisions: 3,
  commissionReady: false,
  completed: true,
};

/** All test states for coherence/totality checks. */
const allStates: GovState[] = [
  stateDraftFromGap,
  stateFirstDomainReview,
  stateNextDomainReview,
  stateSteeringReview,
  stateHumanApproval,
  stateCommission,
  stateRevision,
  stateRevisionExhausted,
  stateHandedOff,
  stateRejected,
  stateWithdrawn,
];

// ── P3_GOV structural tests ──

describe("P3_GOV", () => {
  it("has correct id", () => {
    expect(P3_GOV.id).toBe("P3-GOV");
  });

  it("has correct name", () => {
    expect(P3_GOV.name).toBe("Governance Methodology");
  });

  it("has 11 arms matching the transition function", () => {
    expect(P3_GOV.arms).toHaveLength(11);
  });

  it("has arms with correct priority ordering (1-11)", () => {
    const priorities = P3_GOV.arms.map((a) => a.priority);
    expect(priorities).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("has correct arm labels in priority order", () => {
    const labels = P3_GOV.arms.map((a) => a.label);
    expect(labels).toEqual([
      "draft_from_gap",
      "first_domain_review",
      "next_domain_review",
      "steering_review",
      "human_approval",
      "commission",
      "revision",
      "revision_exhausted",
      "terminal_handoff",
      "terminal_rejected",
      "terminal_withdrawn",
    ]);
  });

  it("has a domain with id D_Phi_GOV", () => {
    expect(P3_GOV.domain.id).toBe("D_Phi_GOV");
  });

  it("has safety bounds configured", () => {
    expect(P3_GOV.safety.maxLoops).toBe(50);
    expect(P3_GOV.safety.maxTokens).toBe(2_000_000);
    expect(P3_GOV.safety.maxCostUsd).toBe(100);
    expect(P3_GOV.safety.maxDurationMs).toBe(7_200_000);
    expect(P3_GOV.safety.maxDepth).toBe(5);
  });

  it("routing arms select methods, terminal arms select null", () => {
    // Arms 1-7 are routing arms — should have methods wired
    expect(P3_GOV.arms[0].selects).not.toBeNull(); // M1-DRAFT
    expect(P3_GOV.arms[1].selects).not.toBeNull(); // M2-REVIEW
    expect(P3_GOV.arms[2].selects).not.toBeNull(); // M2-REVIEW
    expect(P3_GOV.arms[3].selects).not.toBeNull(); // M2-REVIEW
    expect(P3_GOV.arms[4].selects).not.toBeNull(); // M3-APPROVE
    expect(P3_GOV.arms[5].selects).not.toBeNull(); // M4-HANDOFF
    expect(P3_GOV.arms[6].selects).not.toBeNull(); // M1-DRAFT (revision)
    // Arms 8-11 are terminal — should be null
    expect(P3_GOV.arms[7].selects).toBeNull(); // revision_exhausted
    expect(P3_GOV.arms[8].selects).toBeNull(); // terminal_handoff
    expect(P3_GOV.arms[9].selects).toBeNull(); // terminal_rejected
    expect(P3_GOV.arms[10].selects).toBeNull(); // terminal_withdrawn
  });

  it("is coherent over all test states", () => {
    assertCoherent(P3_GOV, allStates);
  });

  it("routing is total over all test states", () => {
    assertRoutingTotal(P3_GOV, allStates);
  });
});

// ── Domain theory tests ──

describe("D_GOV", () => {
  it("has 9 sorts", () => {
    expect(D_GOV.signature.sorts).toHaveLength(9);
  });

  it("has 6 function symbols", () => {
    expect(D_GOV.signature.functionSymbols).toHaveLength(6);
  });

  it("has 8 predicates", () => {
    expect(Object.keys(D_GOV.signature.predicates)).toHaveLength(8);
  });

  it("has 5 axioms", () => {
    const axiomKeys = Object.keys(D_GOV.axioms);
    expect(axiomKeys).toHaveLength(5);
    expect(axiomKeys).toContain("Ax-GOV-0_self_protection");
    expect(axiomKeys).toContain("Ax-GOV-1_human_gate");
    expect(axiomKeys).toContain("Ax-GOV-2_review_coverage");
    expect(axiomKeys).toContain("Ax-GOV-3_essence_guard");
    expect(axiomKeys).toContain("Ax-GOV-5_revision_bound");
  });

  it("has a valid signature", () => {
    assertSignatureValid(D_GOV);
  });

  it("axioms are satisfiable over test states", () => {
    assertAxiomsSatisfied(D_GOV, allStates);
  });

  it("Ax-GOV-1 human gate holds for handed_off state with commission ready", () => {
    assertAxiomsHold(D_GOV, stateHandedOff);
  });

  it("Ax-GOV-5 revision bound is violated when revisionCount exceeds maxRevisions", () => {
    const violatingState: GovState = {
      ...stateRevision,
      revisionCount: 4,
      maxRevisions: 3,
    };
    assertAxiomsViolated(D_GOV, violatingState, ["Ax-GOV-5_revision_bound"]);
  });
});

// ── Transition routing tests ──

describe("evaluateTransition(P3_GOV, ...)", () => {
  it("routes gap without RFC to arm 1 (draft_from_gap)", () => {
    assertRoutesTo(P3_GOV, stateDraftFromGap, "draft_from_gap");
  });

  it("routes well-formed draft to arm 2 (first_domain_review)", () => {
    assertRoutesTo(P3_GOV, stateFirstDomainReview, "first_domain_review");
  });

  it("routes domain_review (not fully reviewed) to arm 3 (next_domain_review)", () => {
    assertRoutesTo(P3_GOV, stateNextDomainReview, "next_domain_review");
  });

  it("routes fully-reviewed RFC to arm 4 (steering_review)", () => {
    assertRoutesTo(P3_GOV, stateSteeringReview, "steering_review");
  });

  it("routes accepted RFC to arm 5 (human_approval)", () => {
    assertRoutesTo(P3_GOV, stateHumanApproval, "human_approval");
  });

  it("routes human_approved RFC to arm 6 (commission)", () => {
    assertRoutesTo(P3_GOV, stateCommission, "commission");
  });

  it("routes revision_requested (budget remaining) to arm 7 (revision)", () => {
    assertRoutesTo(P3_GOV, stateRevision, "revision");
  });

  it("routes revision_requested (budget exhausted) to arm 8 (revision_exhausted)", () => {
    assertRoutesTo(P3_GOV, stateRevisionExhausted, "revision_exhausted");
  });

  it("routes handed_off to arm 9 (terminal_handoff)", () => {
    assertRoutesTo(P3_GOV, stateHandedOff, "terminal_handoff");
  });

  it("routes rejected to arm 10 (terminal_rejected)", () => {
    assertRoutesTo(P3_GOV, stateRejected, "terminal_rejected");
  });

  it("routes withdrawn to arm 11 (terminal_withdrawn)", () => {
    assertRoutesTo(P3_GOV, stateWithdrawn, "terminal_withdrawn");
  });

  it("evaluates all 11 arms and records traces", () => {
    const result = evaluateTransition(P3_GOV, stateDraftFromGap);
    expect(result.armTraces).toHaveLength(11);

    const firedTraces = result.armTraces.filter((t) => t.fired);
    expect(firedTraces).toHaveLength(1);
    expect(firedTraces[0].label).toBe("draft_from_gap");
  });
});

// ── Termination certificate tests ──

describe("P3_GOV terminationCertificate", () => {
  it("measure is 0 for terminal states (handed_off, rejected, withdrawn)", () => {
    expect(P3_GOV.terminationCertificate.measure(stateHandedOff)).toBe(0);
    expect(P3_GOV.terminationCertificate.measure(stateRejected)).toBe(0);
    expect(P3_GOV.terminationCertificate.measure(stateWithdrawn)).toBe(0);
  });

  it("measure is highest for no-RFC state", () => {
    const m = P3_GOV.terminationCertificate.measure;
    expect(m(stateDraftFromGap)).toBeGreaterThan(m(stateFirstDomainReview));
  });

  it("measure decreases through the happy-path pipeline", () => {
    const m = P3_GOV.terminationCertificate.measure;
    // draft -> domain_review -> steering_review -> accepted -> human_approved -> handed_off
    expect(m(stateFirstDomainReview)).toBeGreaterThan(m(stateNextDomainReview));
    expect(m(stateNextDomainReview)).toBeGreaterThan(m(stateSteeringReview));
    expect(m(stateSteeringReview)).toBeGreaterThan(m(stateHumanApproval));
    expect(m(stateHumanApproval)).toBeGreaterThan(m(stateCommission));
    expect(m(stateCommission)).toBeGreaterThan(m(stateHandedOff));
  });

  it("revision decreases outer term (revision_requested with count > 0 has lower measure)", () => {
    const m = P3_GOV.terminationCertificate.measure;
    const firstRevision: GovState = { ...stateRevision, revisionCount: 0 };
    const secondRevision: GovState = { ...stateRevision, revisionCount: 1 };
    expect(m(firstRevision)).toBeGreaterThan(m(secondRevision));
  });

  it("terminates along the happy-path trajectory", () => {
    assertTerminates(P3_GOV, [
      stateDraftFromGap,
      stateFirstDomainReview,
      stateNextDomainReview,
      stateSteeringReview,
      stateHumanApproval,
      stateCommission,
      stateHandedOff,
    ]);
  });

  it("terminates along the rejection trajectory", () => {
    assertTerminates(P3_GOV, [
      stateDraftFromGap,
      stateFirstDomainReview,
      stateRejected,
    ]);
  });
});

// ── Method structural tests ──

describe("M1_DRAFT", () => {
  it("has correct id and name", () => {
    expect(M1_DRAFT.id).toBe("M1-DRAFT");
    expect(M1_DRAFT.name).toBe("RFC Drafting Method");
  });

  it("has 3 steps in a linear DAG", () => {
    expect(M1_DRAFT.dag.steps).toHaveLength(3);
    expect(M1_DRAFT.dag.edges).toHaveLength(2);
  });

  it("has 1 role (rho_drafter)", () => {
    expect(M1_DRAFT.roles).toHaveLength(1);
    expect(M1_DRAFT.roles[0].id).toBe("rho_drafter");
  });

  it("has roles covering all steps", () => {
    assertRolesCovered(M1_DRAFT);
  });

  it("has 2 measures", () => {
    expect(M1_DRAFT.measures).toHaveLength(2);
  });

  it("has an objective predicate", () => {
    expect(M1_DRAFT.objective).toBeDefined();
  });
});

describe("M2_REVIEW_GOV", () => {
  it("has correct id and name", () => {
    expect(M2_REVIEW_GOV.id).toBe("M2-REVIEW");
    expect(M2_REVIEW_GOV.name).toBe("Council Review Method");
  });

  it("has 4 steps in a linear DAG", () => {
    expect(M2_REVIEW_GOV.dag.steps).toHaveLength(4);
    expect(M2_REVIEW_GOV.dag.edges).toHaveLength(3);
  });

  it("has 1 role (rho_reviewer)", () => {
    expect(M2_REVIEW_GOV.roles).toHaveLength(1);
    expect(M2_REVIEW_GOV.roles[0].id).toBe("rho_reviewer");
  });

  it("has roles covering all steps", () => {
    assertRolesCovered(M2_REVIEW_GOV);
  });

  it("has 2 measures", () => {
    expect(M2_REVIEW_GOV.measures).toHaveLength(2);
  });
});

describe("M3_APPROVE", () => {
  it("has correct id and name", () => {
    expect(M3_APPROVE.id).toBe("M3-APPROVE");
    expect(M3_APPROVE.name).toBe("Human Approval Method");
  });

  it("has 3 steps in a linear DAG", () => {
    expect(M3_APPROVE.dag.steps).toHaveLength(3);
    expect(M3_APPROVE.dag.edges).toHaveLength(2);
  });

  it("has 2 roles (rho_presenter, rho_PO)", () => {
    expect(M3_APPROVE.roles).toHaveLength(2);
    const roleIds = M3_APPROVE.roles.map((r) => r.id);
    expect(roleIds).toContain("rho_presenter");
    expect(roleIds).toContain("rho_PO");
  });

  it("has roles covering all steps", () => {
    assertRolesCovered(M3_APPROVE);
  });

  it("has 2 measures", () => {
    expect(M3_APPROVE.measures).toHaveLength(2);
  });
});

describe("M4_HANDOFF", () => {
  it("has correct id and name", () => {
    expect(M4_HANDOFF.id).toBe("M4-HANDOFF");
    expect(M4_HANDOFF.name).toBe("Commission Handoff Method");
  });

  it("has 3 steps in a linear DAG", () => {
    expect(M4_HANDOFF.dag.steps).toHaveLength(3);
    expect(M4_HANDOFF.dag.edges).toHaveLength(2);
  });

  it("has 1 role (rho_commission_author)", () => {
    expect(M4_HANDOFF.roles).toHaveLength(1);
    expect(M4_HANDOFF.roles[0].id).toBe("rho_commission_author");
  });

  it("has roles covering all steps", () => {
    assertRolesCovered(M4_HANDOFF);
  });

  it("has 2 measures", () => {
    expect(M4_HANDOFF.measures).toHaveLength(2);
  });
});
