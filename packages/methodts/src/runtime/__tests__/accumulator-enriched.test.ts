// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for enriched cost tracking: ModelCostRecord, aggregateModelCosts,
 * CompletedMethodRecord with model breakdown, and generateRetro integration
 * with per-model and cache efficiency fields.
 *
 * All new fields are optional — backward compatibility is verified.
 */

import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import {
  type ModelCostRecord,
  type CompletedMethodRecord,
  aggregateModelCosts,
  initialAccumulator,
  recordMethod,
} from "../accumulator.js";
import { generateRetro } from "../retro.js";
import type { MethodologyResult } from "../accumulator.js";
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
          stepOutputSummaries: { s1: "done", s2: "done" },
          cost: { tokens: 3000, usd: 0.3, duration_ms: 20000 },
        },
        {
          methodId: "M2",
          objectiveMet: true,
          stepOutputSummaries: { s3: "done", s4: "done" },
          cost: { tokens: 2000, usd: 0.2, duration_ms: 10000 },
        },
      ],
    },
    ...overrides,
  };
}

// ── ModelCostRecord ──

describe("ModelCostRecord", () => {
  it("constructs a record with all required fields", () => {
    const record: ModelCostRecord = {
      model: "claude-opus-4",
      inputTokens: 10000,
      outputTokens: 2000,
      costUsd: 0.45,
    };

    expect(record.model).toBe("claude-opus-4");
    expect(record.inputTokens).toBe(10000);
    expect(record.outputTokens).toBe(2000);
    expect(record.costUsd).toBe(0.45);
  });

  it("is YAML-serializable", () => {
    const record: ModelCostRecord = {
      model: "claude-sonnet-4",
      inputTokens: 5000,
      outputTokens: 1000,
      costUsd: 0.12,
    };

    const serialized = yaml.dump(record);
    const parsed = yaml.load(serialized) as ModelCostRecord;

    expect(parsed.model).toBe("claude-sonnet-4");
    expect(parsed.inputTokens).toBe(5000);
    expect(parsed.outputTokens).toBe(1000);
    expect(parsed.costUsd).toBe(0.12);
  });
});

// ── aggregateModelCosts ──

describe("aggregateModelCosts", () => {
  it("aggregates 2 methods using 2 models into correct per-model totals", () => {
    const costs = [
      {
        modelBreakdown: [
          { model: "claude-opus-4", inputTokens: 5000, outputTokens: 1000, costUsd: 0.30 },
          { model: "claude-sonnet-4", inputTokens: 2000, outputTokens: 500, costUsd: 0.05 },
        ],
      },
      {
        modelBreakdown: [
          { model: "claude-opus-4", inputTokens: 3000, outputTokens: 800, costUsd: 0.20 },
          { model: "claude-sonnet-4", inputTokens: 1000, outputTokens: 200, costUsd: 0.02 },
        ],
      },
    ];

    const result = aggregateModelCosts(costs);

    expect(result).toHaveLength(2);

    const opus = result.find((r) => r.model === "claude-opus-4");
    expect(opus).toBeDefined();
    expect(opus!.inputTokens).toBe(8000);
    expect(opus!.outputTokens).toBe(1800);
    expect(opus!.costUsd).toBeCloseTo(0.50);

    const sonnet = result.find((r) => r.model === "claude-sonnet-4");
    expect(sonnet).toBeDefined();
    expect(sonnet!.inputTokens).toBe(3000);
    expect(sonnet!.outputTokens).toBe(700);
    expect(sonnet!.costUsd).toBeCloseTo(0.07);
  });

  it("returns empty array when given empty input", () => {
    const result = aggregateModelCosts([]);
    expect(result).toEqual([]);
  });

  it("returns empty array when no records have modelBreakdown", () => {
    const costs = [{}, { modelBreakdown: undefined }];
    const result = aggregateModelCosts(costs);
    expect(result).toEqual([]);
  });

  it("sums same model across multiple methods", () => {
    const costs = [
      {
        modelBreakdown: [
          { model: "claude-opus-4", inputTokens: 1000, outputTokens: 100, costUsd: 0.10 },
        ],
      },
      {
        modelBreakdown: [
          { model: "claude-opus-4", inputTokens: 2000, outputTokens: 200, costUsd: 0.20 },
        ],
      },
      {
        modelBreakdown: [
          { model: "claude-opus-4", inputTokens: 3000, outputTokens: 300, costUsd: 0.30 },
        ],
      },
    ];

    const result = aggregateModelCosts(costs);

    expect(result).toHaveLength(1);
    expect(result[0].model).toBe("claude-opus-4");
    expect(result[0].inputTokens).toBe(6000);
    expect(result[0].outputTokens).toBe(600);
    expect(result[0].costUsd).toBeCloseTo(0.60);
  });

  it("handles mix of records with and without modelBreakdown", () => {
    const costs = [
      {
        modelBreakdown: [
          { model: "claude-opus-4", inputTokens: 1000, outputTokens: 100, costUsd: 0.10 },
        ],
      },
      {},
      {
        modelBreakdown: [
          { model: "claude-opus-4", inputTokens: 2000, outputTokens: 200, costUsd: 0.20 },
        ],
      },
    ];

    const result = aggregateModelCosts(costs);

    expect(result).toHaveLength(1);
    expect(result[0].inputTokens).toBe(3000);
  });
});

