// SPDX-License-Identifier: Apache-2.0
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
 * Agent retry uses executeWithRetry from gate/ (PRD 046 Gate Unification).
 *
 * @see F1-FTH Definition 4.1 — σ = (pre, post, guidance, tools)
 * @see PRD 021 §12.4 — Step execution and retry
 * @see PRD 046 §Wave 2b — Gate unification, methodology runtime path
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
import { executeWithRetry, type RetryExhausted } from "../gate/gate.js";

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
 * Internal output from a single agent execution attempt.
 * Captures either a successful parse result or a parse failure,
 * so the retry loop can treat parse failures as check failures.
 */
type AgentAttemptOutput<S> = {
  readonly parsed: boolean;
  readonly newValue?: S;
  readonly parseError?: string;
  readonly rawOutput?: string;
  readonly cost: { tokens: number; usd: number; duration_ms: number };
  readonly sessionId?: string;
};

/**
 * Execute a single step (script or agent). Validates pre/postconditions,
 * runs the step, and handles retries for agent steps.
 *
 * Returns the new WorldState on success, or a RunStepError on failure.
 * Agent steps are retried on postcondition or parse failure up to maxRetries
 * via executeWithRetry from gate/ (PRD 046).
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

    if (step.execution.tag === "script") {
      // Script execution — never retried, no executeWithRetry.
      return yield* runScriptStep(step, state, config);
    }

    // Agent execution — uses executeWithRetry for retry semantics.
    const maxRetries = Math.max(0, config.maxRetries ?? 3);
    const agentExec = step.execution;

    // Mutable session tracking: first attempt creates sessionId, retries resume it.
    let stepSessionId: string | undefined;

    const retryResult = yield* executeWithRetry<
      WorldState<S>,
      AgentAttemptOutput<S>,
      RunStepError,
      AgentProvider
    >({
      name: `step:${step.id}`,
      maxRetries,
      input: state,

      execute: (inputState, attempt, feedback) =>
        Effect.gen(function* () {
          const agentProvider = yield* AgentProvider;

          // Assemble context from the step's context spec
          const worldFragments: Record<string, string> = {};
          const stepContext = yield* assembleContext(
            agentExec.context,
            inputState.value,
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
          let promptText = agentExec.prompt.run(stepContext);

          // Append insight production instruction if declared
          if (agentExec.context.produceInsight) {
            promptText += `\n\n${agentExec.context.produceInsight.instruction}`;
          }

          // Determine feedback text: on retry use gate feedback, on first attempt use config feedback
          const feedbackText = attempt > 0 ? feedback : config.retryFeedback;
          if (feedbackText) {
            promptText += `\n\n## Retry Feedback\n${feedbackText}`;
          }

          // Build commission with session tracking.
          // First attempt: create a new session. Retries: resume the same session
          // so the agent retains conversation context across retry attempts.
          const commission = attempt === 0
            ? { prompt: promptText, sessionId: `step_${step.id}_${Date.now().toString(36)}` }
            : { prompt: promptText, resumeSessionId: stepSessionId };

          // Execute via agent provider
          const agentResult = yield* agentProvider
            .execute(commission)
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

          // Capture sessionId from first attempt for reuse on retries
          if (attempt === 0) {
            stepSessionId = agentResult.sessionId ?? commission.sessionId;
          }

          // Parse agent output into new state — catch failures for retry
          const parseExit = yield* Effect.either(
            agentExec.parse(agentResult.raw, inputState.value).pipe(
              Effect.mapError(
                (e): RunStepError => ({
                  _tag: "RunStepError",
                  stepId: step.id,
                  message: `Parse error: ${e.message}`,
                  retryable: true,
                  cause: e,
                }),
              ),
            ),
          );

          if (parseExit._tag === "Left") {
            // Parse failed — return as output so check() can report it
            return {
              parsed: false,
              parseError: parseExit.left.message,
              rawOutput: agentResult.raw,
              cost: agentResult.cost,
              sessionId: agentResult.sessionId,
            } as AgentAttemptOutput<S>;
          }

          const newValue = parseExit.right;

          // Extract insight if declared (do this before axiom check)
          if (agentExec.parseInsight) {
            const insightKey =
              agentExec.context.produceInsight?.key ?? step.id;
            const insight = agentExec.parseInsight(agentResult.raw);
            yield* config.insightStore.set(insightKey, insight);
          }

          // Validate axioms — axiom violations are non-retryable, fail immediately
          const axiomResult = validateAxioms(config.domain, newValue);
          if (!axiomResult.valid) {
            return yield* Effect.fail<RunStepError>({
              _tag: "RunStepError",
              stepId: step.id,
              message: `Axiom violations: ${axiomResult.violations.join(", ")}`,
              retryable: false,
            });
          }

          return {
            parsed: true,
            newValue,
            cost: agentResult.cost,
            sessionId: agentResult.sessionId,
          } as AgentAttemptOutput<S>;
        }),

      check: (output) => {
        // Parse failure — retryable
        if (!output.parsed) {
          return {
            passed: false,
            failures: [output.parseError ?? "Parse failed"],
          };
        }

        // Validate postcondition
        if (!evaluate(step.postcondition, output.newValue!)) {
          return {
            passed: false,
            failures: [`Postcondition failed`],
          };
        }

        return { passed: true, failures: [] };
      },

      buildFeedback: (output, failures) => {
        if (!output.parsed) {
          return output.parseError ?? "Parse failed";
        }
        return `Postcondition failed (${failures.join(", ")})`;
      },
    }).pipe(
      Effect.mapError(
        (e): RunStepError => {
          if ((e as { _tag: string })._tag === "RetryExhausted") {
            const exhausted = e as unknown as RetryExhausted;
            // Determine retryable and message based on what kind of failure it was
            const lastOutput = exhausted.lastOutput as AgentAttemptOutput<S> | undefined;
            if (lastOutput && !lastOutput.parsed) {
              return {
                _tag: "RunStepError",
                stepId: step.id,
                message: lastOutput.parseError ?? "Parse error",
                retryable: true,
              };
            }
            return {
              _tag: "RunStepError",
              stepId: step.id,
              message: `Postcondition failed (attempt ${exhausted.attempts})`,
              retryable: true,
            };
          }
          // Non-RetryExhausted errors (RunStepError from execute) pass through
          return e as RunStepError;
        },
      ),
    );

    // Build final WorldState from successful retry result
    const axiomResult = validateAxioms(config.domain, retryResult.data.newValue!);
    return {
      value: retryResult.data.newValue!,
      axiomStatus: axiomResult,
    };
  });
}

/**
 * Execute a script step — no retries, immediate failure on postcondition or axiom violation.
 */
