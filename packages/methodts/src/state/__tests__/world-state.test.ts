// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for WorldState, Snapshot, StateTrace, Witness type construction
 * and the diff() function.
 *
 * @see F1-FTH Def 1.2/1.3 — WorldState, Snapshot, StateTrace
 */
import { describe, it, expect } from "vitest";

import { diff } from "../../state/world-state.js";
import type {
  WorldState,
  Snapshot,
  StateTrace,
  Witness,
  Diff,
} from "../../state/world-state.js";
import type { Predicate } from "../../predicate/predicate.js";
import type { EvalTrace } from "../../predicate/evaluate.js";

// ── diff() ──────────────────────────────────────────────────────────────────

describe("diff()", () => {
  it("returns empty diff for identical objects", () => {
    const state = { a: 1, b: "hello", c: true };
    const result = diff(state, state);

    expect(Object.keys(result.added)).toHaveLength(0);
    expect(Object.keys(result.removed)).toHaveLength(0);
    expect(Object.keys(result.changed)).toHaveLength(0);
  });

  it("detects added fields", () => {
    const before = { a: 1 };
    const after = { a: 1, b: 2 };
    const result = diff(before, after);

    expect(result.added).toEqual({ b: 2 });
    expect(Object.keys(result.removed)).toHaveLength(0);
    expect(Object.keys(result.changed)).toHaveLength(0);
  });

  it("detects removed fields", () => {
    const before = { a: 1, b: 2 };
    const after = { a: 1 };
    const result = diff(before, after);

    expect(Object.keys(result.added)).toHaveLength(0);
    expect(result.removed).toEqual({ b: 2 });
    expect(Object.keys(result.changed)).toHaveLength(0);
  });

  it("detects changed fields with before/after", () => {
    const before = { a: 1, b: "old" };
    const after = { a: 1, b: "new" };
    const result = diff(before, after);

    expect(Object.keys(result.added)).toHaveLength(0);
    expect(Object.keys(result.removed)).toHaveLength(0);
    expect(result.changed).toEqual({
      b: { before: "old", after: "new" },
    });
  });

  it("detects nested object changes via JSON stringify", () => {
    const before = { config: { debug: false, level: 1 } };
    const after = { config: { debug: true, level: 1 } };
    const result = diff(before, after);

    expect(result.changed).toEqual({
      config: {
        before: { debug: false, level: 1 },
        after: { debug: true, level: 1 },
      },
    });
  });

  it("handles multiple changes in one diff", () => {
    const before: Record<string, number> = { a: 1, b: 2, c: 3 };
    const after: Record<string, number> = { b: 20, c: 3, d: 4 };
    const result = diff(before, after);

    expect(result.removed).toEqual({ a: 1 });
    expect(result.added).toEqual({ d: 4 });
    expect(result.changed).toEqual({
      b: { before: 2, after: 20 },
    });
  });
});

// ── Type construction tests ─────────────────────────────────────────────────

describe("WorldState construction", () => {
  /** @see F1-FTH Def 1.2 — A in Mod(D) with axiom validation */
  it("constructs a valid WorldState with value and axiomStatus", () => {
    const ws: WorldState<{ count: number }> = {
      value: { count: 42 },
      axiomStatus: { valid: true, violations: [] },
    };

    expect(ws.value).toEqual({ count: 42 });
    expect(ws.axiomStatus.valid).toBe(true);
    expect(ws.axiomStatus.violations).toEqual([]);
  });

  it("represents axiom violations", () => {
    const ws: WorldState<{ count: number }> = {
      value: { count: -1 },
      axiomStatus: { valid: false, violations: ["count must be non-negative"] },
    };

    expect(ws.axiomStatus.valid).toBe(false);
    expect(ws.axiomStatus.violations).toContain("count must be non-negative");
  });
});

