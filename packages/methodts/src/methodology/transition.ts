/**
 * Transition function evaluation — deterministic δ_Φ.
 *
 * Evaluates arms in priority order, returns the first match.
 * This replaces agent reasoning about routing.
 */

import type { Arm, Methodology } from "./methodology.js";
import type { Method } from "../method/method.js";
import { evaluateWithTrace, type EvalTrace } from "../predicate/evaluate.js";

/** Result of evaluating the transition function. */
export type TransitionResult<S> = {
  readonly firedArm: Arm<S> | null;
  readonly selectedMethod: Method<S> | null;
  readonly armTraces: readonly { readonly label: string; readonly trace: EvalTrace; readonly fired: boolean }[];
};

/** Result of a dry-run simulation over a sequence of states. */
export type SimulationResult<S> = {
  readonly selections: readonly TransitionResult<S>[];
  readonly terminatesAt: number | null;
  readonly methodSequence: readonly string[];
};

/**
 * Evaluate δ_Φ deterministically. Arms evaluated in strict priority order.
 * First arm whose condition holds wins. Zero tokens, zero cost.
 */
export function evaluateTransition<S>(methodology: Methodology<S>, state: S): TransitionResult<S> {
  const sorted = [...methodology.arms].sort((a, b) => a.priority - b.priority);
  const armTraces: TransitionResult<S>["armTraces"][number][] = [];
  let firedArm: Arm<S> | null = null;

  for (const arm of sorted) {
    const trace = evaluateWithTrace(arm.condition, state);
    const fired = trace.result && firedArm === null;
    armTraces.push({ label: arm.label, trace, fired });
    if (fired) {
      firedArm = arm;
    }
  }

  return { firedArm, selectedMethod: firedArm?.selects ?? null, armTraces };
}

/**
 * Dry-run δ_Φ over a sequence of hypothetical states.
 * Evaluates which method would be selected at each state.
 * Does NOT execute method steps. Zero tokens, zero cost.
 */
export function simulateRun<S>(methodology: Methodology<S>, states: S[]): SimulationResult<S> {
  const selections = states.map((s) => evaluateTransition(methodology, s));
  const terminatesAt = selections.findIndex((s) => s.selectedMethod === null);
  const methodSequence = selections
    .filter((s) => s.selectedMethod !== null)
    .map((s) => s.selectedMethod!.id);

  return {
    selections,
    terminatesAt: terminatesAt >= 0 ? terminatesAt : null,
    methodSequence,
  };
}
