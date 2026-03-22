/**
 * P1_EXEC — Execution Methodology.
 *
 * F1-FTH Definition 7.1: Phi = (D_Phi, delta_Phi, O_Phi)
 * Receives a user challenge and routes to the appropriate execution
 * method: M1-COUNCIL, M2-ORCH, M3-TMP, or M4-ADVREV.
 *
 * The transition function (delta_EXEC) evaluates driving predicates on
 * the challenge — adversarial_pressure_beneficial and
 * decomposable_before_execution — then selects the first matching arm
 * from a 5-arm priority stack.
 *
 * @see registry/P1-EXEC/P1-EXEC.yaml — the formal definition
 * @see theory/F1-FTH §7 — Methodology coalgebra
 */

import type { Methodology, Arm } from "../../methodology/methodology.js";
import type { DomainTheory } from "../../domain/domain-theory.js";
import { check } from "../../predicate/predicate.js";

// ── State type ──

/**
 * ExecState — the state P1-EXEC operates on.
 *
 * Tracks the routing lifecycle: challenge arrives, predicates are evaluated,
 * a method is selected, the method runs, and the result is returned.
 */
export type ExecState = {
  readonly challenge: string;
  readonly challengeType: "adversarial" | "decomposable" | "sequential" | "review" | null;
  readonly adversarialPressureBeneficial: boolean;
  readonly decomposableBeforeExecution: boolean;
  readonly selectedMethod: string | null;
  readonly result: string | null;
  readonly completed: boolean;
};

// ── Domain theory ──

/**
 * D_EXEC — the domain theory for P1-EXEC (F1-FTH Def 1.1).
 *
 * Sorts: Challenge, ChallengeProperties, MethodChoice, ExecutionResult, State
 * Key predicates: adversarial_pressure_beneficial, decomposable_before_execution,
 *   is_method_selected, method_completed
 * Axioms: totality of delta_EXEC, bounded invocation count, selection before completion
 */
export const D_EXEC: DomainTheory<ExecState> = {
  id: "D_EXEC",
  signature: {
    sorts: [
      { name: "Challenge", description: "The user's input challenge", cardinality: "singleton" },
      { name: "ChallengeProperties", description: "Evaluated properties relevant to method selection", cardinality: "singleton" },
      { name: "MethodChoice", description: "Selected execution method: COUNCIL, ORCH, TMP, ADVREV", cardinality: "finite" },
      { name: "ExecutionResult", description: "Terminal output produced by the selected method", cardinality: "singleton" },
      { name: "State", description: "Full execution state: challenge, properties, method_selected, result", cardinality: "singleton" },
    ],
    functionSymbols: [
      { name: "evaluate_properties", inputSorts: ["Challenge"], outputSort: "ChallengeProperties", totality: "total" },
      { name: "select_method", inputSorts: ["ChallengeProperties"], outputSort: "MethodChoice", totality: "total" },
      { name: "method_selected", inputSorts: ["State"], outputSort: "MethodChoice", totality: "total", description: "None before selection; Some(M) after delta_EXEC returns" },
      { name: "result_of", inputSorts: ["State"], outputSort: "ExecutionResult", totality: "total", description: "None until selected method completes" },
    ],
    predicates: {
      adversarial_pressure_beneficial: check<ExecState>(
        "adversarial_pressure_beneficial",
        (s) => s.adversarialPressureBeneficial,
      ),
      decomposable_before_execution: check<ExecState>(
        "decomposable_before_execution",
        (s) => s.decomposableBeforeExecution,
      ),
      is_method_selected: check<ExecState>(
        "is_method_selected",
        (s) => s.selectedMethod !== null,
      ),
      method_completed: check<ExecState>(
        "method_completed",
        (s) => s.completed,
      ),
    },
  },
  axioms: {
    // Ax-1: Totality of delta_EXEC — every challenge maps to exactly one method
    "Ax-1": check<ExecState>("totality_of_delta_exec", (s) =>
      // If no method selected yet, the routing predicates are exhaustive:
      // adversarial -> COUNCIL, decomposable -> ORCH, else -> TMP
      s.selectedMethod !== null || s.challenge.length > 0,
    ),
    // Ax-2: Bounded invocation count (at most 2 delta_EXEC firings per run)
    // Structural — verified via termination certificate, not runtime-checkable per-state
    "Ax-2": check<ExecState>("bounded_invocations", () => true),
    // Ax-3: Selection before completion
    "Ax-3": check<ExecState>("selection_before_completion", (s) =>
      !s.completed || s.selectedMethod !== null,
    ),
  },
};

// ── Transition arms ──

