/**
 * runMethodology — Coalgebraic execution loop for methodologies.
 *
 * Implements the coalgebra for the functor F(X) = 1 + Method on Mod(D_Φ):
 *   1. Check safety bounds
 *   2. Evaluate transition function δ_Φ (deterministic, priority-ordered arms)
 *   3. If terminal (null method selected) → complete
 *   4. Run the selected method via runMethod
 *   5. Record result, loop
 *
 * Also provides runMethodologyToCompletion as a convenience wrapper.
 *
 * @see F1-FTH Definition 7.1 — Methodology coalgebra Φ = (D_Φ, δ_Φ, O_Φ)
 * @see PRD 021 §12.6 — MethodologyResult, ExecutionAccumulator
 */

import { Effect } from "effect";
import type { Methodology } from "../methodology/methodology.js";
import type { WorldState, Snapshot } from "../state/world-state.js";
import type {
  MethodologyResult,
  ExecutionAccumulatorState,
  CompletedMethodRecord,
} from "./accumulator.js";
import { initialAccumulator, recordMethod } from "./accumulator.js";
import { evaluateTransition } from "../methodology/transition.js";
import { checkSafety } from "../methodology/safety.js";
import { validateAxioms } from "../domain/domain-theory.js";
import { runMethod, type RunMethodError } from "./run-method.js";
import { AgentProvider } from "../provider/agent-provider.js";
import type { Step } from "../method/step.js";

/**
 * Run a methodology to first suspension or completion.
 *
 * Implements the coalgebraic loop: evaluateTransition -> run method -> loop.
 * Returns a MethodologyResult with status, final state, trace, and accumulator.
 */
export function runMethodology<S>(
  methodology: Methodology<S>,
  initialState: WorldState<S>,
): Effect.Effect<MethodologyResult<S>, RunMethodError, AgentProvider> {
  return Effect.gen(function* () {
    // Validate axioms on initial state
    const axiomCheck = validateAxioms(methodology.domain, initialState.value);
    if (!axiomCheck.valid) {
      return {
        status: "failed" as const,
        finalState: initialState,
        trace: { snapshots: [], initial: initialState, current: initialState },
        accumulator: initialAccumulator(),
      };
    }

    let state = initialState;
    let acc = initialAccumulator();
    const snapshots: Snapshot<S>[] = [];

    // TODO: Methodology-level session continuity — track a methodologySessionId
    // across methods so the agent retains conversation context across steps.
    // This is a bigger architectural change requiring a sessionContinuity config flag.
    // For now, session resume is only wired at the step retry level (run-step.ts).

    // Coalgebraic loop
    while (true) {
      // Safety check — uses ExecutionAccumulator from safety.ts (compatible fields)
      const safety = checkSafety(methodology.safety, {
        loopCount: acc.loopCount,
        totalTokens: acc.totalTokens,
        totalCostUsd: acc.totalCostUsd,
        startedAt: acc.startedAt,
        elapsedMs: acc.elapsedMs,
        suspensionCount: acc.suspensionCount,
      });

      if (!safety.safe) {
        return {
          status: "safety_violation" as const,
          finalState: state,
          trace: { snapshots, initial: initialState, current: state },
          accumulator: acc,
          violation: safety.violation,
        };
      }

      // Evaluate transition function δ_Φ
      const transition = evaluateTransition(methodology, state.value);

      // No arm fired or terminal arm (selects null) → methodology complete
      if (!transition.firedArm || transition.selectedMethod === null) {
        return {
          status: "completed" as const,
          finalState: state,
          trace: { snapshots, initial: initialState, current: state },
          accumulator: acc,
        };
      }

      // Run the selected method
      const method = transition.selectedMethod;

      // Build a step executor that handles both script and agent steps
      const stepExecutor: (
        step: Step<S>,
        stepState: WorldState<S>,
      ) => Effect.Effect<WorldState<S>, RunMethodError, AgentProvider> = (
        step,
        stepState,
      ) => {
        const exec = step.execution;
        if (exec.tag === "script") {
          // WorldServices is Record<string, never> (empty placeholder).
          // Cast to unify with the agent branch's AgentProvider requirement.
          return exec
            .execute(stepState.value)
            .pipe(
              Effect.map(
                (newValue: S): WorldState<S> => ({
                  value: newValue,
                  axiomStatus: { valid: true, violations: [] as string[] },
                }),
              ),
              Effect.mapError(
                (e): RunMethodError => ({
                  _tag: "RunMethodError",
                  methodId: method.id,
                  stepId: step.id,
                  message: e.message ?? "Step failed",
                }),
              ),
            ) as unknown as Effect.Effect<WorldState<S>, RunMethodError, AgentProvider>;
        } else {
          // Agent step — use AgentProvider
          const agentExec = exec;
          return Effect.gen(function* () {
            const agentProvider = yield* AgentProvider;
            const promptText = agentExec.prompt.run({
              state: stepState.value,
              world: {},
              insights: {},
              domainFacts: "",
            });
            const result = yield* agentProvider
              .execute({ prompt: promptText })
              .pipe(
                Effect.mapError(
                  (e): RunMethodError => ({
                    _tag: "RunMethodError",
                    methodId: method.id,
                    stepId: step.id,
                    message: `Agent error: ${e._tag}`,
                  }),
                ),
              );
            const newValue = yield* agentExec
              .parse(result.raw, stepState.value)
              .pipe(
                Effect.mapError(
                  (e): RunMethodError => ({
                    _tag: "RunMethodError",
                    methodId: method.id,
                    stepId: step.id,
                    message: `Parse error: ${e.message}`,
                  }),
                ),
              );
            return {
              value: newValue,
              axiomStatus: { valid: true, violations: [] as string[] },
            } as WorldState<S>;
          });
        }
      };

      const methodResult = yield* runMethod(method, state, stepExecutor);

      // Aggregate cost from step results
      const totalCost = methodResult.stepResults.reduce(
        (acc, sr) => ({
          tokens: acc.tokens + sr.cost.tokens,
          usd: acc.usd + sr.cost.usd,
          duration_ms: acc.duration_ms + sr.cost.duration_ms,
        }),
        { tokens: 0, usd: 0, duration_ms: 0 },
      );

      const stepSummaries: Record<string, string> = {};
      for (const sr of methodResult.stepResults) {
        stepSummaries[sr.stepId] = sr.status;
      }

      // Record completed method in accumulator
      const completedRecord: CompletedMethodRecord = {
        methodId: method.id,
        objectiveMet: methodResult.objectiveMet,
        stepOutputSummaries: stepSummaries,
        cost: totalCost,
      };
      acc = recordMethod(acc, completedRecord);

      // Update state from method result
      state = methodResult.finalState;

      // Re-validate domain axioms after method execution.
      // A method may modify state fields; the methodology domain invariants
      // must still hold before the next δ_Φ evaluation.
      const postAxiomCheck = validateAxioms(methodology.domain, state.value);
      if (!postAxiomCheck.valid) {
        return {
          status: "failed" as const,
          finalState: state,
          trace: { snapshots, initial: initialState, current: state },
          accumulator: acc,
        };
      }
    }
  });
}

/**
 * Run a methodology to full completion, auto-resolving all suspensions.
 * Convenience wrapper around runMethodology.
 */
export function runMethodologyToCompletion<S>(
  methodology: Methodology<S>,
  initialState: WorldState<S>,
): Effect.Effect<MethodologyResult<S>, RunMethodError, AgentProvider> {
  return runMethodology(methodology, initialState);
}
