// SPDX-License-Identifier: Apache-2.0
/**
 * M5_PLAN — Phase Planning Method (M5-PLAN v1.0).
 *
 * 5 steps in a linear DAG: Validate Inputs → Extract Tasks → Integrate Carryover →
 * Scope and Rate → Write and Validate PhaseDoc.
 *
 * Takes a PRDSection and produces a PhaseDoc — a scoped, severity-rated, validated
 * task list for one delivery phase. Output is the handoff artifact consumed by
 * M1-IMPL or M2-DIMPL.
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

type PlanState = {
  readonly prdSectionRef: string;
  readonly archDocsInScope: readonly string[];
  readonly hasCarryover: boolean;
  readonly inputsValidated: boolean;
  readonly tasksExtracted: number;
  readonly rawTaskList: readonly { readonly description: string; readonly acceptanceCriteria: readonly string[] }[];
  readonly carryoverTasksMerged: number;
  readonly mergedTaskList: readonly string[];
  readonly allTasksScoped: boolean;
  readonly allTasksRated: boolean;
  readonly phaseDocComplete: boolean;
  readonly coverageVerified: boolean;
};

// ── Domain Theory ──

const D_PLAN: DomainTheory<PlanState> = {
  id: "D_PLAN",
  signature: {
    sorts: [
      { name: "PRDSection", description: "The bounded PRD section being planned", cardinality: "singleton" },
      { name: "PhaseHistory", description: "Record of all previous phases", cardinality: "singleton" },
      { name: "ArchDoc", description: "An architecture document in scope for this phase", cardinality: "finite" },
      { name: "Task", description: "An implementation task with acceptance criteria, scope, severity, and role", cardinality: "finite" },
      { name: "PhaseDoc", description: "The output artifact: a structured, scoped, validated task list", cardinality: "singleton" },
    ],
    functionSymbols: [],
    predicates: {
      inputs_validated: check<PlanState>("inputs_validated", (s) => s.inputsValidated),
      tasks_extracted: check<PlanState>("tasks_extracted", (s) => s.tasksExtracted >= 1),
      carryover_integrated: check<PlanState>("carryover_integrated", (s) => s.mergedTaskList.length > 0),
      all_scoped_and_rated: check<PlanState>("all_scoped_and_rated", (s) => s.allTasksScoped && s.allTasksRated),
      phase_doc_complete: check<PlanState>("phase_doc_complete", (s) => s.phaseDocComplete && s.coverageVerified),
    },
  },
  axioms: {},
};

// ── Roles ──

const planner: Role<PlanState> = {
  id: "planner",
  description: "Reads PRDSection, PhaseHistory, and ArchDocs. Produces the PhaseDoc. Does not write source code.",
  observe: (s) => s,
  authorized: ["sigma_0", "sigma_1", "sigma_2", "sigma_3", "sigma_4"],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<PlanState>[] = [
  {
    id: "sigma_0",
    name: "Validate Inputs",
    role: "planner",
    precondition: TRUE,
    postcondition: check("inputs_validated", (s: PlanState) => s.inputsValidated),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_1",
    name: "Extract Tasks",
    role: "planner",
    precondition: check("inputs_validated", (s: PlanState) => s.inputsValidated),
    postcondition: check("tasks_extracted", (s: PlanState) => s.tasksExtracted >= 1),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_2",
    name: "Integrate Carryover",
    role: "planner",
    precondition: check("tasks_extracted", (s: PlanState) => s.tasksExtracted >= 1),
    postcondition: check("carryover_integrated", (s: PlanState) => s.mergedTaskList.length > 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_3",
    name: "Scope and Rate",
    role: "planner",
    precondition: check("carryover_integrated", (s: PlanState) => s.mergedTaskList.length > 0),
    postcondition: check("all_scoped_and_rated", (s: PlanState) => s.allTasksScoped && s.allTasksRated),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_4",
    name: "Write and Validate PhaseDoc",
    role: "planner",
    precondition: check("all_scoped_and_rated", (s: PlanState) => s.allTasksScoped && s.allTasksRated),
    postcondition: check("phase_doc_complete", (s: PlanState) => s.phaseDocComplete && s.coverageVerified),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
];

// ── DAG ──

const dag: StepDAG<PlanState> = {
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

// ── Progress measure ──

function planProgress(s: PlanState): number {
  let stage = 0;
  if (s.inputsValidated) stage = 1;
  if (s.tasksExtracted >= 1) stage = 2;
  if (s.mergedTaskList.length > 0) stage = 3;
  if (s.allTasksScoped && s.allTasksRated) stage = 4;
  if (s.phaseDocComplete && s.coverageVerified) stage = 5;
  return stage / 5;
}

// ── Method ──

/** M5_PLAN — Phase Planning Method (v1.0). 5 steps, linear DAG. */
export const M5_PLAN: Method<PlanState> = {
  id: "M5-PLAN",
  name: "Phase Planning Method",
  domain: D_PLAN,
  roles: [planner],
  dag,
  objective: check("plan_complete", (s: PlanState) => s.phaseDocComplete && s.coverageVerified),
  measures: [
    {
      id: "mu_plan_progress",
      name: "Planning Progress",
      compute: planProgress,
      range: [0, 1],
      terminal: 1,
    },
  ],
};