// ── CompletedMethodRecord with enriched cost ──

describe("CompletedMethodRecord with modelBreakdown", () => {
  it("constructs a record with modelBreakdown and cache fields", () => {
    const record: CompletedMethodRecord = {
      methodId: "M1-DESIGN",
      objectiveMet: true,
      stepOutputSummaries: { "step-1": "Designed the API" },
      cost: {
        tokens: 5000,
        usd: 0.35,
        duration_ms: 20000,
        modelBreakdown: [
          { model: "claude-opus-4", inputTokens: 3000, outputTokens: 1000, costUsd: 0.30 },
          { model: "claude-sonnet-4", inputTokens: 800, outputTokens: 200, costUsd: 0.05 },
        ],
        cacheCreationTokens: 500,
        cacheReadTokens: 1200,
      },
    };

    expect(record.cost.modelBreakdown).toHaveLength(2);
    expect(record.cost.cacheCreationTokens).toBe(500);
    expect(record.cost.cacheReadTokens).toBe(1200);
  });

  it("backward compat: works without enriched fields", () => {
    const record: CompletedMethodRecord = {
      methodId: "M1",
      objectiveMet: true,
      stepOutputSummaries: {},
      cost: { tokens: 1000, usd: 0.05, duration_ms: 5000 },
    };

    expect(record.cost.modelBreakdown).toBeUndefined();
    expect(record.cost.cacheCreationTokens).toBeUndefined();
    expect(record.cost.cacheReadTokens).toBeUndefined();
  });

  it("recordMethod works with enriched cost fields", () => {
    const acc = initialAccumulator();
    const record: CompletedMethodRecord = {
      methodId: "M1",
      objectiveMet: true,
      stepOutputSummaries: { s1: "done" },
      cost: {
        tokens: 3000,
        usd: 0.30,
        duration_ms: 20000,
        modelBreakdown: [
          { model: "claude-opus-4", inputTokens: 2000, outputTokens: 500, costUsd: 0.25 },
        ],
        cacheCreationTokens: 100,
        cacheReadTokens: 800,
      },
    };

    const updated = recordMethod(acc, record);

    expect(updated.completedMethods).toHaveLength(1);
    expect(updated.completedMethods[0].cost.modelBreakdown).toHaveLength(1);
    expect(updated.completedMethods[0].cost.cacheCreationTokens).toBe(100);
    expect(updated.totalTokens).toBe(3000);
  });
});

// ── generateRetro with enriched cost data ──

