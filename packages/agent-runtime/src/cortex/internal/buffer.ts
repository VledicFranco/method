// SPDX-License-Identifier: Apache-2.0
/**
 * Bounded FIFO buffer with threshold-transition callbacks — used by
 * `CortexEventConnector` to smooth transient `ctx.events` backlog
 * (429/5xx/timeout) while emitting `connector.degraded` /
 * `connector.recovered` at occupancy thresholds.
 *
 * Semantics (PRD-063 §Architecture, S6 §4.1):
 *   - push: accepts unless at capacity; at capacity, evicts oldest and
 *     returns it as `dropped`.
 *   - Thresholds are relative to capacity, not absolute — retunable by
 *     changing `bufferSize` with no test churn.
 *   - degraded fires on the first crossing of 50% and re-arms at 90%
 *     after a drop below 50%. recovered fires on the first drop below
 *     10% after any prior degraded.
 *   - Individual-event drops do NOT emit per-event events (noise
 *     amplification). Callers increment their own error counter.
 *
 * Pure in-process; no time, no I/O, no async.
 */

export type BufferThresholdEvent =
  | 'degraded-50'
  | 'degraded-90'
  | 'recovered-10';

export type BufferThresholdListener = (event: BufferThresholdEvent) => void;

export interface BoundedBuffer<T> {
  push(item: T): { readonly accepted: boolean; readonly dropped?: T };
  shift(): T | undefined;
  depth(): number;
  capacity(): number;
  onThresholdCrossed(listener: BufferThresholdListener): void;
  /** Test-only hook — drop-oldest count since construction. */
  dropCount(): number;
}

export function createBoundedBuffer<T>(capacity: number): BoundedBuffer<T> {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new Error(`createBoundedBuffer: capacity must be a positive integer (got ${capacity})`);
  }

  const items: T[] = [];
  const listeners: BufferThresholdListener[] = [];
  let drops = 0;

  // Threshold state. `degradedArmed=true` means the next ≥50% crossing
  // fires. After a 50-trigger, we set armedFor90=true to allow the 90
  // escalation. Any drop below 50% re-arms both.
  let crossed50 = false;
  let crossed90 = false;
  // `hasDegraded` tracks whether any degraded has ever fired — recovered
  // only fires after a prior degraded.
  let hasDegraded = false;

  const notify = (ev: BufferThresholdEvent): void => {
    for (const l of listeners) {
      try {
        l(ev);
      } catch {
        // Listener errors are swallowed — buffer contract must not
        // depend on listener reliability.
      }
    }
  };

  const evalThresholds = (): void => {
    const cap = capacity;
    const depth = items.length;
    const pct = depth / cap;

    // Rising edges
    if (pct >= 0.5 && !crossed50) {
      crossed50 = true;
      hasDegraded = true;
      notify('degraded-50');
    }
    if (pct >= 0.9 && !crossed90) {
      crossed90 = true;
      hasDegraded = true;
      notify('degraded-90');
    }

    // Falling edges — re-arm both
    if (pct < 0.5 && crossed50) {
      crossed50 = false;
      // 90 is nested under 50 — drop below 50 also re-arms 90.
      crossed90 = false;
    }
    if (pct < 0.9 && crossed90) {
      // Dropping only below 90 (but still ≥50) re-arms the 90 trigger
      // only — buffer still degraded.
      crossed90 = false;
    }

    // Recovery edge
    if (pct < 0.1 && hasDegraded) {
      hasDegraded = false;
      notify('recovered-10');
    }
  };

  return {
    push(item: T): { readonly accepted: boolean; readonly dropped?: T } {
      if (items.length >= capacity) {
        // Evict oldest, append new.
        const dropped = items.shift();
        items.push(item);
        drops += 1;
        evalThresholds();
        return { accepted: false, dropped };
      }
      items.push(item);
      evalThresholds();
      return { accepted: true };
    },
    shift(): T | undefined {
      const item = items.shift();
      if (item !== undefined) evalThresholds();
      return item;
    },
    depth(): number {
      return items.length;
    },
    capacity(): number {
      return capacity;
    },
    onThresholdCrossed(listener: BufferThresholdListener): void {
      listeners.push(listener);
    },
    dropCount(): number {
      return drops;
    },
  };
}
