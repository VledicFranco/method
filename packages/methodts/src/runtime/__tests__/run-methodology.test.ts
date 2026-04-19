// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for runMethod (DAG traversal) and runMethodology (coalgebraic loop).
 *
 * Builds test methodologies with script and agent steps, validates the
 * coalgebraic loop, safety bounds, accumulator tracking, and agent integration.
 */

import { describe, it, expect } from "vitest";
import { Effect, Layer, pipe } from "effect";
import type { DomainTheory } from "../../domain/domain-theory.js";
import type { Method } from "../../method/method.js";
import type { Step, StepContext } from "../../method/step.js";
import type { StepDAG } from "../../method/dag.js";
import type { Methodology, Arm, SafetyBounds } from "../../methodology/methodology.js";
import type { WorldState } from "../../state/world-state.js";
import { TRUE, check } from "../../predicate/predicate.js";
import { Prompt } from "../../prompt/prompt.js";
import { AgentProvider } from "../../provider/agent-provider.js";
import { MockAgentProvider } from "../../provider/mock-provider.js";
import { runMethod, type RunMethodError, type StepExecutor } from "../run-method.js";
import { runMethodology, runMethodologyToCompletion } from "../run-methodology.js";

// ── Test state type ──

type TestState = { phase: number; done: boolean; count: number };

// ── Helpers ──

function makeWorldState(s: TestState): WorldState<TestState> {
  return { value: s, axiomStatus: { valid: true, violations: [] } };
}

// Domain with no axioms (always valid)
const testDomain: DomainTheory<TestState> = {
  id: "test-domain",
  signature: { sorts: [], functionSymbols: [], predicates: {} },
  axioms: {},
};

// ── Step & Method factories ──

function makeScriptStep(
  id: string,
  fn: (s: TestState) => TestState,
): Step<TestState> {
  return {
    id,
    name: id,
    role: "worker",
    precondition: TRUE,
    postcondition: TRUE,
    execution: {
      tag: "script",
      execute: (state: TestState) => Effect.succeed(fn(state)),
    },
  };
}

function makeAgentStep(
  id: string,
  parseResult: (raw: string, current: TestState) => TestState,
): Step<TestState> {
  return {
    id,
    name: id,
    role: "worker",
    precondition: TRUE,
    postcondition: TRUE,
    execution: {
      tag: "agent",
      role: "worker",
      context: {},
      prompt: new Prompt<StepContext<TestState>>((ctx) => `Current count: ${ctx.state.count}`),
      parse: (raw: string, current: TestState) => {
        try {
          const result = parseResult(raw, current);
          return Effect.succeed(result);
        } catch (e: any) {
          return Effect.fail({ _tag: "ParseError" as const, message: e.message ?? "Parse failed", raw });
        }
      },
    },
  };
}

function makeSingleStepDAG(step: Step<TestState>): StepDAG<TestState> {
  return {
    steps: [step],
    edges: [],
    initial: step.id,
    terminal: step.id,
  };
}

function makeTwoStepDAG(
  step1: Step<TestState>,
  step2: Step<TestState>,
): StepDAG<TestState> {
  return {
    steps: [step1, step2],
    edges: [{ from: step1.id, to: step2.id }],
    initial: step1.id,
    terminal: step2.id,
  };
}

function makeMethod(
  id: string,
  dag: StepDAG<TestState>,
  objectiveCheck: (s: TestState) => boolean,
): Method<TestState> {
  return {
    id,
    name: id,
    domain: testDomain,
    roles: [],
    dag,
    objective: check("objective", objectiveCheck),
    measures: [],
  };
}

