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
} from "@method/methodts";
import { silentProvider, SequenceProvider } from "../provider/recording-provider.js";
import type { Recording } from "../provider/recording-provider.js";

/** Result of running a step in isolation. */
export type StepHarnessResult<S> = {
  /** Whether the precondition was met. */
  readonly preconditionMet: boolean;
  /** Diagnostic trace for precondition evaluation. */
  readonly preconditionTrace: EvalTrace;
  /** Whether the postcondition was met (null if precondition failed or execution errored). */
  readonly postconditionMet: boolean | null;
  /** Diagnostic trace for postcondition evaluation (null if not evaluated). */
  readonly postconditionTrace: EvalTrace | null;
  /** The resulting state value (null if precondition failed or execution errored). */
  readonly state: S | null;
  /** Error message if execution failed. */
  readonly error: string | null;
  /** Agent recordings if agent responses were provided. */
  readonly recordings: Recording[];
};

export type StepHarnessOptions = {
  /** Agent responses for agent steps (consumed in order). */
  agentResponses?: AgentResult[];
};

/**
 * Run a single step in isolation. Handles all Effect boilerplate internally.
 *
 * For script steps, no configuration needed.
 * For agent steps, provide `agentResponses` in options.
 *
 * @example
 * ```ts
 * const result = await runStepIsolated(triageStep, STATES.detected);
 * expect(result.preconditionMet).toBe(true);
 * expect(result.postconditionMet).toBe(true);
 * expect(result.state!.status).toBe("triaged");
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
      preconditionMet: false,
      preconditionTrace,
      postconditionMet: null,
      postconditionTrace: null,
      state: null,
      error: null,
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
      preconditionMet: true,
      preconditionTrace,
      postconditionMet: null,
      postconditionTrace: null,
      state: null,
      error: errorMsg,
      recordings,
    };
  }

  const newValue = exit.right;

  // Evaluate postcondition
  const postconditionTrace = evaluateWithTrace(step.postcondition, newValue);
  return {
    preconditionMet: true,
    preconditionTrace,
    postconditionMet: postconditionTrace.result,
    postconditionTrace,
    state: newValue,
    error: null,
    recordings,
  };
}
