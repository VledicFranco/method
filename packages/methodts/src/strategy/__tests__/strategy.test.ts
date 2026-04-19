// SPDX-License-Identifier: Apache-2.0
/**
 * Strategy layer tests — StrategyController, runStrategy, prebuilt controllers.
 *
 * Uses script-step methodologies (no real agent needed) with MockAgentProvider
 * to satisfy the AgentProvider requirement of the runMethodology signature.
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { runStrategy } from "../run-strategy.js";
import { automatedController, interactiveController } from "../prebuilt.js";
import type { StrategyController, StrategyDecision } from "../controller.js";
import type { Methodology } from "../../methodology/methodology.js";
import type { Method } from "../../method/method.js";
import type { Step } from "../../method/step.js";
import type { DomainTheory } from "../../domain/domain-theory.js";
import type { WorldState } from "../../state/world-state.js";
import type { MethodologyResult } from "../../runtime/accumulator.js";
import { MockAgentProvider } from "../../provider/mock-provider.js";

// ── Test state type ──

type TestState = {
  phase: number;
  done: boolean;
  attempts: number;
};

// ── Test helpers ──

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

/**
 * Build a simple script step that mutates state.
 */
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

/**
 * Build a method with a single script step.
 */
function mkMethod(
  id: string,
  transform: (s: TestState) => TestState,
  objectiveCheck?: (s: TestState) => boolean,
): Method<TestState> {
  const step = mkScriptStep(`${id}-step`, transform);
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

/**
 * Build a methodology with a single method.
 * Arms: (1) select method if !done, (2) terminate if done.
 */
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
    terminationCertificate: { measure: () => 1, decreases: "Test methodology." },
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

describe("runStrategy", () => {
  it("with automatedController: methodology completes → StrategyResult.status = completed", async () => {
    const method = mkMethod("complete", (s) => ({ ...s, done: true }));
    const methodology = mkMethodology(method);
    const controller = automatedController<TestState>(methodology, []);
    const initial = mkWorldState({ phase: 0, done: false, attempts: 0 });

    const result = await Effect.runPromise(
      runStrategy(controller, initial).pipe(Effect.provide(emptyProvider)),
    );

    expect(result.status).toBe("completed");
    expect(result.finalState.value.done).toBe(true);
    expect(result.runs.length).toBe(1);
    expect(result.totalLoops).toBe(1);
  });

  it("methodology fails, onComplete returns rerun → runs again, completes 2nd time", async () => {
    // First methodology: hits safety_violation (maxLoops=1) without setting done
    // The step increments attempts but never sets done=true, and the methodology
    // safety bound (maxLoops=1) triggers a safety_violation.
    const failMethod = mkMethod(
      "fail-method",
      (s) => ({ ...s, attempts: s.attempts + 1 }),
      (s) => s.done, // objective never met
    );
    const failMethodology = mkMethodology(failMethod, { maxLoops: 1 });

    // Second methodology: completes immediately
    const succeedMethod = mkMethod(
      "succeed-method",
      (s) => ({ ...s, done: true, attempts: s.attempts + 1 }),
    );
    const succeedMethodology = mkMethodology(succeedMethod);

    // Controller: first run uses failing methodology, on rerun switch to succeeding one
    let runIndex = 0;
    const controller: StrategyController<TestState> = {
      id: "retry-controller",
      name: "Retry Controller",
      methodology: failMethodology,
      gates: [],
      onComplete: (result) => {
        runIndex++;
        if (result.status === "completed") {
          return Effect.succeed({ tag: "done", result } as StrategyDecision<TestState>);
        }
        // First run failed → rerun with the succeeding methodology
        return Effect.succeed({
          tag: "rerun",
          methodology: succeedMethodology,
        } as StrategyDecision<TestState>);
      },
      safety: { maxLoops: 5, maxTokens: 1_000_000, maxCostUsd: 50, maxDurationMs: 60_000, maxDepth: 3 },
    };

    const initial = mkWorldState({ phase: 0, done: false, attempts: 0 });

    const result = await Effect.runPromise(
      runStrategy(controller, initial).pipe(Effect.provide(emptyProvider)),
    );

    expect(result.status).toBe("completed");
    expect(result.totalLoops).toBe(2);
    expect(result.runs.length).toBe(2);
    expect(result.runs[0].status).not.toBe("completed");
    expect(result.runs[1].status).toBe("completed");
  });

  it("safety bounds exceeded (maxLoops=1) → safety_violation", async () => {
    // Method that never completes — methodology with low internal maxLoops
    // so it hits safety_violation quickly inside runMethodology
    const method = mkMethod(
      "never-done",
      (s) => ({ ...s, attempts: s.attempts + 1 }),
      (s) => s.done,
    );
    const methodology = mkMethodology(method, { maxLoops: 1 });

    const controller = automatedController<TestState>(methodology, [], {
      maxLoops: 1,
    });
    const initial = mkWorldState({ phase: 0, done: false, attempts: 0 });

    const result = await Effect.runPromise(
      runStrategy(controller, initial).pipe(Effect.provide(emptyProvider)),
    );

    expect(result.status).toBe("safety_violation");
    expect(result.totalLoops).toBe(1);
    expect(result.runs.length).toBe(1);
  });

  it("onComplete returns abort → aborted", async () => {
    const method = mkMethod("abort-method", (s) => ({ ...s, done: true }));
    const methodology = mkMethodology(method);

    const controller: StrategyController<TestState> = {
      id: "abort-controller",
      name: "Abort Controller",
      methodology,
      gates: [],
      onComplete: (_result) => {
        return Effect.succeed({ tag: "abort", reason: "User cancelled" } as StrategyDecision<TestState>);
      },
      safety: { maxLoops: 5, maxTokens: 1_000_000, maxCostUsd: 50, maxDurationMs: 60_000, maxDepth: 3 },
    };

    const initial = mkWorldState({ phase: 0, done: false, attempts: 0 });

    const result = await Effect.runPromise(
      runStrategy(controller, initial).pipe(Effect.provide(emptyProvider)),
    );

    expect(result.status).toBe("aborted");
    expect(result.totalLoops).toBe(1);
  });

  it("switch_methodology → different methodology runs", async () => {
    const methodA = mkMethod("method-a", (s) => ({
      ...s,
      phase: 1,
      attempts: s.attempts + 1,
    }));
    const methodB = mkMethod("method-b", (s) => ({
      ...s,
      done: true,
      phase: 2,
      attempts: s.attempts + 1,
    }));

    const methodologyA = mkMethodology(methodA);
    const methodologyB = mkMethodology(methodB);

    let runIndex = 0;
    const controller: StrategyController<TestState> = {
      id: "switch-controller",
      name: "Switch Controller",
      methodology: methodologyA,
      gates: [],
      onComplete: (result) => {
        runIndex++;
        if (runIndex === 1) {
          // First run with methodology A → switch to B
          return Effect.succeed({
            tag: "switch_methodology",
            methodology: methodologyB,
          } as StrategyDecision<TestState>);
        }
        // Second run with methodology B → done
        return Effect.succeed({ tag: "done", result } as StrategyDecision<TestState>);
      },
      safety: { maxLoops: 5, maxTokens: 1_000_000, maxCostUsd: 50, maxDurationMs: 60_000, maxDepth: 3 },
    };

    const initial = mkWorldState({ phase: 0, done: false, attempts: 0 });

    const result = await Effect.runPromise(
      runStrategy(controller, initial).pipe(Effect.provide(emptyProvider)),
    );

    expect(result.status).toBe("completed");
    expect(result.totalLoops).toBe(2);
    expect(result.runs.length).toBe(2);
    expect(result.finalState.value.phase).toBe(2);
    expect(result.finalState.value.done).toBe(true);
  });

  it("StrategyResult.runs contains all MethodologyResults", async () => {
    // Methodology that always hits safety_violation (maxLoops=1, never sets done)
    const failMethod = mkMethod(
      "multi-fail",
      (s) => ({ ...s, attempts: s.attempts + 1 }),
      (s) => s.done,
    );
    const failMethodology = mkMethodology(failMethod, { maxLoops: 1 });

    // Methodology that completes
    const succeedMethod = mkMethod(
      "multi-succeed",
      (s) => ({ ...s, done: true, attempts: s.attempts + 1 }),
    );
    const succeedMethodology = mkMethodology(succeedMethod);

    let strategyRunCount = 0;
    const controller: StrategyController<TestState> = {
      id: "multi-controller",
      name: "Multi Controller",
      methodology: failMethodology,
      gates: [],
      onComplete: (result) => {
        strategyRunCount++;
        if (result.status === "completed") {
          return Effect.succeed({ tag: "done", result } as StrategyDecision<TestState>);
        }
        // After 2 failures, switch to the succeeding methodology
        if (strategyRunCount >= 2) {
          return Effect.succeed({
            tag: "rerun",
            methodology: succeedMethodology,
          } as StrategyDecision<TestState>);
        }
        return Effect.succeed({ tag: "rerun" } as StrategyDecision<TestState>);
      },
      safety: { maxLoops: 10, maxTokens: 1_000_000, maxCostUsd: 50, maxDurationMs: 60_000, maxDepth: 3 },
    };

    const initial = mkWorldState({ phase: 0, done: false, attempts: 0 });

    const result = await Effect.runPromise(
      runStrategy(controller, initial).pipe(Effect.provide(emptyProvider)),
    );

    expect(result.runs.length).toBe(3);
    expect(result.totalLoops).toBe(3);
    // Each run is a MethodologyResult with the expected shape
    for (const run of result.runs) {
      expect(run).toHaveProperty("status");
      expect(run).toHaveProperty("finalState");
      expect(run).toHaveProperty("trace");
      expect(run).toHaveProperty("accumulator");
    }
  });

  it("totalCostUsd accumulated across runs", async () => {
    // First methodology: hits safety_violation (maxLoops=1) without completing
    const failMethod = mkMethod(
      "cost-fail",
      (s) => ({ ...s, attempts: s.attempts + 1 }),
      (s) => s.done,
    );
    const failMethodology = mkMethodology(failMethod, { maxLoops: 1 });

    // Second methodology: completes
    const succeedMethod = mkMethod(
      "cost-succeed",
      (s) => ({ ...s, done: true, attempts: s.attempts + 1 }),
    );
    const succeedMethodology = mkMethodology(succeedMethod);

    let strategyRunCount = 0;
    const controller: StrategyController<TestState> = {
      id: "cost-controller",
      name: "Cost Controller",
      methodology: failMethodology,
      gates: [],
      onComplete: (result) => {
        strategyRunCount++;
        if (result.status === "completed") {
          return Effect.succeed({ tag: "done", result } as StrategyDecision<TestState>);
        }
        // After first failure, switch to succeeding methodology
        return Effect.succeed({
          tag: "rerun",
          methodology: succeedMethodology,
        } as StrategyDecision<TestState>);
      },
      safety: { maxLoops: 5, maxTokens: 1_000_000, maxCostUsd: 50, maxDurationMs: 60_000, maxDepth: 3 },
    };

    const initial = mkWorldState({ phase: 0, done: false, attempts: 0 });

    const result = await Effect.runPromise(
      runStrategy(controller, initial).pipe(Effect.provide(emptyProvider)),
    );

    // totalCostUsd is the sum across all runs. Script steps have 0 cost,
    // so the total is 0, but the accumulation logic is exercised.
    expect(result.totalCostUsd).toBe(0);
    expect(result.totalLoops).toBe(2);
    // Verify each run's accumulator.totalCostUsd is accessible
    for (const run of result.runs) {
      expect(typeof run.accumulator.totalCostUsd).toBe("number");
    }
  });
});

describe("automatedController", () => {
  it("completed methodology → done decision", async () => {
    const method = mkMethod("auto-done", (s) => ({ ...s, done: true }));
    const methodology = mkMethodology(method);
    const controller = automatedController<TestState>(methodology, []);

    // Simulate a completed methodology result
    const fakeResult: MethodologyResult<TestState> = {
      status: "completed",
      finalState: mkWorldState({ phase: 1, done: true, attempts: 1 }),
      trace: {
        snapshots: [],
        initial: mkWorldState({ phase: 0, done: false, attempts: 0 }),
        current: mkWorldState({ phase: 1, done: true, attempts: 1 }),
      },
      accumulator: {
        loopCount: 1,
        totalTokens: 0,
        totalCostUsd: 0,
        startedAt: new Date(),
        elapsedMs: 0,
        suspensionCount: 0,
        completedMethods: [],
      },
    };

    const decision = await Effect.runPromise(controller.onComplete(fakeResult));
    expect(decision.tag).toBe("done");
  });

  it("failed methodology → rerun decision", async () => {
    const method = mkMethod("auto-retry", (s) => s);
    const methodology = mkMethodology(method);
    const controller = automatedController<TestState>(methodology, []);

    const fakeResult: MethodologyResult<TestState> = {
      status: "failed",
      finalState: mkWorldState({ phase: 0, done: false, attempts: 1 }),
      trace: {
        snapshots: [],
        initial: mkWorldState({ phase: 0, done: false, attempts: 0 }),
        current: mkWorldState({ phase: 0, done: false, attempts: 1 }),
      },
      accumulator: {
        loopCount: 1,
        totalTokens: 0,
        totalCostUsd: 0,
        startedAt: new Date(),
        elapsedMs: 0,
        suspensionCount: 0,
        completedMethods: [],
      },
    };

    const decision = await Effect.runPromise(controller.onComplete(fakeResult));
    expect(decision.tag).toBe("rerun");
  });

  it("uses default safety bounds when none provided", () => {
    const method = mkMethod("defaults", (s) => s);
    const methodology = mkMethodology(method);
    const controller = automatedController<TestState>(methodology, []);

    expect(controller.safety.maxLoops).toBe(3);
    expect(controller.safety.maxTokens).toBe(500_000);
    expect(controller.safety.maxCostUsd).toBe(10);
    expect(controller.safety.maxDurationMs).toBe(3_600_000);
    expect(controller.safety.maxDepth).toBe(3);
  });

  it("merges partial safety overrides with defaults", () => {
    const method = mkMethod("partial-safety", (s) => s);
    const methodology = mkMethodology(method);
    const controller = automatedController<TestState>(methodology, [], {
      maxLoops: 7,
      maxCostUsd: 25,
    });

    expect(controller.safety.maxLoops).toBe(7);
    expect(controller.safety.maxCostUsd).toBe(25);
    // Defaults preserved for non-overridden fields
    expect(controller.safety.maxTokens).toBe(500_000);
    expect(controller.safety.maxDurationMs).toBe(3_600_000);
    expect(controller.safety.maxDepth).toBe(3);
  });
});

describe("interactiveController", () => {
  it("always returns done regardless of result status", async () => {
    const method = mkMethod("interactive", (s) => s);
    const methodology = mkMethodology(method);
    const controller = interactiveController<TestState>(methodology, []);

    // Even a failed result gets "done" — the human decides next steps
    const failedResult: MethodologyResult<TestState> = {
      status: "failed",
      finalState: mkWorldState({ phase: 0, done: false, attempts: 0 }),
      trace: {
        snapshots: [],
        initial: mkWorldState({ phase: 0, done: false, attempts: 0 }),
        current: mkWorldState({ phase: 0, done: false, attempts: 0 }),
      },
      accumulator: {
        loopCount: 1,
        totalTokens: 0,
        totalCostUsd: 0,
        startedAt: new Date(),
        elapsedMs: 0,
        suspensionCount: 0,
        completedMethods: [],
      },
    };

    const decision = await Effect.runPromise(controller.onComplete(failedResult));
    expect(decision.tag).toBe("done");
  });
});
