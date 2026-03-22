/**
 * Additional runStrategy tests targeting coverage gaps:
 * - Methodology run error → catchAll converts to failed result (lines 67-72)
 * - Strategy-level gate evaluation, including gate errors (lines 83-94)
 * - rerun decision with updated state
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { runStrategy } from "../run-strategy.js";
import type { StrategyController, StrategyDecision } from "../controller.js";
import type { Methodology, Arm } from "../../methodology/methodology.js";
import type { Method } from "../../method/method.js";
import type { Step } from "../../method/step.js";
import type { DomainTheory } from "../../domain/domain-theory.js";
import type { WorldState } from "../../state/world-state.js";
import type { MethodologyResult } from "../../runtime/accumulator.js";
import type { Gate, GateResult, GateError } from "../../gate/gate.js";
import { MockAgentProvider } from "../../provider/mock-provider.js";

// ── Test state type ──

type TestState = { phase: number; done: boolean; attempts: number };

// ── Helpers ──

const emptyProvider = MockAgentProvider({
  responses: [],
  fallback: { raw: "{}", cost: { tokens: 0, usd: 0, duration_ms: 0 } },
});

function mkWorldState(s: TestState): WorldState<TestState> {
  return { value: s, axiomStatus: { valid: true, violations: [] } };
}

const testDomain: DomainTheory<TestState> = {
  id: "test-domain",
  signature: { sorts: [], functionSymbols: [], predicates: {} },
  axioms: {},
};

function mkScriptStep(
  id: string,
  transform: (s: TestState) => TestState,
): Step<TestState> {
  return {
    id,
    name: id,
    role: "test",
    precondition: { tag: "val", value: true },
    postcondition: { tag: "val", value: true },
    execution: {
      tag: "script",
      execute: (state) => Effect.succeed(transform(state)),
    },
  };
}

function mkFailingScriptStep(id: string): Step<TestState> {
  return {
    id,
    name: id,
    role: "test",
    precondition: { tag: "val", value: true },
    postcondition: { tag: "val", value: true },
    execution: {
      tag: "script",
      execute: (_state) =>
        Effect.fail({
          _tag: "StepError" as const,
          stepId: id,
          message: "Deliberate script failure",
        }),
    },
  };
}

function mkMethod(
  id: string,
  step: Step<TestState>,
  objectiveCheck?: (s: TestState) => boolean,
): Method<TestState> {
  return {
    id,
    name: id,
    domain: testDomain,
    roles: [],
    dag: { steps: [step], edges: [], initial: step.id, terminal: step.id },
    objective: objectiveCheck
      ? { tag: "check", label: "objective", check: objectiveCheck }
      : { tag: "val", value: true },
    measures: [],
  };
}

function mkMethodology(
  method: Method<TestState>,
  safety?: Partial<Methodology<TestState>["safety"]>,
): Methodology<TestState> {
  return {
    id: `methodology-${method.id}`,
    name: `Methodology for ${method.name}`,
    domain: testDomain,
    arms: [
      {
        priority: 1,
        label: "execute",
        condition: { tag: "check", label: "not-done", check: (s: TestState) => !s.done },
        selects: method,
        rationale: "Run method if not done.",
      },
      {
        priority: 2,
        label: "terminate",
        condition: { tag: "check", label: "done", check: (s: TestState) => s.done },
        selects: null,
        rationale: "Terminate when done.",
      },
    ],
    objective: { tag: "check", label: "done", check: (s: TestState) => s.done },
    terminationCertificate: { measure: () => 1, decreases: "Test." },
    safety: {
      maxLoops: safety?.maxLoops ?? 10,
      maxTokens: safety?.maxTokens ?? 1_000_000,
      maxCostUsd: safety?.maxCostUsd ?? 50,
      maxDurationMs: safety?.maxDurationMs ?? 60_000,
      maxDepth: safety?.maxDepth ?? 3,
    },
  };
}

// ── Tests ──

describe("runStrategy — methodology error recovery (catchAll path)", () => {
  it("methodology error is caught and converted to failed result", async () => {
    // Build a methodology whose step always fails, which produces
    // a RunMethodError that gets caught by the catchAll in runStrategy
    const failStep = mkFailingScriptStep("fail-step");
    const method = mkMethod("fail-method", failStep, (s) => s.done);
    const methodology = mkMethodology(method);

    const controller: StrategyController<TestState> = {
      id: "error-recovery",
      name: "Error Recovery Controller",
      methodology,
      gates: [],
      onComplete: (result) => {
        // The methodology should have a "failed" status from the catchAll
        return Effect.succeed({ tag: "done", result } as StrategyDecision<TestState>);
      },
      safety: { maxLoops: 3, maxTokens: 1_000_000, maxCostUsd: 50, maxDurationMs: 60_000, maxDepth: 3 },
    };

    const initial = mkWorldState({ phase: 0, done: false, attempts: 0 });

    const result = await Effect.runPromise(
      runStrategy(controller, initial).pipe(Effect.provide(emptyProvider)),
    );

    // The run should not fail entirely — the error is caught and wrapped
    expect(result.runs.length).toBe(1);
    expect(result.totalLoops).toBe(1);
  });
});

describe("runStrategy — strategy-level gate evaluation", () => {
  it("passing gate is evaluated and recorded in gateResults", async () => {
    const step = mkScriptStep("done-step", (s) => ({ ...s, done: true }));
    const method = mkMethod("done-method", step);
    const methodology = mkMethodology(method);

    const passingGate: Gate<TestState> = {
      id: "pass-gate",
      description: "Always passes",
      predicate: { tag: "val", value: true },
      maxRetries: 0,
      evaluate: (_state) =>
        Effect.succeed({
          passed: true,
          witness: null,
          reason: "Gate passed",
          duration_ms: 0,
        } satisfies GateResult<TestState>),
    };

    const controller: StrategyController<TestState> = {
      id: "gate-controller",
      name: "Gate Controller",
      methodology,
      gates: [passingGate],
      onComplete: (result) =>
        Effect.succeed({ tag: "done", result } as StrategyDecision<TestState>),
      safety: { maxLoops: 5, maxTokens: 1_000_000, maxCostUsd: 50, maxDurationMs: 60_000, maxDepth: 3 },
    };

    const initial = mkWorldState({ phase: 0, done: false, attempts: 0 });

    const result = await Effect.runPromise(
      runStrategy(controller, initial).pipe(Effect.provide(emptyProvider)),
    );

    expect(result.status).toBe("completed");
    expect(result.gateResults).toHaveLength(1);
    expect(result.gateResults[0].passed).toBe(true);
    expect(result.gateResults[0].reason).toBe("Gate passed");
  });

  it("failing gate is recorded but does not abort strategy", async () => {
    const step = mkScriptStep("done-step", (s) => ({ ...s, done: true }));
    const method = mkMethod("done-method", step);
    const methodology = mkMethodology(method);

    const failingGate: Gate<TestState> = {
      id: "fail-gate",
      description: "Always fails",
      predicate: { tag: "val", value: true },
      maxRetries: 0,
      evaluate: (_state) =>
        Effect.succeed({
          passed: false,
          witness: null,
          reason: "Gate failed",
          duration_ms: 0,
        } satisfies GateResult<TestState>),
    };

    const controller: StrategyController<TestState> = {
      id: "failing-gate-controller",
      name: "Failing Gate Controller",
      methodology,
      gates: [failingGate],
      onComplete: (result) =>
        Effect.succeed({ tag: "done", result } as StrategyDecision<TestState>),
      safety: { maxLoops: 5, maxTokens: 1_000_000, maxCostUsd: 50, maxDurationMs: 60_000, maxDepth: 3 },
    };

    const initial = mkWorldState({ phase: 0, done: false, attempts: 0 });

    const result = await Effect.runPromise(
      runStrategy(controller, initial).pipe(Effect.provide(emptyProvider)),
    );

    expect(result.status).toBe("completed");
    expect(result.gateResults).toHaveLength(1);
    expect(result.gateResults[0].passed).toBe(false);
  });

  it("gate error (GateError) is caught and recorded as failed gate result", async () => {
    const step = mkScriptStep("done-step", (s) => ({ ...s, done: true }));
    const method = mkMethod("done-method", step);
    const methodology = mkMethodology(method);

    const errorGate: Gate<TestState> = {
      id: "error-gate",
      description: "Throws GateError",
      predicate: { tag: "val", value: true },
      maxRetries: 0,
      evaluate: (_state) =>
        Effect.fail({
          _tag: "GateError",
          gateId: "error-gate",
          message: "HTTP request failed: ECONNREFUSED",
        } as GateError),
    };

    const controller: StrategyController<TestState> = {
      id: "gate-error-controller",
      name: "Gate Error Controller",
      methodology,
      gates: [errorGate],
      onComplete: (result) =>
        Effect.succeed({ tag: "done", result } as StrategyDecision<TestState>),
      safety: { maxLoops: 5, maxTokens: 1_000_000, maxCostUsd: 50, maxDurationMs: 60_000, maxDepth: 3 },
    };

    const initial = mkWorldState({ phase: 0, done: false, attempts: 0 });

    const result = await Effect.runPromise(
      runStrategy(controller, initial).pipe(Effect.provide(emptyProvider)),
    );

    expect(result.status).toBe("completed");
    expect(result.gateResults).toHaveLength(1);
    expect(result.gateResults[0].passed).toBe(false);
    expect(result.gateResults[0].reason).toContain("ECONNREFUSED");
  });

  it("multiple gates are all evaluated in order", async () => {
    const step = mkScriptStep("done-step", (s) => ({ ...s, done: true }));
    const method = mkMethod("done-method", step);
    const methodology = mkMethodology(method);

    const gate1: Gate<TestState> = {
      id: "gate-1",
      description: "First gate",
      predicate: { tag: "val", value: true },
      maxRetries: 0,
      evaluate: (_state) =>
        Effect.succeed({ passed: true, witness: null, reason: "G1 OK", duration_ms: 0 }),
    };

    const gate2: Gate<TestState> = {
      id: "gate-2",
      description: "Second gate",
      predicate: { tag: "val", value: true },
      maxRetries: 0,
      evaluate: (_state) =>
        Effect.succeed({ passed: false, witness: null, reason: "G2 FAIL", duration_ms: 0 }),
    };

    const controller: StrategyController<TestState> = {
      id: "multi-gate-controller",
      name: "Multi Gate Controller",
      methodology,
      gates: [gate1, gate2],
      onComplete: (result) =>
        Effect.succeed({ tag: "done", result } as StrategyDecision<TestState>),
      safety: { maxLoops: 5, maxTokens: 1_000_000, maxCostUsd: 50, maxDurationMs: 60_000, maxDepth: 3 },
    };

    const initial = mkWorldState({ phase: 0, done: false, attempts: 0 });

    const result = await Effect.runPromise(
      runStrategy(controller, initial).pipe(Effect.provide(emptyProvider)),
    );

    expect(result.gateResults).toHaveLength(2);
    expect(result.gateResults[0].reason).toBe("G1 OK");
    expect(result.gateResults[1].reason).toBe("G2 FAIL");
  });
});

describe("runStrategy — rerun decision with state override", () => {
  it("rerun with updated state propagates the new state", async () => {
    const step = mkScriptStep("inc-step", (s) => ({
      ...s,
      attempts: s.attempts + 1,
      done: s.phase > 0,
    }));
    const method = mkMethod("rerun-method", step);
    const methodology = mkMethodology(method);

    let callCount = 0;
    const controller: StrategyController<TestState> = {
      id: "rerun-state",
      name: "Rerun State Controller",
      methodology,
      gates: [],
      onComplete: (result) => {
        callCount++;
        if (callCount === 1) {
          // First run: rerun with modified state (set phase=1 so done=true on next run)
          return Effect.succeed({
            tag: "rerun",
            state: mkWorldState({ phase: 1, done: false, attempts: result.finalState.value.attempts }),
          } as StrategyDecision<TestState>);
        }
        return Effect.succeed({ tag: "done", result } as StrategyDecision<TestState>);
      },
      safety: { maxLoops: 5, maxTokens: 1_000_000, maxCostUsd: 50, maxDurationMs: 60_000, maxDepth: 3 },
    };

    const initial = mkWorldState({ phase: 0, done: false, attempts: 0 });

    const result = await Effect.runPromise(
      runStrategy(controller, initial).pipe(Effect.provide(emptyProvider)),
    );

    expect(result.totalLoops).toBe(2);
    expect(result.finalState.value.done).toBe(true);
    expect(result.finalState.value.phase).toBe(1);
  });
});
