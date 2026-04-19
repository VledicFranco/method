// SPDX-License-Identifier: Apache-2.0
/**
 * M4_HANDOFF — Commission Handoff Method (M4-HANDOFF v0.1).
 *
 * 3 steps in a linear DAG: Execution Requirement Extraction -> Commission Composition -> Commission Validation.
 *
 * Generates an actionable commission from a human-approved RFC with full governance
 * context. The commission is the output artifact of P3-GOV — it crosses the boundary
 * from governance to execution.
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

/** Handoff execution state — what M4-HANDOFF operates on. */
export type HandoffState = {
  readonly rfcId: string;
  readonly humanApproved: boolean;
  readonly requirementsExtracted: boolean;
  readonly requirementsCount: number;
  readonly conditionsFromReviewsCount: number;
  readonly commissionComposed: boolean;
  readonly conditionsCarried: boolean;
  readonly traceabilityComplete: boolean;
  readonly commissionValid: boolean;
  readonly commissionReady: boolean;
  readonly targetMethodology: "P2-SD" | "P1-EXEC" | null;
  readonly priority: "P0" | "P1" | "P2" | null;
};

// ── Domain Theory ──

/** D_HANDOFF — commission handoff domain theory. */
const D_HANDOFF: DomainTheory<HandoffState> = {
  id: "D_HANDOFF",
  signature: {
    sorts: [
      { name: "RFC", description: "The human-approved RFC — inherited from D_Phi_GOV", cardinality: "singleton" },
      { name: "Commission", description: "The output commission artifact — inherited from D_Phi_GOV", cardinality: "singleton" },
      { name: "GovernanceContext", description: "Full governance history for traceability", cardinality: "singleton" },
      { name: "ExecutionRequirement", description: "A specific requirement for the executing agent", cardinality: "finite" },
      { name: "HandoffState", description: "Full handoff state: { rfc, governance_context, requirements, commission }", cardinality: "singleton" },
    ],
    functionSymbols: [],
    predicates: {
      human_approved: check<HandoffState>("human_approved", (s) => s.humanApproved),
      requirements_extracted: check<HandoffState>("requirements_extracted", (s) => s.requirementsExtracted),
      commission_composed: check<HandoffState>("commission_composed", (s) => s.commissionComposed),
      commission_ready: check<HandoffState>("commission_ready", (s) => s.commissionReady),
      conditions_carried: check<HandoffState>("conditions_carried", (s) => s.conditionsCarried),
      traceability_complete: check<HandoffState>("traceability_complete", (s) => s.traceabilityComplete),
    },
  },
  axioms: {},
};

// ── Roles ──

const commissionAuthor: Role<HandoffState> = {
  id: "rho_commission_author",
  description: "The agent generating the commission from the approved RFC. Full governance visibility.",
  observe: (s) => s,
  authorized: ["sigma_0", "sigma_1", "sigma_2"],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<HandoffState>[] = [
  {
    id: "sigma_0",
    name: "Execution Requirement Extraction",
    role: "rho_commission_author",
    precondition: check("human_approved", (s: HandoffState) => s.humanApproved),
    postcondition: check("requirements_extracted", (s: HandoffState) => s.requirementsExtracted && s.requirementsCount > 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_1",
    name: "Commission Composition",
    role: "rho_commission_author",
    precondition: check("requirements_extracted", (s: HandoffState) => s.requirementsExtracted),
    postcondition: check("commission_composed", (s: HandoffState) =>
      s.commissionComposed && s.conditionsCarried && s.traceabilityComplete,
    ),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_2",
    name: "Commission Validation",
    role: "rho_commission_author",
    precondition: check("commission_composed", (s: HandoffState) => s.commissionComposed),
    postcondition: check("commission_ready", (s: HandoffState) => s.commissionValid && s.commissionReady),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
];

// ── DAG ──

const dag: StepDAG<HandoffState> = {
  steps,
  edges: [
    { from: "sigma_0", to: "sigma_1" },
    { from: "sigma_1", to: "sigma_2" },
  ],
  initial: "sigma_0",
  terminal: "sigma_2",
};

// ── Progress measure ──

/** Maps requirement coverage to [0, 1]. */
function requirementCoverage(s: HandoffState): number {
  if (s.requirementsCount === 0) return 0;
  // All requirements included in commission when commission is composed
  return s.commissionComposed ? 1 : 0;
}

// ── Method ──

/** M4_HANDOFF — Commission Handoff Method (v0.1). 3 steps, linear DAG. */
export const M4_HANDOFF: Method<HandoffState> = {
  id: "M4-HANDOFF",
  name: "Commission Handoff Method",
  domain: D_HANDOFF,
  roles: [commissionAuthor],
  dag,
  objective: check("o_handoff", (s: HandoffState) =>
    s.commissionReady && s.commissionComposed && s.conditionsCarried && s.traceabilityComplete,
  ),
  measures: [
    {
      id: "mu_requirement_coverage",
      name: "Requirement Coverage",
      compute: requirementCoverage,
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_commission_completeness",
      name: "Commission Completeness",
      compute: (s: HandoffState) => s.commissionReady ? 1 : 0,
      range: [0, 1],
      terminal: 1,
    },
  ],
};
