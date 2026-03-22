/**
 * Suspension, resolution, and suspended-state types.
 *
 * When the runtime yields control (gate review, error, safety warning,
 * human decision, etc.), it produces a SuspendedMethodology snapshot.
 * The caller inspects the reason and provides a Resolution to resume.
 *
 * @see PRD 021 §12.1 — SuspendedMethodology, SuspensionReason, Resolution
 */

import type { WorldState, StateTrace } from "../state/world-state.js";
import type { RuntimeError } from "./errors.js";
import type { ExecutionAccumulatorState } from "./accumulator.js";

// ── Suspension reasons ──

/** Why the runtime suspended. Tagged union with 9 variants. */
export type SuspensionReason<S> =
  | { readonly tag: "gate_review"; readonly gateId: string; readonly passed: boolean; readonly stepId: string }
  | { readonly tag: "checklist_review"; readonly lowConfidence: readonly string[] }
  | { readonly tag: "error"; readonly error: RuntimeError; readonly stepId: string }
  | { readonly tag: "safety_warning"; readonly bound: string; readonly usage: number; readonly limit: number }
  | { readonly tag: "scheduled_halt"; readonly trigger: string }
  | { readonly tag: "checkpoint"; readonly stepId: string }
  | { readonly tag: "human_decision"; readonly question: string; readonly options: readonly string[] }
  | { readonly tag: "method_boundary"; readonly completedMethod: string; readonly nextArm: string | null }
  | { readonly tag: "methodology_complete" };

// ── Resolutions ──

/** What the caller provides to resume execution. Tagged union with 6 variants. */
export type Resolution<S> =
  | { readonly tag: "continue" }
  | { readonly tag: "provide_value"; readonly value: Partial<S> }
  | { readonly tag: "rerun_step" }
  | { readonly tag: "rerun_step_with"; readonly state: S }
  | { readonly tag: "skip_step" }
  | { readonly tag: "abort"; readonly reason: string };

// ── Suspended state ──

/** The suspended state yielded by the runtime. Captures everything needed to resume. */
export type SuspendedMethodology<S> = {
  readonly reason: SuspensionReason<S>;
  readonly state: WorldState<S>;
  readonly trace: StateTrace<S>;
  readonly accumulator: ExecutionAccumulatorState;
  readonly insightStore: Readonly<Record<string, string>>;
  readonly position: {
    readonly methodologyId: string;
    readonly methodId: string;
    readonly stepId: string;
    readonly stepIndex: number;
    readonly retryCount: number;
  };
};
