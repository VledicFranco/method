/**
 * Tests for generateRetro — structured retrospective from methodology results.
 *
 * Verifies timing, cost breakdown, routing, step aggregation, safety headroom,
 * status propagation, and YAML round-trip serialization (DR-T06).
 */

import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import { generateRetro, type MethodologyRetro } from "../retro.js";
import type {
  MethodologyResult,
  ExecutionAccumulatorState,
  CompletedMethodRecord,
} from "../accumulator.js";
import type { SafetyBounds } from "../../methodology/methodology.js";
import type { WorldState, StateTrace } from "../../state/world-state.js";

// ── Test helpers ──

type TestState = { value: number };

const testBounds: SafetyBounds = {
  maxLoops: 10,
  maxTokens: 100000,
  maxCostUsd: 5.0,
  maxDurationMs: 3600000,
  maxDepth: 3,
};

function makeWorldState(s: TestState): WorldState<TestState> {
  return { value: s, axiomStatus: { valid: true, violations: [] } };
}

function makeTrace(s: TestState): StateTrace<TestState> {
  const ws = makeWorldState(s);
  return { snapshots: [], initial: ws, current: ws };
}

/** Build a mock MethodologyResult with sensible defaults. */
function mockResult(
  overrides?: Partial<MethodologyResult<TestState>>,
): MethodologyResult<TestState> {
  const state = makeWorldState({ value: 42 });
  return {
    status: "completed",
    finalState: state,
    trace: { snapshots: [], initial: state, current: state },
    accumulator: {
      loopCount: 2,
      totalTokens: 5000,
      totalCostUsd: 0.5,
      startedAt: new Date("2026-03-22T00:00:00Z"),
      elapsedMs: 30000,
      suspensionCount: 0,
      completedMethods: [
        {
          methodId: "M1",
          objectiveMet: true,
          stepOutputSummaries: { s1: "done", s2: "done", s3: "done" },
          cost: { tokens: 3000, usd: 0.3, duration_ms: 20000 },
        },
        {
          methodId: "M2",
          objectiveMet: true,
          stepOutputSummaries: { s4: "done", s5: "done", s6: "done" },
          cost: { tokens: 2000, usd: 0.2, duration_ms: 10000 },
        },
      ],
    },
    ...overrides,
  };
}

// ── Tests ──