describe("Snapshot construction", () => {
  /** @see F1-FTH Def 1.3 — Frozen state with execution metadata */
  it("constructs a valid Snapshot with all fields", () => {
    const now = new Date();
    const ws: WorldState<{ status: string }> = {
      value: { status: "active" },
      axiomStatus: { valid: true, violations: [] },
    };

    const snap: Snapshot<{ status: string }> = {
      state: ws,
      sequence: 0,
      timestamp: now,
      delta: null,
      witnesses: [],
      metadata: {
        producedBy: "test-agent",
        stepId: "S1",
        methodId: "M1",
      },
    };

    expect(snap.state).toBe(ws);
    expect(snap.sequence).toBe(0);
    expect(snap.timestamp).toBe(now);
    expect(snap.delta).toBeNull();
    expect(snap.witnesses).toEqual([]);
    expect(snap.metadata.producedBy).toBe("test-agent");
    expect(snap.metadata.stepId).toBe("S1");
    expect(snap.metadata.methodId).toBe("M1");
  });

  it("constructs a Snapshot with a delta", () => {
    const now = new Date();
    const ws: WorldState<{ count: number }> = {
      value: { count: 2 },
      axiomStatus: { valid: true, violations: [] },
    };
    const delta: Diff<{ count: number }> = {
      added: {},
      removed: {},
      changed: { count: { before: 1, after: 2 } },
    };

    const snap: Snapshot<{ count: number }> = {
      state: ws,
      sequence: 1,
      timestamp: now,
      delta,
      witnesses: [],
      metadata: {},
    };

    expect(snap.delta).toBe(delta);
    expect(snap.delta!.changed).toHaveProperty("count");
  });
});

describe("StateTrace construction", () => {
  /** @see F1-FTH — Ordered sequence of snapshots forming execution trace */
  it("constructs a valid StateTrace with snapshots, initial, and current", () => {
    const initial: WorldState<{ phase: string }> = {
      value: { phase: "init" },
      axiomStatus: { valid: true, violations: [] },
    };
    const current: WorldState<{ phase: string }> = {
      value: { phase: "running" },
      axiomStatus: { valid: true, violations: [] },
    };
    const now = new Date();

    const snap0: Snapshot<{ phase: string }> = {
      state: initial,
      sequence: 0,
      timestamp: now,
      delta: null,
      witnesses: [],
      metadata: {},
    };
    const snap1: Snapshot<{ phase: string }> = {
      state: current,
      sequence: 1,
      timestamp: now,
      delta: { added: {}, removed: {}, changed: { phase: { before: "init", after: "running" } } },
      witnesses: [],
      metadata: { stepId: "S1" },
    };

    const trace: StateTrace<{ phase: string }> = {
      snapshots: [snap0, snap1],
      initial,
      current,
    };

    expect(trace.snapshots).toHaveLength(2);
    expect(trace.initial.value.phase).toBe("init");
    expect(trace.current.value.phase).toBe("running");
    expect(trace.snapshots[0].sequence).toBe(0);
    expect(trace.snapshots[1].sequence).toBe(1);
  });
});

describe("Witness construction", () => {
  /** @see F1-FTH — Evidence that a predicate held at evaluation time */
  it("constructs a valid Witness with predicate, evaluatedAt, and trace", () => {
    const pred: Predicate<number> = {
      tag: "check",
      label: "isPositive",
      check: (n: number) => n > 0,
    };
    const evalTrace: EvalTrace = {
      label: "isPositive",
      result: true,
      children: [],
    };
    const now = new Date();

    const witness: Witness<number> = {
      predicate: pred,
      evaluatedAt: now,
      trace: evalTrace,
    };

    expect(witness.predicate.tag).toBe("check");
    expect(witness.evaluatedAt).toBe(now);
    expect(witness.trace.result).toBe(true);
    expect(witness.trace.label).toBe("isPositive");
    expect(witness.trace.children).toEqual([]);
  });

  it("supports compound predicate witnesses with nested traces", () => {
    const left: Predicate<number> = {
      tag: "check",
      label: "isPositive",
      check: (n: number) => n > 0,
    };
    const right: Predicate<number> = {
      tag: "check",
      label: "isEven",
      check: (n: number) => n % 2 === 0,
    };
    const andPred: Predicate<number> = {
      tag: "and",
      left,
      right,
    };
    const evalTrace: EvalTrace = {
      label: "AND",
      result: true,
      children: [
        { label: "isPositive", result: true, children: [] },
        { label: "isEven", result: true, children: [] },
      ],
    };
    const now = new Date();

    const witness: Witness<number> = {
      predicate: andPred,
      evaluatedAt: now,
      trace: evalTrace,
    };

    expect(witness.predicate.tag).toBe("and");
    expect(witness.trace.children).toHaveLength(2);
    expect(witness.trace.children[0].label).toBe("isPositive");
    expect(witness.trace.children[1].label).toBe("isEven");
  });
});
