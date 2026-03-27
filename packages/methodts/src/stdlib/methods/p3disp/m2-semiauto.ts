/**
 * M2_SEMIAUTO — Selective Escalation Dispatch Method (M2-SEMIAUTO v1.0).
 *
 * 6 steps with a loop: Load and Route -> Initialize -> Execute Step ->
 * Validate -> Scope Check -> Loop or Complete (sigma_S6 -> sigma_S3 loop).
 *
 * Semi-autonomous dispatch method where the agent handles clear decisions autonomously
 * and escalates ambiguous or failed decisions to the human. Balances throughput with
 * safety through selective escalation triggers.
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

/** Semi-auto dispatch execution state — what M2-SEMIAUTO operates on. */
export type SemiautoState = {
  readonly targetMethodology: string;
  readonly autonomyMode: "SEMIAUTO";
  readonly routingClear: boolean;
  readonly selectedMethod: string | null;
  readonly sessionInitialized: boolean;
  readonly currentStep: string | null;
  readonly totalSteps: number;
  readonly stepsCompleted: number;
  readonly retryCount: number;
  readonly escalationCount: number;
  readonly decisionPointsEncountered: number;
  readonly scopeChangeDetected: boolean;
  readonly scopeMinor: boolean;
  readonly methodComplete: boolean;
  readonly sessionAborted: boolean;
};

// ── Domain Theory ──

/** D_SEMIAUTO — selective escalation dispatch domain theory. */
const D_SEMIAUTO: DomainTheory<SemiautoState> = {
  id: "D_SEMIAUTO",
  signature: {
    sorts: [
      { name: "EscalationTrigger", description: "Conditions that trigger escalation: BORDERLINE_ROUTING, VALIDATION_DOUBLE_FAIL, SCOPE_CHANGE_MAJOR", cardinality: "finite" },
      { name: "ScopeChange", description: "A detected scope change during step execution", cardinality: "unbounded" },
      { name: "ScopeSize", description: "MINOR: < 30 lines. MAJOR: >= 30 lines or touches files not in scope.", cardinality: "finite" },
    ],
    functionSymbols: [],
    predicates: {
      routing_clear: check<SemiautoState>("routing_clear", (s) => s.routingClear),
      scope_change_detected: check<SemiautoState>("scope_change_detected", (s) => s.scopeChangeDetected),
      scope_minor: check<SemiautoState>("scope_minor", (s) => s.scopeMinor),
      escalation_needed: check<SemiautoState>("escalation_needed", (s) => !s.routingClear || s.retryCount >= 1 || (s.scopeChangeDetected && !s.scopeMinor)),
      method_complete: check<SemiautoState>("method_complete", (s) => s.methodComplete),
      session_aborted: check<SemiautoState>("session_aborted", (s) => s.sessionAborted),
    },
  },
  axioms: {},
};

// ── Roles ──

const executor: Role<SemiautoState> = {
  id: "rho_executor",
  description: "The dispatch agent in semi-auto mode. Conditional authority: decides autonomously on clear cases, escalates on ambiguity.",
  observe: (s) => s,
  authorized: ["sigma_S1", "sigma_S2", "sigma_S3", "sigma_S4", "sigma_S5", "sigma_S6"],
  notAuthorized: [],
};

const productOwner: Role<SemiautoState> = {
  id: "rho_PO",
  description: "The human escalation authority. Consulted only when escalation triggers fire.",
  observe: (s) => s,
  authorized: ["sigma_S1", "sigma_S4", "sigma_S5"],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<SemiautoState>[] = [
  {
    id: "sigma_S1",
    name: "Load and Route",
    role: "rho_executor",
    precondition: check("target_identified", (s: SemiautoState) => s.targetMethodology.length > 0),
    postcondition: check("method_selected", (s: SemiautoState) => s.selectedMethod !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_S2",
    name: "Initialize",
    role: "rho_executor",
    precondition: check("method_selected", (s: SemiautoState) => s.selectedMethod !== null),
    postcondition: check("session_initialized", (s: SemiautoState) => s.sessionInitialized && s.currentStep !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_S3",
    name: "Execute Step",
    role: "rho_executor",
    precondition: check("step_ready", (s: SemiautoState) => s.sessionInitialized && s.currentStep !== null),
    postcondition: TRUE,
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_S4",
    name: "Validate",
    role: "rho_executor",
    precondition: TRUE,
    postcondition: TRUE,
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_S5",
    name: "Scope Check",
    role: "rho_executor",
    precondition: TRUE,
    postcondition: TRUE,
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_S6",
    name: "Loop or Complete",
    role: "rho_executor",
    precondition: TRUE,
    postcondition: check("loop_resolved", (s: SemiautoState) => s.methodComplete || s.sessionAborted || s.currentStep !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
];

// ── DAG ──

// StepDAG is acyclic by definition (F1-FTH §4). The loop (sigma_S6 → sigma_S3)
// was removed: iteration across multiple target-methodology steps is handled at
// the methodology level (P3-DISPATCH re-invokes M2-SEMIAUTO per step).
const dag: StepDAG<SemiautoState> = {
  steps,
  edges: [
    { from: "sigma_S1", to: "sigma_S2" },
    { from: "sigma_S2", to: "sigma_S3" },
    { from: "sigma_S3", to: "sigma_S4" },
    { from: "sigma_S4", to: "sigma_S5" },
    { from: "sigma_S5", to: "sigma_S6" },
  ],
  initial: "sigma_S1",
  terminal: "sigma_S6",
};

// ── Progress measure ──

/** Maps autonomous step completion progress to [0, 1]. */
function autonomousProgress(s: SemiautoState): number {
  if (s.totalSteps === 0) return 0;
  return s.stepsCompleted / s.totalSteps;
}

/** Maps escalation rate as an observational measure. */
function escalationRate(s: SemiautoState): number {
  if (s.decisionPointsEncountered === 0) return 0;
  return s.escalationCount / s.decisionPointsEncountered;
}

// ── Method ──

/** M2_SEMIAUTO — Selective Escalation Dispatch Method (v1.0). 6 steps, loop DAG. */
export const M2_SEMIAUTO: Method<SemiautoState> = {
  id: "M2-SEMIAUTO",
  name: "Selective Escalation Dispatch Method",
  domain: D_SEMIAUTO,
  roles: [executor, productOwner],
  dag,
  objective: check("o_semiauto", (s: SemiautoState) =>
    s.methodComplete || s.sessionAborted,
  ),
  measures: [
    {
      id: "mu_steps_completed",
      name: "Autonomous Progress",
      compute: autonomousProgress,
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_escalation_rate",
      name: "Escalation Rate",
      compute: escalationRate,
      range: [0, 1],
      terminal: 1,
    },
  ],
};
