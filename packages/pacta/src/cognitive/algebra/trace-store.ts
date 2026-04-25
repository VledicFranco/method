// SPDX-License-Identifier: Apache-2.0
/**
 * TraceStore Port — Surface 3b of PRD 058.
 *
 * Query interface over assembled CycleTraces. Consumed by the bridge's
 * dashboard API, by retros and experiment summaries, and by the
 * self-monitor. Producers (SqliteTraceStore, in-memory test stores)
 * implement both this port and TraceSink.onEvent — they consume the
 * event stream and persist assembled cycles in one step.
 *
 * Pure port — zero implementation imports. Asserted by G-TRACE-STORE.
 *
 * @see docs/prds/058-hierarchical-trace-observability.md (Surface 3)
 */

import type { CycleTrace, TraceStats } from './trace-cycle.js';

// ── Query Options ───────────────────────────────────────────────

/**
 * Filters for {@link TraceStore.getCycles}. Time fields are ms since epoch.
 *
 * When both `since` and `before` are set, the result is the half-open
 * interval `[since, before)`. `limit` caps the number of returned cycles
 * (newest first); the implementation default is 50.
 */
export interface TraceStoreQueryOptions {
  readonly limit?: number;
  readonly since?: number;
  readonly before?: number;
}

// ── Stats Options ───────────────────────────────────────────────

/**
 * Options for {@link TraceStore.getStats}. `windowCycles` selects the
 * most recent N cycles to aggregate over (default 10).
 */
export interface TraceStoreStatsOptions {
  readonly windowCycles?: number;
}

// ── Port Interface ──────────────────────────────────────────────

/**
 * Read/write port over a backing store of CycleTraces.
 *
 * Implementations also typically implement `TraceSink.onEvent` so they
 * consume the event stream → assemble → persist in one step. That coupling
 * is convention, not part of this port — consumers depend only on the
 * methods declared below.
 */
export interface TraceStore {
  /** Persist an assembled CycleTrace. Idempotent on `cycleId`. */
  storeCycle(trace: CycleTrace): Promise<void>;

  /** Fetch one cycle by id. Returns `null` if absent. */
  getCycle(cycleId: string): Promise<CycleTrace | null>;

  /** Fetch recent cycles, newest first, with optional time-range filtering. */
  getCycles(options?: TraceStoreQueryOptions): Promise<readonly CycleTrace[]>;

  /** Aggregate stats over the most recent N cycles. */
  getStats(options?: TraceStoreStatsOptions): Promise<TraceStats>;
}
