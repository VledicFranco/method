// SPDX-License-Identifier: Apache-2.0
/**
 * Suspension serialization tests (SC9).
 *
 * Validates that SuspendedMethodology state can round-trip through JSON
 * serialization/deserialization, preserving all fields except functions.
 */

import { describe, it, expect } from "vitest";
import type { SuspendedMethodology, SuspensionReason } from "../runtime/suspension.js";
import type { WorldState, StateTrace, Snapshot } from "../state/world-state.js";
import type { ExecutionAccumulatorState } from "../runtime/accumulator.js";

type TestState = { count: number; phase: string };

/** Helper to build a minimal suspended snapshot (omitting non-serializable fields). */
function makeSuspended(
  overrides: Partial<{
    reason: SuspensionReason<TestState>;
    state: WorldState<TestState>;
    accumulator: Partial<ExecutionAccumulatorState>;
    insightStore: Record<string, string>;
    position: SuspendedMethodology<TestState>["position"];
  }> = {},
): Omit<SuspendedMethodology<TestState>, never> {
  const state: WorldState<TestState> = overrides.state ?? {
    value: { count: 5, phase: "review" },
    axiomStatus: { valid: true, violations: [] },
  };

  return {
    reason: overrides.reason ?? { tag: "checkpoint", stepId: "sigma_2" },
    state,
    trace: { snapshots: [], initial: state, current: state },
    accumulator: {
      loopCount: 2,
      totalTokens: 5000,
      totalCostUsd: 0.5,
      startedAt: new Date("2026-03-22T00:00:00Z"),
      elapsedMs: 30000,
      suspensionCount: 1,
      completedMethods: [],
      ...overrides.accumulator,
    },
    insightStore: overrides.insightStore ?? { arch_analysis: "3 modules identified" },
    position: overrides.position ?? {
      methodologyId: "P-TEST",
      methodId: "M-REVIEW",
      stepId: "sigma_2",
      stepIndex: 2,
      retryCount: 0,
    },
  };
}

