// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for runStep — inner step execution loop.
 *
 * Covers:
 * - Script steps: success, precondition failure, postcondition failure, axiom violation
 * - Agent steps: full pipeline, parse retry, max retries exhausted, insight extraction
 */

import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { check, TRUE, FALSE } from "../../predicate/predicate.js";
import { Prompt } from "../../prompt/prompt.js";
import { createInsightStore, type InsightStore } from "../insight-store.js";
import { MockAgentProvider } from "../../provider/mock-provider.js";
import { AgentProvider } from "../../provider/agent-provider.js";
import { runStep, type RunStepConfig, type RunStepError } from "../run-step.js";
import type { Step, StepContext, ContextSpec } from "../../method/step.js";
import type { DomainTheory } from "../../domain/domain-theory.js";
import type { WorldState } from "../../state/world-state.js";

// ── Test fixtures ──

type TestState = { count: number; valid: boolean };

const testDomain: DomainTheory<TestState> = {
  id: "D-TEST",
  signature: {
    sorts: [],
    functionSymbols: [],
    predicates: {},
  },
  axioms: {
    "always-valid": check<TestState>("valid", (s) => s.valid),
  },
};

const validState: WorldState<TestState> = {
  value: { count: 0, valid: true },
  axiomStatus: { valid: true, violations: [] },
};

/** Helper: create a config with an InsightStore inside Effect. */
function makeConfig(
  overrides?: Partial<RunStepConfig<TestState>>,
): Effect.Effect<RunStepConfig<TestState>, never, never> {
  return Effect.gen(function* () {
    const insightStore = yield* createInsightStore();
    return {
      domain: testDomain,
      insightStore,
      ...overrides,
    };
  });
}

/** Helper: make a script step. */
function scriptStep(
  overrides?: Partial<Step<TestState>>,
): Step<TestState> {
  return {
    id: "step-script",
    name: "Script Step",
    role: "engineer",
    precondition: TRUE,
    postcondition: TRUE,
    execution: {
      tag: "script",
      execute: (s) => Effect.succeed({ count: s.count + 1, valid: true }),
    },
    ...overrides,
  };
}

/** Helper: make an agent step. */
function agentStep(
  overrides?: Partial<Step<TestState>> & {
    contextSpec?: ContextSpec<TestState>;
    parseImpl?: (raw: string, current: TestState) => Effect.Effect<TestState, { _tag: "ParseError"; message: string; raw?: string }, never>;
  },
): Step<TestState> {
  const contextSpec = overrides?.contextSpec ?? {};
  const parseImpl =
    overrides?.parseImpl ??
    ((raw: string, _current: TestState) => {
      try {
        const parsed = JSON.parse(raw) as TestState;
        return Effect.succeed(parsed);
      } catch {
        return Effect.fail({
          _tag: "ParseError" as const,
          message: "Invalid JSON",
          raw,
        });
      }
    });

  const { contextSpec: _, parseImpl: __, ...stepOverrides } = overrides ?? {};

  return {
    id: "step-agent",
    name: "Agent Step",
    role: "engineer",
    precondition: TRUE,
    postcondition: TRUE,
    execution: {
      tag: "agent",
      role: "engineer",
      context: contextSpec,
      prompt: new Prompt<StepContext<TestState>>(
        (ctx) => `Process state with count=${ctx.state.count}`,
      ),
      parse: parseImpl,
    },
    ...stepOverrides,
  };
}

/** Default mock provider returning valid state JSON. */
const defaultMockLayer = MockAgentProvider({
  responses: [
    {
      match: () => true,
      result: {
        raw: '{"count": 5, "valid": true}',
        cost: { tokens: 100, usd: 0.01, duration_ms: 500 },
      },
    },
  ],
});

// ── Script step tests ──

