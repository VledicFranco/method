// SPDX-License-Identifier: Apache-2.0
/**
 * P3_GOV — Governance Methodology.
 *
 * F1-FTH Definition 7.1: Phi = (D_Phi, delta_Phi, O_Phi)
 * Pipeline methodology whose transition function tracks RFC lifecycle through
 * governance review stages. Receives identified gaps as input, produces
 * human-approved commissions as output. The RFC is the primary artifact
 * that crosses the governance-execution boundary.
 *
 * The transition function (delta_GOV) routes based on RFC lifecycle status.
 * The Phase sort is the sole discriminator. 11 arms cover gap-without-RFC,
 * each Phase value, and terminal states.
 *
 * @see registry/P3-GOV/P3-GOV.yaml — the formal definition
 * @see theory/F1-FTH §7 — Methodology coalgebra
 */

import type { Methodology, Arm } from "../../methodology/methodology.js";
import type { Method } from "../../method/method.js";
import { M1_DRAFT } from "../methods/p3gov/m1-draft.js";
import { M2_REVIEW_GOV } from "../methods/p3gov/m2-review.js";
import { M3_APPROVE } from "../methods/p3gov/m3-approve.js";
import { M4_HANDOFF } from "../methods/p3gov/m4-handoff.js";
import type { DomainTheory } from "../../domain/domain-theory.js";
import { check, and, not, or } from "../../predicate/predicate.js";

// ── State type ──

/**
 * GovState — the state P3-GOV operates on.
 *
 * Tracks the RFC lifecycle: gap identified, RFC drafted, domain reviews,
 * steering review, human approval, commission handoff. Terminal states:
 * handed_off, rejected, withdrawn.
 */
export type GovState = {
  readonly gapIdentified: boolean;
  readonly rfcExists: boolean;
  readonly rfcPhase:
    | "draft"
    | "domain_review"
    | "steering_review"
    | "accepted"
    | "rejected"
    | "revision_requested"
    | "human_approved"
    | "handed_off"
    | "withdrawn"
    | null;
  readonly rfcWellFormed: boolean;
  readonly fullyReviewed: boolean;
  readonly revisionCount: number;
  readonly maxRevisions: number;
  readonly commissionReady: boolean;
  readonly completed: boolean;
};

// ── Domain theory ──

/**
 * D_GOV — the domain theory for P3-GOV (F1-FTH Def 1.1).
 *
 * Sorts: RFC, Council, Review, Phase, ReviewVerdict, HumanDecision,
 *   Commission, EssenceImpact, State
 * Key predicates: gap_identified, rfc_exists, well_formed, fully_reviewed,
 *   governance_approved, human_approved, commission_ready, revision_limit_reached
 * Axioms: self-protection, human gate, review coverage, essence guard,
 *   block resolution, revision bound, entry threshold, verdict aggregation
 */
