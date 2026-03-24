/**
 * Method and methodology harnesses — run in isolation with zero Effect ceremony.
 */

import { Effect, Layer } from "effect";
import {
  type Method,
  type Methodology,
  type Step,
  type WorldState,
  type AgentResult,
  type MethodResult,
  type MethodologyResult,
  type RunMethodError,
  evaluate,
  validateAxioms,
  runMethod,
  runMethodology,
  AgentProvider,
} from "../../index.js";
import { silentProvider, SequenceProvider } from "../provider/recording-provider.js";
import type { Recording, RecordingProviderResult } from "../provider/recording-provider.js";

export type MethodHarnessOptions = {
  /** Agent responses for agent steps (consumed in order). */
  agentResponses?: AgentResult[];
  /** Pre-configured provider layer (overrides agentResponses). */
  provider?: RecordingProviderResult;
};

/**
 * Run a full methodology in isolation. Handles Effect.provide + runPromise.
 *
 * For script-only methodologies, no options needed.
 * For agent steps, provide `agentResponses` or a `provider`.
 *
 * @example
 * ```ts
 * const result = await runMethodologyIsolated(methodology, worldState(initial));
 * expect(result.status).toBe("completed");
 * expect(result.accumulator.loopCount).toBe(4);
 * ```
 */
export async function runMethodologyIsolated<S>(
  methodology: Methodology<S>,
  initialState: WorldState<S>,
  options?: MethodHarnessOptions,
): Promise<MethodologyResult<S>> {
  const { layer } = resolveProvider(options);

  const effect = runMethodology(methodology, initialState).pipe(
    Effect.provide(layer),
  );

  return Effect.runPromise(effect);
}

/**
 * Run a method in isolation with the same step executor semantics as runMethodology.
 * Includes axiom validation and postcondition checking for parity with the real runtime.
 *
 * @example
 * ```ts
 * const result = await runMethodIsolated(M_TRIAGE, worldState(STATES.detected));
 * expect(result.objectiveMet).toBe(true);
 * ```
 */
export async function runMethodIsolated<S>(
  method: Method<S>,
  initialState: WorldState<S>,
  options?: MethodHarnessOptions,
): Promise<MethodResult<S>> {
  const { layer } = resolveProvider(options);

  const stepExecutor = buildStepExecutor<S>(method);

  const effect = runMethod(method, initialState, stepExecutor).pipe(
    Effect.provide(layer),
  );

  return Effect.runPromise(effect);
}

/**
 * Build a step executor that matches runMethodology's behavior:
 * 1. Execute step (script or agent)
 * 2. Validate domain axioms on new state
 * 3. Validate postcondition on new state
 */
function buildStepExecutor<S>(
  method: Method<S>,
): (step: Step<S>, state: WorldState<S>) => Effect.Effect<WorldState<S>, RunMethodError, AgentProvider> {
  return (step: Step<S>, stepState: WorldState<S>) => {
    const exec = step.execution;

    if (exec.tag === "script") {
      return Effect.gen(function* () {
        // Execute script
        const newValue = yield* (exec.execute(stepState.value) as unknown as Effect.Effect<S, { message?: string }, never>).pipe(
          Effect.mapError(
            (e): RunMethodError => ({
              _tag: "RunMethodError",
              methodId: method.id,
              stepId: step.id,
              message: e.message ?? "Step failed",
            }),
          ),
        );

        // Validate axioms
        const axiomResult = validateAxioms(method.domain, newValue);
        if (!axiomResult.valid) {
          return yield* Effect.fail<RunMethodError>({
            _tag: "RunMethodError",
            methodId: method.id,
            stepId: step.id,
            message: `Axiom violations: ${axiomResult.violations.join(", ")}`,
          });
        }

        // Validate postcondition
        if (!evaluate(step.postcondition, newValue)) {
          return yield* Effect.fail<RunMethodError>({
            _tag: "RunMethodError",
            methodId: method.id,
            stepId: step.id,
            message: `Postcondition failed for step "${step.id}"`,
          });
        }

        return {
          value: newValue,
          axiomStatus: axiomResult,
        } as WorldState<S>;
      });
    } else {
      // Agent step
      return Effect.gen(function* () {
        const agentProvider = yield* AgentProvider;
        const ctx = {
          state: stepState.value,
          world: {} as Record<string, string>,
          insights: {} as Record<string, string>,
          domainFacts: "",
        };
        const promptText = exec.prompt.run(ctx as any);
        const agentResult = yield* agentProvider.execute({ prompt: promptText }).pipe(
          Effect.mapError(
            (e): RunMethodError => ({
              _tag: "RunMethodError",
              methodId: method.id,
              stepId: step.id,
              message: `Agent error: ${e._tag}`,
            }),
          ),
        );
        const newValue = yield* exec.parse(agentResult.raw, stepState.value).pipe(
          Effect.mapError(
            (e): RunMethodError => ({
              _tag: "RunMethodError",
              methodId: method.id,
              stepId: step.id,
              message: `Parse error: ${(e as { message?: string }).message ?? "unknown"}`,
            }),
          ),
        );

        // Validate axioms
        const axiomResult = validateAxioms(method.domain, newValue);
        if (!axiomResult.valid) {
          return yield* Effect.fail<RunMethodError>({
            _tag: "RunMethodError",
            methodId: method.id,
            stepId: step.id,
            message: `Axiom violations: ${axiomResult.violations.join(", ")}`,
          });
        }

        // Validate postcondition
        if (!evaluate(step.postcondition, newValue)) {
          return yield* Effect.fail<RunMethodError>({
            _tag: "RunMethodError",
            methodId: method.id,
            stepId: step.id,
            message: `Postcondition failed for step "${step.id}"`,
          });
        }

        return {
          value: newValue,
          axiomStatus: axiomResult,
        } as WorldState<S>;
      });
    }
  };
}

function resolveProvider(options?: MethodHarnessOptions): { layer: Layer.Layer<AgentProvider>; recordings: Recording[] } {
  if (options?.provider) {
    return { layer: options.provider.layer, recordings: options.provider.recordings };
  }
  if (options?.agentResponses) {
    const seq = SequenceProvider(options.agentResponses);
    return { layer: seq.layer, recordings: seq.recordings };
  }
  return { layer: silentProvider(), recordings: [] };
}
