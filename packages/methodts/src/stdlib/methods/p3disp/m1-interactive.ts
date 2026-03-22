/**
 * M1_INTERACTIVE — Human-in-the-Loop Dispatch Method (M1-INTERACTIVE v1.0).
 *
 * 5 steps with a loop: Load Target Methodology -> Initialize Method Session ->
 * Execute Step -> Validate and Decide -> Loop or Complete (sigma_I5 -> sigma_I3 loop).
 *
 * Interactive dispatch method where the human confirms every decision point. The agent
 * executes methodology steps by spawning sub-agents but defers all routing, approval,
 * and failure-handling decisions to the human.
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

/** Interactive dispatch execution state — what M1-INTERACTIVE operates on. */
export type InteractiveState = {
  readonly targetMethodology: string;
  readonly autonomyMode: "INTERACTIVE";
  readonly routingConfirmed: boolean;
  readonly selectedMethod: string | null;
  readonly sessionInitialized: boolean;
  readonly currentStep: string | null;
  readonly totalSteps: number;
  readonly stepsConfirmed: number;
  readonly humanDecision: "ADVANCE" | "RETRY" | "ABORT" | null;
  readonly methodComplete: boolean;
  readonly sessionAborted: boolean;
};

// ── Domain Theory ──

/** D_INTERACTIVE — human-in-the-loop dispatch domain theory. */
const D_INTERACTIVE: DomainTheory<InteractiveState> = {
  id: "D_INTERACTIVE",
  signature: {
    sorts: [
      { name: "HumanDecision", description: "The human's decision after reviewing a step output: ADVANCE, RETRY, ABORT", cardinality: "finite" },
      { name: "RoutingConfirmation", description: "Human confirms or overrides the suggested method routing: CONFIRMED, OVERRIDE", cardinality: "finite" },
    ],
    functionSymbols: [],
    predicates: {
      human_confirmed: check<InteractiveState>("human_confirmed", (s) => s.stepsConfirmed > 0),
      routing_confirmed: check<InteractiveState>("routing_confirmed", (s) => s.routingConfirmed),
      method_complete: check<InteractiveState>("method_complete", (s) => s.methodComplete),
      session_aborted: check<InteractiveState>("session_aborted", (s) => s.sessionAborted),
    },
  },
  axioms: {},
};

// ── Roles ──

const executor: Role<InteractiveState> = {
  id: "rho_executor",
  description: "The dispatch agent in interactive mode. Executes mechanical work but makes no decisions.",
  observe: (s) => s,
  authorized: ["sigma_I1", "sigma_I2", "sigma_I3", "sigma_I5"],
  notAuthorized: [],
};

const productOwner: Role<InteractiveState> = {
  id: "rho_PO",
  description: "The human decision-maker. Consulted at every decision point.",
  observe: (s) => s,
  authorized: ["sigma_I4"],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<InteractiveState>[] = [
  {
    id: "sigma_I1",
    name: "Load Target Methodology",
    role: "rho_executor",
    precondition: check("target_identified", (s: InteractiveState) => s.targetMethodology.length > 0),
    postcondition: check("routing_confirmed", (s: InteractiveState) => s.routingConfirmed && s.selectedMethod !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_I2",
    name: "Initialize Method Session",
    role: "rho_executor",
    precondition: check("routing_confirmed", (s: InteractiveState) => s.routingConfirmed && s.selectedMethod !== null),
    postcondition: check("session_initialized", (s: InteractiveState) => s.sessionInitialized && s.currentStep !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_I3",
    name: "Execute Step",
    role: "rho_executor",
    precondition: check("step_ready", (s: InteractiveState) => s.sessionInitialized && s.currentStep !== null),
    postcondition: TRUE,
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_I4",
    name: "Validate and Decide",
    role: "rho_PO",
    precondition: TRUE,
    postcondition: check("human_decided", (s: InteractiveState) => s.humanDecision !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_I5",
    name: "Loop or Complete",
    role: "rho_executor",
    precondition: check("human_decided", (s: InteractiveState) => s.humanDecision !== null),
    postcondition: check("loop_resolved", (s: InteractiveState) => s.methodComplete || s.sessionAborted || s.currentStep !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
];

// ── DAG ──

const dag: StepDAG<InteractiveState> = {
  steps,
  edges: [
    { from: "sigma_I1", to: "sigma_I2" },
    { from: "sigma_I2", to: "sigma_I3" },
    { from: "sigma_I3", to: "sigma_I4" },
    { from: "sigma_I4", to: "sigma_I5" },
    { from: "sigma_I5", to: "sigma_I3" },
  ],
  initial: "sigma_I1",
  terminal: "sigma_I5",
};

// ── Progress measure ──

/** Maps human-confirmed step progress to [0, 1]. */
function humanConfirmedSteps(s: InteractiveState): number {
  if (s.totalSteps === 0) return 0;
  return s.stepsConfirmed / s.totalSteps;
}

// ── Method ──

/** M1_INTERACTIVE — Human-in-the-Loop Dispatch Method (v1.0). 5 steps, loop DAG. */
export const M1_INTERACTIVE: Method<InteractiveState> = {
  id: "M1-INTERACTIVE",
  name: "Human-in-the-Loop Dispatch Method",
  domain: D_INTERACTIVE,
  roles: [executor, productOwner],
  dag,
  objective: check("o_interactive", (s: InteractiveState) =>
    (s.methodComplete && s.stepsConfirmed === s.totalSteps) || s.sessionAborted,
  ),
  measures: [
    {
      id: "mu_steps_confirmed",
      name: "Human Confirmed Steps",
      compute: humanConfirmedSteps,
      range: [0, 1],
      terminal: 1,
    },
  ],
};