describe("generateRetro with enriched cost", () => {
  it("populates perModel when methods have modelBreakdown", () => {
    const result = mockResult({
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
            stepOutputSummaries: { s1: "done" },
            cost: {
              tokens: 3000,
              usd: 0.3,
              duration_ms: 20000,
              modelBreakdown: [
                { model: "claude-opus-4", inputTokens: 2000, outputTokens: 500, costUsd: 0.25 },
                { model: "claude-sonnet-4", inputTokens: 400, outputTokens: 100, costUsd: 0.05 },
              ],
            },
          },
          {
            methodId: "M2",
            objectiveMet: true,
            stepOutputSummaries: { s2: "done" },
            cost: {
              tokens: 2000,
              usd: 0.2,
              duration_ms: 10000,
              modelBreakdown: [
                { model: "claude-opus-4", inputTokens: 1500, outputTokens: 300, costUsd: 0.18 },
                { model: "claude-sonnet-4", inputTokens: 150, outputTokens: 50, costUsd: 0.02 },
              ],
            },
          },
        ],
      },
    });

    const retro = generateRetro(result, testBounds);

    expect(retro.cost.perModel).toBeDefined();
    expect(retro.cost.perModel).toHaveLength(2);

    const opus = retro.cost.perModel!.find((r) => r.model === "claude-opus-4");
    expect(opus).toBeDefined();
    expect(opus!.inputTokens).toBe(3500);
    expect(opus!.outputTokens).toBe(800);
    expect(opus!.costUsd).toBeCloseTo(0.43);

    const sonnet = retro.cost.perModel!.find((r) => r.model === "claude-sonnet-4");
    expect(sonnet).toBeDefined();
    expect(sonnet!.inputTokens).toBe(550);
    expect(sonnet!.outputTokens).toBe(150);
    expect(sonnet!.costUsd).toBeCloseTo(0.07);
  });

  it("perModel is undefined when methods lack modelBreakdown", () => {
    const retro = generateRetro(mockResult(), testBounds);

    expect(retro.cost.perModel).toBeUndefined();
  });

  it("cache metrics are aggregated correctly", () => {
    const result = mockResult({
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
            stepOutputSummaries: { s1: "done" },
            cost: {
              tokens: 3000,
              usd: 0.3,
              duration_ms: 20000,
              cacheCreationTokens: 500,
              cacheReadTokens: 1200,
            },
          },
          {
            methodId: "M2",
            objectiveMet: true,
            stepOutputSummaries: { s2: "done" },
            cost: {
              tokens: 2000,
              usd: 0.2,
              duration_ms: 10000,
              cacheCreationTokens: 300,
              cacheReadTokens: 800,
            },
          },
        ],
      },
    });

    const retro = generateRetro(result, testBounds);

    expect(retro.cost.cacheEfficiency).toBeDefined();
    expect(retro.cost.cacheEfficiency!.creationTokens).toBe(800);
    expect(retro.cost.cacheEfficiency!.readTokens).toBe(2000);
    expect(retro.cost.cacheEfficiency!.savingsEstimate).toBe(2000);
  });

  it("cacheEfficiency is undefined when no cache data present", () => {
    const retro = generateRetro(mockResult(), testBounds);

    expect(retro.cost.cacheEfficiency).toBeUndefined();
  });

  it("cacheEfficiency present when only one method has cache data", () => {
    const result = mockResult({
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
            stepOutputSummaries: { s1: "done" },
            cost: {
              tokens: 3000,
              usd: 0.3,
              duration_ms: 20000,
              cacheCreationTokens: 200,
              cacheReadTokens: 0,
            },
          },
          {
            methodId: "M2",
            objectiveMet: true,
            stepOutputSummaries: { s2: "done" },
            cost: { tokens: 2000, usd: 0.2, duration_ms: 10000 },
          },
        ],
      },
    });

    const retro = generateRetro(result, testBounds);

    expect(retro.cost.cacheEfficiency).toBeDefined();
    expect(retro.cost.cacheEfficiency!.creationTokens).toBe(200);
    expect(retro.cost.cacheEfficiency!.readTokens).toBe(0);
  });

  it("enriched retro is YAML-serializable (round-trip)", () => {
    const result = mockResult({
      accumulator: {
        loopCount: 1,
        totalTokens: 5000,
        totalCostUsd: 0.5,
        startedAt: new Date("2026-03-22T00:00:00Z"),
        elapsedMs: 30000,
        suspensionCount: 0,
        completedMethods: [
          {
            methodId: "M1",
            objectiveMet: true,
            stepOutputSummaries: { s1: "done" },
            cost: {
              tokens: 5000,
              usd: 0.5,
              duration_ms: 30000,
              modelBreakdown: [
                { model: "claude-opus-4", inputTokens: 4000, outputTokens: 800, costUsd: 0.45 },
              ],
              cacheCreationTokens: 300,
              cacheReadTokens: 1500,
            },
          },
        ],
      },
    });

    const retro = generateRetro(result, testBounds);
    const yamlStr = yaml.dump(retro);
    const parsed = yaml.load(yamlStr) as typeof retro;

    // Verify enriched fields survive round-trip
    expect(parsed.cost.perModel).toHaveLength(1);
    expect(parsed.cost.perModel![0].model).toBe("claude-opus-4");
    expect(parsed.cost.perModel![0].inputTokens).toBe(4000);
    expect(parsed.cost.perModel![0].outputTokens).toBe(800);
    expect(parsed.cost.perModel![0].costUsd).toBe(0.45);

    expect(parsed.cost.cacheEfficiency).toBeDefined();
    expect(parsed.cost.cacheEfficiency!.creationTokens).toBe(300);
    expect(parsed.cost.cacheEfficiency!.readTokens).toBe(1500);
    expect(parsed.cost.cacheEfficiency!.savingsEstimate).toBe(1500);

    // Core fields still intact
    expect(parsed.status).toBe("completed");
    expect(parsed.cost.totalTokens).toBe(5000);
  });

  it("existing retro tests still pass — new fields are optional and do not affect base behavior", () => {
    // This test verifies backward compat by using the same mockResult as existing tests
    const retro = generateRetro(mockResult(), testBounds);

    // All existing fields still populated correctly
    expect(retro.status).toBe("completed");
    expect(retro.cost.totalTokens).toBe(5000);
    expect(retro.cost.totalCostUsd).toBeCloseTo(0.5);
    expect(retro.cost.perMethod).toHaveLength(2);
    expect(retro.routing.totalLoops).toBe(2);
    expect(retro.routing.methodSequence).toEqual(["M1", "M2"]);
    expect(retro.steps.total).toBe(4);
    expect(retro.safety.violated).toBe(false);

    // New fields are absent (undefined) when not provided
    expect(retro.cost.perModel).toBeUndefined();
    expect(retro.cost.cacheEfficiency).toBeUndefined();
  });
});
