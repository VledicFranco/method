// SPDX-License-Identifier: Apache-2.0
/**
 * Additional EventBus tests targeting coverage gaps:
 * - Waiter cleanup after resolution (lines 128-130)
 * - waitFor without timeout (lines 189-192)
 */

import { describe, it, expect } from "vitest";
import { Effect, Fiber } from "effect";
import { createEventBus } from "../event-bus.js";
import type { RuntimeEvent } from "../events.js";

type TestState = { count: number };

function makeEvent(
  type: RuntimeEvent<TestState>["type"],
  overrides?: Partial<RuntimeEvent<TestState>>,
): RuntimeEvent<TestState> {
  const base = { timestamp: new Date("2026-01-01T00:00:00Z") };
  switch (type) {
    case "methodology_completed":
      return { ...base, type: "methodology_completed", status: "completed", ...overrides } as RuntimeEvent<TestState>;
    case "step_started":
      return { ...base, type: "step_started", stepId: "s1", executionTag: "script" as const, ...overrides } as RuntimeEvent<TestState>;
    case "custom":
      return { ...base, type: "custom", name: "test", payload: {}, ...overrides } as RuntimeEvent<TestState>;
    default:
      return { ...base, type, ...overrides } as RuntimeEvent<TestState>;
  }
}

describe("EventBus — waitFor without timeout", () => {
  it("resolves when matching event is emitted (no timeout)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* createEventBus<TestState>();

        // Fork a waitFor with NO timeout
        const fiber = yield* Effect.fork(
          bus.waitFor((e) => e.type === "methodology_completed"),
        );

        // Emit the matching event
        yield* bus.emit(makeEvent("methodology_completed"));

        // Join should resolve immediately
        const event = yield* Fiber.join(fiber);
        expect(event.type).toBe("methodology_completed");
      }),
    );
  });
});

describe("EventBus — waiter cleanup after resolution", () => {
  it("resolved waiters are cleaned up from internal list", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* createEventBus<TestState>();

        // Set up two waiters, both waiting for different event types
        const fiber1 = yield* Effect.fork(
          bus.waitFor((e) => e.type === "methodology_completed"),
        );
        const fiber2 = yield* Effect.fork(
          bus.waitFor((e) => e.type === "custom"),
        );

        // Emit the first matching event — resolves fiber1
        yield* bus.emit(makeEvent("methodology_completed"));
        const event1 = yield* Fiber.join(fiber1);
        expect(event1.type).toBe("methodology_completed");

        // Emit the second matching event — resolves fiber2
        yield* bus.emit(makeEvent("custom"));
        const event2 = yield* Fiber.join(fiber2);
        expect(event2.type).toBe("custom");

        // Verify history has both events
        const hist = yield* bus.history();
        expect(hist).toHaveLength(2);
      }),
    );
  });

  it("multiple waiters resolved by same event are all cleaned up", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* createEventBus<TestState>();

        // Two waiters waiting for the same event type
        const fiber1 = yield* Effect.fork(
          bus.waitFor((e) => e.type === "methodology_completed"),
        );
        const fiber2 = yield* Effect.fork(
          bus.waitFor((e) => e.type === "methodology_completed"),
        );

        // Emit one event — should resolve both
        yield* bus.emit(makeEvent("methodology_completed"));

        const event1 = yield* Fiber.join(fiber1);
        const event2 = yield* Fiber.join(fiber2);

        expect(event1.type).toBe("methodology_completed");
        expect(event2.type).toBe("methodology_completed");
      }),
    );
  });
});
