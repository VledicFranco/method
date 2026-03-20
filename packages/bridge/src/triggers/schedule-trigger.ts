/**
 * PRD 018: Event Triggers — ScheduleTrigger (Phase 2a-2)
 *
 * Fires on a cron schedule. Uses a lightweight 5-field cron parser
 * (minute, hour, day-of-month, month, day-of-week) with no external deps.
 * All times are UTC.
 *
 * Uses the injectable TimerInterface for deterministic testing.
 */

import type {
  TriggerWatcher,
  TriggerType,
  ScheduleTriggerConfig,
  TimerInterface,
} from './types.js';
import { realTimers } from './types.js';

// ── Cron Parser ──────────────────────────────────────────────────

interface CronField {
  values: Set<number>;
}

interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

/**
 * Parse a single cron field into a set of matching values.
 * Supports: *, N, N-M, N/step, *, star/step, N-M/step, comma-separated lists.
 */
function parseCronField(field: string, min: number, max: number): CronField {
  const values = new Set<number>();

  for (const part of field.split(',')) {
    const trimmed = part.trim();

    // star/step: */5
    if (trimmed.startsWith('*/')) {
      const step = parseInt(trimmed.substring(2), 10);
      if (isNaN(step) || step <= 0) throw new Error(`Invalid cron step: ${trimmed}`);
      for (let i = min; i <= max; i += step) {
        values.add(i);
      }
      continue;
    }

    // plain star: *
    if (trimmed === '*') {
      for (let i = min; i <= max; i++) {
        values.add(i);
      }
      continue;
    }

    // range with optional step: N-M or N-M/step
    if (trimmed.includes('-')) {
      const [rangePart, stepPart] = trimmed.split('/');
      const [startStr, endStr] = rangePart.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      const step = stepPart ? parseInt(stepPart, 10) : 1;

      if (isNaN(start) || isNaN(end) || isNaN(step) || step <= 0) {
        throw new Error(`Invalid cron range: ${trimmed}`);
      }
      if (start < min || end > max || start > end) {
        throw new Error(`Cron range out of bounds: ${trimmed} (${min}-${max})`);
      }

      for (let i = start; i <= end; i += step) {
        values.add(i);
      }
      continue;
    }

    // simple number
    const num = parseInt(trimmed, 10);
    if (isNaN(num) || num < min || num > max) {
      throw new Error(`Invalid cron value: ${trimmed} (expected ${min}-${max})`);
    }
    values.add(num);
  }

  return { values };
}

/**
 * Parse a standard 5-field cron expression.
 * Format: minute hour day-of-month month day-of-week
 * All times are UTC.
 */
export function parseCron(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `Invalid cron expression: expected 5 fields, got ${fields.length}: "${expression}"`,
    );
  }

  return {
    minute: parseCronField(fields[0], 0, 59),
    hour: parseCronField(fields[1], 0, 23),
    dayOfMonth: parseCronField(fields[2], 1, 31),
    month: parseCronField(fields[3], 1, 12),
    dayOfWeek: parseCronField(fields[4], 0, 6), // 0 = Sunday
  };
}

/**
 * Check if a Date matches a parsed cron expression (UTC).
 */
export function cronMatches(cron: ParsedCron, date: Date): boolean {
  return (
    cron.minute.values.has(date.getUTCMinutes()) &&
    cron.hour.values.has(date.getUTCHours()) &&
    cron.dayOfMonth.values.has(date.getUTCDate()) &&
    cron.month.values.has(date.getUTCMonth() + 1) &&
    cron.dayOfWeek.values.has(date.getUTCDay())
  );
}

/**
 * Calculate the next fire time from a given start time.
 * Iterates minute-by-minute from the start (exclusive) until a match.
 * Returns the next matching Date, or null if not found within 366 days.
 */
export function nextCronFire(cron: ParsedCron, from: Date): Date | null {
  // Start from the next minute boundary
  const candidate = new Date(from.getTime());
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  // Safety: scan at most 366 days * 24 hours * 60 minutes
  const maxIterations = 366 * 24 * 60;

  for (let i = 0; i < maxIterations; i++) {
    if (cronMatches(cron, candidate)) {
      return candidate;
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }

  return null;
}

// ── ScheduleTrigger ──────────────────────────────────────────────

export class ScheduleTrigger implements TriggerWatcher {
  readonly type: TriggerType = 'schedule';

  private _active = false;
  private readonly config: ScheduleTriggerConfig;
  private readonly timer: TimerInterface;
  private readonly cron: ParsedCron;
  private timerId: ReturnType<typeof globalThis.setTimeout> | null = null;
  private onFire: ((payload: Record<string, unknown>) => void) | null = null;

  constructor(config: ScheduleTriggerConfig, options?: { timer?: TimerInterface }) {
    this.config = config;
    this.timer = options?.timer ?? realTimers;
    this.cron = parseCron(config.cron);
  }

  get active(): boolean {
    return this._active;
  }

  start(onFire: (payload: Record<string, unknown>) => void): void {
    if (this._active) return;
    this.onFire = onFire;
    this._active = true;
    this.scheduleNext();
  }

  stop(): void {
    this._active = false;
    if (this.timerId !== null) {
      this.timer.clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.onFire = null;
  }

  private scheduleNext(): void {
    if (!this._active) return;

    const now = new Date(this.timer.now());
    const next = nextCronFire(this.cron, now);

    if (!next) {
      // No next fire found within scan range — stop
      return;
    }

    const delayMs = next.getTime() - this.timer.now();

    // Schedule at least 1ms in the future
    const effectiveDelay = Math.max(1, delayMs);

    this.timerId = this.timer.setTimeout(() => {
      this.timerId = null;
      if (!this._active || !this.onFire) return;

      const firedAt = new Date(this.timer.now()).toISOString();

      this.onFire({
        cron_expression: this.config.cron,
        scheduled_at: next.toISOString(),
        fired_at: firedAt,
      });

      // Schedule the next occurrence
      this.scheduleNext();
    }, effectiveDelay);
  }
}
