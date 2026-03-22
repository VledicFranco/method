/**
 * P2_SD — Software Delivery Methodology.
 *
 * F1-FTH Definition 7.1: Phi = (D_Phi, delta_Phi, O_Phi)
 * Routes software delivery challenges to the appropriate execution method
 * based on task type classification. 7 task types map to 7 methods covering
 * the full delivery loop: PRD sectioning, architecture refinement, planning,
 * implementation (single + parallel), review, and audit.
 *
 * @see registry/P2-SD/P2-SD.yaml — the compiled methodology spec
 * @see theory/F1-FTH §7 — Methodology coalgebra
 */

import type { Methodology, Arm } from "../../methodology/methodology.js";
import type { DomainTheory } from "../../domain/domain-theory.js";
import { check, and, not } from "../../predicate/predicate.js";

// ── SDState ──

/**
 * State type for P2-SD — Software Delivery methodology.
 *
 * Represents the routing state of a software delivery challenge.
 * P2-SD is a pure routing function — it classifies and dispatches,
 * it does not execute delivery work.
 */
export type SDState = {
  readonly taskType:
    | "prd_section"
    | "architecture"
    | "planning"
    | "implementation"
    | "parallel_impl"
    | "review"
    | "audit"
    | null;
  readonly multiTaskScope: boolean;
  readonly hasArchitectureDoc: boolean;
  readonly hasPRD: boolean;
  readonly phase: string | null;
  readonly deliverableReady: boolean;
  readonly completed: boolean;
};

// ── D_Phi_SD — Domain Theory ──

/**
 * D_Phi_SD — the domain theory for P2-SD (F1-FTH Def 1.1).
 *
 * Sorts: Challenge, TaskType, MethodID, ExecutionResult, State
 * Predicates: task_type checks, multi_task_scope, dispatched, method_completed
 * Axioms: task-type uniqueness, routing uniqueness/totality, selection ordering
 */
export const D_Phi_SD: DomainTheory<SDState> = {
  id: "D_Phi_SD",
  signature: {
    sorts: [
      { name: "Challenge", description: "The software delivery task presented to the methodology", cardinality: "singleton" },
      { name: "TaskType", description: "The category of delivery work being requested", cardinality: "finite" },
      { name: "MethodID", description: "Identifier for the selected method", cardinality: "finite" },
      { name: "ExecutionResult", description: "Terminal output produced by the selected method", cardinality: "singleton" },
      { name: "State", description: "Full execution state: { challenge, task_type, method_selected, result }", cardinality: "singleton" },
    ],
    functionSymbols: [
      { name: "classify", inputSorts: ["Challenge"], outputSort: "TaskType", totality: "total" },
      { name: "route", inputSorts: ["TaskType"], outputSort: "MethodID", totality: "total", description: "Maps task type to method (delta_SD core logic)" },
      { name: "method_selected", inputSorts: ["State"], outputSort: "MethodID", totality: "total" },
      { name: "result_of", inputSorts: ["State"], outputSort: "ExecutionResult", totality: "total" },
    ],
    predicates: {
      is_prd_section: check<SDState>("is_prd_section", (s) => s.taskType === "prd_section"),
      is_architecture: check<SDState>("is_architecture", (s) => s.taskType === "architecture"),
      is_planning: check<SDState>("is_planning", (s) => s.taskType === "planning"),
      is_implementation: check<SDState>("is_implementation", (s) => s.taskType === "implementation"),
      is_parallel_impl: check<SDState>("is_parallel_impl", (s) => s.taskType === "parallel_impl"),
      is_review: check<SDState>("is_review", (s) => s.taskType === "review"),
      is_audit: check<SDState>("is_audit", (s) => s.taskType === "audit"),
      multi_task_scope: check<SDState>("multi_task_scope", (s) => s.multiTaskScope),
      is_method_selected: check<SDState>("is_method_selected", (s) => s.taskType !== null),
      method_completed: check<SDState>("method_completed", (s) => s.completed),
      not_yet_selected: check<SDState>("not_yet_selected", (s) => !s.completed && s.taskType !== null),
    },
  },
  axioms: {
    // Ax-1: Each challenge has exactly one task type
    "Ax-1_task_type_uniqueness": check<SDState>("task_type_exists", (s) =>
      s.taskType !== null || s.completed),
    // Ax-4: Selection before completion
    "Ax-4_selection_before_completion": check<SDState>("selection_before_completion", (s) =>
      !s.completed || s.taskType !== null),
    // Ax-5: Single dispatch per invocation
    "Ax-5_single_dispatch": check<SDState>("single_dispatch", () => true),
  },
};

// ── Transition Arms (delta_SD) ──

/**
 * Arm 1: PRD sectioning — full PRD needs decomposition into plannable sections.
 * Routes to M7-PRDS.
 */
export const arm_section: Arm<SDState> = {
  priority: 1,
  label: "section",
  condition: and(
    not(check<SDState>("completed", (s) => s.completed)),
    check<SDState>("is_prd_section", (s) => s.taskType === "prd_section"),
  ),
  selects: null, // M7-PRDS not yet ported
  rationale: "Full PRD needs sectioning before any downstream work.",
};

/**
 * Arm 2: Architecture refinement — ArchDoc stale/missing for new requirements.
 * Routes to M6-ARFN.
 */
