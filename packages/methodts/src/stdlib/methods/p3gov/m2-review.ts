// SPDX-License-Identifier: Apache-2.0
/**
 * M2_REVIEW_GOV — Council Review Method (M2-REVIEW v0.2).
 *
 * 4 steps in a linear DAG: RFC Intake and Framing -> Council Setup -> Debate (M1-COUNCIL delegation) -> Verdict Production.
 *
 * Receives a well-formed RFC and produces a review verdict. Parameterized for domain
 * review (review_type = domain) or steering review (review_type = steering). The debate
 * step delegates to M1-COUNCIL via domain retraction.
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

/** Review execution state — what M2-REVIEW operates on. */
export type ReviewState = {
  readonly rfcId: string;
  readonly reviewType: "domain" | "steering";
  readonly framed: boolean;
  readonly councilSetupComplete: boolean;
  readonly debateComplete: boolean;
  readonly verdictProduced: boolean;
  readonly essenceChecked: boolean;
  readonly verdict: "approve" | "approve_with_conditions" | "request_changes" | "block" | null;
  readonly stepsCompleted: number;
  readonly maxRounds: number;
};

// ── Domain Theory ──

/** D_REVIEW — council review domain theory. */
const D_REVIEW: DomainTheory<ReviewState> = {
  id: "D_REVIEW",
  signature: {
    sorts: [
      { name: "RFC", description: "The RFC under review — inherited from D_Phi_GOV", cardinality: "singleton" },
      { name: "Review", description: "The review verdict being produced — inherited from D_Phi_GOV", cardinality: "singleton" },
      { name: "ReviewVerdict", description: "Verdict values: approve, approve_with_conditions, request_changes, block", cardinality: "finite" },
      { name: "Council", description: "The reviewing council — inherited from D_Phi_GOV", cardinality: "singleton" },
      { name: "ReviewType", description: "Whether this is a domain review or steering review", cardinality: "finite" },
      { name: "EssenceCheckResult", description: "Result of the essence check (steering review only)", cardinality: "singleton" },
      { name: "FramingContext", description: "5-layer framing context for M1-COUNCIL delegation", cardinality: "singleton" },
      { name: "ReviewState", description: "Full review state: { rfc, council, review_type, framing, debate_result, verdict }", cardinality: "singleton" },
    ],
    functionSymbols: [],
    predicates: {
      framed: check<ReviewState>("framed", (s) => s.framed),
      council_setup_complete: check<ReviewState>("council_setup_complete", (s) => s.councilSetupComplete),
      debate_complete: check<ReviewState>("debate_complete", (s) => s.debateComplete),
      verdict_produced: check<ReviewState>("verdict_produced", (s) => s.verdictProduced),
      essence_checked: check<ReviewState>("essence_checked", (s) => s.essenceChecked),
    },
  },
  axioms: {},
};

// ── Roles ──

const reviewer: Role<ReviewState> = {
  id: "rho_reviewer",
  description: "The reviewing council, specialized from rho_council for the review context.",
  observe: (s) => s,
  authorized: ["sigma_0", "sigma_1", "sigma_2", "sigma_3"],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<ReviewState>[] = [
  {
    id: "sigma_0",
    name: "RFC Intake and Framing",
    role: "rho_reviewer",
    precondition: check("rfc_exists", (s: ReviewState) => s.rfcId.length > 0),
    postcondition: check("framed", (s: ReviewState) => s.framed),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_1",
    name: "Council Setup",
    role: "rho_reviewer",
    precondition: check("framed", (s: ReviewState) => s.framed),
    postcondition: check("council_setup_complete", (s: ReviewState) => s.councilSetupComplete),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_2",
    name: "Debate",
    role: "rho_reviewer",
    precondition: check("council_setup_complete", (s: ReviewState) => s.councilSetupComplete),
    postcondition: check("debate_complete", (s: ReviewState) => s.debateComplete),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_3",
    name: "Verdict Production",
    role: "rho_reviewer",
    precondition: check("debate_complete", (s: ReviewState) => s.debateComplete),
    postcondition: check("verdict_produced", (s: ReviewState) =>
      s.verdictProduced && (s.reviewType !== "steering" || s.essenceChecked),
    ),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
];

// ── DAG ──

const dag: StepDAG<ReviewState> = {
  steps,
  edges: [
    { from: "sigma_0", to: "sigma_1" },
    { from: "sigma_1", to: "sigma_2" },
    { from: "sigma_2", to: "sigma_3" },
  ],
  initial: "sigma_0",
  terminal: "sigma_3",
};

// ── Progress measure ──

/** Maps review step completion progress to [0, 1]. */
function reviewProgress(s: ReviewState): number {
  return s.stepsCompleted / 4;
}

// ── Method ──

/** M2_REVIEW_GOV — Council Review Method (v0.2). 4 steps, linear DAG. */
export const M2_REVIEW_GOV: Method<ReviewState> = {
  id: "M2-REVIEW",
  name: "Council Review Method",
  domain: D_REVIEW,
  roles: [reviewer],
  dag,
  objective: check("o_review", (s: ReviewState) =>
    s.verdictProduced &&
    (s.reviewType !== "steering" || s.essenceChecked) &&
    s.debateComplete,
  ),
  measures: [
    {
      id: "mu_review_progress",
      name: "Review Progress",
      compute: reviewProgress,
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_debate_quality",
      name: "Debate Quality",
      compute: (_s: ReviewState) => 0,
      range: [0, 1],
      terminal: 1,
    },
  ],
};
