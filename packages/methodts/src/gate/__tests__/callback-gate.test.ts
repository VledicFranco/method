// SPDX-License-Identifier: Apache-2.0
/**
 * callbackGate tests — webhook-style external trigger gate.
 *
 * @see PRD 021 Component 7 — callback gate runner
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { callbackGate } from "../runners/callback-gate.js";

// ── Test state ──

type TestState = { value: number };
const state: TestState = { value: 42 };

// ── Tests ──

describe("callbackGate", () => {
  it("resolve(true) passes the gate with the given reason", async () => {
    const { gate, resolve } = callbackGate<TestState>({
      id: "cb-1",
      description: "Wait for webhook",
    });

    // Start evaluation, then resolve immediately
    const resultPromise = Effect.runPromise(gate.evaluate(state));
    resolve(true, "Webhook received: deploy complete");

    const result = await resultPromise;
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("Webhook received: deploy complete");
    expect(result.witness).toBeNull();
  });

  it("resolve(false) fails the gate with the given reason", async () => {
    const { gate, resolve } = callbackGate<TestState>({
      id: "cb-2",
      description: "Wait for approval",
    });

    const resultPromise = Effect.runPromise(gate.evaluate(state));
    resolve(false, "Approval denied by reviewer");

    const result = await resultPromise;
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("Approval denied by reviewer");
    expect(result.witness).toBeNull();
  });

  it("timeout causes the gate to fail with timeout message", async () => {
    const { gate } = callbackGate<TestState>({
      id: "cb-3",
      description: "Wait for slow webhook",
      timeoutMs: 50,
    });

    // Do not call resolve — let it timeout
    const result = await Effect.runPromise(gate.evaluate(state));

    expect(result.passed).toBe(false);
    expect(result.reason).toBe("Callback gate timed out after 50ms");
    expect(result.duration_ms).toBe(50);
    expect(result.witness).toBeNull();
  });

  it("gate has correct id and description", () => {
    const { gate } = callbackGate<TestState>({
      id: "cb-meta",
      description: "Metadata check",
    });

    expect(gate.id).toBe("cb-meta");
    expect(gate.description).toBe("Metadata check");
    expect(gate.maxRetries).toBe(0);
  });

  it("gate predicate is TRUE (callback controls pass/fail, not predicate)", () => {
    const { gate } = callbackGate<TestState>({
      id: "cb-pred",
      description: "Predicate check",
    });

    expect(gate.predicate).toEqual({ tag: "val", value: true });
  });

  it("resolve before evaluate is a no-op (no crash)", () => {
    const { resolve } = callbackGate<TestState>({
      id: "cb-early",
      description: "Early resolve",
    });

    // Calling resolve before evaluate should not throw
    expect(() => resolve(true, "early")).not.toThrow();
  });
});