export const D_GOV: DomainTheory<GovState> = {
  id: "D_Phi_GOV",
  signature: {
    sorts: [
      { name: "RFC", description: "The primary governance artifact — a proposal for changing shared artifacts", cardinality: "singleton" },
      { name: "Council", description: "A standing decision body (steering, theory, future domain councils)", cardinality: "finite" },
      { name: "Review", description: "A council's formal verdict on an RFC", cardinality: "unbounded" },
      { name: "Phase", description: "The RFC lifecycle stage — drives all delta_GOV routing", cardinality: "finite" },
      { name: "ReviewVerdict", description: "A council's verdict: approve, approve_with_conditions, request_changes, block", cardinality: "finite" },
      { name: "HumanDecision", description: "The PO's decision: approve, reject, request_changes", cardinality: "finite" },
      { name: "Commission", description: "The output artifact: an actionable commission for another methodology", cardinality: "singleton" },
      { name: "EssenceImpact", description: "How the RFC relates to the project's essence", cardinality: "finite" },
      { name: "State", description: "Full governance state: { rfc, reviews[], phase, human_decision, commission }", cardinality: "singleton" },
    ],
    functionSymbols: [
      { name: "status", inputSorts: ["RFC"], outputSort: "Phase", totality: "total", description: "Current lifecycle stage of the RFC" },
      { name: "author", inputSorts: ["RFC"], outputSort: "Council", totality: "total", description: "Who proposed the RFC" },
      { name: "domain_routing", inputSorts: ["RFC"], outputSort: "Council", totality: "total", description: "Which councils must review this RFC" },
      { name: "verdict", inputSorts: ["Review"], outputSort: "ReviewVerdict", totality: "total", description: "The reviewing council's verdict" },
      { name: "essence_impact", inputSorts: ["RFC"], outputSort: "EssenceImpact", totality: "total", description: "The RFC's relationship to the project's essence" },
      { name: "revision_count", inputSorts: ["RFC"], outputSort: "Phase", totality: "total", description: "Number of times the RFC has been revised" },
    ],
    predicates: {
      gap_identified: check<GovState>("gap_identified", (s) => s.gapIdentified),
      rfc_exists: check<GovState>("rfc_exists", (s) => s.rfcExists),
      well_formed: check<GovState>("well_formed", (s) => s.rfcWellFormed),
      fully_reviewed: check<GovState>("fully_reviewed", (s) => s.fullyReviewed),
      governance_approved: check<GovState>("governance_approved", (s) => s.rfcPhase === "accepted"),
      human_approved: check<GovState>("human_approved", (s) => s.rfcPhase === "human_approved"),
      commission_ready: check<GovState>("commission_ready", (s) => s.commissionReady),
      revision_limit_reached: check<GovState>("revision_limit_reached", (s) => s.revisionCount >= s.maxRevisions),
    },
  },
  axioms: {
    // Ax-GOV-0: Self-protection — constitutional axioms cannot be subject of an RFC
    "Ax-GOV-0_self_protection": check<GovState>("self_protection", () => true),
    // Ax-GOV-1: Human gate — no RFC reaches execution without human approval
    // Operationalized: if the RFC is handed off, commission must be ready (implies human approved it)
    "Ax-GOV-1_human_gate": check<GovState>("human_gate", (s) =>
      s.rfcPhase !== "handed_off" || s.commissionReady,
    ),
    // Ax-GOV-2: Review coverage — all domain councils must review before steering
    "Ax-GOV-2_review_coverage": check<GovState>("review_coverage", (s) =>
      s.rfcPhase !== "steering_review" || s.fullyReviewed,
    ),
    // Ax-GOV-3: Essence guard — essence-touching RFCs get mandatory scrutiny
    "Ax-GOV-3_essence_guard": check<GovState>("essence_guard", () => true),
    // Ax-GOV-5: Revision bound — prevents infinite revision loops
    "Ax-GOV-5_revision_bound": check<GovState>("revision_bound", (s) =>
      s.revisionCount <= s.maxRevisions,
    ),
  },
};

// ── Transition arms ──

/**
 * Arm 1: draft_from_gap — gap identified, no RFC yet. Draft one.
 * Routes to M1-DRAFT.
 */
export const arm_draft_from_gap: Arm<GovState> = {
  priority: 1,
  label: "draft_from_gap",
  condition: and(
    check<GovState>("gap_identified", (s) => s.gapIdentified),
    not(check<GovState>("rfc_exists", (s) => s.rfcExists)),
  ),
  selects: M1_DRAFT as unknown as Method<GovState>,
  rationale: "Gap identified, no RFC yet. Draft one.",
};

/**
 * Arm 2: first_domain_review — well-formed RFC ready for domain review.
 * Routes to M2-REVIEW (domain mode).
 */
