/**
 * M4_ADVREV — Adversarial Review Pipeline Method (M4-ADVREV v0.1, trial).
 *
 * 7 steps in a linear DAG: Target Identification -> Advisor Cast Design ->
 * Advisor Dispatch -> Advisor Collection & Review Report -> Synthesizer Dispatch ->
 * Consensus Matrix & Action Plan -> Iteration Check.
 *
 * Structured adversarial review where parallel contrarian advisors independently
 * attack an artifact from complementary dimensions, followed by parallel
 * synthesizers who defend, refine, and sequence findings into an Action Plan.
 * Produces two artifacts: a Review Report and an Action Plan.
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

/** Adversarial review pipeline state — what M4-ADVREV operates on. */
export type AdvrevState = {
  readonly artifactPath: string;
  readonly artifactType: string;
  readonly riskSurface: readonly string[];
  readonly mandatoryDimensions: readonly string[];
  readonly allMandatoryCovered: boolean;
  readonly advisorCount: number;
  readonly advisorsDispatched: boolean;
  readonly advisorsCollected: boolean;
  readonly reviewReportComplete: boolean;
  readonly synthesizerCount: number;
  readonly synthesizersDispatched: boolean;
  readonly synthesizersCollected: boolean;
  readonly actionPlanComplete: boolean;
  readonly totalFindings: number;
  readonly findingsWithCitations: number;
  readonly criticalHighWithMitigations: number;
  readonly criticalHighTotal: number;
  readonly consensusReached: number;
  readonly nonMergedFindings: number;
  readonly iterationCount: number;
  readonly isDelegated: boolean;
};

// ── Domain Theory ──

/** D_ADVREV — adversarial review structure domain theory. */
const D_ADVREV: DomainTheory<AdvrevState> = {
  id: "D_ADVREV",
  signature: {
    sorts: [
      { name: "Artifact", description: "The artifact under review", cardinality: "singleton" },
      { name: "ArtifactType", description: "Classification of the artifact being reviewed", cardinality: "finite" },
      { name: "ReviewDimension", description: "A specific aspect to evaluate", cardinality: "finite" },
      { name: "MandatoryDimension", description: "A dimension the advisor cast MUST cover", cardinality: "finite" },
      { name: "Advisor", description: "A contrarian reviewer with a specific dimension and attack posture", cardinality: "finite" },
      { name: "Synthesizer", description: "A response agent with a fixed posture archetype", cardinality: "finite" },
      { name: "Finding", description: "A specific review observation with citation, severity, and mitigation", cardinality: "unbounded" },
      { name: "Severity", description: "Finding severity: CRITICAL, HIGH, MEDIUM, LOW", cardinality: "finite" },
      { name: "ReviewReport", description: "Phase A output: all advisor findings with convergence analysis", cardinality: "singleton" },
      { name: "ActionPlan", description: "Phase B output: consensus-driven response with implementation checklist", cardinality: "singleton" },
      { name: "ConsensusAction", description: "Consensus response action across all synthesizers", cardinality: "finite" },
      { name: "IterationCounter", description: "Counts re-review iterations. Max 2.", cardinality: "finite" },
    ],
    functionSymbols: [],
    predicates: {
      artifact_loaded: check<AdvrevState>("artifact_loaded", (s) => s.artifactPath.length > 0),
      risk_assessed: check<AdvrevState>("risk_assessed", (s) => s.riskSurface.length >= 1),
      all_mandatory_covered: check<AdvrevState>("all_mandatory_covered", (s) => s.allMandatoryCovered),
      advisors_dispatched: check<AdvrevState>("advisors_dispatched", (s) => s.advisorsDispatched),
      advisors_collected: check<AdvrevState>("advisors_collected", (s) => s.advisorsCollected),
      review_report_complete: check<AdvrevState>("review_report_complete", (s) => s.reviewReportComplete),
      synthesizers_dispatched: check<AdvrevState>("synthesizers_dispatched", (s) => s.synthesizersDispatched),
      synthesizers_collected: check<AdvrevState>("synthesizers_collected", (s) => s.synthesizersCollected),
      action_plan_complete: check<AdvrevState>("action_plan_complete", (s) => s.actionPlanComplete),
      iteration_bounded: check<AdvrevState>("iteration_bounded", (s) => s.iterationCount <= 2),
    },
  },
  axioms: {},
};

// ── Roles ──

const orchestrator: Role<AdvrevState> = {
  id: "rho_orchestrator",
  description: "Designs advisor and synthesizer casts, dispatches sub-agents, collects results, computes consensus, and produces the Review Report and Action Plan.",
  observe: (s) => s,
  authorized: ["sigma_0", "sigma_1", "sigma_2", "sigma_3", "sigma_4", "sigma_5", "sigma_6"],
  notAuthorized: [],
};

