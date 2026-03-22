/**
 * Tests for agentSteeredController — agent-driven strategy decisions.
 *
 * Uses MockAgentProvider to supply canned JSON responses, and the
 * agentExecute callback pattern to satisfy the StrategyController type
 * (onComplete returns Effect<StrategyDecision, never, never>).
 *
 * @see agent-steered.ts
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { agentSteeredController } from "../agent-steered.js";
import type { AgentSteeredConfig, SteeringContext } from "../agent-steered.js";
import type { MethodologyResult } from "../../runtime/accumulator.js";
import type { Methodology } from "../../methodology/methodology.js";
import type { Method } from "../../method/method.js";
import type { Step } from "../../method/step.js";
import type { DomainTheory } from "../../domain/domain-theory.js";
import type { WorldState } from "../../state/world-state.js";
import { AgentProvider } from "../../provider/agent-provider.js";
import { MockAgentProvider } from "../../provider/mock-provider.js";
import { Prompt } from "../../prompt/prompt.js";

// ── Test state type ──

type TestState = {
  phase: number;
  done: boolean;
  attempts: number;
};

// ── Test helpers ──

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

function mkMethod(
  id: string,
  transform: (s: TestState) => TestState,
): Method<TestState> {
  const step = mkScriptStep(`${id}-step`, transform);
  return {
    id,
    name: id,
    domain: testDomain,
    roles: [],
    dag: { steps: [step], edges: [], initial: step.id, terminal: step.id },
    objective: { tag: "val", value: true },
    measures: [],
  };
}

function mkMethodology(method: Method<TestState>): Methodology<TestState> {
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
      maxLoops: 10,
      maxTokens: 1_000_000,
      maxCostUsd: 50,
      maxDurationMs: 60_000,
      maxDepth: 3,
    },
  };
}

/** Build a fake MethodologyResult for testing onComplete directly. */
function mkResult(
  status: MethodologyResult<TestState>["status"],
  costUsd: number = 0,
): MethodologyResult<TestState> {
  const state = mkWorldState({ phase: 1, done: status === "completed", attempts: 1 });
  return {
    status,
    finalState: state,
    trace: {
      snapshots: [],
      initial: mkWorldState({ phase: 0, done: false, attempts: 0 }),
      current: state,
    },
    accumulator: {
      loopCount: 1,
      totalTokens: 100,
      totalCostUsd: costUsd,
      startedAt: new Date(),
      elapsedMs: 500,
      suspensionCount: 0,
      completedMethods: [],
    },
  };
}

/**
 * Create an agentExecute callback that uses MockAgentProvider internally.
 * This closes over the provider so that onComplete can return Effect<..., never, never>.
 */
function mkAgentExecute(
  responseText: string,
): (prompt: string) => Effect.Effect<string, never, never> {
  const layer = MockAgentProvider({
    responses: [
      {
        match: () => true,
        result: { raw: responseText, cost: { tokens: 10, usd: 0.001, duration_ms: 50 } },
      },
    ],
  });

  return (prompt: string) =>
    Effect.gen(function* () {
      const provider = yield* AgentProvider;
      const result = yield* provider.execute({ prompt });
      return result.raw;
    }).pipe(
      Effect.provide(layer),
      Effect.catchAll(() => Effect.succeed('{"action":"done","reason":"agent error fallback"}')),
    );
}

/**
 * Create an agentExecute callback that always fails, triggering error handling.
 */
function mkFailingAgentExecute(): (prompt: string) => Effect.Effect<string, never, never> {
  const layer = MockAgentProvider({
    responses: [],
    failOn: [
      {
        match: () => true,
        error: { _tag: "AgentCrash" as const, message: "intentional crash" },
      },
    ],
  });

  return (prompt: string) =>
    Effect.gen(function* () {
      const provider = yield* AgentProvider;
      const result = yield* provider.execute({ prompt });
      return result.raw;
    }).pipe(
      Effect.provide(layer),
      Effect.catchAll(() => Effect.succeed('{"action":"done","reason":"agent error — defaulting to done"}')),
    );
}

/**
 * Create an agentExecute callback that captures the prompts it receives.
 */
function mkCapturingAgentExecute(
  responseText: string,
  captured: string[],
): (prompt: string) => Effect.Effect<string, never, never> {
  return (prompt: string) => {
    captured.push(prompt);
    return Effect.succeed(responseText);
  };
}

// ── Tests ──

