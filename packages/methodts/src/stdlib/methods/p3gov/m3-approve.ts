// SPDX-License-Identifier: Apache-2.0
/**
 * M3_APPROVE — Human Approval Method (M3-APPROVE v0.1).
 *
 * 3 steps in a linear DAG: Review Package Assembly -> Human Decision -> Decision Validation and Status Transition.
 *
 * Presents a governance-approved RFC to the human Product Owner with the complete review
 * package and records the human's decision. Implements Ax-GOV-1 (human gate) — no RFC
 * reaches execution without explicit human approval.
 *
 * Phase 1b: all steps are script execution. Agent prompts are deferred
 * to Phase 2 when the provider system is wired in.
 */

import { Effect } from "effect";
import type { Method } from "../../../method/method.js";
import type { Step } from "../../../method/step.js";
import type { StepDAG } from "../../../method/dag.js";
import type { DomainTheory } from "../../../domain/domain-theory.js";
import type { Role } from "../../../domain/role.js";
import { check, TRUE } from "../../../predicate/predicate.js";

// ── State ──

/** Approval execution state — what M3-APPROVE operates on. */
export type ApprovalState = {
  readonly rfcId: string;
  readonly governanceApproved: boolean;
  readonly packageAssembled: boolean;
  readonly allReviewsIncluded: boolean;
  readonly minorityPositionsIncluded: boolean;
  readonly essenceCheckIncluded: boolean;
  readonly humanDecision: "approve" | "reject" | "request_changes" | null;
  readonly decisionRecorded: boolean;
  readonly reviewCount: number;
  readonly statusTransition: "human_approved" | "rejected" | "revision_requested" | null;
};

// ── Domain Theory ──

/** D_APPROVE — human approval domain theory. */
const D_APPROVE: DomainTheory<ApprovalState> = {
  id: "D_APPROVE",
  signature: {
    sorts: [
      { name: "RFC", description: "The governance-approved RFC — inherited from D_Phi_GOV", cardinality: "singleton" },
      { name: "Review", description: "The set of all reviews for this RFC — inherited from D_Phi_GOV", cardinality: "finite" },
      { name: "HumanDecision", description: "The PO's decision values: approve, reject, request_changes", cardinality: "finite" },
      { name: "ReviewPackage", description: "The assembled package presented to the human", cardinality: "singleton" },
      { name: "ApprovalState", description: "Full approval state: { rfc, reviews, review_package, human_decision, rationale }", cardinality: "singleton" },
    ],
    functionSymbols: [],
    predicates: {
      governance_approved: check<ApprovalState>("governance_approved", (s) => s.governanceApproved),
      package_assembled: check<ApprovalState>("package_assembled", (s) => s.packageAssembled),
      decision_recorded: check<ApprovalState>("decision_recorded", (s) => s.decisionRecorded),
      all_reviews_included: check<ApprovalState>("all_reviews_included", (s) => s.allReviewsIncluded),
      essence_check_included: check<ApprovalState>("essence_check_included", (s) => s.essenceCheckIncluded),
      minority_positions_included: check<ApprovalState>("minority_positions_included", (s) => s.minorityPositionsIncluded),
    },
  },
  axioms: {},
};

// ── Roles ──

const presenter: Role<ApprovalState> = {
  id: "rho_presenter",
  description: "The agent assembling and presenting the review package. Neutral information assembler.",
  observe: (s) => s,
  authorized: ["sigma_0", "sigma_2"],
  notAuthorized: [],
};

const productOwner: Role<ApprovalState> = {
  id: "rho_PO",
  description: "The human Product Owner. Final decision authority.",
  observe: (s) => s,
  authorized: ["sigma_1"],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<ApprovalState>[] = [
  {
    id: "sigma_0",
    name: "Review Package Assembly",
    role: "rho_presenter",
    precondition: check("governance_approved", (s: ApprovalState) => s.governanceApproved),
    postcondition: check("package_assembled", (s: ApprovalState) => s.packageAssembled && s.allReviewsIncluded),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_1",
    name: "Human Decision",
    role: "rho_PO",
    precondition: check("package_assembled", (s: ApprovalState) => s.packageAssembled && s.allReviewsIncluded),
    postcondition: check("decision_recorded", (s: ApprovalState) => s.decisionRecorded && s.humanDecision !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_2",
    name: "Decision Validation and Status Transition",
    role: "rho_presenter",
    precondition: check("decision_recorded", (s: ApprovalState) => s.decisionRecorded && s.humanDecision !== null),
    postcondition: check("status_transitioned", (s: ApprovalState) => s.decisionRecorded && s.statusTransition !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
];

// ── DAG ──

const dag: StepDAG<ApprovalState> = {
  steps,
  edges: [
    { from: "sigma_0", to: "sigma_1" },
    { from: "sigma_1", to: "sigma_2" },
  ],
  initial: "sigma_0",
  terminal: "sigma_2",
};

// ── Progress measure ──

/** Maps package completeness to [0, 1]. */
function packageCompleteness(s: ApprovalState): number {
  const components = [
    s.allReviewsIncluded,
    s.minorityPositionsIncluded,
    s.essenceCheckIncluded,
  ];
  const included = components.filter(Boolean).length;
  return included / components.length;
}

// ── Method ──

/** M3_APPROVE — Human Approval Method (v0.1). 3 steps, linear DAG. */
export const M3_APPROVE: Method<ApprovalState> = {
  id: "M3-APPROVE",
  name: "Human Approval Method",
  domain: D_APPROVE,
  roles: [presenter, productOwner],
  dag,
  objective: check("o_approve", (s: ApprovalState) =>
    s.decisionRecorded && s.packageAssembled && s.allReviewsIncluded && s.humanDecision !== null,
  ),
  measures: [
    {
      id: "mu_package_completeness",
      name: "Package Completeness",
      compute: packageCompleteness,
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_decision_recorded",
      name: "Decision Recorded",
      compute: (s: ApprovalState) => s.decisionRecorded ? 1 : 0,
      range: [0, 1],
      terminal: 1,
    },
  ],
};