describe("Suspension serialization", () => {
  it("state/trace/accumulator/position round-trips through JSON", () => {
    const suspended = makeSuspended();

    const json = JSON.stringify(suspended);
    const deserialized = JSON.parse(json);

    expect(deserialized.state.value.count).toBe(5);
    expect(deserialized.state.value.phase).toBe("review");
    expect(deserialized.state.axiomStatus.valid).toBe(true);
    expect(deserialized.state.axiomStatus.violations).toEqual([]);
    expect(deserialized.accumulator.loopCount).toBe(2);
    expect(deserialized.accumulator.totalTokens).toBe(5000);
    expect(deserialized.accumulator.totalCostUsd).toBe(0.5);
    expect(deserialized.accumulator.suspensionCount).toBe(1);
    expect(deserialized.position.stepId).toBe("sigma_2");
    expect(deserialized.position.methodologyId).toBe("P-TEST");
    expect(deserialized.position.methodId).toBe("M-REVIEW");
    expect(deserialized.position.stepIndex).toBe(2);
    expect(deserialized.position.retryCount).toBe(0);
    expect(deserialized.insightStore.arch_analysis).toBe("3 modules identified");
    expect(deserialized.reason.tag).toBe("checkpoint");
    expect(deserialized.reason.stepId).toBe("sigma_2");
  });

  it("preserves trace with multiple snapshots", () => {
    const state1: WorldState<TestState> = {
      value: { count: 1, phase: "init" },
      axiomStatus: { valid: true, violations: [] },
    };
    const state2: WorldState<TestState> = {
      value: { count: 3, phase: "mid" },
      axiomStatus: { valid: true, violations: [] },
    };
    const state3: WorldState<TestState> = {
      value: { count: 5, phase: "review" },
      axiomStatus: { valid: true, violations: [] },
    };

    // Build snapshots without non-serializable Predicate references in witnesses
    const snap1: Snapshot<TestState> = {
      state: state1,
      sequence: 0,
      timestamp: new Date("2026-03-22T00:00:00Z"),
      delta: null,
      witnesses: [],
      metadata: { producedBy: "sigma_0", stepId: "sigma_0" },
    };
    const snap2: Snapshot<TestState> = {
      state: state2,
      sequence: 1,
      timestamp: new Date("2026-03-22T00:01:00Z"),
      delta: {
        added: {},
        removed: {},
        changed: { count: { before: 1, after: 3 }, phase: { before: "init", after: "mid" } },
      },
      witnesses: [],
      metadata: { producedBy: "sigma_1", stepId: "sigma_1" },
    };

    const trace: StateTrace<TestState> = {
      snapshots: [snap1, snap2],
      initial: state1,
      current: state3,
    };

    const suspended: Omit<SuspendedMethodology<TestState>, never> = {
      reason: { tag: "checkpoint", stepId: "sigma_2" },
      state: state3,
      trace,
      accumulator: {
        loopCount: 1,
        totalTokens: 2000,
        totalCostUsd: 0.2,
        startedAt: new Date("2026-03-22T00:00:00Z"),
        elapsedMs: 60000,
        suspensionCount: 0,
        completedMethods: [],
      },
      insightStore: {},
      position: {
        methodologyId: "P-TEST",
        methodId: "M-REVIEW",
        stepId: "sigma_2",
        stepIndex: 2,
        retryCount: 0,
      },
    };

    const json = JSON.stringify(suspended);
    const deserialized = JSON.parse(json);

    expect(deserialized.trace.snapshots).toHaveLength(2);
    expect(deserialized.trace.snapshots[0].state.value.count).toBe(1);
    expect(deserialized.trace.snapshots[0].state.value.phase).toBe("init");
    expect(deserialized.trace.snapshots[0].metadata.stepId).toBe("sigma_0");
    expect(deserialized.trace.snapshots[1].delta.changed.count.before).toBe(1);
    expect(deserialized.trace.snapshots[1].delta.changed.count.after).toBe(3);
    expect(deserialized.trace.initial.value.count).toBe(1);
    expect(deserialized.trace.current.value.count).toBe(5);
  });

  it("preserves nested state with complex values", () => {
    type NestedState = { items: { name: string; tags: string[] }[]; meta: { version: number } };

    const state: WorldState<NestedState> = {
      value: {
        items: [
          { name: "alpha", tags: ["fast", "safe"] },
          { name: "beta", tags: ["experimental"] },
        ],
        meta: { version: 3 },
      },
      axiomStatus: { valid: false, violations: ["missing_invariant"] },
    };

    const suspended: Omit<SuspendedMethodology<NestedState>, never> = {
      reason: { tag: "checkpoint", stepId: "sigma_1" },
      state,
      trace: { snapshots: [], initial: state, current: state },
      accumulator: {
        loopCount: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        startedAt: new Date("2026-03-22T00:00:00Z"),
        elapsedMs: 0,
        suspensionCount: 0,
        completedMethods: [],
      },
      insightStore: { note: "nested test" },
      position: {
        methodologyId: "P-NESTED",
        methodId: "M-NESTED",
        stepId: "sigma_1",
        stepIndex: 1,
        retryCount: 0,
      },
    };

    const json = JSON.stringify(suspended);
    const deserialized = JSON.parse(json);

    expect(deserialized.state.value.items).toHaveLength(2);
    expect(deserialized.state.value.items[0].name).toBe("alpha");
    expect(deserialized.state.value.items[0].tags).toEqual(["fast", "safe"]);
    expect(deserialized.state.value.items[1].tags).toEqual(["experimental"]);
    expect(deserialized.state.value.meta.version).toBe(3);
    expect(deserialized.state.axiomStatus.valid).toBe(false);
    expect(deserialized.state.axiomStatus.violations).toEqual(["missing_invariant"]);
  });

  it("preserves all SuspensionReason variants through JSON", () => {
    // gate_review
    const gateReason: SuspensionReason<TestState> = {
      tag: "gate_review", gateId: "G3", passed: false, stepId: "sigma_6",
    };
    expect(JSON.parse(JSON.stringify(gateReason))).toEqual(gateReason);

    // checklist_review
    const checklistReason: SuspensionReason<TestState> = {
      tag: "checklist_review", lowConfidence: ["item_a", "item_b"],
    };
    expect(JSON.parse(JSON.stringify(checklistReason))).toEqual(checklistReason);

    // safety_warning
    const safetyReason: SuspensionReason<TestState> = {
      tag: "safety_warning", bound: "maxTokens", usage: 90000, limit: 100000,
    };
    expect(JSON.parse(JSON.stringify(safetyReason))).toEqual(safetyReason);

    // scheduled_halt
    const haltReason: SuspensionReason<TestState> = {
      tag: "scheduled_halt", trigger: "budget_80_percent",
    };
    expect(JSON.parse(JSON.stringify(haltReason))).toEqual(haltReason);

    // checkpoint (already tested above)
    const checkpointReason: SuspensionReason<TestState> = {
      tag: "checkpoint", stepId: "sigma_3",
    };
    expect(JSON.parse(JSON.stringify(checkpointReason))).toEqual(checkpointReason);

    // human_decision
    const humanReason: SuspensionReason<TestState> = {
      tag: "human_decision", question: "Approve merge?", options: ["approve", "reject", "defer"],
    };
    expect(JSON.parse(JSON.stringify(humanReason))).toEqual(humanReason);

    // method_boundary
    const boundaryReason: SuspensionReason<TestState> = {
      tag: "method_boundary", completedMethod: "M1-MDES", nextArm: "review",
    };
    expect(JSON.parse(JSON.stringify(boundaryReason))).toEqual(boundaryReason);

    // methodology_complete
    const completeReason: SuspensionReason<TestState> = {
      tag: "methodology_complete",
    };
    expect(JSON.parse(JSON.stringify(completeReason))).toEqual(completeReason);
  });

  it("preserves completedMethods records in accumulator", () => {
    const suspended = makeSuspended({
      accumulator: {
        loopCount: 3,
        totalTokens: 15000,
        totalCostUsd: 1.5,
        completedMethods: [
          {
            methodId: "M1-MDES",
            objectiveMet: true,
            stepOutputSummaries: { sigma_0: "oriented", sigma_6: "compiled" },
            cost: { tokens: 8000, usd: 0.8, duration_ms: 20000 },
          },
          {
            methodId: "M2-REVIEW",
            objectiveMet: false,
            stepOutputSummaries: { sigma_0: "started" },
            cost: { tokens: 7000, usd: 0.7, duration_ms: 15000 },
          },
        ],
      },
    });

    const json = JSON.stringify(suspended);
    const deserialized = JSON.parse(json);

    expect(deserialized.accumulator.completedMethods).toHaveLength(2);
    expect(deserialized.accumulator.completedMethods[0].methodId).toBe("M1-MDES");
    expect(deserialized.accumulator.completedMethods[0].objectiveMet).toBe(true);
    expect(deserialized.accumulator.completedMethods[0].cost.tokens).toBe(8000);
    expect(deserialized.accumulator.completedMethods[0].stepOutputSummaries.sigma_6).toBe("compiled");
    expect(deserialized.accumulator.completedMethods[1].methodId).toBe("M2-REVIEW");
    expect(deserialized.accumulator.completedMethods[1].objectiveMet).toBe(false);
  });

  it("Date fields serialize to ISO strings", () => {
    const suspended = makeSuspended();
    const json = JSON.stringify(suspended);
    const deserialized = JSON.parse(json);

    // JSON.stringify converts Date to ISO string
    expect(typeof deserialized.accumulator.startedAt).toBe("string");
    expect(deserialized.accumulator.startedAt).toBe("2026-03-22T00:00:00.000Z");

    // Can reconstruct Date from serialized form
    const reconstructed = new Date(deserialized.accumulator.startedAt);
    expect(reconstructed.getTime()).toBe(new Date("2026-03-22T00:00:00Z").getTime());
  });

  it("empty insightStore round-trips correctly", () => {
    const suspended = makeSuspended({ insightStore: {} });
    const json = JSON.stringify(suspended);
    const deserialized = JSON.parse(json);

    expect(deserialized.insightStore).toEqual({});
  });

  it("large insightStore round-trips correctly", () => {
    const store: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      store[`key_${i}`] = `value_${i}_${"x".repeat(100)}`;
    }

    const suspended = makeSuspended({ insightStore: store });
    const json = JSON.stringify(suspended);
    const deserialized = JSON.parse(json);

    expect(Object.keys(deserialized.insightStore)).toHaveLength(20);
    expect(deserialized.insightStore.key_0).toBe(store.key_0);
    expect(deserialized.insightStore.key_19).toBe(store.key_19);
  });
});
