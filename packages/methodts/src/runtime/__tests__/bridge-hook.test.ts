/**
 * Tests for bridge-hook.ts — formatProgress, formatEvent, bridgeChannelHook.
 *
 * Covers the pure formatting layer that maps RuntimeEvent variants
 * to bridge channel payloads (progress + events).
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { formatProgress, formatEvent, bridgeChannelHook } from "../bridge-hook.js";
import type { RuntimeEvent } from "../events.js";

type TestState = { count: number };

const ts = new Date("2026-03-21T12:00:00Z");
const tsISO = "2026-03-21T12:00:00.000Z";

// ── formatProgress ──

describe("formatProgress", () => {
  it("step_started → step=stepId, status='started', detail includes executionTag", () => {
    const event: RuntimeEvent<TestState> = {
      type: "step_started",
      stepId: "S1-code",
      executionTag: "agent",
      timestamp: ts,
    };
    const result = formatProgress(event);
    expect(result).toEqual({
      step: "S1-code",
      status: "started",
      detail: "Execution: agent",
      timestamp: tsISO,
    });
  });

  it("step_completed → includes cost detail", () => {
    const event: RuntimeEvent<TestState> = {
      type: "step_completed",
      stepId: "S2-test",
      cost: { tokens: 5000, usd: 0.0123, duration_ms: 2500 },
      timestamp: ts,
    };
    const result = formatProgress(event);
    expect(result).toEqual({
      step: "S2-test",
      status: "completed",
      detail: "Cost: $0.0123",
      timestamp: tsISO,
    });
  });

  it("step_retried → includes attempt and feedback", () => {
    const event: RuntimeEvent<TestState> = {
      type: "step_retried",
      stepId: "S1-code",
      attempt: 2,
      feedback: "test failures detected",
      timestamp: ts,
    };
    const result = formatProgress(event);
    expect(result).toEqual({
      step: "S1-code",
      status: "retrying",
      detail: "Attempt 2: test failures detected",
      timestamp: tsISO,
    });
  });

  it("method_selected → includes arm", () => {
    const event: RuntimeEvent<TestState> = {
      type: "method_selected",
      methodId: "M3-code",
      arm: "agent-driven",
      timestamp: ts,
    };
    const result = formatProgress(event);
    expect(result).toEqual({
      step: "M3-code",
      status: "method_selected",
      detail: "Arm: agent-driven",
      timestamp: tsISO,
    });
  });

  it("method_completed with objectiveMet=true → status 'objective_met'", () => {
    const event: RuntimeEvent<TestState> = {
      type: "method_completed",
      methodId: "M3-code",
      objectiveMet: true,
      timestamp: ts,
    };
    const result = formatProgress(event);
    expect(result).toEqual({
      step: "M3-code",
      status: "objective_met",
      timestamp: tsISO,
    });
  });

  it("method_completed with objectiveMet=false → status 'objective_not_met'", () => {
    const event: RuntimeEvent<TestState> = {
      type: "method_completed",
      methodId: "M3-code",
      objectiveMet: false,
      timestamp: ts,
    };
    const result = formatProgress(event);
    expect(result).toEqual({
      step: "M3-code",
      status: "objective_not_met",
      timestamp: tsISO,
    });
  });

  it("methodology_started → step=methodologyId, status='started'", () => {
    const event: RuntimeEvent<TestState> = {
      type: "methodology_started",
      methodologyId: "P2-SD",
      initialState: { value: { count: 0 }, axiomStatus: { valid: true, violations: [] } },
      timestamp: ts,
    };
    const result = formatProgress(event);
    expect(result).toEqual({
      step: "P2-SD",
      status: "started",
      timestamp: tsISO,
    });
  });

  it("methodology_completed → passes through status", () => {
    const event: RuntimeEvent<TestState> = {
      type: "methodology_completed",
      status: "completed",
      timestamp: ts,
    };
    const result = formatProgress(event);
    expect(result).toEqual({
      step: "methodology",
      status: "completed",
      timestamp: tsISO,
    });
  });

  it("methodology_completed with safety_violation status", () => {
    const event: RuntimeEvent<TestState> = {
      type: "methodology_completed",
      status: "safety_violation",
      timestamp: ts,
    };
    const result = formatProgress(event);
    expect(result).toEqual({
      step: "methodology",
      status: "safety_violation",
      timestamp: tsISO,
    });
  });

  it("gate_evaluated passed → status 'gate_passed'", () => {
    const event: RuntimeEvent<TestState> = {
      type: "gate_evaluated",
      gateId: "G1-review",
      passed: true,
      timestamp: ts,
    };
    const result = formatProgress(event);
    expect(result).toEqual({
      step: "G1-review",
      status: "gate_passed",
      timestamp: tsISO,
    });
  });

  it("gate_evaluated failed → status 'gate_failed'", () => {
    const event: RuntimeEvent<TestState> = {
      type: "gate_evaluated",
      gateId: "G1-review",
      passed: false,
      timestamp: ts,
    };
    const result = formatProgress(event);
    expect(result).toEqual({
      step: "G1-review",
      status: "gate_failed",
      timestamp: tsISO,
    });
  });

  it("safety_warning → includes bound, usage, and limit", () => {
    const event: RuntimeEvent<TestState> = {
      type: "safety_warning",
      bound: "token_budget",
      usage: 45000,
      limit: 50000,
      timestamp: ts,
    };
    const result = formatProgress(event);
    expect(result).toEqual({
      step: "safety",
      status: "warning",
      detail: "token_budget: 45000/50000",
      timestamp: tsISO,
    });
  });

  it("unknown/unhandled event type → generic format", () => {
    const event: RuntimeEvent<TestState> = {
      type: "custom",
      name: "my-custom-event",
      payload: { foo: "bar" },
      timestamp: ts,
    };
    const result = formatProgress(event);
    expect(result).toEqual({
      step: "custom",
      status: "event",
      timestamp: tsISO,
    });
  });

  it("axiom_validated → falls through to default", () => {
    const event: RuntimeEvent<TestState> = {
      type: "axiom_validated",
      valid: true,
      violations: [],
      timestamp: ts,
    };
    const result = formatProgress(event);
    expect(result).toEqual({
      step: "axiom_validated",
      status: "event",
      timestamp: tsISO,
    });
  });
});

// ── formatEvent ──

describe("formatEvent", () => {
  it("wraps any event with type + payload + timestamp", () => {
    const event: RuntimeEvent<TestState> = {
      type: "step_started",
      stepId: "S1-code",
      executionTag: "script",
      timestamp: ts,
    };
    const result = formatEvent(event);
    expect(result.type).toBe("step_started");
    expect(result.payload).toEqual(expect.objectContaining({
      type: "step_started",
      stepId: "S1-code",
      executionTag: "script",
    }));
    expect(result.timestamp).toBe(tsISO);
  });

  it("timestamp is ISO string", () => {
    const event: RuntimeEvent<TestState> = {
      type: "methodology_completed",
      status: "completed",
      timestamp: new Date("2026-06-15T08:30:00Z"),
    };
    const result = formatEvent(event);
    expect(result.timestamp).toBe("2026-06-15T08:30:00.000Z");
  });

  it("payload includes all event fields via spread", () => {
    const event: RuntimeEvent<TestState> = {
      type: "safety_warning",
      bound: "cost_usd",
      usage: 1.5,
      limit: 2.0,
      timestamp: ts,
    };
    const result = formatEvent(event);
    expect(result.payload).toHaveProperty("bound", "cost_usd");
    expect(result.payload).toHaveProperty("usage", 1.5);
    expect(result.payload).toHaveProperty("limit", 2.0);
  });
});

// ── bridgeChannelHook ──

describe("bridgeChannelHook", () => {
  it("has correct id including sessionId", () => {
    const hook = bridgeChannelHook<TestState>({
      bridgeUrl: "http://localhost:3456",
      sessionId: "sess-42",
    });
    expect(hook.id).toBe("bridge-channel-sess-42");
  });

  it("has correct description", () => {
    const hook = bridgeChannelHook<TestState>({
      bridgeUrl: "http://localhost:3456",
      sessionId: "sess-42",
    });
    expect(hook.description).toBe("Forward events to bridge session sess-42");
  });

  it("mode is fire_and_forget", () => {
    const hook = bridgeChannelHook<TestState>({
      bridgeUrl: "http://localhost:3456",
      sessionId: "sess-1",
    });
    expect(hook.mode).toBe("fire_and_forget");
  });

  it("passes through filter from config", () => {
    const filter = { types: ["step_started", "step_completed"] as const };
    const hook = bridgeChannelHook<TestState>({
      bridgeUrl: "http://localhost:3456",
      sessionId: "sess-1",
      filter,
    });
    expect(hook.filter).toBe(filter);
  });

  it("filter is undefined when not provided", () => {
    const hook = bridgeChannelHook<TestState>({
      bridgeUrl: "http://localhost:3456",
      sessionId: "sess-1",
    });
    expect(hook.filter).toBeUndefined();
  });

  it("handler executes without error", async () => {
    const hook = bridgeChannelHook<TestState>({
      bridgeUrl: "http://localhost:3456",
      sessionId: "sess-99",
    });
    const event: RuntimeEvent<TestState> = {
      type: "step_started",
      stepId: "S1-code",
      executionTag: "agent",
      timestamp: ts,
    };

    // Should not throw
    await Effect.runPromise(hook.handler(event));
  });

  it("handler works with various event types", async () => {
    const hook = bridgeChannelHook<TestState>({
      bridgeUrl: "http://localhost:3456",
      sessionId: "sess-99",
    });

    const events: RuntimeEvent<TestState>[] = [
      { type: "methodology_started", methodologyId: "P2-SD", initialState: { value: { count: 0 }, axiomStatus: { valid: true, violations: [] } }, timestamp: ts },
      { type: "methodology_completed", status: "completed", timestamp: ts },
      { type: "gate_evaluated", gateId: "G1", passed: true, timestamp: ts },
      { type: "safety_warning", bound: "tokens", usage: 100, limit: 200, timestamp: ts },
      { type: "custom", name: "test", payload: {}, timestamp: ts },
    ];

    for (const event of events) {
      await Effect.runPromise(hook.handler(event));
    }
  });
});