describe("generateRetro", () => {
  it("populates all fields from a completed result with 2 methods and 6 steps", () => {
    const retro = generateRetro(mockResult(), testBounds);

    expect(retro.status).toBe("completed");
    expect(retro.timing.startedAt).toEqual(new Date("2026-03-22T00:00:00Z"));
    expect(retro.timing.durationMs).toBe(30000);
    expect(retro.timing.completedAt).toBeInstanceOf(Date);
    expect(retro.cost.totalTokens).toBe(5000);
    expect(retro.cost.totalCostUsd).toBeCloseTo(0.5);
    expect(retro.cost.perMethod).toHaveLength(2);
    expect(retro.routing.totalLoops).toBe(2);
    expect(retro.routing.methodSequence).toEqual(["M1", "M2"]);
    expect(retro.steps.total).toBe(6);
    expect(retro.steps.completed).toBe(6);
    expect(retro.steps.failed).toBe(0);
    expect(retro.safety.violated).toBe(false);
    expect(retro.safety.violatedBound).toBeNull();
  });

  it("timing has correct startedAt and durationMs", () => {
    const retro = generateRetro(mockResult(), testBounds);

    expect(retro.timing.startedAt).toEqual(new Date("2026-03-22T00:00:00Z"));
    expect(retro.timing.durationMs).toBe(30000);
    // completedAt should be a recent Date (set to now)
    expect(retro.timing.completedAt.getTime()).toBeGreaterThan(
      new Date("2026-03-21T00:00:00Z").getTime(),
    );
  });

  it("cost breakdown per method is correct", () => {
    const retro = generateRetro(mockResult(), testBounds);

    expect(retro.cost.perMethod).toEqual([
      { methodId: "M1", tokens: 3000, usd: 0.3 },
      { methodId: "M2", tokens: 2000, usd: 0.2 },
    ]);
    expect(retro.cost.totalTokens).toBe(5000);
    expect(retro.cost.totalCostUsd).toBeCloseTo(0.5);
  });

  it("routing.methodSequence = ['M1', 'M2'] and totalLoops = 2", () => {
    const retro = generateRetro(mockResult(), testBounds);

    expect(retro.routing.methodSequence).toEqual(["M1", "M2"]);
    expect(retro.routing.totalLoops).toBe(2);
  });

  it("safety headroom is calculated correctly", () => {
    const retro = generateRetro(mockResult(), testBounds);

    // bounds: maxLoops=10, maxTokens=100000, maxCostUsd=5.0, maxDurationMs=3600000
    // usage: loopCount=2, totalTokens=5000, totalCostUsd=0.50, elapsedMs=30000
    expect(retro.safety.headroom.loops).toBe(8); // 10 - 2
    expect(retro.safety.headroom.tokens).toBe(95000); // 100000 - 5000
    expect(retro.safety.headroom.costUsd).toBeCloseTo(4.5); // 5.0 - 0.5
    expect(retro.safety.headroom.durationMs).toBe(3570000); // 3600000 - 30000
  });

  it("safety.violated = false for completed status", () => {
    const retro = generateRetro(mockResult(), testBounds);

    expect(retro.safety.violated).toBe(false);
    expect(retro.safety.violatedBound).toBeNull();
  });

  it("safety_violation status sets violated = true and violatedBound", () => {
    const result = mockResult({
      status: "safety_violation",
      accumulator: {
        loopCount: 10,
        totalTokens: 120000,
        totalCostUsd: 1.2,
        startedAt: new Date("2026-03-22T00:00:00Z"),
        elapsedMs: 60000,
        suspensionCount: 0,
        completedMethods: [
          {
            methodId: "M1",
            objectiveMet: false,
            stepOutputSummaries: { s1: "done" },
            cost: { tokens: 120000, usd: 1.2, duration_ms: 60000 },
          },
        ],
      },
      violation: { bound: "maxTokens", limit: 100000, actual: 120000 },
    });

    const retro = generateRetro(result, testBounds);

    expect(retro.status).toBe("safety_violation");
    expect(retro.safety.violated).toBe(true);
    expect(retro.safety.violatedBound).toBe("maxTokens");
  });

  it("safety_violation headroom shows negative for violated bound", () => {
    const result = mockResult({
      status: "safety_violation",
      accumulator: {
        loopCount: 12,
        totalTokens: 120000,
        totalCostUsd: 6.0,
        startedAt: new Date("2026-03-22T00:00:00Z"),
        elapsedMs: 4000000,
        suspensionCount: 0,
        completedMethods: [],
      },
      violation: { bound: "maxTokens", limit: 100000, actual: 120000 },
    });

    const retro = generateRetro(result, testBounds);

    // All headroom values should be negative since all bounds are exceeded
    expect(retro.safety.headroom.loops).toBe(-2); // 10 - 12
    expect(retro.safety.headroom.tokens).toBe(-20000); // 100000 - 120000
    expect(retro.safety.headroom.costUsd).toBeCloseTo(-1.0); // 5.0 - 6.0
    expect(retro.safety.headroom.durationMs).toBe(-400000); // 3600000 - 4000000
  });

  it("status field matches result.status", () => {
    const statuses = ["completed", "safety_violation", "failed", "aborted"] as const;

    for (const status of statuses) {
      const result = mockResult({ status });
      const retro = generateRetro(result, testBounds);
      expect(retro.status).toBe(status);
    }
  });

  it("is YAML-serializable (round-trip)", () => {
    const retro = generateRetro(mockResult(), testBounds);
    const yamlStr = yaml.dump(retro);
    const parsed = yaml.load(yamlStr) as typeof retro;

    expect(parsed.status).toBe(retro.status);
    expect(parsed.cost.totalTokens).toBe(retro.cost.totalTokens);
    expect(parsed.cost.totalCostUsd).toBe(retro.cost.totalCostUsd);
    expect(parsed.routing.totalLoops).toBe(retro.routing.totalLoops);
    expect(parsed.routing.methodSequence).toEqual(retro.routing.methodSequence);
    expect(parsed.safety.violated).toBe(retro.safety.violated);
    expect(parsed.safety.violatedBound).toBe(retro.safety.violatedBound);
    expect(parsed.safety.headroom.loops).toBe(retro.safety.headroom.loops);
    expect(parsed.steps.total).toBe(retro.steps.total);
    expect(parsed.steps.completed).toBe(retro.steps.completed);
    // Dates serialize to strings in YAML; verify they parse back
    expect(new Date(parsed.timing.startedAt).getTime()).toBe(
      retro.timing.startedAt.getTime(),
    );
  });
});