function makeMethodology(
  arms: Arm<TestState>[],
  safety?: Partial<SafetyBounds>,
): Methodology<TestState> {
  return {
    id: "test-methodology",
    name: "Test Methodology",
    domain: testDomain,
    arms,
    objective: check("done", (s: TestState) => s.done),
    terminationCertificate: {
      measure: (s: TestState) => (s.done ? 0 : 1),
      decreases: "done flag transitions from false to true",
    },
    safety: {
      maxLoops: safety?.maxLoops ?? 10,
      maxTokens: safety?.maxTokens ?? 1_000_000,
      maxCostUsd: safety?.maxCostUsd ?? 100,
      maxDurationMs: safety?.maxDurationMs ?? 3_600_000,
      maxDepth: safety?.maxDepth ?? 5,
    },
  };
}

// A no-op mock provider for script-only tests (never actually called)
const noopMockLayer = MockAgentProvider({
  responses: [],
  fallback: { raw: "{}", cost: { tokens: 0, usd: 0, duration_ms: 0 } },
});

/**
 * Simple script-only step executor for runMethod tests.
 * Handles the WorldServices → AgentProvider cast needed because script steps
 * declare WorldServices (Record<string, never>) as their R parameter.
 */
function scriptExecutor(methodId: string): StepExecutor<TestState> {
  return (step, ws) => {
    if (step.execution.tag === "script") {
      return step.execution.execute(ws.value).pipe(
        Effect.map((v): WorldState<TestState> => ({
          value: v,
          axiomStatus: { valid: true, violations: [] },
        })),
        Effect.mapError((): RunMethodError => ({
          _tag: "RunMethodError",
          methodId,
          stepId: step.id,
          message: "Step failed",
        })),
      ) as unknown as Effect.Effect<WorldState<TestState>, RunMethodError, AgentProvider>;
    }
    return Effect.fail({
      _tag: "RunMethodError" as const,
      methodId,
      message: "Unexpected agent step in script executor",
    });
  };
}

// ── runMethod tests ──

describe("runMethod", () => {
  it("executes a single script step and reports objective met", async () => {
    const step = makeScriptStep("inc", (s) => ({ ...s, count: s.count + 1 }));
    const method = makeMethod("m-inc", makeSingleStepDAG(step), (s) => s.count > 0);
    const state = makeWorldState({ phase: 1, done: false, count: 0 });

    const result = await Effect.runPromise(
      pipe(runMethod(method, state, scriptExecutor(method.id)), Effect.provide(noopMockLayer)),
    );

    expect(result.status).toBe("completed");
    expect(result.objectiveMet).toBe(true);
    expect(result.finalState.value.count).toBe(1);
    expect(result.stepResults).toHaveLength(1);
    expect(result.stepResults[0].stepId).toBe("inc");
    expect(result.stepResults[0].status).toBe("completed");
    expect(result.stepResults[0].executionTag).toBe("script");
  });

  it("executes two steps in topological order", async () => {
    const step1 = makeScriptStep("first", (s) => ({ ...s, count: s.count + 10 }));
    const step2 = makeScriptStep("second", (s) => ({ ...s, count: s.count * 2 }));
    const method = makeMethod("m-two", makeTwoStepDAG(step1, step2), (s) => s.count === 20);
    const state = makeWorldState({ phase: 1, done: false, count: 0 });

    const result = await Effect.runPromise(
      pipe(runMethod(method, state, scriptExecutor(method.id)), Effect.provide(noopMockLayer)),
    );

    expect(result.status).toBe("completed");
    expect(result.objectiveMet).toBe(true);
    expect(result.finalState.value.count).toBe(20); // 0 + 10 = 10, 10 * 2 = 20
    expect(result.stepResults).toHaveLength(2);
    expect(result.stepResults[0].stepId).toBe("first");
    expect(result.stepResults[1].stepId).toBe("second");
  });

  it("reports objective_not_met when objective fails", async () => {
    const step = makeScriptStep("inc", (s) => ({ ...s, count: s.count + 1 }));
    // Objective requires count > 100 — will not be met
    const method = makeMethod("m-unmet", makeSingleStepDAG(step), (s) => s.count > 100);
    const state = makeWorldState({ phase: 1, done: false, count: 0 });

    const result = await Effect.runPromise(
      pipe(runMethod(method, state, scriptExecutor(method.id)), Effect.provide(noopMockLayer)),
    );

    expect(result.status).toBe("objective_not_met");
    expect(result.objectiveMet).toBe(false);
    expect(result.finalState.value.count).toBe(1);
  });

  it("records before/after snapshots for each step", async () => {
    const step = makeScriptStep("snap", (s) => ({ ...s, count: 42 }));
    const method = makeMethod("m-snap", makeSingleStepDAG(step), () => true);
    const state = makeWorldState({ phase: 1, done: false, count: 0 });

    const result = await Effect.runPromise(
      pipe(runMethod(method, state, scriptExecutor(method.id)), Effect.provide(noopMockLayer)),
    );

    const sr = result.stepResults[0];
    expect(sr.before.state.value.count).toBe(0);
    expect(sr.after.state.value.count).toBe(42);
    expect(sr.before.metadata.stepId).toBe("snap");
    expect(sr.before.metadata.methodId).toBe("m-snap");
    expect(sr.before.sequence).toBe(0);
    expect(sr.after.sequence).toBe(1);
  });
});

