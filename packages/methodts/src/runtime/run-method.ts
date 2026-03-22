/**
 * runMethod — Execute a method's step DAG in topological order.
 *
 * Takes a Method, an initial WorldState, and a StepExecutor (dependency injection).
 * Walks the DAG via topologicalOrder, executes each step, records before/after snapshots,
 * and evaluates the method objective at the end.
 *
 * @see F1-FTH Definition 6.1 — Method execution
 * @see PRD 021 §12.9 — MethodResult, StepResult
 */

import { Effect } from "effect";
import type { Method } from "../method/method.js";
import type { Step } from "../method/step.js";
import type { WorldState, Snapshot } from "../state/world-state.js";
import type { MethodResult, StepResult } from "./accumulator.js";
import { topologicalOrder } from "../method/dag.js";
import { evaluate } from "../predicate/evaluate.js";
import { AgentProvider } from "../provider/agent-provider.js";

/** Simplified step executor for runMethod — dependency injection for testability. */
export type StepExecutor<S> = (
  step: Step<S>,
  state: WorldState<S>,
) => Effect.Effect<WorldState<S>, RunMethodError, AgentProvider>;

/** Error produced by runMethod when a step fails. */
export type RunMethodError = {
  readonly _tag: "RunMethodError";
  readonly methodId: string;
  readonly stepId?: string;
  readonly message: string;
  readonly cause?: unknown;
};

/**
 * Run a method's step DAG in topological order.
 *
 * Uses the provided stepExecutor for each step (dependency injection for testability).
 * Records before/after snapshots per step and evaluates the method objective at the end.
 */
export function runMethod<S>(
  method: Method<S>,
  state: WorldState<S>,
  stepExecutor: StepExecutor<S>,
): Effect.Effect<MethodResult<S>, RunMethodError, AgentProvider> {
  return Effect.gen(function* () {
    const steps = topologicalOrder(method.dag);
    let currentState = state;
    const stepResults: StepResult<S>[] = [];

    for (const step of steps) {
      const before: Snapshot<S> = {
        state: currentState,
        sequence: stepResults.length * 2,
        timestamp: new Date(),
        delta: null,
        witnesses: [],
        metadata: { stepId: step.id, methodId: method.id },
      };

      const start = Date.now();
      const newState = yield* stepExecutor(step, currentState).pipe(
        Effect.mapError(
          (e): RunMethodError => ({
            _tag: "RunMethodError",
            methodId: method.id,
            stepId: step.id,
            message: e.message ?? "Step execution failed",
            cause: e,
          }),
        ),
      );
      const elapsed = Date.now() - start;

      const after: Snapshot<S> = {
        state: newState,
        sequence: stepResults.length * 2 + 1,
        timestamp: new Date(),
        delta: null,
        witnesses: [],
        metadata: { stepId: step.id, methodId: method.id },
      };

      stepResults.push({
        stepId: step.id,
        status: "completed",
        before,
        after,
        cost: { tokens: 0, usd: 0, duration_ms: elapsed },
        retries: 0,
        executionTag: step.execution.tag,
      });

      currentState = newState;
    }

    const objectiveMet = evaluate(method.objective, currentState.value);

    return {
      status: objectiveMet ? "completed" : "objective_not_met",
      finalState: currentState,
      stepResults,
      objectiveMet,
    } satisfies MethodResult<S>;
  });
}
