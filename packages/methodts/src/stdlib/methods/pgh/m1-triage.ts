// SPDX-License-Identifier: Apache-2.0
/**
 * M1_TRIAGE — Issue Triage Method (P-GH/M1-TRIAGE v1.0).
 *
 * 5 steps in a linear DAG: Load Issue -> Classify -> Assess -> Decide -> Act.
 *
 * Reads a GitHub issue, classifies it by type and scope, checks alignment with
 * the project's essence, and routes it to the appropriate action: commission an
 * agent (trivial/small), draft a PRD (medium/large), escalate to the steering
 * council (essence-touching), or close (won't-fix/duplicate).
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
import type { TriageState } from "../../types.js";

// ── Domain Theory ──

/** D_TRIAGE — issue triage domain theory. */
const D_TRIAGE: DomainTheory<TriageState> = {
  id: "D_TRIAGE",
  signature: {
    sorts: [
      { name: "Issue", description: "The GitHub issue being triaged", cardinality: "singleton" },
      { name: "IssueType", description: "Classification of the issue's nature (bug/feature/question/meta)", cardinality: "finite" },
      { name: "Scope", description: "Estimated effort required (trivial/small/medium/large)", cardinality: "finite" },
      { name: "Action", description: "The triage routing decision (commission/prd/escalate/close)", cardinality: "finite" },
      { name: "ProjectCard", description: "The project's essence, delivery rules, and governance", cardinality: "singleton" },
      { name: "PRD", description: "Existing PRD documents that may overlap with the issue", cardinality: "finite" },
      { name: "AgendaItem", description: "Items on the steering council agenda", cardinality: "finite" },
      { name: "TriageDecision", description: "The assembled decision: type, scope, action, rationale", cardinality: "singleton" },
    ],
    functionSymbols: [],
    predicates: {
      issue_loaded: check<TriageState>("issue_loaded", (s) => s.issue.length > 0),
      type_assigned: check<TriageState>("type_assigned", (s) => s.issueType !== null),
      scope_assessed: check<TriageState>("scope_assessed", (s) => s.scope !== null),
      serves_essence: check<TriageState>("serves_essence", (s) => s.servesEssence),
      overlaps_prd: check<TriageState>("overlaps_prd", (s) => s.overlapsPRD),
      action_decided: check<TriageState>("action_decided", (s) => s.action !== null),
      triage_complete: check<TriageState>("triage_complete", (s) => s.triageDecision !== null),
    },
  },
  axioms: {},
};

// ── Roles ──

const triager: Role<TriageState> = {
  id: "triager",
  description: "Reads the issue, project card, existing PRDs, and council agenda. Classifies, assesses, decides, and executes triage.",
  observe: (s) => s,
  authorized: ["sigma_0", "sigma_1", "sigma_2", "sigma_3", "sigma_4"],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<TriageState>[] = [
  {
    id: "sigma_0",
    name: "Load Issue",
    role: "triager",
    precondition: TRUE,
    postcondition: check("issue_loaded", (s: TriageState) => s.issue.length > 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_1",
    name: "Classify",
    role: "triager",
    precondition: check("issue_loaded", (s: TriageState) => s.issue.length > 0),
    postcondition: check("type_assigned", (s: TriageState) => s.issueType !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_2",
    name: "Assess",
    role: "triager",
    precondition: check("type_assigned", (s: TriageState) => s.issueType !== null),
    postcondition: check("scope_assessed", (s: TriageState) => s.scope !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_3",
    name: "Decide",
    role: "triager",
    precondition: check("scope_assessed", (s: TriageState) => s.scope !== null),
    postcondition: check("action_decided", (s: TriageState) => s.action !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_4",
    name: "Act",
    role: "triager",
    precondition: check("action_decided", (s: TriageState) => s.action !== null),
    postcondition: check("triage_complete", (s: TriageState) => s.triageDecision !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
];

// ── DAG ──

const dag: StepDAG<TriageState> = {
  steps,
  edges: [
    { from: "sigma_0", to: "sigma_1" },
    { from: "sigma_1", to: "sigma_2" },
    { from: "sigma_2", to: "sigma_3" },
    { from: "sigma_3", to: "sigma_4" },
  ],
  initial: "sigma_0",
  terminal: "sigma_4",
};

// ── Method ──

/** M1_TRIAGE — Issue Triage Method (P-GH v1.0). 5 steps, linear DAG. */
export const M1_TRIAGE: Method<TriageState> = {
  id: "M1-TRIAGE",
  name: "Issue Triage Method",
  domain: D_TRIAGE,
  roles: [triager],
  dag,
  objective: check("o_triage", (s: TriageState) =>
    s.issueType !== null && s.scope !== null && s.action !== null && s.triageDecision !== null,
  ),
  measures: [
    {
      id: "mu_classification",
      name: "Classification Completeness",
      compute: (s: TriageState) => (s.issueType !== null && s.scope !== null ? 1 : 0),
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_action",
      name: "Action Execution",
      compute: (s: TriageState) => (s.action !== null && s.triageDecision !== null ? 1 : 0),
      range: [0, 1],
      terminal: 1,
    },
  ],
};
