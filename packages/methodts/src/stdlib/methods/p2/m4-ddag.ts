/**
 * M4_DDAG — Drift Audit Method (M4-DDAG v1.0).
 *
 * 4 steps in a linear DAG: Scope → Collect → Analyze → Report.
 *
 * Cross-phase drift detection. Analyzes N most recent completed phases to
 * identify architectural drift, accumulating divergences, pattern violations,
 * and inter-phase inconsistencies that single-phase review cannot detect.
 * Produces a DriftReport with drift vectors and remediation recommendations.
 * Read-only — M4-DDAG does not modify source.
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

type DdagState = {
  readonly auditWindowSize: number;
  readonly phases: readonly string[];
  readonly architectureBaseline: readonly string[];
  readonly divergences: readonly { readonly phaseSource: string; readonly location: string; readonly description: string }[];
  readonly phasesExamined: number;
  readonly driftVectors: readonly { readonly name: string; readonly severity: "STRUCTURAL" | "MODERATE" | "COSMETIC" }[];
  readonly reportComplete: boolean;
};

// ── Domain Theory ──

const D_DDAG: DomainTheory<DdagState> = {
  id: "D_DDAG",
  signature: {
    sorts: [
      { name: "AuditWindow", description: "The N-phase window under audit", cardinality: "singleton" },
      { name: "Phase", description: "A completed delivery phase", cardinality: "finite" },
      { name: "ArchDoc", description: "Architecture documents the codebase should conform to", cardinality: "finite" },
      { name: "Divergence", description: "A specific deviation from architecture", cardinality: "unbounded" },
      { name: "DriftVector", description: "An identified pattern of accumulating divergences", cardinality: "unbounded" },
      { name: "Remediation", description: "A recommended action to address a drift vector", cardinality: "unbounded" },
      { name: "DriftReport", description: "Assembled analysis: drift vectors, divergences, remediations", cardinality: "singleton" },
      { name: "DriftSeverity", description: "STRUCTURAL, MODERATE, or COSMETIC", cardinality: "finite" },
    ],
    functionSymbols: [],
    predicates: {
      window_defined: check<DdagState>("window_defined", (s) => s.auditWindowSize >= 2),
      all_phases_examined: check<DdagState>("all_phases_examined", (s) => s.phasesExamined >= s.auditWindowSize),
      drift_analyzed: check<DdagState>("drift_analyzed", (s) => s.driftVectors !== undefined),
      report_complete: check<DdagState>("report_complete", (s) => s.reportComplete),
    },
  },
  axioms: {},
};

// ── Roles ──

const driftAuditor: Role<DdagState> = {
  id: "drift_auditor",
  description: "Cross-phase evaluator. Read-only access to all phase artifacts across the N-phase window.",
  observe: (s) => s,
  authorized: ["sigma_0", "sigma_1", "sigma_2", "sigma_3"],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<DdagState>[] = [
  {
    id: "sigma_0",
    name: "Scope",
    role: "drift_auditor",
    precondition: TRUE,
    postcondition: check("window_defined", (s: DdagState) => s.auditWindowSize >= 2 && s.phases.length >= 2),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_1",
    name: "Collect",
    role: "drift_auditor",
    precondition: check("window_defined", (s: DdagState) => s.auditWindowSize >= 2),
    postcondition: check("all_phases_examined", (s: DdagState) => s.phasesExamined >= s.auditWindowSize),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_2",
    name: "Analyze",
    role: "drift_auditor",
    precondition: check("all_phases_examined", (s: DdagState) => s.phasesExamined >= s.auditWindowSize),
    postcondition: check("drift_analyzed", (s: DdagState) => s.driftVectors !== undefined),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_3",
    name: "Report",
    role: "drift_auditor",
    precondition: check("drift_analyzed", (s: DdagState) => s.driftVectors !== undefined),
    postcondition: check("report_complete", (s: DdagState) => s.reportComplete),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
];

// ── DAG ──

const dag: StepDAG<DdagState> = {
  steps,
  edges: [
    { from: "sigma_0", to: "sigma_1" },
    { from: "sigma_1", to: "sigma_2" },
    { from: "sigma_2", to: "sigma_3" },
  ],
  initial: "sigma_0",
  terminal: "sigma_3",
};

// ── Method ──

/** M4_DDAG — Drift Audit Method (v1.0). 4 steps, linear DAG. */
export const M4_DDAG: Method<DdagState> = {
  id: "M4-DDAG",
  name: "Drift Audit Method",
  domain: D_DDAG,
  roles: [driftAuditor],
  dag,
  objective: check("drift_report_complete", (s: DdagState) => s.reportComplete),
  measures: [
    {
      id: "mu_phase_coverage",
      name: "Phase Coverage",
      compute: (s: DdagState) =>
        s.auditWindowSize > 0 ? s.phasesExamined / s.auditWindowSize : 0,
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_remediation_coverage",
      name: "Remediation Coverage",
      compute: (s: DdagState) => (s.reportComplete ? 1 : 0),
      range: [0, 1],
      terminal: 1,
    },
  ],
};
