/**
 * M3_FULLAUTO — Unattended Dispatch Method (M3-FULLAUTO v1.0).
 *
 * 6 steps with a loop: Load and Route -> Initialize -> Execute Step ->
 * Validate and Retry -> Budget Check -> Loop or Complete (sigma_F6 -> sigma_F3 loop).
 *
 * Fully autonomous dispatch method where the agent has full decision authority. The human
 * is notified on completion or hard failure but is not consulted during execution. Bounded
 * by a retry budget that prevents unbounded failure loops.
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

/** Full-auto dispatch execution state — what M3-FULLAUTO operates on. */
export type FullautoState = {
  readonly targetMethodology: string;
  readonly autonomyMode: "FULLAUTO";
  readonly selectedMethod: string | null;
  readonly ambiguityNoted: boolean;
  readonly sessionInitialized: boolean;
  readonly currentStep: string | null;
  readonly totalSteps: number;
  readonly stepsCompleted: number;
  readonly retryCount: number;
  readonly maxRetries: number;
  readonly retriesExhausted: boolean;
  readonly abortTriggered: boolean;
  readonly failureLogSent: boolean;
  readonly methodComplete: boolean;
  readonly notificationSent: boolean;
};

// ── Domain Theory ──

/** D_FULLAUTO — unattended dispatch domain theory. */
const D_FULLAUTO: DomainTheory<FullautoState> = {
  id: "D_FULLAUTO",
  signature: {
    sorts: [
      { name: "FailureLog", description: "Cumulative log of failures across all retry attempts", cardinality: "singleton" },
      { name: "RetryContext", description: "Enriched context for a retry attempt, including prior failure information", cardinality: "unbounded" },
    ],
    functionSymbols: [],
    predicates: {
      retries_exhausted: check<FullautoState>("retries_exhausted", (s) => s.retriesExhausted),
      abort_triggered: check<FullautoState>("abort_triggered", (s) => s.abortTriggered),
      method_complete: check<FullautoState>("method_complete", (s) => s.methodComplete),
      failure_log_sent: check<FullautoState>("failure_log_sent", (s) => s.failureLogSent),
    },
  },
  axioms: {},
};

// ── Roles ──

const executor: Role<FullautoState> = {
  id: "rho_executor",
  description: "The dispatch agent in full-auto mode. Full authority over all decisions, bounded by retry budget.",
  observe: (s) => s,
  authorized: ["sigma_F1", "sigma_F2", "sigma_F3", "sigma_F4", "sigma_F5", "sigma_F6"],
  notAuthorized: [],
};

const observer: Role<FullautoState> = {
  id: "rho_observer",
  description: "The human in full-auto mode. Receives completion/failure notifications. Not consulted during execution.",
  observe: (s) => s,
  authorized: [],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<FullautoState>[] = [
  {
    id: "sigma_F1",
    name: "Load and Route",
    role: "rho_executor",
    precondition: check("target_identified", (s: FullautoState) => s.targetMethodology.length > 0),
    postcondition: check("method_selected", (s: FullautoState) => s.selectedMethod !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_F2",
    name: "Initialize",
    role: "rho_executor",
    precondition: check("method_selected", (s: FullautoState) => s.selectedMethod !== null),
    postcondition: check("session_initialized", (s: FullautoState) => s.sessionInitialized && s.currentStep !== null && s.maxRetries >= 1),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_F3",
    name: "Execute Step",
    role: "rho_executor",
    precondition: check("step_ready", (s: FullautoState) => s.sessionInitialized && s.currentStep !== null),
    postcondition: TRUE,
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_F4",
    name: "Validate and Retry",
    role: "rho_executor",
    precondition: TRUE,
    postcondition: TRUE,
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_F5",
    name: "Budget Check",
    role: "rho_executor",
    precondition: TRUE,
    postcondition: TRUE,
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_F6",
    name: "Loop or Complete",
    role: "rho_executor",
    precondition: check("budget_ok", (s: FullautoState) => !s.abortTriggered),
    postcondition: check("loop_resolved", (s: FullautoState) => s.methodComplete || s.currentStep !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
];

// ── DAG ──

// StepDAG is acyclic by definition (F1-FTH §4). The loop (sigma_F6 → sigma_F3)
// was removed: iteration across multiple target-methodology steps is handled at
// the methodology level (P3-DISPATCH re-invokes M3-FULLAUTO per step).
const dag: StepDAG<FullautoState> = {
  steps,
  edges: [
    { from: "sigma_F1", to: "sigma_F2" },
    { from: "sigma_F2", to: "sigma_F3" },
    { from: "sigma_F3", to: "sigma_F4" },
    { from: "sigma_F4", to: "sigma_F5" },
    { from: "sigma_F5", to: "sigma_F6" },
  ],
  initial: "sigma_F1",
  terminal: "sigma_F6",
};

// ── Progress measure ──

/** Maps autonomous step completion progress to [0, 1]. */
function autonomousProgress(s: FullautoState): number {
  if (s.totalSteps === 0) return 0;
  return s.stepsCompleted / s.totalSteps;
}

/** Maps retry budget consumption as an observational measure. */
function retryBudgetConsumption(s: FullautoState): number {
  if (s.totalSteps === 0 || s.maxRetries === 0) return 0;
  return s.retryCount / (s.totalSteps * s.maxRetries);
}

// ── Method ──

/** M3_FULLAUTO — Unattended Dispatch Method (v1.0). 6 steps, loop DAG. */
export const M3_FULLAUTO: Method<FullautoState> = {
  id: "M3-FULLAUTO",
  name: "Unattended Dispatch Method",
  domain: D_FULLAUTO,
  roles: [executor, observer],
  dag,
  objective: check("o_fullauto", (s: FullautoState) =>
    s.methodComplete || (s.abortTriggered && s.failureLogSent),
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
      id: "mu_retry_usage",
      name: "Retry Budget Consumption",
      compute: retryBudgetConsumption,
      range: [0, 1],
      terminal: 1,
    },
  ],
};
