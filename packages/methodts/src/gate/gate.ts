// SPDX-License-Identifier: Apache-2.0
/**
 * Gate framework — quality gates with Effect-based evaluation.
 *
 * Gates wrap Predicates into evaluable checkpoints that produce
 * structured results with witnesses, timing, and diagnostic traces.
 * Composition helpers (allPass, anyPass) build GateSuites.
 * withRetry adds retry semantics for transient failures.
 *
 * @see PRD 021 Component 7 — Gate types and runners
 * @see F1-FTH — Predicates as closed Sigma-sentences
 */

import { Effect } from "effect";
import type { Predicate } from "../predicate/predicate.js";
import type { EvalTrace } from "../predicate/evaluate.js";
import type { RuntimeObserver } from "./runtime-observer.js";

// ── Error type ──

/** Structured error emitted when a gate evaluation fails at the Effect level. */
export type GateError = {
  readonly _tag: "GateError";
  readonly gateId: string;
  readonly message: string;
  readonly cause?: unknown;
};

/** Construct a GateError. */
export function gateError(gateId: string, message: string, cause?: unknown): GateError {
  return { _tag: "GateError", gateId, message, cause };
}

// ── Result types ──

/** Outcome of evaluating a single Gate against a state. */
export type GateResult<S> = {
  readonly passed: boolean;
  readonly witness: { predicate: Predicate<S>; evaluatedAt: Date; trace: EvalTrace } | null;
  readonly reason: string;
  readonly feedback?: string;
  readonly duration_ms: number;
};

/** Aggregate outcome of evaluating a GateSuite. */
export type GateSuiteResult<S> = {
  readonly name: string;
  readonly passed: boolean;
  readonly results: GateResult<S>[];
  readonly duration_ms: number;
};

// ── Gate and Suite types ──

/** A single quality gate — wraps a Predicate with evaluation semantics. */
export type Gate<S> = {
  readonly id: string;
  readonly description: string;
  readonly predicate: Predicate<S>;
  readonly evaluate: (state: S) => Effect.Effect<GateResult<S>, GateError, never>;
  readonly maxRetries: number;
};

/** A named collection of gates evaluated together. */
export type GateSuite<S> = {
  readonly name: string;
  readonly gates: Gate<S>[];
};

// ── Re-exports for convenience ──

export { scriptGate } from "./runners/script-gate.js";
export { testRunner } from "./runners/test-runner.js";
export { httpChecker } from "./runners/http-checker.js";
export { checklistGate, renderChecklistInstructions, parseAttestations, evaluateChecklist } from "./runners/checklist-gate.js";

// ── PRD 046: Consolidated gate infrastructure ──

export type { RuntimeObserver, GateEvaluatedEvent, NodeStartedEvent, NodeCompletedEvent, RetryAttemptEvent } from "./runtime-observer.js";
export { nullObserver } from "./runtime-observer.js";

export type { DagGateEvaluator, DagGateConfig, DagGateContext, DagGateResult, HumanApprovalResolver, HumanApprovalContext } from "./dag-gate-evaluator.js";

export type { FileArtifact, AlgorithmicGateResult } from "./algorithmic-checks.js";
export { checkNoAny, checkNoTodos, checkStructure, checkPortFreeze, checkPortSubstance, checkDocumentationSections, runAlgorithmicGates } from "./algorithmic-checks.js";

// ── Composition helpers ──

/**
 * Compose gates with AND semantics: all must pass for the suite to pass.
 *
 * Runs every gate regardless of individual results (no short-circuit),
 * so the caller always gets the full diagnostic picture.
 *
 * @param name - Suite name for diagnostics
 * @param gates - Gates to evaluate
 * @returns A function that evaluates the suite against a state
 */
export function allPass<S>(
  name: string,
  gates: Gate<S>[],
): (state: S) => Effect.Effect<GateSuiteResult<S>, GateError, never> {
  return (state: S) =>
    Effect.gen(function* () {
      const start = Date.now();
      const results: GateResult<S>[] = [];
      for (const gate of gates) {
        const result = yield* gate.evaluate(state);
        results.push(result);
      }
      return {
        name,
        passed: results.every((r) => r.passed),
        results,
        duration_ms: Date.now() - start,
      };
    });
}

