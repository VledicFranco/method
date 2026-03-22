/**
 * Unit tests for the gate framework.
 *
 * Tests GateResult construction, scriptGate evaluation,
 * allPass/anyPass composition, withRetry semantics,
 * and GateError construction.
 *
 * @see PRD 021 Component 7 — Gate types, scriptGate, composition
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { check, TRUE, FALSE } from "../../predicate/predicate.js";
import { evaluateWithTrace } from "../../predicate/evaluate.js";
import type { Predicate } from "../../predicate/predicate.js";
import {
  scriptGate,
  allPass,
  anyPass,
  withRetry,
  gateError,
} from "../gate.js";
import type { GateResult, GateError, Gate } from "../gate.js";

// ── Test state type ──

type TestState = { value: number };

// ── Helper predicates ──

const positive = check<TestState>("positive", (s) => s.value > 0);
const evenValue = check<TestState>("even", (s) => s.value % 2 === 0);
const lessThan10 = check<TestState>("lessThan10", (s) => s.value < 10);

// ── GateResult construction ──

describe("GateResult construction", () => {
  it("passed result has witness and reason", () => {
    const trace = evaluateWithTrace(positive, { value: 5 });
    const result: GateResult<TestState> = {
      passed: true,
      witness: { predicate: positive, evaluatedAt: new Date(), trace },
      reason: "positive",
      duration_ms: 0,
    };
    expect(result.passed).toBe(true);
    expect(result.witness).not.toBeNull();
    expect(result.witness!.predicate).toBe(positive);
    expect(result.witness!.trace.result).toBe(true);
    expect(result.reason).toBe("positive");
  });

  it("failed result has null witness", () => {
    const result: GateResult<TestState> = {
      passed: false,
      witness: null,
      reason: "positive",
      duration_ms: 0,
    };
    expect(result.passed).toBe(false);
    expect(result.witness).toBeNull();
  });
});

// ── scriptGate ──

describe("scriptGate", () => {
  it("predicate passes: GateResult.passed=true with witness", () => {
    const gate = scriptGate<TestState>("g1", "value must be positive", positive);
    const result = Effect.runSync(gate.evaluate({ value: 5 }));

    expect(result.passed).toBe(true);
    expect(result.witness).not.toBeNull();
    expect(result.witness!.predicate).toBe(positive);
    expect(result.witness!.trace.result).toBe(true);
    expect(result.witness!.evaluatedAt).toBeInstanceOf(Date);
    expect(result.reason).toBe("positive");
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("predicate fails: GateResult.passed=false, witness=null", () => {
    const gate = scriptGate<TestState>("g2", "value must be positive", positive);
    const result = Effect.runSync(gate.evaluate({ value: -3 }));

    expect(result.passed).toBe(false);
    expect(result.witness).toBeNull();
    expect(result.reason).toBe("positive");
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("gate id, description, and predicate are preserved", () => {
    const gate = scriptGate<TestState>("my-gate", "checks positivity", positive, 3);
    expect(gate.id).toBe("my-gate");
    expect(gate.description).toBe("checks positivity");
    expect(gate.predicate).toBe(positive);
    expect(gate.maxRetries).toBe(3);
  });

  it("default maxRetries is 0", () => {
    const gate = scriptGate<TestState>("g3", "desc", positive);
    expect(gate.maxRetries).toBe(0);
  });

  it("works with literal TRUE predicate", () => {
    const gate = scriptGate<TestState>("always", "always passes", TRUE);
    const result = Effect.runSync(gate.evaluate({ value: -999 }));
    expect(result.passed).toBe(true);
    expect(result.witness).not.toBeNull();
  });

  it("works with literal FALSE predicate", () => {
    const gate = scriptGate<TestState>("never", "always fails", FALSE);
    const result = Effect.runSync(gate.evaluate({ value: 999 }));
    expect(result.passed).toBe(false);
    expect(result.witness).toBeNull();
  });
});

// ── allPass ──

describe("allPass", () => {
  it("all pass: suite passed", () => {
    const g1 = scriptGate<TestState>("g1", "positive", positive);
    const g2 = scriptGate<TestState>("g2", "even", evenValue);
    const run = allPass("all-checks", [g1, g2]);
    const result = Effect.runSync(run({ value: 4 }));

    expect(result.name).toBe("all-checks");
    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].passed).toBe(true);
    expect(result.results[1].passed).toBe(true);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("one fails: suite failed, results contain all individual results", () => {
    const g1 = scriptGate<TestState>("g1", "positive", positive);
    const g2 = scriptGate<TestState>("g2", "even", evenValue);
    const run = allPass("all-checks", [g1, g2]);
    // value=3: positive passes, even fails
    const result = Effect.runSync(run({ value: 3 }));

    expect(result.passed).toBe(false);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].passed).toBe(true);
    expect(result.results[1].passed).toBe(false);
  });

  it("empty gate list: suite passes (vacuous truth)", () => {
    const run = allPass<TestState>("empty", []);
    const result = Effect.runSync(run({ value: 0 }));

    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(0);
  });
});

// ── anyPass ──

describe("anyPass", () => {
  it("one passes: suite passed", () => {
    const g1 = scriptGate<TestState>("g1", "positive", positive);
    const g2 = scriptGate<TestState>("g2", "even", evenValue);
    const run = anyPass("any-check", [g1, g2]);
    // value=3: positive passes, even fails
    const result = Effect.runSync(run({ value: 3 }));

    expect(result.name).toBe("any-check");
    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(2);
  });

  it("all fail: suite failed", () => {
    const g1 = scriptGate<TestState>("g1", "positive", positive);
    const g2 = scriptGate<TestState>("g2", "even", evenValue);
    const run = anyPass("any-check", [g1, g2]);
    // value=-3: positive fails, even fails
    const result = Effect.runSync(run({ value: -3 }));

    expect(result.passed).toBe(false);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].passed).toBe(false);
    expect(result.results[1].passed).toBe(false);
  });

  it("all pass: suite passed", () => {
    const g1 = scriptGate<TestState>("g1", "positive", positive);
    const g2 = scriptGate<TestState>("g2", "even", evenValue);
    const run = anyPass("any-check", [g1, g2]);
    const result = Effect.runSync(run({ value: 4 }));

    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(2);
  });

  it("empty gate list: suite fails (no evidence)", () => {
    const run = anyPass<TestState>("empty", []);
    const result = Effect.runSync(run({ value: 0 }));

    expect(result.passed).toBe(false);
    expect(result.results).toHaveLength(0);
  });
});

// ── withRetry ──

describe("withRetry", () => {
  it("gate passes on first try: no retry needed", () => {
    let evalCount = 0;
    const countingGate: Gate<TestState> = {
      id: "counting",
      description: "counts evaluations",
      predicate: positive,
      maxRetries: 0,
      evaluate: (state: TestState) => {
        evalCount++;
        return scriptGate<TestState>("inner", "positive", positive).evaluate(state);
      },
    };

    const retried = withRetry(countingGate, 3);
    const result = Effect.runSync(retried.evaluate({ value: 5 }));

    expect(result.passed).toBe(true);
    expect(evalCount).toBe(1); // No retries needed
  });

  it("gate fails then passes: retried correctly", () => {
    let evalCount = 0;
    // Gate that fails on first call, passes on second
    const flaky: Gate<TestState> = {
      id: "flaky",
      description: "fails once then passes",
      predicate: positive,
      maxRetries: 0,
      evaluate: (_state: TestState) => {
        evalCount++;
        if (evalCount < 2) {
          // First attempt: fail
          const failResult: GateResult<TestState> = {
            passed: false,
            witness: null,
            reason: "not ready yet",
            duration_ms: 0,
          };
          return Effect.succeed(failResult);
        }
        // Subsequent attempts: pass
        const passResult: GateResult<TestState> = {
          passed: true,
          witness: { predicate: positive, evaluatedAt: new Date(), trace: { label: "positive", result: true, children: [] } },
          reason: "positive",
          duration_ms: 0,
        };
        return Effect.succeed(passResult);
      },
    };

    const retried = withRetry(flaky, 3);
    const result = Effect.runSync(retried.evaluate({ value: 5 }));

    expect(result.passed).toBe(true);
    expect(evalCount).toBe(2); // Failed once, passed on retry
  });

  it("gate always fails: exhausts all retries", () => {
    let evalCount = 0;
    const alwaysFails: Gate<TestState> = {
      id: "always-fails",
      description: "never passes",
      predicate: FALSE as Predicate<TestState>,
      maxRetries: 0,
      evaluate: (_state: TestState) => {
        evalCount++;
        const failResult: GateResult<TestState> = {
          passed: false,
          witness: null,
          reason: "always fails",
          duration_ms: 0,
        };
        return Effect.succeed(failResult);
      },
    };

    const retried = withRetry(alwaysFails, 2);
    const result = Effect.runSync(retried.evaluate({ value: 5 }));

    expect(result.passed).toBe(false);
    expect(evalCount).toBe(3); // 1 initial + 2 retries
  });

  it("withRetry updates maxRetries on the returned gate", () => {
    const gate = scriptGate<TestState>("g", "desc", positive, 0);
    const retried = withRetry(gate, 5);
    expect(retried.maxRetries).toBe(5);
    expect(retried.id).toBe("g");
    expect(retried.description).toBe("desc");
  });
});

// ── GateError construction ──

describe("GateError", () => {
  it("constructs with tag, gateId, and message", () => {
    const err = gateError("gate-1", "evaluation timed out");
    expect(err._tag).toBe("GateError");
    expect(err.gateId).toBe("gate-1");
    expect(err.message).toBe("evaluation timed out");
    expect(err.cause).toBeUndefined();
  });

  it("constructs with optional cause", () => {
    const underlying = new Error("network failure");
    const err = gateError("gate-2", "remote check failed", underlying);
    expect(err._tag).toBe("GateError");
    expect(err.gateId).toBe("gate-2");
    expect(err.message).toBe("remote check failed");
    expect(err.cause).toBe(underlying);
  });
});
