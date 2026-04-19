// SPDX-License-Identifier: Apache-2.0
/**
 * RecordingObservabilitySink — ObservabilityPort test double.
 *
 * Captures every emitted event into `events[]` for assertion. Pairs with the
 * existing Recording* testkit doubles (RecordingContextQueryPort, etc.).
 *
 * Also exposes convenience helpers for filtering by scope/event/severity
 * so tests don't have to re-implement filtering each time.
 */

import type { ObservabilityPort, ObservabilityEvent } from '../ports/observability.js';

export class RecordingObservabilitySink implements ObservabilityPort {
  readonly events: ObservabilityEvent[] = [];

  emit(event: ObservabilityEvent): void {
    this.events.push(event);
  }

  /** Return events matching the given scope (and optional event name). */
  find(scope: string, event?: string): ObservabilityEvent[] {
    return this.events.filter(
      (e) => e.scope === scope && (event === undefined || e.event === event),
    );
  }

  /** Assertion helper — throws if no event matches. */
  assertEmitted(scope: string, event: string): ObservabilityEvent {
    const matches = this.find(scope, event);
    if (matches.length === 0) {
      const available = this.events.map((e) => `${e.scope}.${e.event}`).join(', ') || '(none)';
      throw new Error(
        `Expected event '${scope}.${event}' to have been emitted. Recorded: ${available}`,
      );
    }
    return matches[0];
  }

  /** Reset recorded events — useful between test cases. */
  clear(): void {
    this.events.length = 0;
  }
}
