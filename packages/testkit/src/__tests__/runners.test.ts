/**
 * Tests for testkit runners — step harness, method harness, scenario.
 */

import { describe, it, expect } from "vitest";
import { check, and, not } from "@method/methodts";
import {
  scriptStep,
  methodBuilder,
  methodologyBuilder,
  domainBuilder,
  worldState,
  runStepIsolated,
  runMethodIsolated,
  runMethodologyIsolated,
  scenario,
} from "../index.js";

// ── Domain ──

type CounterState = {
  count: number;
  target: number;
  done: boolean;
};

const notDone = check<CounterState>("not_done", (s) => !s.done);
const isDone = check<CounterState>("is_done", (s) => s.done);
const belowTarget = check<CounterState>("below_target", (s) => s.count < s.target);
const atTarget = check<CounterState>("at_target", (s) => s.count >= s.target);

const incrementStep = scriptStep<CounterState>("increment", {
  role: "counter",
  pre: and(notDone, belowTarget),
  post: notDone,
  execute: (s) => ({ ...s, count: s.count + 1 }),
});

const finalizeStep = scriptStep<CounterState>("finalize", {
  role: "counter",
  pre: atTarget,
  post: isDone,
  execute: (s) => ({ ...s, done: true }),
});

// ── runStepIsolated ──

describe("runStepIsolated", () => {
  it("runs a script step and returns completed status with state", async () => {
    const result = await runStepIsolated(incrementStep, {
      count: 0,
      target: 3,
      done: false,
    });

    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.postconditionMet).toBe(true);
      expect(result.state.count).toBe(1);
    }
  });

  it("detects precondition failure with discriminated status", async () => {
    const result = await runStepIsolated(incrementStep, {
      count: 3,
      target: 3,
      done: false,
    });

    expect(result.status).toBe("precondition_failed");
  });

  it("detects postcondition failure", async () => {
    // A step whose postcondition won't be met
    const badStep = scriptStep<CounterState>("bad", {
      pre: notDone,
      post: isDone,  // expects done=true
      execute: (s) => s,  // but doesn't set done
    });

    const result = await runStepIsolated(badStep, {
      count: 0,
      target: 3,
      done: false,
    });

    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.postconditionMet).toBe(false);
      expect(result.postconditionTrace).toBeDefined();
    }
  });

  it("provides precondition trace for diagnosis", async () => {
    const result = await runStepIsolated(incrementStep, {
      count: 3,
      target: 3,
      done: false,
    });

    expect(result.status).toBe("precondition_failed");
    expect(result.preconditionTrace.result).toBe(false);
    // Should have children from the AND predicate
    expect(result.preconditionTrace.children.length).toBeGreaterThan(0);
  });

  it("returns error status for failing Effect steps", async () => {
    const { Effect: Eff } = await import("effect");
    const { scriptStepEffect } = await import("../index.js");

    const failStep = scriptStepEffect<CounterState>("fail_step", {
      pre: notDone,
      execute: (_s) => Eff.fail({ _tag: "StepError" as const, message: "intentional failure" }),
    });

    const result = await runStepIsolated(failStep, {
      count: 0,
      target: 3,
      done: false,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toContain("intentional failure");
    }
  });
});

// ── runMethodIsolated ──

describe("runMethodIsolated", () => {
  const domain = domainBuilder<CounterState>("D_COUNTER").build();

  const incrementMethod = methodBuilder<CounterState>("M_INCREMENT")
    .domain(domain)
    .role("counter", (s) => s)
    .steps([incrementStep])
    .objective(notDone)
    .build();

  it("runs a method and returns MethodResult", async () => {
    const result = await runMethodIsolated(
      incrementMethod,
      worldState({ count: 0, target: 3, done: false }),
    );

    expect(result.status).toBe("completed");
    expect(result.objectiveMet).toBe(true);
    expect(result.finalState.value.count).toBe(1);
    expect(result.stepResults).toHaveLength(1);
    expect(result.stepResults[0].stepId).toBe("increment");
  });
});

// ── runMethodologyIsolated ──

