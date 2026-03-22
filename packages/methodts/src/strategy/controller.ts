/**
 * StrategyController — Adaptive strategy layer types.
 *
 * A StrategyController wraps a methodology with decision logic:
 * after each run completes, the onComplete callback decides whether
 * to accept the result, rerun, switch methodologies, or abort.
 *
 * @see PRD 021 — Strategy layer for multi-run methodology orchestration
 */

import type { Effect } from "effect";
import type { Methodology, SafetyBounds } from "../methodology/methodology.js";
import type { MethodologyResult } from "../runtime/accumulator.js";
import type { WorldState } from "../state/world-state.js";
import type { Gate, GateResult } from "../gate/gate.js";

/**
 * Decision returned by onComplete after a methodology run.
 *
 * - done: accept this result as the final outcome
 * - rerun: re-execute (optionally with a different methodology or state)
 * - switch_methodology: swap to a different methodology for the next loop
 * - abort: terminate immediately with an abort reason
 */
export type StrategyDecision<S> =
  | { readonly tag: "done"; readonly result: MethodologyResult<S> }
  | { readonly tag: "rerun"; readonly methodology?: Methodology<S>; readonly state?: WorldState<S> }
  | { readonly tag: "switch_methodology"; readonly methodology: Methodology<S> }
  | { readonly tag: "abort"; readonly reason: string };

/**
 * Final result of a strategy execution.
 *
 * Aggregates all methodology runs, gate results, and cost tracking.
 */
export type StrategyResult<S> = {
  readonly status: "completed" | "failed" | "aborted" | "safety_violation";
  readonly finalState: WorldState<S>;
  readonly runs: readonly MethodologyResult<S>[];
  readonly totalCostUsd: number;
  readonly totalLoops: number;
  readonly gateResults: readonly GateResult<S>[];
};

/**
 * A strategy controller — wraps a methodology with adaptive decision logic.
 *
 * The controller's onComplete callback is invoked after each methodology run
 * and returns a StrategyDecision determining what happens next.
 */
export type StrategyController<S> = {
  readonly id: string;
  readonly name: string;
  readonly methodology: Methodology<S>;
  readonly gates: readonly Gate<S>[];
  readonly onComplete: (result: MethodologyResult<S>) => Effect.Effect<StrategyDecision<S>, never, never>;
  readonly safety: SafetyBounds;
};