function runScriptStep<S>(
  step: Step<S>,
  state: WorldState<S>,
  config: RunStepConfig<S>,
): Effect.Effect<WorldState<S>, RunStepError, AgentProvider> {
  return Effect.gen(function* () {
    // WorldServices is Record<string, never> (Phase 1b placeholder),
    // so we safely cast the R channel to never.
    const scriptEffect = step.execution.tag === "script"
      ? step.execution.execute(state.value) as Effect.Effect<
          S,
          { readonly _tag: "StepError"; readonly stepId: string; readonly message: string; readonly cause?: unknown },
          never
        >
      : Effect.fail({ _tag: "StepError" as const, stepId: step.id, message: "Not a script step" });

    const newValue = yield* scriptEffect.pipe(
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

    // Validate axioms
    const axiomResult = validateAxioms(config.domain, newValue);
    if (!axiomResult.valid) {
      return yield* Effect.fail<RunStepError>({
        _tag: "RunStepError",
        stepId: step.id,
        message: `Axiom violations: ${axiomResult.violations.join(", ")}`,
        retryable: false,
      });
    }

    // Validate postcondition
    if (!evaluate(step.postcondition, newValue)) {
      return yield* Effect.fail<RunStepError>({
        _tag: "RunStepError",
        stepId: step.id,
        message: `Postcondition failed (attempt 1)`,
        retryable: true,
      });
    }

    return {
      value: newValue,
      axiomStatus: axiomResult,
    };
  });
}
