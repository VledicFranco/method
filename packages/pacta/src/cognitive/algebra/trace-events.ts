// SPDX-License-Identifier: Apache-2.0
/**
 * Hierarchical Trace Events — Surface 1 of PRD 058.
 *
 * Streaming primitive for cognitive-cycle observability. Three granularity
 * levels nest: CYCLE > PHASE > OPERATION. Producers (cycle.ts, tracingMiddleware,
 * any module) emit TraceEvents through TraceSink.onEvent. Consumers (TraceAssembler,
 * TraceRingBuffer, SqliteTraceStore — all in cognitive/observability/) reconstruct
 * the hierarchy or persist the stream.
 *
 * Pure type module — no methods, no classes. Asserted by G-TRACE-EVENT-SHAPE.
 *
 * @see docs/prds/058-hierarchical-trace-observability.md (Surface 1)
 */

import type { MonitoringSignal } from './module.js';

// ── Event Kind Enum ─────────────────────────────────────────────

/**
 * Discriminator for trace-event granularity. Five members are intentional:
 * adding more later is additive; removing requires migration.
 */
export type TraceEventKind =
  | 'cycle-start'
  | 'cycle-end'
  | 'phase-start'
  | 'phase-end'
  | 'operation';

// ── Trace Event ─────────────────────────────────────────────────

/**
 * Single trace event emitted during a cognitive cycle.
 *
 * Hierarchy reconstruction key: events sharing a `cycleId` belong to one cycle;
 * events sharing a `phase` (within that cycle) belong to one phase. OPERATION
 * events with a `phase` set nest under that phase; without `phase` they're
 * cycle-scoped.
 */
export interface TraceEvent {
  /** Unique per emission. Producers generate (typically `crypto.randomUUID()`). */
  readonly eventId: string;

  /** Stable across one cycle; events grouped by cycleId reconstruct the cycle. */
  readonly cycleId: string;

  /** Discriminator (see {@link TraceEventKind}). */
  readonly kind: TraceEventKind;

  /**
   * Human-readable name. Conventions:
   *   - cycle-{start,end}: `"cycle-{N}"` or any descriptive label
   *   - phase-{start,end}: phase name (`"observe"`, `"reason"`, ...)
   *   - operation: operation kind (`"llm-complete"`, `"slm-inference"`, ...)
   */
  readonly name: string;

  /** Wall-clock time of emission, milliseconds since epoch. */
  readonly timestamp: number;

  /** Set on `*_END` and `OPERATION` events; `undefined` on `*_START`. */
  readonly durationMs?: number;

  /** Set when the event belongs to a phase; `undefined` for cycle-level events. */
  readonly phase?: string;

  /** Free-form payload. Producers should keep this small (<5KB). */
  readonly data?: Readonly<Record<string, unknown>>;

  /** Signals captured at emission time. Optional. */
  readonly signals?: readonly MonitoringSignal[];
}
