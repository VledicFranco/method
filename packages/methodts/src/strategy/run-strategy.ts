/**
 * runStrategy — Adaptive execution loop over methodology runs.
 *
 * Implements the strategy loop:
 *   1. Check safety bounds (maxLoops)
 *   2. Run the current methodology via runMethodology
 *   3. Evaluate strategy-level gates
 *   4. Call onComplete to get a StrategyDecision
 *   5. Act on the decision (done / rerun / switch / abort)
 *
 * The loop continues until a terminal decision or safety violation.
 *
 * @see PRD 021 — Strategy execution
 */

import { Effect } from "effect";
import type { StrategyController, StrategyResult } from "./controller.js";
import type { WorldState } from "../state/world-state.js";
import type { MethodologyResult } from "../runtime/accumulator.js";
import type { GateResult } from "../gate/gate.js";
import { runMethodology } from "../runtime/run-methodology.js";
import { AgentProvider } from "../provider/agent-provider.js";
import { initialAccumulator } from "../runtime/accumulator.js";
import type { GateError } from "../gate/gate.js";

/**
 * Execute a strategy: run a methodology in a loop with adaptive decisions.
 *
 * After each methodology run, the controller's onComplete callback decides
 * whether to accept, retry, switch methodologies, or abort.
 *
 * Safety bounds (maxLoops) are enforced at the strategy level.
 * Strategy-level gates are evaluated after each run.
 *
 * @param controller - The strategy controller with methodology, gates, and decision logic
 * @param initialState - Starting world state
 * @returns StrategyResult aggregating all runs
 */
export function runStrategy<S>(
  controller: StrategyController<S>,
  initialState: WorldState<S>,
): Effect.Effect<StrategyResult<S>, never, AgentProvider> {
  return Effect.gen(function* () {
    let state = initialState;
    let methodology = controller.methodology;
    const runs: MethodologyResult<S>[] = [];
    const allGateResults: GateResult<S>[] = [];
    let totalCost = 0;
    let loopCount = 0;

    while (true) {
      // Safety check — strategy-level maxLoops
      if (loopCount >= controller.safety.maxLoops) {
        return {
          status: "safety_violation" as const,
          finalState: state,
          runs,
          totalCostUsd: totalCost,
          totalLoops: loopCount,
          gateResults: allGateResults,
        };
      }

      // Run methodology — catch errors and convert to a failed result
      const result = yield* runMethodology(methodology, state).pipe(
        Effect.catchAll((e) =>
          Effect.succeed({
            status: "failed" as const,
            finalState: state,
            trace: { snapshots: [], initial: state, current: state },
            accumulator: initialAccumulator(),
          } satisfies MethodologyResult<S>),
        ),
      );

      runs.push(result);
      totalCost += result.accumulator.totalCostUsd;
      loopCount++;
      state = result.finalState;

      // Evaluate strategy-level gates (catch GateErrors as failed results)
      for (const gate of controller.gates) {
        const gateResult = yield* gate.evaluate(state.value).pipe(
          Effect.catchAll((gateErr: GateError) =>
            Effect.succeed({
              passed: false,
              witness: null,
              reason: gateErr.message,
              duration_ms: 0,
            } as GateResult<S>),
          ),
        );
        allGateResults.push(gateResult);
      }

      // Call the controller's decision function
      const decision = yield* controller.onComplete(result);

      switch (decision.tag) {
        case "done":
          return {
            status: result.status === "completed" ? ("completed" as const) : result.status,
            finalState: state,
            runs,
            totalCostUsd: totalCost,
            totalLoops: loopCount,
            gateResults: allGateResults,
          };
        case "rerun":
          if (decision.methodology) methodology = decision.methodology;
          if (decision.state) state = decision.state;
          continue;
        case "switch_methodology":
          methodology = decision.methodology;
          continue;
        case "abort":
          return {
            status: "aborted" as const,
            finalState: state,
            runs,
            totalCostUsd: totalCost,
            totalLoops: loopCount,
            gateResults: allGateResults,
          };
      }
    }
  });
}