describe("runMethodologyIsolated", () => {
  const domain = domainBuilder<CounterState>("D_COUNTER").build();

  const incrementMethod = methodBuilder<CounterState>("M_INCREMENT")
    .domain(domain)
    .role("counter", (s) => s)
    .steps([incrementStep])
    .objective(notDone)
    .build();

  const finalizeMethod = methodBuilder<CounterState>("M_FINALIZE")
    .domain(domain)
    .role("counter", (s) => s)
    .steps([finalizeStep])
    .objective(isDone)
    .build();

  const methodology = methodologyBuilder<CounterState>("PHI_COUNTER")
    .domain(domain)
    .arm(1, "increment", and(notDone, belowTarget), incrementMethod)
    .arm(2, "finalize", and(notDone, atTarget), finalizeMethod)
    .arm(3, "terminate", isDone, null)
    .objective(isDone)
    .terminationMeasure(
      (s) => s.done ? 0 : s.target - s.count + 1,
      "Distance to target decreases, then done.",
    )
    .safety({ maxLoops: 20 })
    .build();

  it("runs methodology to completion", async () => {
    const result = await runMethodologyIsolated(
      methodology,
      worldState({ count: 0, target: 3, done: false }),
    );

    expect(result.status).toBe("completed");
    expect(result.finalState.value.count).toBe(3);
    expect(result.finalState.value.done).toBe(true);
    // 3 increments + 1 finalize = 4 loops
    expect(result.accumulator.loopCount).toBe(4);
    expect(result.accumulator.completedMethods.map((m) => m.methodId)).toEqual([
      "M_INCREMENT", "M_INCREMENT", "M_INCREMENT", "M_FINALIZE",
    ]);
  });

  it("detects safety violations", async () => {
    const tight = methodologyBuilder<CounterState>("PHI_TIGHT")
      .domain(domain)
      .arm(1, "increment", and(notDone, belowTarget), incrementMethod)
      .arm(2, "finalize", and(notDone, atTarget), finalizeMethod)
      .arm(3, "terminate", isDone, null)
      .objective(isDone)
      .safety({ maxLoops: 2 })
      .build();

    const result = await runMethodologyIsolated(
      tight,
      worldState({ count: 0, target: 3, done: false }),
    );

    expect(result.status).toBe("safety_violation");
    expect(result.accumulator.loopCount).toBe(2);
  });
});

// ── scenario ──

describe("scenario", () => {
  const domain = domainBuilder<CounterState>("D_COUNTER").build();

  const incrementMethod = methodBuilder<CounterState>("M_INCREMENT")
    .domain(domain)
    .role("counter", (s) => s)
    .steps([incrementStep])
    .objective(notDone)
    .build();

  const finalizeMethod = methodBuilder<CounterState>("M_FINALIZE")
    .domain(domain)
    .role("counter", (s) => s)
    .steps([finalizeStep])
    .objective(isDone)
    .build();

  const methodology = methodologyBuilder<CounterState>("PHI_COUNTER")
    .domain(domain)
    .arm(1, "increment", and(notDone, belowTarget), incrementMethod)
    .arm(2, "finalize", and(notDone, atTarget), finalizeMethod)
    .arm(3, "terminate", isDone, null)
    .objective(isDone)
    .build();

  it("verifies a full routing trajectory", () => {
    scenario(methodology)
      .given({ count: 0, target: 2, done: false })
      .expectsRoute("increment")
      .then({ count: 1, target: 2, done: false })
      .expectsRoute("increment")
      .then({ count: 2, target: 2, done: false })
      .expectsRoute("finalize")
      .then({ count: 2, target: 2, done: true })
      .expectsTermination()
      .run();
  });

  it("throws on wrong route", () => {
    expect(() => {
      scenario(methodology)
        .given({ count: 0, target: 2, done: false })
        .expectsRoute("finalize")  // wrong — should be increment
        .run();
    }).toThrow("increment");
  });

  it("throws when expecting termination but arm fires", () => {
    expect(() => {
      scenario(methodology)
        .given({ count: 0, target: 2, done: false })
        .expectsTermination()  // wrong — increment should fire
        .run();
    }).toThrow("increment");
  });
});
