// SPDX-License-Identifier: Apache-2.0
/**
 * Assembled Cycle Hierarchy — Surface 2 of PRD 058.
 *
 * Three nested levels reconstructed from a TraceEvent stream:
 *   CycleTrace > PhaseTrace > OperationTrace
 *
 * Plus TraceStats — aggregate over a window of recent cycles, used by the
 * self-monitor and bridge experiments dashboard.
 *
 * Produced by TraceAssembler (cognitive/observability/assembler.ts) on
 * receipt of a CYCLE_END event. Stored by SqliteTraceStore. Queried by
 * TraceStore consumers.
 *
 * Pure type module — no methods, no classes. Asserted by G-TRACE-CYCLE-SHAPE.
 *
 * @see docs/prds/058-hierarchical-trace-observability.md (Surface 2)
 */

import type { MonitoringSignal } from './module.js';
import type { TokenUsage } from '../../pact.js';

// ── Operation Trace ─────────────────────────────────────────────

/**
 * A single traced operation inside a phase.
 *
 * Examples: `"llm-complete"` (provider invocation), `"slm-inference"`
 * (SLM cascade hit), `"memory-retrieve"` (memory query).
 */
export interface OperationTrace {
  readonly operation: string;
  /** ms since epoch */
  readonly startedAt: number;
  readonly durationMs: number;
  /** Free-form metadata: `inputTokens`, `outputTokens`, `model`, `confidence`, ... */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

// ── Phase Trace ─────────────────────────────────────────────────

/**
 * A single phase within a cycle, with its operations and signals.
 *
 * `inputSummary` and `outputSummary` are short string previews bounded
 * by the producer (typically the cycle runner truncates to ~500 chars)
 * so the trace blob stays small enough for SQLite storage and WebSocket
 * fan-out. Consumers needing full inputs query through `OperationTrace.metadata`.
 */
export interface PhaseTrace {
  readonly phase: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
  readonly inputSummary: string;
  readonly outputSummary: string;
  readonly signals: readonly MonitoringSignal[];
  readonly operations: readonly OperationTrace[];
  /** Set if the phase threw or the runner recorded a control violation. */
  readonly error?: string;
}

// ── Cycle Trace ─────────────────────────────────────────────────

/**
 * Complete trace of one cognitive cycle, assembled from a TraceEvent stream.
 *
 * Workspace snapshot is opt-in (strategies / retros consume it; live UI does
 * not) — producers populate only when explicitly configured.
 */
export interface CycleTrace {
  readonly cycleId: string;
  readonly cycleNumber: number;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
  readonly inputText: string;
  readonly outputText: string;
  readonly phases: readonly PhaseTrace[];
  readonly signals: readonly MonitoringSignal[];
  readonly tokenUsage?: TokenUsage;
  readonly workspaceSnapshot?: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

// ── Aggregate Stats ─────────────────────────────────────────────

/**
 * Aggregate statistics over a window of recent cycles. Computed by
 * TraceStore.getStats(); returned to the bridge dashboard, the self-monitor,
 * or any retro consumer.
 *
 * `slmEscalationRate` is `null` when no SLM-related signals appear in the
 * window (i.e., no cascade was active).
 */
export interface TraceStats {
  readonly cycleCount: number;
  readonly avgDurationMs: number;
  readonly avgInputTokens: number;
  readonly avgOutputTokens: number;
  /** Phase name → average duration in ms across the window. */
  readonly phaseAvgDurations: ReadonlyMap<string, number>;
  /** Signal type (string discriminator) → count across the window. */
  readonly signalCounts: ReadonlyMap<string, number>;
  /** Fraction of cycles that escalated past the SLM tier. `null` if not measurable. */
  readonly slmEscalationRate: number | null;
}
