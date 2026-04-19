// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for step middleware framework.
 *
 * Covers: composeMiddleware, withTracing, withAxiomValidation,
 * withCostTracking, withTimeout.
 */

import { describe, it, expect } from "vitest";
import { Effect, Ref } from "effect";
import {
  composeMiddleware,
  withTracing,
  withAxiomValidation,
  withCostTracking,
  withTimeout,
  type StepMiddleware,
  type StepExecutionError,
} from "../middleware.js";
import type { Step } from "../../method/step.js";
import type { WorldState, Snapshot } from "../../state/world-state.js";
import type { DomainTheory } from "../../domain/domain-theory.js";
import type { ExecutionAccumulatorState } from "../accumulator.js";
import { initialAccumulator } from "../accumulator.js";
import { TRUE } from "../../predicate/predicate.js";
import { Prompt } from "../../prompt/prompt.js";

// ── Test types and helpers ──

type TestState = { value: number; valid: boolean };

function makeWorldState(s: TestState): WorldState<TestState> {
  return { value: s, axiomStatus: { valid: true, violations: [] } };
}

const initialState = makeWorldState({ value: 0, valid: true });
const resultState = makeWorldState({ value: 42, valid: true });

const testStep: Step<TestState> = {
  id: "test-step",
  name: "Test Step",
  role: "tester",
  precondition: TRUE,
  postcondition: TRUE,
  execution: { tag: "script", execute: (s) => Effect.succeed(s) },
};

/** A mock `next` that returns a predetermined WorldState. */
const mockNext =
  <S>(result: WorldState<S>) =>
  (_step: Step<S>, _state: WorldState<S>): Effect.Effect<WorldState<S>, StepExecutionError, never> =>
    Effect.succeed(result);

/** A mock `next` that fails with a StepExecutionError. */
const failingNext =
  <S>(error: StepExecutionError) =>
  (_step: Step<S>, _state: WorldState<S>): Effect.Effect<WorldState<S>, StepExecutionError, never> =>
    Effect.fail(error);

// ── composeMiddleware ──

describe("composeMiddleware", () => {
  it("composes 2 middleware — both invoked in left-to-right order", async () => {
    const order: string[] = [];

    const mwA: StepMiddleware<TestState> = (step, state, next) =>
      Effect.gen(function* () {
        order.push("A:pre");
        const result = yield* next(step, state);
        order.push("A:post");
        return result;
      });

    const mwB: StepMiddleware<TestState> = (step, state, next) =>
      Effect.gen(function* () {
        order.push("B:pre");
        const result = yield* next(step, state);
        order.push("B:post");
        return result;
      });

    const composed = composeMiddleware(mwA, mwB);

    await Effect.runPromise(composed(testStep, initialState, mockNext(resultState)));

    expect(order).toEqual(["A:pre", "B:pre", "B:post", "A:post"]);
  });

  it("empty middleware list — next called directly", async () => {
    const composed = composeMiddleware<TestState>();
    let nextCalled = false;

    const trackingNext = (
      _step: Step<TestState>,
      _state: WorldState<TestState>,
    ): Effect.Effect<WorldState<TestState>, StepExecutionError, never> => {
      nextCalled = true;
      return Effect.succeed(resultState);
    };

    const result = await Effect.runPromise(composed(testStep, initialState, trackingNext));

    expect(nextCalled).toBe(true);
    expect(result).toBe(resultState);
  });
});

// ── withTracing ──

describe("withTracing", () => {
  it("produces 2 snapshots per step (pre + post)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const snapshotsRef = yield* Ref.make<Snapshot<TestState>[]>([]);
        const mw = withTracing<TestState>(snapshotsRef);

        yield* mw(testStep, initialState, mockNext(resultState));

        const snapshots = yield* Ref.get(snapshotsRef);
        expect(snapshots).toHaveLength(2);
      }),
    );
  });

  it("snapshots have correct metadata (stepId and producedBy)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const snapshotsRef = yield* Ref.make<Snapshot<TestState>[]>([]);
        const mw = withTracing<TestState>(snapshotsRef);

        yield* mw(testStep, initialState, mockNext(resultState));

        const snapshots = yield* Ref.get(snapshotsRef);

        // Pre-snapshot
        expect(snapshots[0].metadata.stepId).toBe("test-step");
        expect(snapshots[0].metadata.producedBy).toBe("middleware:tracing");
        expect(snapshots[0].state).toBe(initialState);
        expect(snapshots[0].sequence).toBe(0);

        // Post-snapshot
        expect(snapshots[1].metadata.stepId).toBe("test-step");
        expect(snapshots[1].metadata.producedBy).toBe("middleware:tracing");
        expect(snapshots[1].state).toBe(resultState);
        expect(snapshots[1].sequence).toBe(1);
      }),
    );
  });
});

