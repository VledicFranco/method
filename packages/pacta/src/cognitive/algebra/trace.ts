// SPDX-License-Identifier: Apache-2.0
/**
 * Trace — observability records for cognitive module execution.
 *
 * Every module step emits a TraceRecord. Traces are consumed through TraceSink ports,
 * enabling post-hoc inspection, debugging, and experiment analysis.
 */

import type { ModuleId, MonitoringSignal } from './module.js';
import type { TokenUsage } from '../../pact.js';
import type { TraceEvent } from './trace-events.js';

// ── Trace Record ─────────────────────────────────────────────────

/** A single trace record capturing one module step execution. */
export interface TraceRecord {
  /** Which module produced this trace. */
  moduleId: ModuleId;

  /** Cognitive cycle phase during which this step ran. */
  phase: string;

  /** When the step started. */
  timestamp: number;

  /** Hash of the input (for replay/dedup). */
  inputHash: string;

  /** Summary of the output (truncated for observability). */
  outputSummary: string;

  /** The monitoring signal emitted by this step. */
  monitoring: MonitoringSignal;

  /** Hash of the post-step state (for integrity checking). */
  stateHash: string;

  /** Wall-clock duration in milliseconds. */
  durationMs: number;

  /** Token usage for this step (if LLM invocation occurred). */
  tokenUsage?: TokenUsage;
}

// ── Trace Sink ───────────────────────────────────────────────────

/**
 * Port interface for consuming trace records and (optionally) hierarchical
 * trace events.
 *
 * `onTrace` is the legacy flat-record path (preserved for back-compat with
 * existing callers). `onEvent` is the additive hierarchical path introduced
 * in PRD 058 — sinks that handle only flat records may leave it `undefined`.
 * Producers prefer `onEvent` when both are available.
 *
 * @see docs/prds/058-hierarchical-trace-observability.md (Surface 3)
 */
export interface TraceSink {
  /** Receive a flat per-step trace record (legacy). */
  onTrace(record: TraceRecord): void;

  /**
   * Receive a hierarchical trace event (PRD 058). Optional — sinks that
   * only consume flat records leave this `undefined`. May be sync or
   * async; producers should not block the cognitive hot path on a slow sink.
   */
  onEvent?(event: TraceEvent): void | Promise<void>;
}