/**
 * Compose gates with OR semantics: at least one must pass for the suite to pass.
 *
 * Runs every gate regardless of individual results (no short-circuit),
 * so the caller always gets the full diagnostic picture.
 *
 * @param name - Suite name for diagnostics
 * @param gates - Gates to evaluate
 * @returns A function that evaluates the suite against a state
 */
export function anyPass<S>(
  name: string,
  gates: Gate<S>[],
): (state: S) => Effect.Effect<GateSuiteResult<S>, GateError, never> {
  return (state: S) =>
    Effect.gen(function* () {
      const start = Date.now();
      const results: GateResult<S>[] = [];
      for (const gate of gates) {
        const result = yield* gate.evaluate(state);
        results.push(result);
      }
      return {
        name,
        passed: results.some((r) => r.passed),
        results,
        duration_ms: Date.now() - start,
      };
    });
}

/**
 * Wrap a gate with retry semantics.
 *
 * If the gate's predicate evaluates to passed=false (not a GateError),
 * retries up to maxRetries times. Uses a closure to track retry state
 * across evaluate calls.
 *
 * @param gate - The gate to wrap
 * @param maxRetries - Maximum number of retries (0 = no retries, same as original)
 * @returns A new Gate with retry behavior
 */
export function withRetry<S>(gate: Gate<S>, maxRetries: number): Gate<S> {
  return {
    ...gate,
    maxRetries,
    evaluate: (state: S) =>
      Effect.gen(function* () {
        let lastResult: GateResult<S> | undefined;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          lastResult = yield* gate.evaluate(state);
          if (lastResult.passed) {
            return lastResult;
          }
        }
        // All attempts exhausted — return the last failed result
        return lastResult!;
      }),
  };
}

// ── PRD 046: Unified gate-check-retry loop ──

/** Error emitted when all retry attempts are exhausted. */
export type RetryExhausted = {
  readonly _tag: "RetryExhausted";
  readonly name: string;
  readonly attempts: number;
  readonly lastFailures: string[];
  readonly lastOutput: unknown;
};

/**
 * Unified gate-check-retry loop.
 *
 * Extracts the retry pattern from runAtomic (semantic), strategy executor,
 * and methodology runtime into a single reusable utility.
 *
 * On each attempt:
 * 1. Call execute(input, attempt, feedback?) to produce an output
 * 2. Run check(output) — if passed, return immediately with degrading confidence
 * 3. If failed and retries remain: build feedback, notify observer, retry
 * 4. If all retries exhausted: fail with RetryExhausted
 *
 * Confidence degrades: max(0.5, 0.90 - attempt * 0.10)
 *
 * @see PRD 046 §Wave 1 — Gate Unification
 * @see semantic/run.ts — runAtomic (first consumer)
 */
export function executeWithRetry<I, O, E, R>(config: {
  name: string;
  execute: (input: I, attempt: number, feedback?: string) => Effect.Effect<O, E, R>;
  check: (output: O) => { passed: boolean; failures: string[] };
  buildFeedback: (output: O, failures: string[]) => string;
  maxRetries: number;
  input: I;
  observer?: RuntimeObserver;
}): Effect.Effect<{ data: O; attempts: number; confidence: number }, RetryExhausted | E, R> {
  return Effect.gen(function* () {
    const { name, execute, check, buildFeedback, maxRetries, input, observer } = config;
    let lastFailures: string[] = [];
    let lastOutput: O | undefined;
    let feedback: string | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const output = yield* execute(input, attempt, feedback);
      lastOutput = output;
      const result = check(output);

      if (result.passed) {
        const confidence = Math.max(0.5, 0.90 - attempt * 0.10);
        return { data: output, attempts: attempt + 1, confidence };
      }

      lastFailures = result.failures;

      if (attempt < maxRetries) {
        feedback = buildFeedback(output, result.failures);
        observer?.onRetryAttempt({
          name,
          attempt: attempt + 1,
          maxRetries,
          feedback,
        });
      }
    }

    return yield* Effect.fail<RetryExhausted>({
      _tag: "RetryExhausted",
      name,
      attempts: maxRetries + 1,
      lastFailures,
      lastOutput,
    });
  });
}