describe("agentSteeredController", () => {
  it('agent returns {"action":"done"} → StrategyDecision.tag === "done"', async () => {
    const method = mkMethod("done-method", (s) => ({ ...s, done: true }));
    const methodology = mkMethodology(method);
    const config: AgentSteeredConfig<TestState> = { methodology, gates: [] };
    const agentExecute = mkAgentExecute('{"action":"done","reason":"all good"}');

    const controller = agentSteeredController(config, agentExecute);
    const result = mkResult("completed");

    const decision = await Effect.runPromise(controller.onComplete(result));
    expect(decision.tag).toBe("done");
    if (decision.tag === "done") {
      expect(decision.result).toBe(result);
    }
  });

  it('agent returns {"action":"rerun"} → StrategyDecision.tag === "rerun"', async () => {
    const method = mkMethod("rerun-method", (s) => s);
    const methodology = mkMethodology(method);
    const config: AgentSteeredConfig<TestState> = { methodology, gates: [] };
    const agentExecute = mkAgentExecute('{"action":"rerun","reason":"needs another pass"}');

    const controller = agentSteeredController(config, agentExecute);
    const result = mkResult("failed");

    const decision = await Effect.runPromise(controller.onComplete(result));
    expect(decision.tag).toBe("rerun");
  });

  it('agent returns {"action":"abort"} → StrategyDecision.tag === "abort"', async () => {
    const method = mkMethod("abort-method", (s) => s);
    const methodology = mkMethodology(method);
    const config: AgentSteeredConfig<TestState> = { methodology, gates: [] };
    const agentExecute = mkAgentExecute('{"action":"abort","reason":"unrecoverable failure"}');

    const controller = agentSteeredController(config, agentExecute);
    const result = mkResult("failed");

    const decision = await Effect.runPromise(controller.onComplete(result));
    expect(decision.tag).toBe("abort");
    if (decision.tag === "abort") {
      expect(decision.reason).toBe("unrecoverable failure");
    }
  });

  it("agent returns invalid JSON → defaults to done", async () => {
    const method = mkMethod("invalid-json-method", (s) => s);
    const methodology = mkMethodology(method);
    const config: AgentSteeredConfig<TestState> = { methodology, gates: [] };
    const agentExecute = mkAgentExecute("this is not valid json at all");

    const controller = agentSteeredController(config, agentExecute);
    const result = mkResult("completed");

    const decision = await Effect.runPromise(controller.onComplete(result));
    expect(decision.tag).toBe("done");
    if (decision.tag === "done") {
      expect(decision.result).toBe(result);
    }
  });

  it("agent error → defaults to done", async () => {
    const method = mkMethod("error-method", (s) => s);
    const methodology = mkMethodology(method);
    const config: AgentSteeredConfig<TestState> = { methodology, gates: [] };
    const agentExecute = mkFailingAgentExecute();

    const controller = agentSteeredController(config, agentExecute);
    const result = mkResult("completed");

    // The failing agent execute catches the error and returns a "done" JSON fallback
    const decision = await Effect.runPromise(controller.onComplete(result));
    expect(decision.tag).toBe("done");
  });

  it("runCount increments across calls", async () => {
    const method = mkMethod("counting-method", (s) => s);
    const methodology = mkMethodology(method);
    const config: AgentSteeredConfig<TestState> = { methodology, gates: [] };

    // Use a capturing execute to verify the prompt content changes
    const captured: string[] = [];
    const agentExecute = mkCapturingAgentExecute(
      '{"action":"rerun","reason":"again"}',
      captured,
    );

    const controller = agentSteeredController(config, agentExecute);

    // Call onComplete 3 times
    await Effect.runPromise(controller.onComplete(mkResult("failed")));
    await Effect.runPromise(controller.onComplete(mkResult("failed")));
    await Effect.runPromise(controller.onComplete(mkResult("failed")));

    // Each call should reference increasing run counts in the prompt
    expect(captured.length).toBe(3);
    expect(captured[0]).toContain("Runs so far: 1");
    expect(captured[1]).toContain("Runs so far: 2");
    expect(captured[2]).toContain("Runs so far: 3");
  });

  it("totalCostUsd accumulates across calls", async () => {
    const method = mkMethod("cost-method", (s) => s);
    const methodology = mkMethodology(method);
    const config: AgentSteeredConfig<TestState> = { methodology, gates: [] };

    const captured: string[] = [];
    const agentExecute = mkCapturingAgentExecute(
      '{"action":"rerun","reason":"continuing"}',
      captured,
    );

    const controller = agentSteeredController(config, agentExecute);

    // Each result has a cost — call multiple times
    await Effect.runPromise(controller.onComplete(mkResult("failed", 1.50)));
    await Effect.runPromise(controller.onComplete(mkResult("failed", 2.25)));
    await Effect.runPromise(controller.onComplete(mkResult("completed", 0.75)));

    expect(captured.length).toBe(3);
    // First call: total = 1.50
    expect(captured[0]).toContain("Total cost: $1.50");
    // Second call: total = 1.50 + 2.25 = 3.75
    expect(captured[1]).toContain("Total cost: $3.75");
    // Third call: total = 3.75 + 0.75 = 4.50
    expect(captured[2]).toContain("Total cost: $4.50");
  });

  it("custom steeringPrompt is used", async () => {
    const method = mkMethod("custom-prompt-method", (s) => s);
    const methodology = mkMethodology(method);

    const customPrompt = new Prompt<SteeringContext<TestState>>((ctx) =>
      `CUSTOM: status=${ctx.result.status}, runs=${ctx.runCount}`,
    );

    const config: AgentSteeredConfig<TestState> = {
      methodology,
      gates: [],
      steeringPrompt: customPrompt,
    };

    const captured: string[] = [];
    const agentExecute = mkCapturingAgentExecute(
      '{"action":"done","reason":"custom prompt works"}',
      captured,
    );

    const controller = agentSteeredController(config, agentExecute);
    await Effect.runPromise(controller.onComplete(mkResult("completed")));

    expect(captured.length).toBe(1);
    expect(captured[0]).toBe("CUSTOM: status=completed, runs=1");
    // Verify the default prompt format is NOT used
    expect(captured[0]).not.toContain("Strategy Decision Required");
  });

  it("default safety bounds", () => {
    const method = mkMethod("safety-method", (s) => s);
    const methodology = mkMethodology(method);
    const config: AgentSteeredConfig<TestState> = { methodology, gates: [] };
    const agentExecute = mkAgentExecute('{"action":"done"}');

    const controller = agentSteeredController(config, agentExecute);

    expect(controller.safety.maxLoops).toBe(5);
    expect(controller.safety.maxTokens).toBe(1_000_000);
    expect(controller.safety.maxCostUsd).toBe(20);
    expect(controller.safety.maxDurationMs).toBe(7_200_000);
    expect(controller.safety.maxDepth).toBe(5);
  });

  it("partial safety overrides merge with defaults", () => {
    const method = mkMethod("override-method", (s) => s);
    const methodology = mkMethodology(method);
    const config: AgentSteeredConfig<TestState> = {
      methodology,
      gates: [],
      safety: { maxLoops: 10, maxCostUsd: 50 },
    };
    const agentExecute = mkAgentExecute('{"action":"done"}');

    const controller = agentSteeredController(config, agentExecute);

    // Overridden
    expect(controller.safety.maxLoops).toBe(10);
    expect(controller.safety.maxCostUsd).toBe(50);
    // Defaults preserved
    expect(controller.safety.maxTokens).toBe(1_000_000);
    expect(controller.safety.maxDurationMs).toBe(7_200_000);
    expect(controller.safety.maxDepth).toBe(5);
  });

  it("controller has correct id and name", () => {
    const method = mkMethod("id-method", (s) => s);
    const methodology = mkMethodology(method);
    const config: AgentSteeredConfig<TestState> = { methodology, gates: [] };
    const agentExecute = mkAgentExecute('{"action":"done"}');

    const controller = agentSteeredController(config, agentExecute);

    expect(controller.id).toBe("agent-steered");
    expect(controller.name).toBe("Agent-Steered Controller");
  });

  it("unknown action in JSON defaults to done", async () => {
    const method = mkMethod("unknown-action-method", (s) => s);
    const methodology = mkMethodology(method);
    const config: AgentSteeredConfig<TestState> = { methodology, gates: [] };
    const agentExecute = mkAgentExecute('{"action":"unknown_action","reason":"??"}');

    const controller = agentSteeredController(config, agentExecute);
    const result = mkResult("completed");

    const decision = await Effect.runPromise(controller.onComplete(result));
    expect(decision.tag).toBe("done");
  });

  it("abort without reason uses default message", async () => {
    const method = mkMethod("abort-no-reason", (s) => s);
    const methodology = mkMethodology(method);
    const config: AgentSteeredConfig<TestState> = { methodology, gates: [] };
    const agentExecute = mkAgentExecute('{"action":"abort"}');

    const controller = agentSteeredController(config, agentExecute);
    const result = mkResult("failed");

    const decision = await Effect.runPromise(controller.onComplete(result));
    expect(decision.tag).toBe("abort");
    if (decision.tag === "abort") {
      expect(decision.reason).toBe("Agent decided to abort");
    }
  });
});
