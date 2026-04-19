// SPDX-License-Identifier: Apache-2.0
/**
 * Event hook types and built-in hooks.
 *
 * Hooks react to matching events on the EventBus. Two modes:
 * - "fire_and_forget": handler is forked — emit does not wait for it.
 * - "blocking": handler runs inline — emit waits for it to complete.
 *
 * @see PRD 021 §12.5 — EventHook
 */

import { Effect } from "effect";
import type { RuntimeEvent } from "./events.js";
import type { EventFilter } from "./event-bus.js";

/** An event hook — reacts to matching events. */
export type EventHook<S> = {
  readonly id: string;
  readonly description: string;
  readonly filter?: EventFilter<S>;
  readonly handler: (event: RuntimeEvent<S>) => Effect.Effect<void, never, never>;
  readonly mode: "fire_and_forget" | "blocking";
};

/** Built-in hook: log events to console. */
export function logToConsole<S>(filter?: EventFilter<S>): EventHook<S> {
  return {
    id: "log-console",
    description: "Log events to console",
    filter,
    handler: (event) =>
      Effect.sync(() => {
        console.log(`[EventBus] ${event.type}`, event);
      }),
    mode: "fire_and_forget",
  };
}
