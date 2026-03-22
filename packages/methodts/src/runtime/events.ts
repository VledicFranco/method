/**
 * Runtime event union type.
 *
 * 19 named variants covering methodology lifecycle, method selection,
 * step execution, verification, safety, context assembly, and strategy
 * orchestration. Plus a `custom` escape hatch for extension.
 *
 * All events carry a `timestamp` and a discriminant `type` string.
 * The type parameter S flows through to events that reference WorldState.
 *
 * @see PRD 021 §12.5 — RuntimeEvent
 */

import type { WorldState } from "../state/world-state.js";

/** Runtime event — 20 variants covering methodology, method, step, verification, safety, context, strategy lifecycle. */
export type RuntimeEvent<S> =
  | { readonly type: "methodology_started"; readonly methodologyId: string; readonly initialState: WorldState<S>; readonly timestamp: Date }
  | { readonly type: "methodology_completed"; readonly status: "completed" | "safety_violation" | "failed" | "aborted"; readonly timestamp: Date }
  | { readonly type: "methodology_suspended"; readonly reason: string; readonly stepId: string; readonly timestamp: Date }
  | { readonly type: "methodology_resumed"; readonly resolution: string; readonly timestamp: Date }
  | { readonly type: "method_selected"; readonly arm: string; readonly methodId: string; readonly timestamp: Date }
  | { readonly type: "method_completed"; readonly methodId: string; readonly objectiveMet: boolean; readonly timestamp: Date }
  | { readonly type: "step_started"; readonly stepId: string; readonly executionTag: "agent" | "script"; readonly timestamp: Date }
  | { readonly type: "step_completed"; readonly stepId: string; readonly cost: { readonly tokens: number; readonly usd: number; readonly duration_ms: number }; readonly timestamp: Date }
  | { readonly type: "step_retried"; readonly stepId: string; readonly attempt: number; readonly feedback: string; readonly timestamp: Date }
  | { readonly type: "gate_evaluated"; readonly gateId: string; readonly passed: boolean; readonly timestamp: Date }
  | { readonly type: "axiom_validated"; readonly valid: boolean; readonly violations: readonly string[]; readonly timestamp: Date }
  | { readonly type: "safety_checked"; readonly safe: boolean; readonly timestamp: Date }
  | { readonly type: "safety_warning"; readonly bound: string; readonly usage: number; readonly limit: number; readonly timestamp: Date }
  | { readonly type: "insight_produced"; readonly key: string; readonly stepId: string; readonly preview: string; readonly timestamp: Date }
  | { readonly type: "context_assembled"; readonly stepId: string; readonly channels: readonly string[]; readonly tokenEstimate: number; readonly timestamp: Date }
  | { readonly type: "strategy_loop"; readonly iteration: number; readonly methodologyId: string; readonly timestamp: Date }
  | { readonly type: "strategy_decision"; readonly decision: string; readonly timestamp: Date }
  | { readonly type: "strategy_completed"; readonly status: string; readonly timestamp: Date }
  | { readonly type: "custom"; readonly name: string; readonly payload: unknown; readonly timestamp: Date };
