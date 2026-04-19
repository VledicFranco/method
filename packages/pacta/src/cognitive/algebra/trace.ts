// SPDX-License-Identifier: Apache-2.0
/**
 * Trace — observability records for cognitive module execution.
 *
 * Every module step emits a TraceRecord. Traces are consumed through TraceSink ports,
 * enabling post-hoc inspection, debugging, and experiment analysis.
 */

import type { ModuleId, MonitoringSignal } from './module.js';
import type { TokenUsage } from '../../pact.js';

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

/** Port interface for consuming trace records. */
export interface TraceSink {
  onTrace(record: TraceRecord): void;
}