const productOwner: Role<AdvrevState> = {
  id: "rho_PO",
  description: "Product Owner or parent method. Provides the artifact, resolves disputed findings, and decides whether to re-review.",
  observe: (s) => s,
  authorized: [],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<AdvrevState>[] = [
  {
    id: "sigma_0",
    name: "Target Identification",
    role: "rho_orchestrator",
    precondition: check("artifact_provided", (s: AdvrevState) => s.artifactPath.length > 0),
    postcondition: check("risk_assessed", (s: AdvrevState) => s.riskSurface.length >= 1 && s.artifactType.length > 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_1",
    name: "Advisor Cast Design",
    role: "rho_orchestrator",
    precondition: check("risk_assessed", (s: AdvrevState) => s.riskSurface.length >= 1),
    postcondition: check("cast_designed", (s: AdvrevState) => s.advisorCount >= 3 && s.advisorCount <= 5 && s.allMandatoryCovered),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_2",
    name: "Advisor Dispatch",
    role: "rho_orchestrator",
    precondition: check("cast_designed", (s: AdvrevState) => s.advisorCount >= 3 && s.allMandatoryCovered),
    postcondition: check("advisors_dispatched", (s: AdvrevState) => s.advisorsDispatched),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_3",
    name: "Advisor Collection and Review Report",
    role: "rho_orchestrator",
    precondition: check("advisors_dispatched", (s: AdvrevState) => s.advisorsDispatched),
    postcondition: check("review_report_complete", (s: AdvrevState) => s.advisorsCollected && s.reviewReportComplete),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_4",
    name: "Synthesizer Dispatch",
    role: "rho_orchestrator",
    precondition: check("review_report_complete", (s: AdvrevState) => s.reviewReportComplete),
    postcondition: check("synthesizers_dispatched", (s: AdvrevState) => s.synthesizersDispatched),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_5",
    name: "Consensus Matrix and Action Plan",
    role: "rho_orchestrator",
    precondition: check("synthesizers_dispatched", (s: AdvrevState) => s.synthesizersDispatched),
    postcondition: check("action_plan_complete", (s: AdvrevState) => s.synthesizersCollected && s.actionPlanComplete),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_6",
    name: "Iteration Check",
    role: "rho_orchestrator",
    precondition: check("action_plan_complete", (s: AdvrevState) => s.actionPlanComplete),
    postcondition: check("iteration_resolved", (s: AdvrevState) => s.iterationCount <= 2),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
];

// ── DAG ──

/**
 * Linear DAG for Phase 1b. The YAML defines a conditional loop (sigma_6 -> sigma_2)
 * bounded by iteration_count <= 2, but this is modeled as a linear path in the typed
 * DAG since Step DAGs are acyclic by definition. The loop is handled at execution time.
 */
const dag: StepDAG<AdvrevState> = {
  steps,
  edges: [
    { from: "sigma_0", to: "sigma_1" },
    { from: "sigma_1", to: "sigma_2" },
    { from: "sigma_2", to: "sigma_3" },
    { from: "sigma_3", to: "sigma_4" },
    { from: "sigma_4", to: "sigma_5" },
    { from: "sigma_5", to: "sigma_6" },
  ],
  initial: "sigma_0",
  terminal: "sigma_6",
};

// ── Progress measures ──

/** Pipeline progress: fraction of completed steps. */
function pipelineProgress(s: AdvrevState): number {
  let completed = 0;
  if (s.riskSurface.length >= 1) completed++;
  if (s.advisorCount >= 3) completed++;
  if (s.advisorsDispatched) completed++;
  if (s.reviewReportComplete) completed++;
  if (s.synthesizersDispatched) completed++;
  if (s.actionPlanComplete) completed++;
  if (s.actionPlanComplete && s.iterationCount <= 2) completed++;
  return completed / 7;
}

/** Finding quality: fraction of findings meeting citation and mitigation requirements. */
function findingQuality(s: AdvrevState): number {
  if (s.totalFindings === 0) return 1;
  const qualifyingFindings = s.findingsWithCitations;
  const mitigationOk = s.criticalHighTotal === 0 || s.criticalHighWithMitigations >= s.criticalHighTotal;
  if (!mitigationOk) return qualifyingFindings / s.totalFindings * 0.5;
  return qualifyingFindings / s.totalFindings;
}

/** Consensus rate: fraction of non-merged findings with clear consensus. */
function consensusRate(s: AdvrevState): number {
  if (s.nonMergedFindings === 0) return 1;
  return s.consensusReached / s.nonMergedFindings;
}

// ── Method ──

/** M4_ADVREV — Adversarial Review Pipeline Method (v0.1, trial). 7 steps, linear DAG. */
export const M4_ADVREV: Method<AdvrevState> = {
  id: "M4-ADVREV",
  name: "Adversarial Review Pipeline Method",
  domain: D_ADVREV,
  roles: [orchestrator, productOwner],
  dag,
  objective: check("o_advrev", (s: AdvrevState) =>
    s.reviewReportComplete
    && s.actionPlanComplete
    && (!s.isDelegated || s.allMandatoryCovered)
    && s.findingsWithCitations >= s.totalFindings
    && (s.criticalHighTotal === 0 || s.criticalHighWithMitigations >= s.criticalHighTotal),
  ),
  measures: [
    {
      id: "mu_pipeline_progress",
      name: "Pipeline Progress",
      compute: pipelineProgress,
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_finding_quality",
      name: "Finding Quality",
      compute: findingQuality,
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_consensus_rate",
      name: "Consensus Rate",
      compute: consensusRate,
      range: [0, 1],
      terminal: 1,
    },
  ],
};