// ── runMethodology tests ──

describe("runMethodology", () => {
  it("simple 1-method methodology: runs script step, terminates with completed", async () => {
    // Method increments count and sets done
    const step = makeScriptStep("set-done", (s) => ({ ...s, count: 1, done: true }));
    const method = makeMethod("m-done", makeSingleStepDAG(step), (s) => s.done);

    const methodology = makeMethodology([
      {
        priority: 1,
        label: "execute",
        condition: check("not-done", (s: TestState) => !s.done),
        selects: method,
        rationale: "Run when not done.",
      },
      {
        priority: 2,
        label: "terminate",
        condition: check("done", (s: TestState) => s.done),
        selects: null,
        rationale: "Terminate when done.",
      },
    ]);

    const state = makeWorldState({ phase: 1, done: false, count: 0 });

    const result = await Effect.runPromise(
      pipe(runMethodology(methodology, state), Effect.provide(noopMockLayer)),
    );

    expect(result.status).toBe("completed");
    expect(result.finalState.value.done).toBe(true);
    expect(result.finalState.value.count).toBe(1);
    expect(result.accumulator.loopCount).toBe(1);
    expect(result.accumulator.completedMethods).toHaveLength(1);
    expect(result.accumulator.completedMethods[0].methodId).toBe("m-done");
  });

  it("2-method methodology: phase transitions, sequential method execution", async () => {
    // Method 1: incrementer (phase 1 → phase 2)
    const incStep = makeScriptStep("inc-step", (s) => ({
      ...s,
      count: s.count + 1,
      phase: 2,
    }));
    const incrementer = makeMethod("m-increment", makeSingleStepDAG(incStep), (s) => s.phase === 2);

    // Method 2: finalizer (sets done)
    const finStep = makeScriptStep("fin-step", (s) => ({
      ...s,
      done: true,
    }));
    const finalizer = makeMethod("m-finalize", makeSingleStepDAG(finStep), (s) => s.done);

    const methodology = makeMethodology([
      {
        priority: 1,
        label: "terminate",
        condition: check("done", (s: TestState) => s.done),
        selects: null,
        rationale: "Terminate when done (highest priority).",
      },
      {
        priority: 2,
        label: "increment",
        condition: check("phase-1", (s: TestState) => s.phase === 1),
        selects: incrementer,
        rationale: "Increment when in phase 1.",
      },
      {
        priority: 3,
        label: "finalize",
        condition: check("phase-2", (s: TestState) => s.phase === 2),
        selects: finalizer,
        rationale: "Finalize when in phase 2.",
      },
    ]);

    const state = makeWorldState({ phase: 1, done: false, count: 0 });

    const result = await Effect.runPromise(
      pipe(runMethodology(methodology, state), Effect.provide(noopMockLayer)),
    );

    expect(result.status).toBe("completed");
    expect(result.finalState.value.phase).toBe(2);
    expect(result.finalState.value.count).toBe(1);
    expect(result.finalState.value.done).toBe(true);
    expect(result.accumulator.loopCount).toBe(2);
    expect(result.accumulator.completedMethods).toHaveLength(2);
    expect(result.accumulator.completedMethods[0].methodId).toBe("m-increment");
    expect(result.accumulator.completedMethods[1].methodId).toBe("m-finalize");
  });

  it("safety violation: maxLoops=1 causes safety_violation on second loop", async () => {
    // Method that does NOT set done — will loop forever
    const step = makeScriptStep("loop-step", (s) => ({ ...s, count: s.count + 1 }));
    const looper = makeMethod("m-loop", makeSingleStepDAG(step), (s) => s.count > 0);

    const methodology = makeMethodology(
      [
        {
          priority: 1,
          label: "loop",
          condition: check("not-done", (s: TestState) => !s.done),
          selects: looper,
          rationale: "Keep looping.",
        },
        {
          priority: 2,
          label: "terminate",
          condition: check("done", (s: TestState) => s.done),
          selects: null,
          rationale: "Terminate when done.",
        },
      ],
      { maxLoops: 1 },
    );

    const state = makeWorldState({ phase: 1, done: false, count: 0 });

    const result = await Effect.runPromise(
      pipe(runMethodology(methodology, state), Effect.provide(noopMockLayer)),
    );

    expect(result.status).toBe("safety_violation");
    expect(result.violation).toBeDefined();
    expect(result.violation!.bound).toBe("maxLoops");
    expect(result.violation!.limit).toBe(1);
    expect(result.violation!.actual).toBe(1);
    expect(result.accumulator.loopCount).toBe(1);
  });

  it("method objective not met: returns to loop, different arm fires", async () => {
    // Method 1: increments count but does NOT achieve its own objective (count > 100)
    // The methodology loop should continue and the next arm should fire
    const incStep = makeScriptStep("inc", (s) => ({
      ...s,
      count: s.count + 1,
      phase: 2,
    }));
    const weakMethod = makeMethod("m-weak", makeSingleStepDAG(incStep), (s) => s.count > 100);

    // Method 2: sets done
    const doneStep = makeScriptStep("done", (s) => ({ ...s, done: true }));
    const doneMethod = makeMethod("m-done", makeSingleStepDAG(doneStep), (s) => s.done);

    const methodology = makeMethodology([
      {
        priority: 1,
        label: "weak-increment",
        condition: check("phase-1", (s: TestState) => s.phase === 1),
        selects: weakMethod,
        rationale: "Run weak method in phase 1.",
      },
      {
        priority: 2,
        label: "finish",
        condition: check("phase-2", (s: TestState) => s.phase === 2 && !s.done),
        selects: doneMethod,
        rationale: "Finish when in phase 2.",
      },
      {
        priority: 3,
        label: "terminate",
        condition: check("done", (s: TestState) => s.done),
        selects: null,
        rationale: "Terminate when done.",
      },
    ]);

    const state = makeWorldState({ phase: 1, done: false, count: 0 });

    const result = await Effect.runPromise(
      pipe(runMethodology(methodology, state), Effect.provide(noopMockLayer)),
    );

    expect(result.status).toBe("completed");
    // First method's objective was NOT met (count=1, needs >100), but methodology continues
    expect(result.accumulator.completedMethods[0].objectiveMet).toBe(false);
    expect(result.accumulator.completedMethods[1].objectiveMet).toBe(true);
    expect(result.finalState.value.done).toBe(true);
    expect(result.accumulator.loopCount).toBe(2);
  });

  it("runMethodologyToCompletion: produces same result as runMethodology", async () => {
    const step = makeScriptStep("complete", (s) => ({ ...s, done: true, count: 99 }));
    const method = makeMethod("m-complete", makeSingleStepDAG(step), (s) => s.done);

    const methodology = makeMethodology([
      {
        priority: 1,
        label: "run",
        condition: check("not-done", (s: TestState) => !s.done),
        selects: method,
        rationale: "Run.",
      },
      {
        priority: 2,
        label: "terminate",
        condition: check("done", (s: TestState) => s.done),
        selects: null,
        rationale: "Terminate.",
      },
    ]);

    const state = makeWorldState({ phase: 1, done: false, count: 0 });

    const result = await Effect.runPromise(
      pipe(runMethodologyToCompletion(methodology, state), Effect.provide(noopMockLayer)),
    );

    expect(result.status).toBe("completed");
    expect(result.finalState.value.count).toBe(99);
    expect(result.finalState.value.done).toBe(true);
    expect(result.accumulator.loopCount).toBe(1);
  });

  it("accumulator tracks loopCount and completedMethods accurately", async () => {
    // 3-phase methodology: phase 1 → phase 2 → phase 3 → done
    const step1 = makeScriptStep("s1", (s) => ({ ...s, phase: 2, count: s.count + 1 }));
    const m1 = makeMethod("m1", makeSingleStepDAG(step1), () => true);

    const step2 = makeScriptStep("s2", (s) => ({ ...s, phase: 3, count: s.count + 10 }));
    const m2 = makeMethod("m2", makeSingleStepDAG(step2), () => true);

    const step3 = makeScriptStep("s3", (s) => ({ ...s, done: true, count: s.count + 100 }));
    const m3 = makeMethod("m3", makeSingleStepDAG(step3), (s) => s.done);

    const methodology = makeMethodology([
      {
        priority: 1,
        label: "terminate",
        condition: check("done", (s: TestState) => s.done),
        selects: null,
        rationale: "Done (highest priority).",
      },
      {
        priority: 2,
        label: "phase-1",
        condition: check("p1", (s: TestState) => s.phase === 1),
        selects: m1,
        rationale: "Phase 1.",
      },
      {
        priority: 3,
        label: "phase-2",
        condition: check("p2", (s: TestState) => s.phase === 2),
        selects: m2,
        rationale: "Phase 2.",
      },
      {
        priority: 4,
        label: "phase-3",
        condition: check("p3", (s: TestState) => s.phase === 3),
        selects: m3,
        rationale: "Phase 3.",
      },
    ]);

    const state = makeWorldState({ phase: 1, done: false, count: 0 });

    const result = await Effect.runPromise(
      pipe(runMethodology(methodology, state), Effect.provide(noopMockLayer)),
    );

    expect(result.status).toBe("completed");
    expect(result.accumulator.loopCount).toBe(3);
    expect(result.accumulator.completedMethods).toHaveLength(3);
    expect(result.accumulator.completedMethods.map((m) => m.methodId)).toEqual(["m1", "m2", "m3"]);
    expect(result.finalState.value.count).toBe(111); // 1 + 10 + 100
    expect(result.finalState.value.done).toBe(true);
  });

  it("fails when initial state violates domain axioms", async () => {
    const domainWithAxiom: DomainTheory<TestState> = {
      id: "strict-domain",
      signature: { sorts: [], functionSymbols: [], predicates: {} },
      axioms: {
        "count-non-negative": check("count >= 0", (s: TestState) => s.count >= 0),
      },
    };

    const step = makeScriptStep("noop", (s) => s);
    const method: Method<TestState> = {
      id: "m-noop",
      name: "m-noop",
      domain: domainWithAxiom,
      roles: [],
      dag: makeSingleStepDAG(step),
      objective: TRUE,
      measures: [],
    };

    const methodology: Methodology<TestState> = {
      id: "test-axiom",
      name: "Test Axiom",
      domain: domainWithAxiom,
      arms: [
        { priority: 1, label: "run", condition: TRUE, selects: method, rationale: "Run." },
      ],
      objective: TRUE,
      terminationCertificate: { measure: () => 0, decreases: "trivial" },
      safety: { maxLoops: 10, maxTokens: 1_000_000, maxCostUsd: 100, maxDurationMs: 3_600_000, maxDepth: 5 },
    };

    // Initial state with count = -1 violates the axiom
    const state = makeWorldState({ phase: 1, done: false, count: -1 });

    const result = await Effect.runPromise(
      pipe(runMethodology(methodology, state), Effect.provide(noopMockLayer)),
    );

    expect(result.status).toBe("failed");
  });

  it("agent step with MockAgentProvider: execute, parse, state updated", async () => {
    // Agent step that parses JSON from agent output
    const agentStep = makeAgentStep("agent-step", (raw, current) => {
      const parsed = JSON.parse(raw);
      return { ...current, ...parsed };
    });

    const method = makeMethod("m-agent", makeSingleStepDAG(agentStep), (s) => s.count > 0);

    const methodology = makeMethodology([
      {
        priority: 1,
        label: "agent-run",
        condition: check("not-done", (s: TestState) => !s.done),
        selects: method,
        rationale: "Run agent.",
      },
      {
        priority: 2,
        label: "terminate",
        condition: check("done-or-count", (s: TestState) => s.done || s.count > 0),
        selects: null,
        rationale: "Terminate.",
      },
    ]);

    const state = makeWorldState({ phase: 1, done: false, count: 0 });

    // Mock: agent returns JSON that updates count
    const mockLayer = MockAgentProvider({
      responses: [
        {
          match: (c) => c.prompt.includes("count"),
          result: {
            raw: JSON.stringify({ count: 42, done: true }),
            cost: { tokens: 100, usd: 0.003, duration_ms: 500 },
          },
        },
      ],
    });

    const result = await Effect.runPromise(
      pipe(runMethodology(methodology, state), Effect.provide(mockLayer)),
    );

    expect(result.status).toBe("completed");
    expect(result.finalState.value.count).toBe(42);
    expect(result.finalState.value.done).toBe(true);
    expect(result.accumulator.loopCount).toBe(1);
    expect(result.accumulator.completedMethods[0].methodId).toBe("m-agent");
    expect(result.accumulator.completedMethods[0].objectiveMet).toBe(true);
  });

  it("terminates immediately when no arm fires", async () => {
    const step = makeScriptStep("noop", (s) => s);
    const method = makeMethod("m-noop", makeSingleStepDAG(step), () => true);

    // Only arm requires phase === 99, which will never be true
    const methodology = makeMethodology([
      {
        priority: 1,
        label: "impossible",
        condition: check("phase-99", (s: TestState) => s.phase === 99),
        selects: method,
        rationale: "Never fires.",
      },
    ]);

    const state = makeWorldState({ phase: 1, done: false, count: 0 });

    const result = await Effect.runPromise(
      pipe(runMethodology(methodology, state), Effect.provide(noopMockLayer)),
    );

    expect(result.status).toBe("completed");
    expect(result.accumulator.loopCount).toBe(0);
    expect(result.accumulator.completedMethods).toHaveLength(0);
  });

  it("multi-step method within methodology: DAG traversal with two steps", async () => {
    const step1 = makeScriptStep("add-10", (s) => ({ ...s, count: s.count + 10 }));
    const step2 = makeScriptStep("set-done", (s) => ({ ...s, done: true }));
    const method = makeMethod("m-two-step", makeTwoStepDAG(step1, step2), (s) => s.done);

    const methodology = makeMethodology([
      {
        priority: 1,
        label: "execute",
        condition: check("not-done", (s: TestState) => !s.done),
        selects: method,
        rationale: "Run.",
      },
      {
        priority: 2,
        label: "terminate",
        condition: check("done", (s: TestState) => s.done),
        selects: null,
        rationale: "Terminate.",
      },
    ]);

    const state = makeWorldState({ phase: 1, done: false, count: 0 });

    const result = await Effect.runPromise(
      pipe(runMethodology(methodology, state), Effect.provide(noopMockLayer)),
    );

    expect(result.status).toBe("completed");
    expect(result.finalState.value.count).toBe(10);
    expect(result.finalState.value.done).toBe(true);
    expect(result.accumulator.loopCount).toBe(1);
    expect(result.accumulator.completedMethods[0].objectiveMet).toBe(true);
  });
});
