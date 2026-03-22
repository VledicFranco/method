/**
 * M3_PHRV — Phase Review Method (M3-PHRV v1.1).
 *
 * 4 steps in a linear DAG: Orient → Criteria Audit → Architecture Assessment → Report.
 *
 * Evaluates delivered work against PhaseDoc, architecture docs, and PRD.
 * Produces a ReviewReport with per-finding citations and an overall verdict.
 * Read-only — M3-PHRV does not modify source.
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

type PhrvState = {
  readonly acceptanceCriteria: readonly string[];
  readonly architectureDocs: readonly string[];
  readonly filesInScope: readonly string[];
  readonly criteriaResults: readonly { readonly criterion: string; readonly result: "MET" | "GAP" }[];
  readonly architectureFindings: readonly string[];
  readonly architectureAligned: boolean;
  readonly reportComplete: boolean;
  readonly verdict: "PASS" | "CONDITIONAL" | "FAIL" | null;
};

// ── Domain Theory ──

const D_PHRV: DomainTheory<PhrvState> = {
  id: "D_PHRV",
  signature: {
    sorts: [
      { name: "PhaseArtifact", description: "The bundle of phase outputs: source files, session log, PhaseDoc, test results", cardinality: "singleton" },
      { name: "ArchDoc", description: "Architecture documents the phase should conform to", cardinality: "finite" },
      { name: "AcceptanceCriterion", description: "A specific criterion from the PhaseDoc", cardinality: "finite" },
      { name: "Finding", description: "A specific observation with citation", cardinality: "unbounded" },
      { name: "Severity", description: "Finding severity: CRITICAL, HIGH, MEDIUM, LOW", cardinality: "finite" },
      { name: "ReviewReport", description: "Assembled findings with verdict", cardinality: "singleton" },
      { name: "Verdict", description: "PASS, CONDITIONAL, or FAIL", cardinality: "finite" },
    ],
    functionSymbols: [],
    predicates: {
      criteria_enumerated: check<PhrvState>("criteria_enumerated", (s) => s.acceptanceCriteria.length > 0),
      all_criteria_evaluated: check<PhrvState>("all_criteria_evaluated", (s) => s.criteriaResults.length >= s.acceptanceCriteria.length),
      architecture_assessed: check<PhrvState>("architecture_assessed", (s) => s.architectureFindings !== undefined),
      report_complete: check<PhrvState>("report_complete", (s) => s.reportComplete),
      verdict_set: check<PhrvState>("verdict_set", (s) => s.verdict !== null),
    },
  },
  axioms: {},
};

// ── Roles ──

const reviewer: Role<PhrvState> = {
  id: "reviewer",
  description: "Read-only evaluator. Produces findings with file:line citations. Does not modify source.",
  observe: (s) => s,
  authorized: ["sigma_0", "sigma_1", "sigma_2", "sigma_3"],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<PhrvState>[] = [
  {
    id: "sigma_0",
    name: "Orient",
    role: "reviewer",
    precondition: TRUE,
    postcondition: check("criteria_enumerated", (s: PhrvState) => s.acceptanceCriteria.length > 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_1",
    name: "Criteria Audit",
    role: "reviewer",
    precondition: check("criteria_enumerated", (s: PhrvState) => s.acceptanceCriteria.length > 0),
    postcondition: check("all_criteria_evaluated", (s: PhrvState) => s.criteriaResults.length >= s.acceptanceCriteria.length),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_2",
    name: "Architecture Assessment",
    role: "reviewer",
    precondition: check("all_criteria_evaluated", (s: PhrvState) => s.criteriaResults.length >= s.acceptanceCriteria.length),
    postcondition: check("architecture_assessed", (s: PhrvState) => s.architectureFindings !== undefined),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_3",
    name: "Report",
    role: "reviewer",
    precondition: check("architecture_assessed", (s: PhrvState) => s.architectureFindings !== undefined),
    postcondition: check("report_complete", (s: PhrvState) => s.reportComplete && s.verdict !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
];

// ── DAG ──

const dag: StepDAG<PhrvState> = {
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

function reviewProgress(s: PhrvState): number {
  let stage = 0;
  if (s.acceptanceCriteria.length > 0) stage = 1;
  if (s.criteriaResults.length >= s.acceptanceCriteria.length && s.acceptanceCriteria.length > 0) stage = 2;
  if (s.architectureFindings !== undefined && stage >= 2) stage = 3;
  if (s.reportComplete && s.verdict !== null) stage = 4;
  return stage / 4;
}

// ── Method ──

/** M3_PHRV — Phase Review Method (v1.1). 4 steps, linear DAG. */
export const M3_PHRV: Method<PhrvState> = {
  id: "M3-PHRV",
  name: "Phase Review Method",
  domain: D_PHRV,
  roles: [reviewer],
  dag,
  objective: check("review_complete", (s: PhrvState) => s.reportComplete && s.verdict !== null),
  measures: [
    {
      id: "mu_coverage",
      name: "Criteria Coverage",
      compute: (s: PhrvState) =>
        s.acceptanceCriteria.length > 0
          ? s.criteriaResults.length / s.acceptanceCriteria.length
          : 0,
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_completeness",
      name: "Report Completeness",
      compute: (s: PhrvState) => (s.reportComplete && s.verdict !== null ? 1 : 0),
      range: [0, 1],
      terminal: 1,
    },
  ],
};
