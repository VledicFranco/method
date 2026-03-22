/**
 * Measure<S> and ProgressOrder<S> tests.
 *
 * F1-FTH Definition 5.2 (ProgressOrder) and 5.3 (Measure).
 * mu : Mod(D) -> R
 */

import { describe, it, expect } from "vitest";
import type { Measure, ProgressOrder } from "../measure.js";

type TestState = { readonly score: number; readonly completed: number; readonly total: number };

describe("Measure — construction and compute (F1-FTH Def 5.3)", () => {
  it("constructs a measure with compute, range, and terminal", () => {
    const measure: Measure<TestState> = {
      id: "m-score",
      name: "Score",
      compute: (s) => s.score,
      range: [0, 100],
      terminal: 100,
    };

    expect(measure.id).toBe("m-score");
    expect(measure.name).toBe("Score");
    expect(measure.range).toEqual([0, 100]);
    expect(measure.terminal).toBe(100);
  });

  it("compute returns correct values for different states", () => {
    const measure: Measure<TestState> = {
      id: "m-completion",
      name: "Completion Rate",
      compute: (s) => (s.total === 0 ? 0 : (s.completed / s.total) * 100),
      range: [0, 100],
      terminal: 100,
    };

    expect(measure.compute({ score: 0, completed: 0, total: 10 })).toBe(0);
    expect(measure.compute({ score: 0, completed: 5, total: 10 })).toBe(50);
    expect(measure.compute({ score: 0, completed: 10, total: 10 })).toBe(100);
    expect(measure.compute({ score: 0, completed: 0, total: 0 })).toBe(0);
  });

  it("constructs a measure with an optional ProgressOrder", () => {
    const measure: Measure<TestState> = {
      id: "m-progress",
      name: "Task Progress",
      compute: (s) => s.completed,
      range: [0, 50],
      terminal: 50,
      order: {
        compare: (a, b) => a.completed - b.completed,
      },
    };

    expect(measure.id).toBe("m-progress");
    expect(measure.order).toBeDefined();
    expect(measure.order!.compare(
      { score: 0, completed: 3, total: 10 },
      { score: 0, completed: 7, total: 10 },
    )).toBeLessThan(0);
  });

  it("measure without order has undefined order field", () => {
    const measure: Measure<TestState> = {
      id: "m-basic",
      name: "Basic",
      compute: (s) => s.score,
      range: [0, 10],
      terminal: 10,
    };

    expect(measure.order).toBeUndefined();
  });
});

describe("ProgressOrder — compare function (F1-FTH Def 5.2)", () => {
  it("compare returns negative when a is closer to objective", () => {
    const order: ProgressOrder<TestState> = {
      compare: (a, b) => a.completed - b.completed,
    };

    const closer: TestState = { score: 0, completed: 8, total: 10 };
    const farther: TestState = { score: 0, completed: 3, total: 10 };

    // Higher completed = more progress, so compare(farther, closer) < 0
    // means farther is "less" than closer in the ordering
    expect(order.compare(farther, closer)).toBeLessThan(0);
    expect(order.compare(closer, farther)).toBeGreaterThan(0);
  });

  it("compare returns 0 for equivalent states", () => {
    const order: ProgressOrder<TestState> = {
      compare: (a, b) => a.completed - b.completed,
    };

    const stateA: TestState = { score: 50, completed: 5, total: 10 };
    const stateB: TestState = { score: 99, completed: 5, total: 10 };

    // Same completed count => equal in this ordering (score irrelevant)
    expect(order.compare(stateA, stateB)).toBe(0);
  });

  it("compare defines a total preorder (transitivity)", () => {
    const order: ProgressOrder<TestState> = {
      compare: (a, b) => a.completed - b.completed,
    };

    const low: TestState = { score: 0, completed: 1, total: 10 };
    const mid: TestState = { score: 0, completed: 5, total: 10 };
    const high: TestState = { score: 0, completed: 9, total: 10 };

    // Transitivity: low <= mid and mid <= high => low <= high
    expect(order.compare(low, mid)).toBeLessThan(0);
    expect(order.compare(mid, high)).toBeLessThan(0);
    expect(order.compare(low, high)).toBeLessThan(0);
  });
});
