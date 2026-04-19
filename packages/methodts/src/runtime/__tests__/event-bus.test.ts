// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for EventBus service: emit, subscribe, waitFor, history, hooks.
 *
 * Uses Effect.runPromise to execute test effects.
 */

import { describe, it, expect, vi } from "vitest";
import { Effect, Deferred, Fiber } from "effect";
import { createEventBus, type EventFilter } from "../event-bus.js";
import type { EventHook } from "../hooks.js";
import { logToConsole } from "../hooks.js";
import type { RuntimeEvent } from "../events.js";

// ── Test helpers ──

type TestState = { count: number; done: boolean };

function makeEvent(
  type: RuntimeEvent<TestState>["type"],
  overrides?: Partial<RuntimeEvent<TestState>>,
): RuntimeEvent<TestState> {
  const base = { timestamp: new Date("2026-01-01T00:00:00Z") };
  switch (type) {
    case "methodology_started":
      return {
        ...base,
        type: "methodology_started",
        methodologyId: "PHI-SD",
        initialState: { value: { count: 0, done: false }, axiomStatus: { valid: true, violations: [] } },
        ...overrides,
      } as RuntimeEvent<TestState>;
    case "methodology_completed":
      return { ...base, type: "methodology_completed", status: "completed", ...overrides } as RuntimeEvent<TestState>;
    case "step_started":
      return {
        ...base,
        type: "step_started",
        stepId: "step-1",
        executionTag: "agent" as const,
        ...overrides,
      } as RuntimeEvent<TestState>;
    case "step_completed":
      return {
        ...base,
        type: "step_completed",
        stepId: "step-1",
        cost: { tokens: 1000, usd: 0.03, duration_ms: 5000 },
        ...overrides,
      } as RuntimeEvent<TestState>;
    case "safety_warning":
      return {
        ...base,
        type: "safety_warning",
        bound: "maxTokens",
        usage: 90000,
        limit: 100000,
        ...overrides,
      } as RuntimeEvent<TestState>;
    case "custom":
      return {
        ...base,
        type: "custom",
        name: "test-event",
        payload: { detail: "test" },
        ...overrides,
      } as RuntimeEvent<TestState>;
    default:
      return { ...base, type, ...overrides } as RuntimeEvent<TestState>;
  }
}

// ── emit + subscribe ──