describe("runStep — script", () => {
  it("executes script and returns new WorldState", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* makeConfig();
        return yield* runStep(scriptStep(), validState, config);
      }).pipe(Effect.provide(defaultMockLayer)),
    );

    expect(result.value.count).toBe(1);
    expect(result.value.valid).toBe(true);
    expect(result.axiomStatus.valid).toBe(true);
  });

  it("fails with RunStepError when precondition fails", async () => {
    const step = scriptStep({
      precondition: FALSE,
    });

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* makeConfig();
        return yield* runStep(step, validState, config).pipe(Effect.flip);
      }).pipe(Effect.provide(defaultMockLayer)),
    );

    expect(error._tag).toBe("RunStepError");
    expect(error.message).toBe("Precondition failed");
    expect(error.retryable).toBe(false);
  });

  it("fails with RunStepError when postcondition fails", async () => {
    const step = scriptStep({
      postcondition: FALSE,
    });

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* makeConfig();
        return yield* runStep(step, validState, config).pipe(Effect.flip);
      }).pipe(Effect.provide(defaultMockLayer)),
    );

    expect(error._tag).toBe("RunStepError");
    expect(error.message).toContain("Postcondition failed");
    expect(error.stepId).toBe("step-script");
  });

  it("fails with RunStepError when axiom is violated", async () => {
    // Step produces state with valid=false, which violates the axiom
    const step = scriptStep({
      execution: {
        tag: "script",
        execute: (s) => Effect.succeed({ count: s.count + 1, valid: false }),
      },
    });

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* makeConfig();
        return yield* runStep(step, validState, config).pipe(Effect.flip);
      }).pipe(Effect.provide(defaultMockLayer)),
    );

    expect(error._tag).toBe("RunStepError");
    expect(error.message).toContain("Axiom violations");
    expect(error.message).toContain("always-valid");
    expect(error.retryable).toBe(false);
  });

  it("does not retry script steps on postcondition failure", async () => {
    let callCount = 0;
    const step = scriptStep({
      postcondition: FALSE,
      execution: {
        tag: "script",
        execute: (s) => {
          callCount++;
          return Effect.succeed({ count: s.count + 1, valid: true });
        },
      },
    });

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* makeConfig({ maxRetries: 3 });
        return yield* runStep(step, validState, config).pipe(Effect.flip);
      }).pipe(Effect.provide(defaultMockLayer)),
    );

    expect(error._tag).toBe("RunStepError");
    // Script step executed only once — no retry
    expect(callCount).toBe(1);
  });
});

// ── Agent step tests ──

