/**
 * Step harness — run a single step in isolation without Effect ceremony.
 */

import { Effect } from "effect";
import {
  type Step,
  type AgentResult,
  AgentProvider,
  evaluateWithTrace,
  type EvalTrace,
} from "../../index.js";
import { silentProvider, SequenceProvider } from "../provider/recording-provider.js";
import type { Recording } from "../provider/recording-provider.js";

/** Discriminated union result of running a step in isolation. */
export type StepHarnessResult<S> =
  | {
      /** Precondition was not met — step did not execute. */
      readonly status: "precondition_failed";
      readonly preconditionTrace: EvalTrace;
      readonly recordings: Recording[];
    }
  | {
      /** Step executed successfully. */
      readonly status: "completed";
      readonly preconditionTrace: EvalTrace;
      readonly postconditionMet: boolean;
      readonly postconditionTrace: EvalTrace;
      readonly state: S;
      readonly recordings: Recording[];
    }
  | {
      /** Step execution failed with an expected error. */
      readonly status: "error";
      readonly preconditionTrace: EvalTrace;
      readonly error: string;
      readonly recordings: Recording[];
    };

export type StepHarnessOptions = {
  /** Agent responses for agent steps (consumed in order). */
  agentResponses?: AgentResult[];
};

/**
 * Run a single step in isolation. Handles all Effect boilerplate internally.
 *
 * Returns a discriminated union on `status`:
 * - `"precondition_failed"` — step was not executed
 * - `"completed"` — step ran, check `postconditionMet` and `state`
 * - `"error"` — step execution failed
 *
 * Effect defects (bugs) propagate as thrown exceptions to the test runner.
 *
 * @example
 * ```ts
 * const result = await runStepIsolated(triageStep, STATES.detected);
 * if (result.status === "completed") {
 *   expect(result.postconditionMet).toBe(true);
 *   expect(result.state.status).toBe("triaged");
 * }
 * ```
 */
export async function runStepIsolated<S>(
  step: Step<S>,
  stateValue: S,
  options?: StepHarnessOptions,
): Promise<StepHarnessResult<S>> {
  // Evaluate precondition
  const preconditionTrace = evaluateWithTrace(step.precondition, stateValue);
  if (!preconditionTrace.result) {
    return {
      status: "precondition_failed",
      preconditionTrace,
      recordings: [],
    };
  }

  // Build provider
  let recordings: Recording[] = [];
  let layer;
  if (options?.agentResponses) {
    const seq = SequenceProvider(options.agentResponses);
    layer = seq.layer;
    recordings = seq.recordings;
  } else {
    layer = silentProvider();
  }

  // Execute step based on type
  const exec = step.execution;

  // Build the execution effect
  let execEffect: Effect.Effect<S, unknown, never>;

  if (exec.tag === "script") {
    execEffect = exec.execute(stateValue) as unknown as Effect.Effect<S, unknown, never>;
  } else {
    // Agent step — use AgentProvider from the layer
    execEffect = Effect.gen(function* () {
      const provider = yield* AgentProvider;
      const ctx = {
        state: stateValue,
        world: {} as Record<string, string>,
        insights: {} as Record<string, string>,
        domainFacts: "",
      };
      const promptText = exec.prompt.run(ctx as any);
      const agentResult = yield* provider.execute({ prompt: promptText });
      return yield* exec.parse(agentResult.raw, stateValue);
    }).pipe(Effect.provide(layer)) as unknown as Effect.Effect<S, unknown, never>;
  }

  // Run with Effect.either to capture expected failures.
  // Effect defects (bugs) will propagate as thrown exceptions — this is intentional.
  const exit = await Effect.runPromise(Effect.either(execEffect));

  if (exit._tag === "Left") {
    // Expected failure — step execution errored
    const err = exit.left;
    const errorMsg = typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message)
      : JSON.stringify(err);
    return {
      status: "error",
      preconditionTrace,
      error: errorMsg,
      recordings,
    };
  }

  const newValue = exit.right;

  // Evaluate postcondition
  const postconditionTrace = evaluateWithTrace(step.postcondition, newValue);
  return {
    status: "completed",
    preconditionTrace,
    postconditionMet: postconditionTrace.result,
    postconditionTrace,
    state: newValue,
    recordings,
  };
}
