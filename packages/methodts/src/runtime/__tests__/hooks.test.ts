// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for hooks.ts — logToConsole handler execution.
 *
 * Covers the logToConsole handler body (console.log call),
 * which was uncovered in prior coverage runs.
 */

import { describe, it, expect, vi } from "vitest";
import { Effect } from "effect";
import { logToConsole } from "../hooks.js";
import type { RuntimeEvent } from "../events.js";

type TestState = { count: number };

describe("logToConsole handler", () => {
  it("calls console.log with the event", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const hook = logToConsole<TestState>();
      const event: RuntimeEvent<TestState> = {
        type: "methodology_started",
        methodologyId: "P2-SD",
        initialState: { value: { count: 0 }, axiomStatus: { valid: true, violations: [] } },
        timestamp: new Date("2026-01-01T00:00:00Z"),
      };

      await Effect.runPromise(hook.handler(event));

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        "[EventBus] methodology_started",
        event,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("logs different event types correctly", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const hook = logToConsole<TestState>();
      const event: RuntimeEvent<TestState> = {
        type: "step_completed",
        stepId: "step-1",
        cost: { tokens: 100, usd: 0.01, duration_ms: 500 },
        timestamp: new Date("2026-01-01T00:00:00Z"),
      };

      await Effect.runPromise(hook.handler(event));

      expect(spy).toHaveBeenCalledWith("[EventBus] step_completed", event);
    } finally {
      spy.mockRestore();
    }
  });
});
