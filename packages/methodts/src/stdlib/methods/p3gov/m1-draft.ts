/**
 * M1_DRAFT — RFC Drafting Method (M1-DRAFT v0.1).
 *
 * 3 steps in a linear DAG: Gap Analysis -> RFC Composition -> Well-Formedness Validation.
 *
 * Receives a gap description (or an existing RFC in revision mode) and produces a
 * well-formed RFC per RFC-SCHEMA. Two modes: initial drafting (gap -> RFC) and revision
 * (existing RFC + review feedback -> revised RFC).
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

/** Draft execution state — what M1-DRAFT operates on. */
export type DraftState = {
  readonly gapDescription: string;
  readonly mode: "initial" | "revision";
  readonly revisionCount: number;
  readonly gapAnalyzed: boolean;
  readonly fieldsPopulated: number;
  readonly totalRequiredFields: number;
  readonly feedbackItemsTotal: number;
  readonly feedbackItemsAddressed: number;
  readonly wellFormed: boolean;
  readonly allFeedbackAddressed: boolean;
  readonly thresholdMet: boolean;
  readonly rfcProduced: boolean;
};

// ── Domain Theory ──

/** D_DRAFT — RFC drafting domain theory. */
const D_DRAFT: DomainTheory<DraftState> = {
  id: "D_DRAFT",
  signature: {
    sorts: [
      { name: "Gap", description: "The identified gap or opportunity that motivates the RFC", cardinality: "singleton" },
      { name: "RFC", description: "The RFC being drafted — inherited from D_Phi_GOV", cardinality: "singleton" },
      { name: "Phase", description: "RFC lifecycle phase — inherited from D_Phi_GOV", cardinality: "finite" },
      { name: "EssenceImpact", description: "How the RFC relates to project essence — inherited from D_Phi_GOV", cardinality: "finite" },
      { name: "ReviewFeedback", description: "Change requests from prior reviews (revision mode)", cardinality: "finite" },
      { name: "DraftState", description: "Full draft state: { gap, rfc, mode, revision_count, feedback }", cardinality: "singleton" },
    ],
    functionSymbols: [],
    predicates: {
      gap_analyzed: check<DraftState>("gap_analyzed", (s) => s.gapAnalyzed),
      well_formed: check<DraftState>("well_formed", (s) => s.wellFormed),
      feedback_addressed: check<DraftState>("feedback_addressed", (s) => s.allFeedbackAddressed),
      all_feedback_addressed: check<DraftState>("all_feedback_addressed", (s) => s.allFeedbackAddressed),
      threshold_met: check<DraftState>("threshold_met", (s) => s.thresholdMet),
      rfc_produced: check<DraftState>("rfc_produced", (s) => s.rfcProduced),
    },
  },
  axioms: {},
};

// ── Roles ──

const drafter: Role<DraftState> = {
  id: "rho_drafter",
  description: "The agent drafting the RFC. Specializes rho_council for the drafting context.",
  observe: (s) => s,
  authorized: ["sigma_0", "sigma_1", "sigma_2"],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<DraftState>[] = [
  {
    id: "sigma_0",
    name: "Gap Analysis",
    role: "rho_drafter",
    precondition: check("gap_exists", (s: DraftState) => s.gapDescription.length > 0),
    postcondition: check("gap_analyzed", (s: DraftState) => s.gapAnalyzed),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_1",
    name: "RFC Composition",
    role: "rho_drafter",
    precondition: check("gap_analyzed", (s: DraftState) => s.gapAnalyzed),
    postcondition: check("fields_populated", (s: DraftState) => s.fieldsPopulated === s.totalRequiredFields),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_2",
    name: "Well-Formedness Validation",
    role: "rho_drafter",
    precondition: check("fields_populated", (s: DraftState) => s.fieldsPopulated === s.totalRequiredFields),
    postcondition: check("well_formed_and_complete", (s: DraftState) => s.wellFormed && s.allFeedbackAddressed && s.rfcProduced),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
];

// ── DAG ──

const dag: StepDAG<DraftState> = {
  steps,
  edges: [
    { from: "sigma_0", to: "sigma_1" },
    { from: "sigma_1", to: "sigma_2" },
  ],
  initial: "sigma_0",
  terminal: "sigma_2",
};

// ── Progress measure ──

/** Maps RFC field completeness progress to [0, 1]. */
function fieldCompleteness(s: DraftState): number {
  if (s.totalRequiredFields === 0) return 0;
  return s.fieldsPopulated / s.totalRequiredFields;
}

/** Maps feedback coverage progress to [0, 1]. */
function feedbackCoverage(s: DraftState): number {
  if (s.feedbackItemsTotal === 0) return 1; // vacuously true in initial mode
  return s.feedbackItemsAddressed / s.feedbackItemsTotal;
}

// ── Method ──

/** M1_DRAFT — RFC Drafting Method (v0.1). 3 steps, linear DAG. */
export const M1_DRAFT: Method<DraftState> = {
  id: "M1-DRAFT",
  name: "RFC Drafting Method",
  domain: D_DRAFT,
  roles: [drafter],
  dag,
  objective: check("o_draft", (s: DraftState) =>
    s.wellFormed && (s.mode !== "revision" || s.allFeedbackAddressed) && s.thresholdMet,
  ),
  measures: [
    {
      id: "mu_field_completeness",
      name: "Field Completeness",
      compute: fieldCompleteness,
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_feedback_coverage",
      name: "Feedback Coverage",
      compute: feedbackCoverage,
      range: [0, 1],
      terminal: 1,
    },
  ],
};