export const arm_first_domain_review: Arm<GovState> = {
  priority: 2,
  label: "first_domain_review",
  condition: and(
    check<GovState>("rfc_exists", (s) => s.rfcExists),
    check<GovState>("is_draft", (s) => s.rfcPhase === "draft"),
    check<GovState>("well_formed", (s) => s.rfcWellFormed),
  ),
  selects: M2_REVIEW_GOV as unknown as Method<GovState>,
  rationale: "Well-formed RFC ready for domain review.",
};

/**
 * Arm 3: next_domain_review — domain review in progress, next unreviewed council.
 * Routes to M2-REVIEW (domain mode).
 */
export const arm_next_domain_review: Arm<GovState> = {
  priority: 3,
  label: "next_domain_review",
  condition: and(
    check<GovState>("rfc_exists", (s) => s.rfcExists),
    check<GovState>("is_domain_review", (s) => s.rfcPhase === "domain_review"),
    not(check<GovState>("fully_reviewed", (s) => s.fullyReviewed)),
  ),
  selects: M2_REVIEW_GOV as unknown as Method<GovState>,
  rationale: "Domain review in progress — route to next unreviewed council.",
};

/**
 * Arm 4: steering_review — all domain reviews complete, steering decides.
 * Routes to M2-REVIEW (steering mode, essence check mandatory per Ax-GOV-3).
 */
export const arm_steering_review: Arm<GovState> = {
  priority: 4,
  label: "steering_review",
  condition: and(
    check<GovState>("rfc_exists", (s) => s.rfcExists),
    check<GovState>("fully_reviewed", (s) => s.fullyReviewed),
    not(check<GovState>("is_accepted", (s) => s.rfcPhase === "accepted")),
    not(check<GovState>("is_rejected", (s) => s.rfcPhase === "rejected")),
  ),
  selects: M2_REVIEW_GOV as unknown as Method<GovState>,
  rationale: "All domain reviews complete. Steering council makes final call.",
};

/**
 * Arm 5: human_approval — governance-approved RFC ready for human review.
 * Routes to M3-APPROVE.
 */
export const arm_human_approval: Arm<GovState> = {
  priority: 5,
  label: "human_approval",
  condition: and(
    check<GovState>("rfc_exists", (s) => s.rfcExists),
    check<GovState>("is_accepted", (s) => s.rfcPhase === "accepted"),
  ),
  selects: M3_APPROVE as unknown as Method<GovState>,
  rationale: "Governance-approved RFC ready for human review.",
};

/**
 * Arm 6: commission — human approved, generate commission.
 * Routes to M4-HANDOFF.
 */
export const arm_commission: Arm<GovState> = {
  priority: 6,
  label: "commission",
  condition: and(
    check<GovState>("rfc_exists", (s) => s.rfcExists),
    check<GovState>("is_human_approved", (s) => s.rfcPhase === "human_approved"),
  ),
  selects: M4_HANDOFF as unknown as Method<GovState>,
  rationale: "Human approved. Generate commission for execution methodology.",
};

/**
 * Arm 7: revision — review requested changes, re-enter draft stage.
 * Routes to M1-DRAFT (revision mode).
 */
export const arm_revision: Arm<GovState> = {
  priority: 7,
  label: "revision",
  condition: and(
    check<GovState>("rfc_exists", (s) => s.rfcExists),
    check<GovState>("is_revision_requested", (s) => s.rfcPhase === "revision_requested"),
    not(check<GovState>("revision_limit_reached", (s) => s.revisionCount >= s.maxRevisions)),
  ),
  selects: M1_DRAFT as unknown as Method<GovState>,
  rationale: "Human or reviewer requested changes. Re-enter draft stage.",
};

/**
 * Arm 8: revision_exhausted — max revisions reached, auto-reject per Ax-GOV-5.
 */
export const arm_revision_exhausted: Arm<GovState> = {
  priority: 8,
  label: "revision_exhausted",
  condition: and(
    check<GovState>("rfc_exists", (s) => s.rfcExists),
    check<GovState>("is_revision_requested", (s) => s.rfcPhase === "revision_requested"),
    check<GovState>("revision_limit_reached", (s) => s.revisionCount >= s.maxRevisions),
  ),
  selects: null,
  rationale: "Max revisions reached. Pipeline terminates with rejection.",
};