describe("EventBus", () => {
  describe("emit + subscribe", () => {
    it("subscriber receives matching events", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* createEventBus<TestState>();
          const sub = yield* bus.subscribe();

          const event = makeEvent("methodology_started");
          yield* bus.emit(event);

          const received = yield* sub.events();
          expect(received).toHaveLength(1);
          expect(received[0].type).toBe("methodology_started");
        }),
      );
    });

    it("subscriber receives multiple events in order", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* createEventBus<TestState>();
          const sub = yield* bus.subscribe();

          yield* bus.emit(makeEvent("methodology_started"));
          yield* bus.emit(makeEvent("step_started"));
          yield* bus.emit(makeEvent("step_completed"));

          const received = yield* sub.events();
          expect(received).toHaveLength(3);
          expect(received[0].type).toBe("methodology_started");
          expect(received[1].type).toBe("step_started");
          expect(received[2].type).toBe("step_completed");
        }),
      );
    });
  });

  // ── EventFilter by type ──

  describe("EventFilter by type", () => {
    it("only matching types are received", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* createEventBus<TestState>();
          const sub = yield* bus.subscribe({ types: ["step_started", "step_completed"] });

          yield* bus.emit(makeEvent("methodology_started"));
          yield* bus.emit(makeEvent("step_started"));
          yield* bus.emit(makeEvent("step_completed"));
          yield* bus.emit(makeEvent("methodology_completed"));

          const received = yield* sub.events();
          expect(received).toHaveLength(2);
          expect(received[0].type).toBe("step_started");
          expect(received[1].type).toBe("step_completed");
        }),
      );
    });
  });

  // ── EventFilter by predicate ──

  describe("EventFilter by predicate", () => {
    it("filters by custom predicate", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* createEventBus<TestState>();
          const sub = yield* bus.subscribe({
            predicate: (e) => e.type === "safety_warning",
          });

          yield* bus.emit(makeEvent("methodology_started"));
          yield* bus.emit(makeEvent("safety_warning"));
          yield* bus.emit(makeEvent("step_started"));

          const received = yield* sub.events();
          expect(received).toHaveLength(1);
          expect(received[0].type).toBe("safety_warning");
        }),
      );
    });

    it("combines type and predicate filters", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* createEventBus<TestState>();
          const sub = yield* bus.subscribe({
            types: ["step_completed"],
            predicate: (e) => e.type === "step_completed" && e.cost.tokens > 500,
          });

          yield* bus.emit(
            makeEvent("step_completed", {
              stepId: "low",
              cost: { tokens: 100, usd: 0.01, duration_ms: 1000 },
            } as Partial<RuntimeEvent<TestState>>),
          );
          yield* bus.emit(
            makeEvent("step_completed", {
              stepId: "high",
              cost: { tokens: 5000, usd: 0.15, duration_ms: 30000 },
            } as Partial<RuntimeEvent<TestState>>),
          );

          const received = yield* sub.events();
          expect(received).toHaveLength(1);
          if (received[0].type === "step_completed") {
            expect(received[0].cost.tokens).toBe(5000);
          }
        }),
      );
    });
  });

  // ── Multiple subscribers ──

  describe("multiple subscribers", () => {
    it("each subscriber gets their own copies", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* createEventBus<TestState>();
          const sub1 = yield* bus.subscribe();
          const sub2 = yield* bus.subscribe({ types: ["step_started"] });

          yield* bus.emit(makeEvent("methodology_started"));
          yield* bus.emit(makeEvent("step_started"));

          const events1 = yield* sub1.events();
          const events2 = yield* sub2.events();

          expect(events1).toHaveLength(2);
          expect(events2).toHaveLength(1);
          expect(events2[0].type).toBe("step_started");
        }),
      );
    });
  });

  // ── Unsubscribe ──

  describe("subscribe + unsubscribe", () => {
    it("no more events after unsubscribe", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* createEventBus<TestState>();
          const sub = yield* bus.subscribe();

          yield* bus.emit(makeEvent("methodology_started"));
          yield* sub.unsubscribe();
          yield* bus.emit(makeEvent("step_started"));

          const received = yield* sub.events();
          expect(received).toHaveLength(1);
          expect(received[0].type).toBe("methodology_started");
        }),
      );
    });
  });

  // ── History ──

  describe("history", () => {
    it("returns all emitted events in order", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* createEventBus<TestState>();

          yield* bus.emit(makeEvent("methodology_started"));
          yield* bus.emit(makeEvent("step_started"));
          yield* bus.emit(makeEvent("step_completed"));

          const hist = yield* bus.history();
          expect(hist).toHaveLength(3);
          expect(hist[0].type).toBe("methodology_started");
          expect(hist[1].type).toBe("step_started");
          expect(hist[2].type).toBe("step_completed");
        }),
      );
    });

    it("respects capacity limit", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* createEventBus<TestState>(undefined, 2);

          yield* bus.emit(makeEvent("methodology_started"));
          yield* bus.emit(makeEvent("step_started"));
          yield* bus.emit(makeEvent("step_completed"));

          const hist = yield* bus.history();
          expect(hist).toHaveLength(2);
          // Oldest event should have been dropped
          expect(hist[0].type).toBe("step_started");
          expect(hist[1].type).toBe("step_completed");
        }),
      );
    });
  });

  // ── waitFor ──

  describe("waitFor", () => {
    it("resolves with event already in history", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* createEventBus<TestState>();

          yield* bus.emit(makeEvent("methodology_completed"));

          const event = yield* bus.waitFor((e) => e.type === "methodology_completed");
          expect(event.type).toBe("methodology_completed");
        }),
      );
    });

    it("resolves when matching event is emitted after waitFor is called", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* createEventBus<TestState>();

          // Start waiting in a fiber
          const fiber = yield* Effect.fork(
            bus.waitFor((e) => e.type === "methodology_completed"),
          );

          // Emit the event
          yield* bus.emit(makeEvent("methodology_completed"));

          // Join the fiber — should resolve
          const event = yield* Fiber.join(fiber);
          expect(event.type).toBe("methodology_completed");
        }),
      );
    });

    it("times out when no matching event arrives", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* createEventBus<TestState>();

          const outcome = yield* bus
            .waitFor((e) => e.type === "methodology_completed", 50)
            .pipe(
              Effect.map(() => "resolved" as const),
              Effect.catchAll((err) => Effect.succeed(err)),
            );

          return outcome;
        }),
      );

      expect(result).toEqual({ _tag: "EventBusError", message: "Timeout after 50ms" });
    });

    it("does not resolve for non-matching events", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* createEventBus<TestState>();

          // Start waiting for a specific event
          const fiber = yield* Effect.fork(
            bus.waitFor((e) => e.type === "methodology_completed", 100).pipe(
              Effect.map(() => "resolved" as const),
              Effect.catchAll((err) => Effect.succeed(err)),
            ),
          );

          // Emit a different event
          yield* bus.emit(makeEvent("step_started"));

          const result = yield* Fiber.join(fiber);
          // Should time out since the matching event was never emitted
          expect(result).toEqual({ _tag: "EventBusError", message: "Timeout after 100ms" });
        }),
      );
    });
  });

  // ── Hooks: fire_and_forget ──

  describe("hooks", () => {
    it("fire_and_forget hook handler is called on matching event", async () => {
      const handlerCalls: RuntimeEvent<TestState>[] = [];

      const hook: EventHook<TestState> = {
        id: "test-hook",
        description: "Test hook",
        filter: { types: ["step_started"] },
        handler: (event) =>
          Effect.sync(() => {
            handlerCalls.push(event);
          }),
        mode: "fire_and_forget",
      };

      await Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* createEventBus<TestState>([hook]);

          yield* bus.emit(makeEvent("methodology_started"));
          yield* bus.emit(makeEvent("step_started"));

          // Allow forked fibers to complete
          yield* Effect.yieldNow();
        }),
      );

      expect(handlerCalls).toHaveLength(1);
      expect(handlerCalls[0].type).toBe("step_started");
    });

    it("fire_and_forget hook does not block emit", async () => {
      let hookCompleted = false;

      const hook: EventHook<TestState> = {
        id: "slow-hook",
        description: "Slow hook",
        handler: (event) =>
          Effect.gen(function* () {
            yield* Effect.sleep("10 millis");
            hookCompleted = true;
          }),
        mode: "fire_and_forget",
      };

      await Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* createEventBus<TestState>([hook]);
          yield* bus.emit(makeEvent("step_started"));

          // After emit returns, the forked hook may not have completed yet
          // (it's fire-and-forget). But after yielding and a brief wait, it should.
          yield* Effect.sleep("50 millis");
        }),
      );

      expect(hookCompleted).toBe(true);
    });

    // ── Hooks: blocking ──

    it("blocking hook handler runs before emit returns", async () => {
      const order: string[] = [];

      const hook: EventHook<TestState> = {
        id: "blocking-hook",
        description: "Blocking hook",
        filter: { types: ["step_started"] },
        handler: (_event) =>
          Effect.sync(() => {
            order.push("hook");
          }),
        mode: "blocking",
      };

      await Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* createEventBus<TestState>([hook]);

          yield* bus.emit(makeEvent("step_started"));
          order.push("after-emit");
        }),
      );

      expect(order).toEqual(["hook", "after-emit"]);
    });

    it("blocking hook handler is not called for non-matching events", async () => {
      const handlerCalls: string[] = [];

      const hook: EventHook<TestState> = {
        id: "filtered-hook",
        description: "Filtered hook",
        filter: { types: ["methodology_completed"] },
        handler: (event) =>
          Effect.sync(() => {
            handlerCalls.push(event.type);
          }),
        mode: "blocking",
      };

      await Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* createEventBus<TestState>([hook]);

          yield* bus.emit(makeEvent("step_started"));
          yield* bus.emit(makeEvent("methodology_started"));
        }),
      );

      expect(handlerCalls).toHaveLength(0);
    });
  });

  // ── EventHook construction ──

  describe("EventHook construction", () => {
    it("logToConsole creates a valid hook", () => {
      const hook = logToConsole<TestState>();

      expect(hook.id).toBe("log-console");
      expect(hook.description).toBe("Log events to console");
      expect(hook.mode).toBe("fire_and_forget");
      expect(hook.filter).toBeUndefined();
    });

    it("logToConsole accepts a filter", () => {
      const filter: EventFilter<TestState> = { types: ["step_started"] };
      const hook = logToConsole<TestState>(filter);

      expect(hook.filter).toBe(filter);
      expect(hook.filter?.types).toEqual(["step_started"]);
    });
  });
});
