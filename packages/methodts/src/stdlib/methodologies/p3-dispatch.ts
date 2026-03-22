/**
 * P3_DISPATCH — Dispatch Methodology.
 *
 * F1-FTH Definition 7.1: Phi = (D_Phi, delta_Phi, O_Phi)
 * Autonomy-aware orchestration of methodology execution. Given a target
 * methodology and a human-specified autonomy mode, P3-DISPATCH routes to
 * the appropriate dispatch method: M1-INTERACTIVE, M2-SEMIAUTO, or
 * M3-FULLAUTO.
 *
 * The transition function (delta_DISPATCH) is a direct map — the three
 * autonomy modes are mutually exclusive and exhaustive. No priority
 * ordering needed.
 *
 * @see registry/P3-DISPATCH/P3-DISPATCH.yaml — the formal definition
 * @see theory/F1-FTH §7 — Methodology coalgebra
 */

import type { Methodology, Arm } from "../../methodology/methodology.js";
import type { Method } from "../../method/method.js";
import { M1_INTERACTIVE } from "../methods/p3disp/m1-interactive.js";
import { M2_SEMIAUTO } from "../methods/p3disp/m2-semiauto.js";
import { M3_FULLAUTO } from "../methods/p3disp/m3-fullauto.js";
import type { DomainTheory } from "../../domain/domain-theory.js";
import { check, or } from "../../predicate/predicate.js";

// ── State type ──

/**
 * DispatchState — the state P3-DISPATCH operates on.
 *
 * Tracks the dispatch lifecycle: target methodology identified, autonomy
 * mode set, dispatch method selected, target objective evaluated.
 */
export type DispatchState = {
  readonly targetMethodology: string;
  readonly targetMethod: string | null;
  readonly autonomyMode: "INTERACTIVE" | "SEMIAUTO" | "FULLAUTO";
  readonly targetObjectiveMet: boolean;
  readonly sessionAborted: boolean;
  readonly completed: boolean;
};

// ── Domain theory ──

/**
 * D_DISPATCH — the domain theory for P3-DISPATCH (F1-FTH Def 1.1).
 *
 * Sorts: TargetMethodology, TargetMethod, AutonomyMode, DecisionPoint,
 *   EscalationChannel, AgentSession, StepOutput, ValidationResult
 * Key predicates: requires_human, within_budget, validated,
 *   target_objective_met, budget_exhausted, session_aborted
 * Axioms: interactive requires human for all decisions, full auto requires
 *   human for no decisions, budget bound, validation soundness
 */
export const D_DISPATCH: DomainTheory<DispatchState> = {
  id: "D_Phi_DISPATCH",
  signature: {
    sorts: [
      { name: "TargetMethodology", description: "The methodology being executed (e.g., P2-SD)", cardinality: "singleton" },
      { name: "TargetMethod", description: "The method selected by delta_Phi of the target (e.g., M1-IMPL)", cardinality: "singleton" },
      { name: "AutonomyMode", description: "The autonomy level: INTERACTIVE, SEMIAUTO, FULLAUTO", cardinality: "finite" },
      { name: "DecisionPoint", description: "A point during execution requiring human or agent judgment", cardinality: "unbounded" },
      { name: "EscalationChannel", description: "How to reach the human: TERMINAL, SLACK, ASYNC_REVIEW", cardinality: "finite" },
      { name: "AgentSession", description: "A spawned Claude Code agent executing a method step", cardinality: "unbounded" },
      { name: "StepOutput", description: "The result produced by an agent for a step", cardinality: "unbounded" },
      { name: "ValidationResult", description: "Result of postcondition checking: PASS or FAIL", cardinality: "finite" },
    ],
    functionSymbols: [
      { name: "autonomy_mode", inputSorts: ["State"], outputSort: "AutonomyMode", totality: "total", description: "Returns the autonomy mode set at initialization" },
      { name: "retry_count", inputSorts: ["AgentSession"], outputSort: "AutonomyMode", totality: "total", description: "Number of retries attempted for this session's current step" },
      { name: "max_retries", inputSorts: ["AutonomyMode"], outputSort: "AutonomyMode", totality: "total", description: "Maximum retry budget for the given autonomy mode" },
      { name: "step_validate", inputSorts: ["StepOutput"], outputSort: "ValidationResult", totality: "total", description: "Validates a step's output against its postconditions" },
    ],
    predicates: {
      is_interactive: check<DispatchState>("is_interactive", (s) => s.autonomyMode === "INTERACTIVE"),
      is_semiauto: check<DispatchState>("is_semiauto", (s) => s.autonomyMode === "SEMIAUTO"),
      is_fullauto: check<DispatchState>("is_fullauto", (s) => s.autonomyMode === "FULLAUTO"),
      target_objective_met: check<DispatchState>("target_objective_met", (s) => s.targetObjectiveMet),
      session_aborted: check<DispatchState>("session_aborted", (s) => s.sessionAborted),
    },
  },
  axioms: {
    // Ax-D1: Interactive requires human for all decisions
    "Ax-D1_interactive_all_human": check<DispatchState>("interactive_all_human", () => true),
    // Ax-D2: Full auto requires human for no decisions
    "Ax-D2_fullauto_no_human": check<DispatchState>("fullauto_no_human", () => true),
    // Ax-D3: Budget bound — within_budget iff retry_count < max_retries
    "Ax-D3_budget_bound": check<DispatchState>("budget_bound", () => true),
    // Ax-D4: Validation soundness — validated iff step_validate = PASS
    "Ax-D4_validation_soundness": check<DispatchState>("validation_soundness", () => true),
  },
};