/**
 * Arm 9: terminal_handoff — RFC fully processed, commission ready.
 */
export const arm_terminal_handoff: Arm<GovState> = {
  priority: 9,
  label: "terminal_handoff",
  condition: and(
    check<GovState>("rfc_exists", (s) => s.rfcExists),
    check<GovState>("is_handed_off", (s) => s.rfcPhase === "handed_off"),
  ),
  selects: null,
  rationale: "RFC fully processed. Commission ready for human to fire.",
};

/**
 * Arm 10: terminal_rejected — RFC rejected by steering or human.
 */
export const arm_terminal_rejected: Arm<GovState> = {
  priority: 10,
  label: "terminal_rejected",
  condition: and(
    check<GovState>("rfc_exists", (s) => s.rfcExists),
    check<GovState>("is_rejected", (s) => s.rfcPhase === "rejected"),
  ),
  selects: null,
  rationale: "RFC rejected by steering or human. Pipeline terminates.",
};

/**
 * Arm 11: terminal_withdrawn — RFC withdrawn by author.
 */
export const arm_terminal_withdrawn: Arm<GovState> = {
  priority: 11,
  label: "terminal_withdrawn",
  condition: and(
    check<GovState>("rfc_exists", (s) => s.rfcExists),
    check<GovState>("is_withdrawn", (s) => s.rfcPhase === "withdrawn"),
  ),
  selects: null,
  rationale: "RFC withdrawn by author. Pipeline terminates.",
};

/** All 11 arms in priority order. */
export const GOV_ARMS: readonly Arm<GovState>[] = [
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
];

// ── Methodology ──

/**
 * P3_GOV — Governance Methodology.
 *
 * Evaluates 11 transition arms based on RFC lifecycle status to route
 * governance challenges through the RFC pipeline: drafting, domain review,
 * steering review, human approval, and commission handoff.
 *
 * Termination certificate: composite measure nu_GOV with revision-bounded
 * outer term and status_distance + remaining_reviews inner terms.
 */
export const P3_GOV: Methodology<GovState> = {
  id: "P3-GOV",
  name: "Governance Methodology",
  domain: D_GOV,
  arms: GOV_ARMS,
  objective: or(
    and(
      check<GovState>("is_handed_off", (s) => s.rfcPhase === "handed_off"),
      check<GovState>("commission_ready", (s) => s.commissionReady),
    ),
    check<GovState>("is_rejected", (s) => s.rfcPhase === "rejected"),
    check<GovState>("is_withdrawn", (s) => s.rfcPhase === "withdrawn"),
  ),
  terminationCertificate: {
    measure: (s: GovState) => {
      // Composite measure: outer revision budget * inner pipeline distance
      if (s.rfcPhase === "handed_off" || s.rfcPhase === "rejected" || s.rfcPhase === "withdrawn") return 0;
      const statusDistance: Record<string, number> = {
        draft: 5,
        domain_review: 4,
        steering_review: 3,
        accepted: 2,
        human_approved: 1,
        revision_requested: 5,
      };
      const dist = s.rfcPhase ? (statusDistance[s.rfcPhase] ?? 6) : 6;
      const outerTerm = (s.maxRevisions - s.revisionCount) * 6;
      return outerTerm + dist;
    },
    decreases:
      "Composite measure: outer term (max_revisions - revision_count) * pipeline_width + status_distance. " +
      "Each revision cycle decreases the outer term. Within a cycle, each method invocation decreases status_distance. " +
      "Ax-GOV-5 ensures revision_count never exceeds max_revisions.",
  },
  safety: {
    maxLoops: 50,
    maxTokens: 2_000_000,
    maxCostUsd: 100,
    maxDurationMs: 7_200_000,
    maxDepth: 5,
  },
};