export const arm_architecture: Arm<SDState> = {
  priority: 2,
  label: "architecture",
  condition: and(
    not(check<SDState>("completed", (s) => s.completed)),
    check<SDState>("is_architecture", (s) => s.taskType === "architecture"),
  ),
  selects: null, // M6-ARFN not yet ported
  rationale: "Architecture refinement needed — ArchDoc is a prerequisite for planning and implementation.",
};

/**
 * Arm 3: Planning — PRDSection + ArchDoc ready, produce PhaseDoc.
 * Routes to M5-PLAN.
 */
export const arm_plan: Arm<SDState> = {
  priority: 3,
  label: "plan",
  condition: and(
    not(check<SDState>("completed", (s) => s.completed)),
    check<SDState>("is_planning", (s) => s.taskType === "planning"),
  ),
  selects: null, // M5-PLAN not yet ported
  rationale: "PRDSection + ArchDoc ready — produce PhaseDoc for implementation.",
};

/**
 * Arm 4: Orchestrated implementation — multi-task scope with parallel dispatch.
 * Routes to M5-ORCH (M2-DIMPL in YAML).
 */
export const arm_orchestrated_implement: Arm<SDState> = {
  priority: 4,
  label: "orchestrated_implement",
  condition: and(
    not(check<SDState>("completed", (s) => s.completed)),
    check<SDState>("is_parallel_impl", (s) => s.taskType === "parallel_impl"),
  ),
  selects: null, // M5-ORCH / M2-DIMPL not yet ported
  rationale: "Multi-task scope — parallel orchestration with quality gates.",
};

/**
 * Arm 5: Single implementation — default for implement challenges.
 * Routes to M4-IMPL (M1-IMPL in YAML).
 */
export const arm_implement: Arm<SDState> = {
  priority: 5,
  label: "implement",
  condition: and(
    not(check<SDState>("completed", (s) => s.completed)),
    check<SDState>("is_implementation", (s) => s.taskType === "implementation"),
  ),
  selects: null, // M4-IMPL / M1-IMPL not yet ported
  rationale: "Single-agent sequential implementation — default for implement challenges.",
};

/**
 * Arm 6: Phase review — post-implementation evaluation.
 * Routes to M6-PHRV (M3-PHRV in YAML).
 */
export const arm_review: Arm<SDState> = {
  priority: 6,
  label: "review",
  condition: and(
    not(check<SDState>("completed", (s) => s.completed)),
    check<SDState>("is_review", (s) => s.taskType === "review"),
  ),
  selects: null, // M6-PHRV / M3-PHRV not yet ported
  rationale: "Phase completed — post-implementation review.",
};

/**
 * Arm 7: Cross-phase drift audit.
 * Routes to M7-PRDS (M4-DDAG in YAML).
 */
export const arm_audit: Arm<SDState> = {
  priority: 7,
  label: "audit",
  condition: and(
    not(check<SDState>("completed", (s) => s.completed)),
    check<SDState>("is_audit", (s) => s.taskType === "audit"),
  ),
  selects: null, // M7-PRDS / M4-DDAG not yet ported
  rationale: "Cross-phase drift analysis.",
};

/**
 * Arm 8: Terminate — method selected and completed.
 * Returns None (no further method selection).
 */
export const arm_terminate: Arm<SDState> = {
  priority: 8,
  label: "terminate",
  condition: check<SDState>("completed", (s) => s.completed),
  selects: null,
  rationale: "Method completed — methodology terminates.",
};

/**
 * Arm 9: Executing — method selected but not yet completed.
 * No re-evaluation until completion.
 */
export const arm_executing: Arm<SDState> = {
  priority: 9,
  label: "executing",
  condition: and(
    check<SDState>("has_task_type", (s) => s.taskType !== null),
    not(check<SDState>("completed", (s) => s.completed)),
  ),
  selects: null,
  rationale: "Method is running — no re-evaluation until completion.",
};

/** All 9 arms in priority order. */
export const SD_ARMS: readonly Arm<SDState>[] = [
  arm_section,
  arm_architecture,
  arm_plan,
  arm_orchestrated_implement,
  arm_implement,
  arm_review,
  arm_audit,
  arm_terminate,
  arm_executing,
];

// ── P2_SD Methodology ──

/**
 * P2_SD — Software Delivery Methodology.
 *
 * Evaluates 9 transition arms in priority order to route software delivery
 * challenges to the appropriate execution method (M1-M7), or terminates
 * when the dispatched method completes.
 *
 * Termination certificate: delta_SD fires exactly once per challenge (Ax-5).
 * After the single invocation, a method is selected and executing (arms 8-9
 * return None). nu_SD decreases from 1 to 0.
 */
export const P2_SD: Methodology<SDState> = {
  id: "P2-SD",
  name: "Software Delivery Methodology",
  domain: D_Phi_SD,
  arms: SD_ARMS,
  objective: check<SDState>(
    "completed",
    (s) => s.completed === true,
  ),
  terminationCertificate: {
    measure: (s: SDState) => s.completed ? 0 : 1,
    decreases:
      "delta_SD fires exactly once per challenge. After dispatch, the selected method runs to completion. nu_SD decreases from 1 to 0.",
  },
  safety: {
    maxLoops: 20,
    maxTokens: 1_000_000,
    maxCostUsd: 50,
    maxDurationMs: 3_600_000,
    maxDepth: 3,
  },
};