// ── Transition arms ──

/**
 * Arm 1: interactive — human wants full control over every decision point.
 * Routes to M1-INTERACTIVE.
 */
export const arm_interactive: Arm<DispatchState> = {
  priority: 1,
  label: "interactive",
  condition: check<DispatchState>("is_interactive", (s) => s.autonomyMode === "INTERACTIVE"),
  selects: M1_INTERACTIVE as unknown as Method<DispatchState>,
  rationale: "Human wants full control over every decision point.",
};

/**
 * Arm 2: semiauto — human wants selective escalation.
 * Routes to M2-SEMIAUTO.
 */
export const arm_semiauto: Arm<DispatchState> = {
  priority: 2,
  label: "semiauto",
  condition: check<DispatchState>("is_semiauto", (s) => s.autonomyMode === "SEMIAUTO"),
  selects: M2_SEMIAUTO as unknown as Method<DispatchState>,
  rationale: "Human wants selective escalation — clear decisions delegated, ambiguous ones escalated.",
};

/**
 * Arm 3: fullauto — human wants unattended execution.
 * Routes to M3-FULLAUTO.
 */
export const arm_fullauto: Arm<DispatchState> = {
  priority: 3,
  label: "fullauto",
  condition: check<DispatchState>("is_fullauto", (s) => s.autonomyMode === "FULLAUTO"),
  selects: M3_FULLAUTO as unknown as Method<DispatchState>,
  rationale: "Human wants unattended execution — agent has full authority.",
};

/** All 3 arms in priority order. */
export const DISPATCH_ARMS: readonly Arm<DispatchState>[] = [
  arm_interactive,
  arm_semiauto,
  arm_fullauto,
];

// ── Methodology ──

/**
 * P3_DISPATCH — Dispatch Methodology.
 *
 * Evaluates 3 transition arms via direct map (autonomy mode) to route
 * methodology execution to the appropriate dispatch method. The three
 * modes are mutually exclusive and exhaustive.
 *
 * Termination certificate: wraps the target methodology's own termination
 * certificate. P3-DISPATCH terminates when the target terminates or when
 * the session is aborted.
 */
export const P3_DISPATCH: Methodology<DispatchState> = {
  id: "P3-DISPATCH",
  name: "Dispatch Methodology",
  domain: D_DISPATCH,
  arms: DISPATCH_ARMS,
  objective: or(
    check<DispatchState>("target_objective_met", (s) => s.targetObjectiveMet),
    check<DispatchState>("session_aborted", (s) => s.sessionAborted),
  ),
  terminationCertificate: {
    measure: (s: DispatchState) => {
      if (s.targetObjectiveMet || s.sessionAborted) return 0;
      return 1;
    },
    decreases:
      "nu_DISPATCH wraps nu_target — inherits from target methodology. " +
      "P3-DISPATCH terminates when the target methodology terminates (objective met) or when " +
      "the dispatch session is aborted (budget exhaustion or human termination).",
  },
  safety: {
    maxLoops: 100,
    maxTokens: 5_000_000,
    maxCostUsd: 200,
    maxDurationMs: 14_400_000,
    maxDepth: 5,
  },
};