describe("runStep — agent", () => {
  it("full pipeline with MockAgentProvider returns parsed state", async () => {
    const mockLayer = MockAgentProvider({
      responses: [
        {
          match: () => true,
          result: {
            raw: '{"count": 5, "valid": true}',
            cost: { tokens: 100, usd: 0.01, duration_ms: 500 },
          },
        },
      ],
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* makeConfig();
        return yield* runStep(agentStep(), validState, config);
      }).pipe(Effect.provide(mockLayer)),
    );

    expect(result.value.count).toBe(5);
    expect(result.value.valid).toBe(true);
    expect(result.axiomStatus.valid).toBe(true);
    expect(result.axiomStatus.violations).toEqual([]);
  });

  it("retries on parse failure and succeeds on second attempt", async () => {
    let callCount = 0;
    const mockLayer = MockAgentProvider({
      responses: [
        {
          match: () => {
            callCount++;
            return true;
          },
          result: {
            // Always return valid JSON, but we control parse behavior
            raw: callCount === 0 ? "not-json" : '{"count": 3, "valid": true}',
            cost: { tokens: 50, usd: 0.005, duration_ms: 200 },
          },
        },
      ],
    });

    // Use a parse function that fails on first call, succeeds on second
    let parseCallCount = 0;
    const step = agentStep({
      parseImpl: (raw: string, _current: TestState) => {
        parseCallCount++;
        if (parseCallCount === 1) {
          return Effect.fail({
            _tag: "ParseError" as const,
            message: "Deliberately failing first parse",
            raw,
          });
        }
        return Effect.succeed({ count: 3, valid: true });
      },
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* makeConfig({ maxRetries: 3 });
        return yield* runStep(step, validState, config);
      }).pipe(Effect.provide(mockLayer)),
    );

    expect(result.value.count).toBe(3);
    expect(result.value.valid).toBe(true);
    expect(parseCallCount).toBe(2);
  });

  it("max retries exhausted on persistent parse failure", async () => {
    const mockLayer = MockAgentProvider({
      responses: [
        {
          match: () => true,
          result: {
            raw: "not valid json",
            cost: { tokens: 50, usd: 0.005, duration_ms: 200 },
          },
        },
      ],
    });

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* makeConfig({ maxRetries: 2 });
        return yield* runStep(agentStep(), validState, config).pipe(
          Effect.flip,
        );
      }).pipe(Effect.provide(mockLayer)),
    );

    expect(error._tag).toBe("RunStepError");
    expect(error.message).toContain("Parse error");
    expect(error.retryable).toBe(true);
  });

  it("retries on postcondition failure and succeeds on retry", async () => {
    let agentCallCount = 0;
    const mockLayer = MockAgentProvider({
      responses: [
        {
          match: () => {
            agentCallCount++;
            return true;
          },
          result: {
            raw: '{"count": 10, "valid": true}',
            cost: { tokens: 50, usd: 0.005, duration_ms: 200 },
          },
        },
      ],
    });

    // Postcondition: count must be > 5
    // First parse returns count=2 (fails postcondition), second returns count=10 (passes)
    let parseCallCount = 0;
    const step = agentStep({
      postcondition: check<TestState>("count > 5", (s) => s.count > 5),
      parseImpl: (_raw: string, _current: TestState) => {
        parseCallCount++;
        if (parseCallCount === 1) {
          return Effect.succeed({ count: 2, valid: true }); // fails postcondition
        }
        return Effect.succeed({ count: 10, valid: true }); // passes postcondition
      },
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* makeConfig({ maxRetries: 3 });
        return yield* runStep(step, validState, config);
      }).pipe(Effect.provide(mockLayer)),
    );

    expect(result.value.count).toBe(10);
    expect(parseCallCount).toBe(2);
    // Agent was called twice (initial + 1 retry)
    expect(agentCallCount).toBe(2);
  });

  it("extracts insight and stores it", async () => {
    const mockLayer = MockAgentProvider({
      responses: [
        {
          match: () => true,
          result: {
            raw: '{"count": 5, "valid": true}\n---insight: Use caching strategy',
            cost: { tokens: 100, usd: 0.01, duration_ms: 500 },
          },
        },
      ],
    });

    const step: Step<TestState> = {
      id: "step-with-insight",
      name: "Insight Step",
      role: "engineer",
      precondition: TRUE,
      postcondition: TRUE,
      execution: {
        tag: "agent",
        role: "engineer",
        context: {
          produceInsight: {
            key: "caching-decision",
            instruction: "Describe your caching strategy.",
          },
        },
        prompt: new Prompt<StepContext<TestState>>(
          (ctx) => `Decide caching for count=${ctx.state.count}`,
        ),
        parse: (raw: string, _current: TestState) => {
          // Parse just the JSON part
          const jsonLine = raw.split("\n")[0];
          try {
            return Effect.succeed(JSON.parse(jsonLine) as TestState);
          } catch {
            return Effect.fail({
              _tag: "ParseError" as const,
              message: "Bad JSON",
              raw,
            });
          }
        },
        parseInsight: (raw: string) => {
          const match = raw.match(/---insight: (.+)/);
          return match ? match[1] : "no insight";
        },
      },
    };

    let insightStoreRef: InsightStore | undefined;

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* createInsightStore();
        insightStoreRef = store;
        const config: RunStepConfig<TestState> = {
          domain: testDomain,
          insightStore: store,
        };
        return yield* runStep(step, validState, config);
      }).pipe(Effect.provide(mockLayer)),
    );

    expect(result.value.count).toBe(5);

    // Verify insight was stored
    const storedInsight = await Effect.runPromise(
      insightStoreRef!.get("caching-decision"),
    );
    expect(storedInsight).toBe("Use caching strategy");
  });

  it("agent error propagated as retryable RunStepError", async () => {
    const mockLayer = MockAgentProvider({
      responses: [],
      failOn: [
        {
          match: () => true,
          error: {
            _tag: "AgentTimeout",
            message: "Timed out after 30s",
            duration_ms: 30000,
          },
        },
      ],
    });

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* makeConfig();
        return yield* runStep(agentStep(), validState, config).pipe(
          Effect.flip,
        );
      }).pipe(Effect.provide(mockLayer)),
    );

    expect(error._tag).toBe("RunStepError");
    expect(error.message).toBe("Agent error: AgentTimeout");
    expect(error.retryable).toBe(true);
  });

  it("precondition failure prevents agent execution", async () => {
    let agentCalled = false;
    const mockLayer = MockAgentProvider({
      responses: [
        {
          match: () => {
            agentCalled = true;
            return true;
          },
          result: {
            raw: '{"count": 5, "valid": true}',
            cost: { tokens: 100, usd: 0.01, duration_ms: 500 },
          },
        },
      ],
    });

    const step = agentStep({
      precondition: FALSE,
    });

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* makeConfig();
        return yield* runStep(step, validState, config).pipe(Effect.flip);
      }).pipe(Effect.provide(mockLayer)),
    );

    expect(error._tag).toBe("RunStepError");
    expect(error.message).toBe("Precondition failed");
    expect(agentCalled).toBe(false);
  });

  it("axiom violation after agent execution is not retryable", async () => {
    const mockLayer = MockAgentProvider({
      responses: [
        {
          match: () => true,
          result: {
            raw: '{"count": 5, "valid": false}',
            cost: { tokens: 100, usd: 0.01, duration_ms: 500 },
          },
        },
      ],
    });

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* makeConfig();
        return yield* runStep(agentStep(), validState, config).pipe(
          Effect.flip,
        );
      }).pipe(Effect.provide(mockLayer)),
    );

    expect(error._tag).toBe("RunStepError");
    expect(error.message).toContain("Axiom violations");
    expect(error.retryable).toBe(false);
  });
});