// ── withAxiomValidation ──

describe("withAxiomValidation", () => {
  const validDomain: DomainTheory<TestState> = {
    id: "test-domain",
    signature: { sorts: [], functionSymbols: [], predicates: {} },
    axioms: {
      "value-positive": { tag: "check", label: "value >= 0", check: (s) => s.value >= 0 },
    },
  };

  const strictDomain: DomainTheory<TestState> = {
    id: "strict-domain",
    signature: { sorts: [], functionSymbols: [], predicates: {} },
    axioms: {
      "must-be-valid": { tag: "check", label: "valid must be true", check: (s) => s.valid },
      "value-positive": { tag: "check", label: "value > 0", check: (s) => s.value > 0 },
    },
  };

  it("valid state — passes through", async () => {
    const mw = withAxiomValidation<TestState>(validDomain);
    const result = await Effect.runPromise(mw(testStep, initialState, mockNext(resultState)));

    expect(result).toBe(resultState);
  });

  it("invalid state — fails with StepExecutionError", async () => {
    const invalidResult = makeWorldState({ value: -1, valid: false });
    const mw = withAxiomValidation<TestState>(strictDomain);

    const exit = await Effect.runPromiseExit(mw(testStep, initialState, mockNext(invalidResult)));

    // Should have failed
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const error = (exit.cause as any).error as StepExecutionError;
      expect(error._tag).toBe("StepExecutionError");
      expect(error.stepId).toBe("test-step");
      expect(error.message).toContain("Axiom violations");
    }
  });
});

// ── withCostTracking ──

describe("withCostTracking", () => {
  it("accumulator updated with extracted cost", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const accRef = yield* Ref.make<ExecutionAccumulatorState>(initialAccumulator());
        const extractor = (_state: WorldState<TestState>) => ({ tokens: 500, usd: 0.05 });
        const mw = withCostTracking<TestState>(accRef, extractor);

        yield* mw(testStep, initialState, mockNext(resultState));

        const acc = yield* Ref.get(accRef);
        expect(acc.totalTokens).toBe(500);
        expect(acc.totalCostUsd).toBeCloseTo(0.05);
        expect(acc.elapsedMs).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it("no cost extractor — zero cost added", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const accRef = yield* Ref.make<ExecutionAccumulatorState>(initialAccumulator());
        const mw = withCostTracking<TestState>(accRef);

        yield* mw(testStep, initialState, mockNext(resultState));

        const acc = yield* Ref.get(accRef);
        expect(acc.totalTokens).toBe(0);
        expect(acc.totalCostUsd).toBe(0);
        // elapsedMs should still be updated (time tracking works regardless)
        expect(acc.elapsedMs).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});

// ── withTimeout ──

describe("withTimeout", () => {
  it("fast step — passes through", async () => {
    const mw = withTimeout<TestState>(5000);
    const result = await Effect.runPromise(mw(testStep, initialState, mockNext(resultState)));

    expect(result).toBe(resultState);
  });

  it("wraps next with timeout — returns correct type on success", async () => {
    const mw = withTimeout<TestState>(10000);
    const result = await Effect.runPromise(mw(testStep, initialState, mockNext(resultState)));

    expect(result.value).toEqual({ value: 42, valid: true });
  });

  it("timeout error has correct shape", async () => {
    // Use a very short timeout with a delayed next to trigger timeout
    const mw = withTimeout<TestState>(1);
    const slowNext = (_step: Step<TestState>, _state: WorldState<TestState>) =>
      Effect.sleep(100).pipe(Effect.map(() => resultState)) as Effect.Effect<
        WorldState<TestState>,
        StepExecutionError,
        never
      >;

    const exit = await Effect.runPromiseExit(mw(testStep, initialState, slowNext));

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const error = (exit.cause as any).error as StepExecutionError;
      expect(error._tag).toBe("StepExecutionError");
      expect(error.stepId).toBe("test-step");
      expect(error.message).toContain("timed out");
      expect(error.message).toContain("1ms");
    }
  });
});
