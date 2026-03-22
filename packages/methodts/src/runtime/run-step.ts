/**
 * runStep — Inner step execution loop.
 *
 * Dispatches script or agent steps, validates pre/postconditions and axioms,
 * handles retries for agent steps on postcondition failure or parse errors.
 *
 * Execution flow:
 *   1. Validate precondition against current state
 *   2. Execute step (script: pure transform, agent: context → prompt → LLM → parse)
 *   3. Validate domain axioms on new state
 *   4. Validate postcondition on new state
 *   5. On agent postcondition/parse failure: retry with feedback up to maxRetries
 *
 * @see F1-FTH Definition 4.1 — σ = (pre, post, guidance, tools)
 * @see PRD 021 §12.4 — Step execution and retry
 */

import { Effect } from "effect";
import type { Step } from "../method/step.js";
import type { WorldState } from "../state/world-state.js";
import type { DomainTheory } from "../domain/domain-theory.js";
import type { Role } from "../domain/role.js";
import type { InsightStore } from "./insight-store.js";
import { evaluate } from "../predicate/evaluate.js";
import { validateAxioms } from "../domain/domain-theory.js";
import { assembleContext } from "./context.js";
import { AgentProvider } from "../provider/agent-provider.js";

/** Configuration for running a step. */
export type RunStepConfig<S> = {
  readonly domain: DomainTheory<S>;
  readonly insightStore: InsightStore;
  readonly role?: Role<S, any>;
  readonly maxRetries?: number;
  readonly retryFeedback?: string;
};

/** Error from step execution. */
export type RunStepError = {
  readonly _tag: "RunStepError";
  readonly stepId: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly cause?: unknown;
};

/**
 * Execute a single step (script or agent). Validates pre/postconditions,
 * runs the step, and handles retries for agent steps.
 *
 * Returns the new WorldState on success, or a RunStepError on failure.
 * Agent steps are retried on postcondition or parse failure up to maxRetries.
 * Script steps are never retried — failures are immediate.
 */
export function runStep<S>(
  step: Step<S>,
  state: WorldState<S>,
  config: RunStepConfig<S>,
): Effect.Effect<WorldState<S>, RunStepError, AgentProvider> {
  return Effect.gen(function* () {
    // 1. Validate precondition
    if (!evaluate(step.precondition, state.value)) {
      return yield* Effect.fail<RunStepError>({
        _tag: "RunStepError",
        stepId: step.id,
        message: "Precondition failed",
        retryable: false,
      });
    }

    const maxRetries = config.maxRetries ?? 3;
    let lastError: RunStepError | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const feedback =
        attempt > 0 ? lastError?.message : config.retryFeedback;

      // 2. Execute based on step type
      let newValue: S;
      let cost = { tokens: 0, usd: 0, duration_ms: 0 };

      if (step.execution.tag === "script") {
        // Script execution — never retried.
        // WorldServices is Record<string, never> (Phase 1b placeholder),
        // so we safely cast the R channel to never.
        const scriptEffect = step.execution.execute(state.value) as Effect.Effect<
          S,
          { readonly _tag: "StepError"; readonly stepId: string; readonly message: string; readonly cause?: unknown },
          never
        >;
        const result = yield* scriptEffect.pipe(
          Effect.mapError(
            (e): RunStepError => ({
              _tag: "RunStepError",
              stepId: step.id,
              message: `Script error: ${e.message}`,
              retryable: false,
              cause: e,
            }),
          ),
        );
        newValue = result;
      } else {
        // Agent execution
        const agentProvider = yield* AgentProvider;

        // Assemble context from the step's context spec
        const worldFragments: Record<string, string> = {};
        const stepContext = yield* assembleContext(
          step.execution.context,
          state.value,
          worldFragments,
          config.insightStore,
          config.domain,
          config.role,
        ).pipe(
          Effect.mapError(
            (e): RunStepError => ({
              _tag: "RunStepError",
              stepId: step.id,
              message: `Context assembly failed: ${e.message}`,
              retryable: false,
            }),
          ),
        );

        // Render prompt from context
        let promptText = step.execution.prompt.run(stepContext);

        // Append insight production instruction if declared
        if (step.execution.context.produceInsight) {
          promptText += `\n\n${step.execution.context.produceInsight.instruction}`;
        }

        // Append retry feedback if this is a retry attempt
        if (feedback) {
          promptText += `\n\n## Retry Feedback\n${feedback}`;
        }

        // Execute via agent provider
        const agentResult = yield* agentProvider
          .execute({ prompt: promptText })
          .pipe(
            Effect.mapError(
              (e): RunStepError => ({
                _tag: "RunStepError",
                stepId: step.id,
                message: `Agent error: ${e._tag}`,
                retryable: true,
                cause: e,
              }),
            ),
          );

        cost = agentResult.cost;

        // Parse agent output into new state
        const parseResult = step.execution.parse(
          agentResult.raw,
          state.value,
        ).pipe(
          Effect.mapError(
            (e): RunStepError => ({
              _tag: "RunStepError",
              stepId: step.id,
              message: `Parse error: ${e.message}`,
              retryable: true,
              cause: e,
            }),
          ),
        );

        // Parse may fail — on failure, record error and retry if possible
        const parseExit = yield* Effect.either(parseResult);
        if (parseExit._tag === "Left") {
          lastError = parseExit.left;
          if (attempt < maxRetries) continue;
          return yield* Effect.fail(lastError);
        }
        newValue = parseExit.right;

        // Extract insight if declared
        if (step.execution.parseInsight) {
          const insightKey =
            step.execution.context.produceInsight?.key ?? step.id;
          const insight = step.execution.parseInsight(agentResult.raw);
          yield* config.insightStore.set(insightKey, insight);
        }
      }

      // 3. Validate axioms
      const axiomResult = validateAxioms(config.domain, newValue);
      if (!axiomResult.valid) {
        return yield* Effect.fail<RunStepError>({
          _tag: "RunStepError",
          stepId: step.id,
          message: `Axiom violations: ${axiomResult.violations.join(", ")}`,
          retryable: false,
        });
      }

      // 4. Validate postcondition
      if (!evaluate(step.postcondition, newValue)) {
        lastError = {
          _tag: "RunStepError",
          stepId: step.id,
          message: `Postcondition failed (attempt ${attempt + 1})`,
          retryable: true,
        };
        // Only retry agent steps
        if (attempt < maxRetries && step.execution.tag === "agent") continue;
        return yield* Effect.fail(lastError);
      }

      // 5. Return new WorldState
      return {
        value: newValue,
        axiomStatus: axiomResult,
      };
    }

    // Unreachable in practice — loop always returns or fails
    return yield* Effect.fail<RunStepError>(lastError!);
  });
}