// ── Session resume tests ──

describe("runStep — session resume", () => {
  it("first attempt commission has sessionId, not resumeSessionId", async () => {
    const commissions: Array<{ prompt: string; sessionId?: string; resumeSessionId?: string }> = [];
    const mockLayer = MockAgentProvider({
      responses: [
        {
          match: (c) => {
            commissions.push(c);
            return true;
          },
          result: {
            raw: '{"count": 5, "valid": true}',
            cost: { tokens: 100, usd: 0.01, duration_ms: 500 },
          },
        },
      ],
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* makeConfig();
        return yield* runStep(agentStep(), validState, config);
      }).pipe(Effect.provide(mockLayer)),
    );

    expect(commissions).toHaveLength(1);
    expect(commissions[0].sessionId).toBeDefined();
    expect(commissions[0].sessionId).toMatch(/^step_step-agent_/);
    expect(commissions[0].resumeSessionId).toBeUndefined();
  });

  it("retry attempt commission has resumeSessionId from first attempt", async () => {
    const commissions: Array<{ prompt: string; sessionId?: string; resumeSessionId?: string }> = [];
    let parseCallCount = 0;

    const mockLayer = MockAgentProvider({
      responses: [
        {
          match: (c) => {
            commissions.push(c);
            return true;
          },
          result: {
            raw: '{"count": 5, "valid": true}',
            cost: { tokens: 50, usd: 0.005, duration_ms: 200 },
          },
        },
      ],
    });

    // Parse fails on first call, succeeds on second — forces a retry
    const step = agentStep({
      parseImpl: (_raw: string, _current: TestState) => {
        parseCallCount++;
        if (parseCallCount === 1) {
          return Effect.fail({
            _tag: "ParseError" as const,
            message: "Deliberately failing first parse",
            raw: _raw,
          });
        }
        return Effect.succeed({ count: 5, valid: true });
      },
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* makeConfig({ maxRetries: 3 });
        return yield* runStep(step, validState, config);
      }).pipe(Effect.provide(mockLayer)),
    );

    expect(commissions).toHaveLength(2);
    // First attempt: sessionId set, no resumeSessionId
    expect(commissions[0].sessionId).toBeDefined();
    expect(commissions[0].resumeSessionId).toBeUndefined();
    // Second attempt: resumeSessionId matches first attempt's sessionId
    expect(commissions[1].resumeSessionId).toBe(commissions[0].sessionId);
    expect(commissions[1].sessionId).toBeUndefined();
  });

  it("sessionId from AgentResult is captured for reuse on retries", async () => {
    const commissions: Array<{ prompt: string; sessionId?: string; resumeSessionId?: string }> = [];
    let parseCallCount = 0;
    const bridgeSessionId = "bridge-assigned-session-42";

    const mockLayer = MockAgentProvider({
      responses: [
        {
          match: (c) => {
            commissions.push(c);
            return true;
          },
          result: {
            raw: '{"count": 5, "valid": true}',
            cost: { tokens: 50, usd: 0.005, duration_ms: 200 },
            sessionId: bridgeSessionId, // Bridge assigns a different session ID
          },
        },
      ],
    });

    // Parse fails on first call, succeeds on second — forces a retry
    const step = agentStep({
      parseImpl: (_raw: string, _current: TestState) => {
        parseCallCount++;
        if (parseCallCount === 1) {
          return Effect.fail({
            _tag: "ParseError" as const,
            message: "Deliberately failing first parse",
            raw: _raw,
          });
        }
        return Effect.succeed({ count: 5, valid: true });
      },
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* makeConfig({ maxRetries: 3 });
        return yield* runStep(step, validState, config);
      }).pipe(Effect.provide(mockLayer)),
    );

    expect(commissions).toHaveLength(2);
    // Retry uses the bridge-assigned sessionId (from AgentResult), not the generated one
    expect(commissions[1].resumeSessionId).toBe(bridgeSessionId);
  });

  it("postcondition retry also uses resumeSessionId", async () => {
    const commissions: Array<{ prompt: string; sessionId?: string; resumeSessionId?: string }> = [];
    let parseCallCount = 0;

    const mockLayer = MockAgentProvider({
      responses: [
        {
          match: (c) => {
            commissions.push(c);
            return true;
          },
          result: {
            raw: '{"count": 10, "valid": true}',
            cost: { tokens: 50, usd: 0.005, duration_ms: 200 },
          },
        },
      ],
    });

    // Postcondition: count > 5. First parse returns count=2 (fails), second returns count=10 (passes).
    const step = agentStep({
      postcondition: check<TestState>("count > 5", (s) => s.count > 5),
      parseImpl: (_raw: string, _current: TestState) => {
        parseCallCount++;
        if (parseCallCount === 1) {
          return Effect.succeed({ count: 2, valid: true }); // fails postcondition
        }
        return Effect.succeed({ count: 10, valid: true }); // passes postcondition
      },
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* makeConfig({ maxRetries: 3 });
        return yield* runStep(step, validState, config);
      }).pipe(Effect.provide(mockLayer)),
    );

    expect(commissions).toHaveLength(2);
    // Second attempt resumes the session from the first
    expect(commissions[1].resumeSessionId).toBe(commissions[0].sessionId);
    expect(commissions[1].sessionId).toBeUndefined();
  });

  it("script steps do not generate session tracking fields", async () => {
    // Script steps bypass agent execution entirely — no session tracking
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* makeConfig();
        return yield* runStep(scriptStep(), validState, config);
      }).pipe(Effect.provide(defaultMockLayer)),
    );

    // Script step succeeds without touching agent provider
    expect(result.value.count).toBe(1);
    // No direct way to assert "no commission sent" — but the mock is never matched,
    // and the test passing proves script execution bypasses agent entirely.
  });
});
