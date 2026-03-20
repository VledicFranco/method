/**
 * PRD 018: Event Triggers — Debounce Engine (Phase 2a-1)
 *
 * Collapses rapid trigger events into batched fires using injectable
 * timer interface for deterministic testing.
 *
 * Strategies:
 *   - trailing (default for file_watch): wait for quiet period, then fire
 *   - leading (default for git_commit): fire immediately, suppress for window
 */

import type {
  DebounceConfig,
  DebouncedEvent,
  DebouncedTriggerFire,
  TimerInterface,
} from './types.js';
import { realTimers } from './types.js';

export class DebounceEngine {
  private readonly config: DebounceConfig;
  private readonly timer: TimerInterface;
  private readonly onFire: (batch: DebouncedTriggerFire) => void;

  private pendingEvents: DebouncedEvent[] = [];
  private timerId: ReturnType<typeof globalThis.setTimeout> | null = null;
  private leadingSuppressed = false;
  private leadingWindowStart = 0;
  private firing = false; // re-entrancy guard: onFire must not synchronously re-enter push()

  constructor(
    config: DebounceConfig,
    onFire: (batch: DebouncedTriggerFire) => void,
    timer: TimerInterface = realTimers,
  ) {
    this.config = config;
    this.onFire = onFire;
    this.timer = timer;
  }

  /**
   * Push a raw event into the debounce engine.
   * Depending on strategy, may fire immediately (leading) or schedule a fire (trailing).
   */
  push(payload: Record<string, unknown>): void {
    const event: DebouncedEvent = {
      timestamp: new Date(this.timer.now()).toISOString(),
      payload,
    };

    if (this.config.strategy === 'leading') {
      this.pushLeading(event);
    } else {
      this.pushTrailing(event);
    }
  }

  /**
   * Cancel any pending debounce timer and clear accumulated events.
   */
  cancel(): void {
    if (this.timerId !== null) {
      this.timer.clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.pendingEvents = [];
    this.leadingSuppressed = false;
    this.leadingWindowStart = 0;
  }

  /** Number of events currently buffered (pending fire) */
  get pendingCount(): number {
    return this.pendingEvents.length;
  }

  // ── Leading strategy ────────────────────────────────────────────

  private pushLeading(event: DebouncedEvent): void {
    if (!this.leadingSuppressed) {
      // Fire immediately on the first event
      this.leadingSuppressed = true;
      this.leadingWindowStart = this.timer.now();

      // Fire with just this one event
      this.fireBatch([event]);

      // Set timer to re-open the window after debounce_ms
      this.timerId = this.timer.setTimeout(() => {
        this.timerId = null;
        this.leadingSuppressed = false;

        // If events accumulated during suppression, fire them
        if (this.pendingEvents.length > 0) {
          const batch = [...this.pendingEvents];
          this.pendingEvents = [];
          this.fireBatch(batch);

          // Re-enter suppression for the new batch
          this.leadingSuppressed = true;
          this.leadingWindowStart = this.timer.now();
          this.timerId = this.timer.setTimeout(() => {
            this.timerId = null;
            this.leadingSuppressed = false;
          }, this.config.window_ms);
        }
      }, this.config.window_ms);
    } else {
      // Suppressed — accumulate events
      this.pendingEvents.push(event);

      // max_batch_size forces a fire even during suppression
      if (this.pendingEvents.length >= this.config.max_batch_size) {
        const batch = [...this.pendingEvents];
        this.pendingEvents = [];

        // Reset suppression window
        if (this.timerId !== null) {
          this.timer.clearTimeout(this.timerId);
        }

        this.fireBatch(batch);

        this.leadingWindowStart = this.timer.now();
        this.timerId = this.timer.setTimeout(() => {
          this.timerId = null;
          this.leadingSuppressed = false;
        }, this.config.window_ms);
      }
    }
  }

  // ── Trailing strategy ───────────────────────────────────────────

  private pushTrailing(event: DebouncedEvent): void {
    this.pendingEvents.push(event);

    // Reset the timer on each new event (wait for quiet period)
    if (this.timerId !== null) {
      this.timer.clearTimeout(this.timerId);
    }

    // max_batch_size forces a fire if too many events accumulate
    if (this.pendingEvents.length >= this.config.max_batch_size) {
      const batch = [...this.pendingEvents];
      this.pendingEvents = [];
      this.fireBatch(batch);
      return;
    }

    this.timerId = this.timer.setTimeout(() => {
      this.timerId = null;
      if (this.pendingEvents.length > 0) {
        const batch = [...this.pendingEvents];
        this.pendingEvents = [];
        this.fireBatch(batch);
      }
    }, this.config.window_ms);
  }

  // ── Fire ────────────────────────────────────────────────────────

  /**
   * Fire a batch of events. Protected by a re-entrancy guard:
   * if onFire synchronously calls push(), the nested fireBatch is skipped.
   */
  private fireBatch(events: DebouncedEvent[]): void {
    if (events.length === 0) return;
    if (this.firing) return; // re-entrancy guard

    const fire: DebouncedTriggerFire = {
      events,
      first_event_at: events[0].timestamp,
      last_event_at: events[events.length - 1].timestamp,
      count: events.length,
    };

    this.firing = true;
    try {
      this.onFire(fire);
    } finally {
      this.firing = false;
    }
  }
}
