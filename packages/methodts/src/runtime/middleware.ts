// SPDX-License-Identifier: Apache-2.0
/**
 * Step middleware framework — composable pre/post processing for step execution.
 *
 * Middleware wraps the step execution pipeline, enabling cross-cutting concerns
 * (tracing, axiom validation, cost tracking, timeouts) without modifying step logic.
 *
 * The composition model is left-to-right: the first middleware in the array is the
 * outermost wrapper. Each middleware calls `next()` to delegate to the inner layer.
 *
 * @see PRD 021 §12.9 — Middleware Framework
 */

import { Effect, Ref } from "effect";
import type { WorldState, Snapshot } from "../state/world-state.js";
import type { Step } from "../method/step.js";
import type { DomainTheory } from "../domain/domain-theory.js";
import { validateAxioms } from "../domain/domain-theory.js";
import type { ExecutionAccumulatorState } from "./accumulator.js";

// ── Error type ──

/** Error from step execution (simplified for middleware). */
export type StepExecutionError = {
  readonly _tag: "StepExecutionError";
  readonly stepId: string;
  readonly message: string;
  readonly cause?: unknown;
};

// ── Core types ──

/**
 * A step middleware wraps the step execution, allowing pre/post processing.
 *
 * `next` is the inner execution function. The middleware calls next() to
 * execute the step, and can inspect/modify state before and after.
 */
export type StepMiddleware<S> = (
  step: Step<S>,
  state: WorldState<S>,
  next: (step: Step<S>, state: WorldState<S>) => Effect.Effect<WorldState<S>, StepExecutionError, never>,
) => Effect.Effect<WorldState<S>, StepExecutionError, never>;

// ── Composition ──

/**
 * Compose multiple middleware left-to-right.
 * The first middleware is the outermost wrapper.
 *
 * Given `composeMiddleware(A, B)`, the execution order is:
 * A.pre → B.pre → innerNext → B.post → A.post
 */
export function composeMiddleware<S>(...middleware: StepMiddleware<S>[]): StepMiddleware<S> {
  return (step, state, innerNext) => {
    // Build the chain from right to left so the first middleware is outermost
    let next = innerNext;
    for (let i = middleware.length - 1; i >= 0; i--) {
      const mw = middleware[i];
      const currentNext = next;
      next = (s, st) => mw(s, st, currentNext);
    }
    return next(step, state);
  };
}

// ── Built-in middleware ──

/**
 * Middleware: snapshot state before and after step execution.
 * Appends two snapshots (pre and post) to the trace ref for each step.
 */
export function withTracing<S>(
  snapshotsRef: Ref.Ref<Snapshot<S>[]>,
): StepMiddleware<S> {
  return (step, state, next) =>
    Effect.gen(function* () {
      const currentSnapshots = yield* Ref.get(snapshotsRef);
      const seq = currentSnapshots.length;

      // Pre-snapshot
      const preSnapshot: Snapshot<S> = {
        state,
        sequence: seq,
        timestamp: new Date(),
        delta: null,
        witnesses: [],
        metadata: { stepId: step.id, producedBy: "middleware:tracing" },
      };
      yield* Ref.update(snapshotsRef, (s) => [...s, preSnapshot]);

      // Execute step
      const result = yield* next(step, state);

      // Post-snapshot
      const postSeq = (yield* Ref.get(snapshotsRef)).length;
      const postSnapshot: Snapshot<S> = {
        state: result,
        sequence: postSeq,
        timestamp: new Date(),
        delta: null,
        witnesses: [],
        metadata: { stepId: step.id, producedBy: "middleware:tracing" },
      };
      yield* Ref.update(snapshotsRef, (s) => [...s, postSnapshot]);

      return result;
    });
}

/**
 * Middleware: validate domain axioms after step execution.
 * Fails with StepExecutionError if any axiom is violated.
 */
export function withAxiomValidation<S>(
  domain: DomainTheory<S>,
): StepMiddleware<S> {
  return (step, state, next) =>
    Effect.gen(function* () {
      const result = yield* next(step, state);
      const validation = validateAxioms(domain, result.value);
      if (!validation.valid) {
        return yield* Effect.fail<StepExecutionError>({
          _tag: "StepExecutionError",
          stepId: step.id,
          message: `Axiom violations: ${validation.violations.join(", ")}`,
        });
      }
      return result;
    });
}

/**
 * Middleware: track execution cost after each step.
 * Updates the accumulator ref with token/cost data extracted from the resulting state.
 */
export function withCostTracking<S>(
  accRef: Ref.Ref<ExecutionAccumulatorState>,
  costExtractor?: (state: WorldState<S>) => { tokens: number; usd: number },
): StepMiddleware<S> {
  return (step, state, next) =>
    Effect.gen(function* () {
      const start = Date.now();
      const result = yield* next(step, state);
      const elapsed = Date.now() - start;

      const cost = costExtractor ? costExtractor(result) : { tokens: 0, usd: 0 };

      yield* Ref.update(accRef, (acc) => ({
        ...acc,
        totalTokens: acc.totalTokens + cost.tokens,
        totalCostUsd: acc.totalCostUsd + cost.usd,
        elapsedMs: acc.elapsedMs + elapsed,
      }));

      return result;
    });
}

/**
 * Middleware: timeout step execution.
 * If the step takes longer than the specified duration, fail with a StepExecutionError.
 */
export function withTimeout<S>(ms: number): StepMiddleware<S> {
  return (step, state, next) =>
    next(step, state).pipe(
      Effect.timeoutFail({
        duration: ms,
        onTimeout: () => ({
          _tag: "StepExecutionError" as const,
          stepId: step.id,
          message: `Step timed out after ${ms}ms`,
        }),
      }),
    );
}
