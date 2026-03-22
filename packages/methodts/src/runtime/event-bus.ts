/**
 * EventBus Effect service — in-memory event bus for runtime events.
 *
 * Provides emit/subscribe/waitFor/history operations backed by Effect Refs.
 * Hooks (fire-and-forget or blocking) fire on every matching event.
 *
 * @see PRD 021 §12.5 — EventBus
 */

import { Effect, Ref, Deferred } from "effect";
import type { RuntimeEvent } from "./events.js";
import type { EventHook } from "./hooks.js";

// ── Filter ──

/** Filter to select events by type and/or predicate. */
export type EventFilter<S> = {
  readonly types?: readonly string[];
  readonly predicate?: (event: RuntimeEvent<S>) => boolean;
};

/** Matches an event against a filter. Returns true if filter is undefined or all conditions pass. */
function matchesFilter<S>(event: RuntimeEvent<S>, filter?: EventFilter<S>): boolean {
  if (!filter) return true;
  if (filter.types && !filter.types.includes(event.type)) return false;
  if (filter.predicate && !filter.predicate(event)) return false;
  return true;
}

// ── Error ──

/** EventBus-specific error. */
export type EventBusError = {
  readonly _tag: "EventBusError";
  readonly message: string;
};

// ── Subscription ──

/** A subscription that accumulates matching events. */
export type Subscription<S> = {
  /** Read all events received by this subscription so far. */
  readonly events: () => Effect.Effect<readonly RuntimeEvent<S>[]>;
  /** Unsubscribe — no more events will be delivered. */
  readonly unsubscribe: () => Effect.Effect<void>;
};

// ── Interface ──

/** EventBus service interface. */
export interface EventBus<S> {
  /** Emit an event to all subscribers and hooks. */
  readonly emit: (event: RuntimeEvent<S>) => Effect.Effect<void>;
  /** Subscribe with an optional filter. Returns a Subscription. */
  readonly subscribe: (filter?: EventFilter<S>) => Effect.Effect<Subscription<S>>;
  /** Wait for a specific event matching a predicate, with optional timeout in ms. */
  readonly waitFor: (
    predicate: (event: RuntimeEvent<S>) => boolean,
    timeoutMs?: number,
  ) => Effect.Effect<RuntimeEvent<S>, EventBusError>;
  /** Get all events emitted so far, in order. */
  readonly history: () => Effect.Effect<readonly RuntimeEvent<S>[]>;
}

// ── Internal subscriber record ──

type InternalSubscriber<S> = {
  readonly id: number;
  readonly filter?: EventFilter<S>;
  readonly events: RuntimeEvent<S>[];
  active: boolean;
};

// ── Internal waiter record ──

type InternalWaiter<S> = {
  readonly predicate: (event: RuntimeEvent<S>) => boolean;
  readonly deferred: Deferred.Deferred<RuntimeEvent<S>, EventBusError>;
  resolved: boolean;
};

// ── Factory ──

/**
 * Create an EventBus instance backed by in-memory state.
 *
 * @param hooks - Optional array of hooks to fire on every matching event.
 * @param capacity - Optional max history size (oldest events are dropped when exceeded).
 */
export function createEventBus<S>(
  hooks?: readonly EventHook<S>[],
  capacity?: number,
): Effect.Effect<EventBus<S>> {
  return Effect.gen(function* () {
    const historyRef = yield* Ref.make<RuntimeEvent<S>[]>([]);
    const cap = capacity ?? Infinity;

    // Mutable subscriber and waiter lists, managed via Effect.sync for safety.
    const subscribers: InternalSubscriber<S>[] = [];
    const waiters: InternalWaiter<S>[] = [];
    let nextSubId = 0;

    const bus: EventBus<S> = {
      // ── emit ──
      emit: (event) =>
        Effect.gen(function* () {
          // 1. Append to history (with capacity trim)
          yield* Ref.update(historyRef, (h) => {
            const next = [...h, event];
            return next.length > cap ? next.slice(next.length - cap) : next;
          });

          // 2. Deliver to active subscribers
          for (const sub of subscribers) {
            if (sub.active && matchesFilter(event, sub.filter)) {
              sub.events.push(event);
            }
          }

          // 3. Resolve waiters
          for (const w of waiters) {
            if (!w.resolved && w.predicate(event)) {
              w.resolved = true;
              yield* Deferred.succeed(w.deferred, event);
            }
          }
          // Clean up resolved waiters
          for (let i = waiters.length - 1; i >= 0; i--) {
            if (waiters[i].resolved) waiters.splice(i, 1);
          }

          // 4. Fire hooks
          if (hooks) {
            for (const hook of hooks) {
              if (matchesFilter(event, hook.filter)) {
                if (hook.mode === "fire_and_forget") {
                  yield* Effect.fork(hook.handler(event));
                } else {
                  // blocking — wait for handler to complete
                  yield* hook.handler(event);
                }
              }
            }
          }
        }),

      // ── subscribe ──
      subscribe: (filter) =>
        Effect.sync(() => {
          const id = nextSubId++;
          const sub: InternalSubscriber<S> = { id, filter, events: [], active: true };
          subscribers.push(sub);

          return {
            events: () => Effect.sync(() => [...sub.events] as readonly RuntimeEvent<S>[]),
            unsubscribe: () =>
              Effect.sync(() => {
                sub.active = false;
                const idx = subscribers.indexOf(sub);
                if (idx >= 0) subscribers.splice(idx, 1);
              }),
          } satisfies Subscription<S>;
        }),

      // ── waitFor ──
      waitFor: (predicate, timeoutMs) =>
        Effect.gen(function* () {
          // Check history first — if it already happened, return immediately
          const hist = yield* Ref.get(historyRef);
          const existing = hist.find(predicate);
          if (existing) return existing;

          // Register a waiter with a Deferred
          const deferred = yield* Deferred.make<RuntimeEvent<S>, EventBusError>();
          const waiter: InternalWaiter<S> = { predicate, deferred, resolved: false };
          waiters.push(waiter);

          const awaitDeferred = Deferred.await(deferred);

          if (timeoutMs !== undefined) {
            // Race between deferred resolution and timeout
            const result = yield* awaitDeferred.pipe(
              Effect.timeoutFail({
                duration: timeoutMs,
                onTimeout: () =>
                  ({ _tag: "EventBusError", message: `Timeout after ${timeoutMs}ms` }) as EventBusError,
              }),
            );
            return result;
          }

          return yield* awaitDeferred;
        }),

      // ── history ──
      history: () => Ref.get(historyRef),
    };

    return bus;
  });
}