/**
 * Arm 1: adversarial_dispatch — adversarial pressure is beneficial.
 * Routes to M1-COUNCIL for structured multi-perspective debate.
 */
export const arm_adversarial_dispatch: Arm<ExecState> = {
  priority: 1,
  label: "adversarial_dispatch",
  condition: check<ExecState>(
    "not_selected_and_adversarial",
    (s) => s.selectedMethod === null && s.adversarialPressureBeneficial,
  ),
  selects: null, // M1-COUNCIL not yet ported — placeholder
  rationale:
    "Adversarial pressure is beneficial: uncertain framing, multiple defensible positions, " +
    "high-stakes preconditions, or silent assumption risk. Route to structured debate.",
};

/**
 * Arm 2: orchestration_dispatch — decomposable into parallel sub-tasks.
 * Routes to M2-ORCH for parallel orchestration.
 */
export const arm_orchestration_dispatch: Arm<ExecState> = {
  priority: 2,
  label: "orchestration_dispatch",
  condition: check<ExecState>(
    "not_selected_and_decomposable",
    (s) => s.selectedMethod === null && !s.adversarialPressureBeneficial && s.decomposableBeforeExecution,
  ),
  selects: null, // M2-ORCH not yet ported — placeholder
  rationale:
    "No adversarial need, but the challenge decomposes into independent parallel sub-tasks. " +
    "Route to parallel orchestration.",
};

/**
 * Arm 3: sequential_dispatch — default single-agent reasoning.
 * Routes to M3-TMP (zero-overhead baseline).
 */
export const arm_sequential_dispatch: Arm<ExecState> = {
  priority: 3,
  label: "sequential_dispatch",
  condition: check<ExecState>(
    "not_selected_and_sequential",
    (s) => s.selectedMethod === null && !s.adversarialPressureBeneficial && !s.decomposableBeforeExecution,
  ),
  selects: null, // M3-TMP not yet ported — placeholder
  rationale:
    "No adversarial need, not decomposable. Default: single-agent sequential reasoning. " +
    "M3-TMP is the zero-overhead baseline.",
};

/**
 * Arm 4: terminate — method completed, return result.
 */
export const arm_terminate: Arm<ExecState> = {
  priority: 4,
  label: "terminate",
  condition: check<ExecState>(
    "selected_and_completed",
    (s) => s.selectedMethod !== null && s.completed,
  ),
  selects: null, // Terminate — no method selected
  rationale: "Selected method has completed and produced a result. Methodology terminates.",
};

/**
 * Arm 5: executing — method is running, no re-evaluation.
 */
export const arm_executing: Arm<ExecState> = {
  priority: 5,
  label: "executing",
  condition: check<ExecState>(
    "selected_and_not_completed",
    (s) => s.selectedMethod !== null && !s.completed,
  ),
  selects: null, // No re-evaluation during execution
  rationale: "Method is running — no re-evaluation until completion.",
};

/** All 5 arms in priority order. */
export const EXEC_ARMS: readonly Arm<ExecState>[] = [
  arm_adversarial_dispatch,
  arm_orchestration_dispatch,
  arm_sequential_dispatch,
  arm_terminate,
  arm_executing,
];

// ── Methodology ──

/**
 * P1_EXEC — Execution Methodology.
 *
 * Evaluates the 5 transition arms in priority order to determine which
 * execution method (M1-COUNCIL, M2-ORCH, M3-TMP) to invoke, or terminates
 * if the selected method has completed.
 *
 * Termination certificate: nu(s) = 2 - |delta_EXEC invocations|.
 * At most 2 invocations: one for initial selection, one for ORCH-to-TMP fallback.
 */
export const P1_EXEC: Methodology<ExecState> = {
  id: "P1-EXEC",
  name: "Execution Methodology",
  domain: D_EXEC,
  arms: EXEC_ARMS,
  objective: check<ExecState>(
    "challenge_addressed",
    (s) => s.completed && s.result !== null,
  ),
  terminationCertificate: {
    measure: (s: ExecState) => {
      // nu(s) = 2 - invocations. Each selection reduces by 1.
      // Approximation: 0 if completed, 1 if method selected but not complete, 2 if not selected
      if (s.completed) return 0;
      if (s.selectedMethod !== null) return 1;
      return 2;
    },
    decreases:
      "delta_EXEC fires at most twice per run: once for initial selection (arms 1-3), " +
      "and at most once for the ORCH-to-TMP fallback. Each invocation reduces nu by 1.",
  },
  safety: {
    maxLoops: 10,
    maxTokens: 1_000_000,
    maxCostUsd: 50,
    maxDurationMs: 3_600_000,
    maxDepth: 3,
  },
};
