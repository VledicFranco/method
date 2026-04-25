// SPDX-License-Identifier: Apache-2.0
/**
 * SqliteTraceStore — better-sqlite3-backed TraceStore + TraceSink.
 *
 * Implements both `TraceSink.onEvent` (consumes events, assembles via an
 * internal TraceAssembler, persists assembled CycleTraces) and `TraceStore`
 * (read API for the bridge dashboard, retros, self-monitor).
 *
 * Schema: a single `cycle_traces` table with denormalized columns
 * (cycle_id, cycle_number, started_at, ended_at, duration_ms, input_text,
 * output_text) plus a JSON blob holding the full CycleTrace. Time-range
 * queries hit the indexed columns; full-cycle reads parse the JSON.
 *
 * Retention: cleanup runs on `initialize()`. Cycles older than
 * `retentionDays` (default 7) are deleted in one statement.
 *
 * @see docs/prds/058-hierarchical-trace-observability.md (Wave 2, C-4)
 */

import Database from 'better-sqlite3';
import type { Database as SqliteDb, Statement } from 'better-sqlite3';

import {
  TraceAssembler,
  type TraceEvent,
  type CycleTrace,
  type PhaseTrace,
  type OperationTrace,
  type TraceStats,
  type TraceSink,
  type TraceRecord,
  type TraceStore,
  type TraceStoreQueryOptions,
  type TraceStoreStatsOptions,
  type MonitoringSignal,
} from '@methodts/pacta';

const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_STATS_WINDOW = 10;
const ESCALATION_SIGNAL_TYPES = new Set([
  'confidence-low',
  'impasse',
  'anomaly-detected',
]);

export interface SqliteTraceStoreOptions {
  /** Path to the SQLite database file. Use `':memory:'` for tests. */
  readonly dbPath: string;
  /** Days to retain. Cycles older than this are deleted on initialize(). Default 7. */
  readonly retentionDays?: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cycle_traces (
  cycle_id TEXT PRIMARY KEY,
  cycle_number INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  duration_ms REAL NOT NULL,
  input_text TEXT NOT NULL,
  output_text TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cycle_traces_started_at
  ON cycle_traces(started_at);
`;

export class SqliteTraceStore implements TraceSink, TraceStore {
  private readonly options: SqliteTraceStoreOptions;
  private readonly assembler = new TraceAssembler();
  private db: SqliteDb | null = null;
  private insertStmt: Statement | null = null;
  private selectOneStmt: Statement | null = null;

  constructor(options: SqliteTraceStoreOptions) {
    this.options = options;
  }

  /** Create tables, run retention cleanup. Idempotent. */
  async initialize(): Promise<void> {
    if (this.db) return;
    const db = new Database(this.options.dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(SCHEMA);

    const retentionDays = this.options.retentionDays ?? DEFAULT_RETENTION_DAYS;
    if (retentionDays > 0) {
      const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      db.prepare('DELETE FROM cycle_traces WHERE started_at < ?').run(cutoff);
    }

    this.db = db;
    this.insertStmt = db.prepare(`
      INSERT OR REPLACE INTO cycle_traces
        (cycle_id, cycle_number, started_at, ended_at, duration_ms, input_text, output_text, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.selectOneStmt = db.prepare('SELECT data FROM cycle_traces WHERE cycle_id = ?');
  }

  /** Close the database. Subsequent calls to read/write methods will throw. */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.insertStmt = null;
      this.selectOneStmt = null;
    }
  }

  /** Legacy flat-trace path — accepted but not stored. */
  onTrace(_record: TraceRecord): void {
    // Intentional no-op. SQLite store specializes in CycleTraces.
  }

  /**
   * Receive a TraceEvent. When a `cycle-end` event triggers the assembler,
   * the resulting CycleTrace is persisted.
   *
   * Async because consumers may await before next emission, but the actual
   * SQLite write is sync — better-sqlite3 has no async API.
   */
  async onEvent(event: TraceEvent): Promise<void> {
    const trace = this.assembler.feed(event);
    if (trace) {
      await this.storeCycle(trace);
    }
  }

  async storeCycle(trace: CycleTrace): Promise<void> {
    this.requireInit();
    const data = JSON.stringify(serializeCycle(trace));
    this.insertStmt!.run(
      trace.cycleId,
      trace.cycleNumber,
      trace.startedAt,
      trace.endedAt,
      trace.durationMs,
      trace.inputText,
      trace.outputText,
      data,
    );
  }

  async getCycle(cycleId: string): Promise<CycleTrace | null> {
    this.requireInit();
    const row = this.selectOneStmt!.get(cycleId) as { data: string } | undefined;
    if (!row) return null;
    return deserializeCycle(JSON.parse(row.data));
  }

  async getCycles(options?: TraceStoreQueryOptions): Promise<readonly CycleTrace[]> {
    this.requireInit();
    const limit = options?.limit ?? 50;
    const wheres: string[] = [];
    const params: (number | string)[] = [];
    if (options?.since !== undefined) {
      wheres.push('started_at >= ?');
      params.push(options.since);
    }
    if (options?.before !== undefined) {
      wheres.push('started_at < ?');
      params.push(options.before);
    }
    const where = wheres.length > 0 ? `WHERE ${wheres.join(' AND ')}` : '';
    const sql = `SELECT data FROM cycle_traces ${where} ORDER BY started_at DESC LIMIT ?`;
    params.push(limit);
    const rows = this.db!.prepare(sql).all(...params) as { data: string }[];
    return rows.map((r) => deserializeCycle(JSON.parse(r.data)));
  }

  async getStats(options?: TraceStoreStatsOptions): Promise<TraceStats> {
    this.requireInit();
    const window = options?.windowCycles ?? DEFAULT_STATS_WINDOW;
    const rows = this.db!
      .prepare('SELECT data FROM cycle_traces ORDER BY started_at DESC LIMIT ?')
      .all(window) as { data: string }[];
    const traces = rows.map((r) => deserializeCycle(JSON.parse(r.data)));
    return computeStats(traces);
  }

  private requireInit(): void {
    if (!this.db) {
      throw new Error('SqliteTraceStore: call initialize() before use');
    }
  }
}

// ── Serialization helpers ───────────────────────────────────────

function serializeCycle(trace: CycleTrace): unknown {
  return {
    cycleId: trace.cycleId,
    cycleNumber: trace.cycleNumber,
    startedAt: trace.startedAt,
    endedAt: trace.endedAt,
    durationMs: trace.durationMs,
    inputText: trace.inputText,
    outputText: trace.outputText,
    phases: trace.phases.map(serializePhase),
    signals: trace.signals,
    tokenUsage: trace.tokenUsage,
    workspaceSnapshot: trace.workspaceSnapshot,
  };
}

function serializePhase(phase: PhaseTrace): unknown {
  return {
    phase: phase.phase,
    startedAt: phase.startedAt,
    endedAt: phase.endedAt,
    durationMs: phase.durationMs,
    inputSummary: phase.inputSummary,
    outputSummary: phase.outputSummary,
    operations: phase.operations,
    signals: phase.signals,
    error: phase.error,
  };
}

function deserializeCycle(d: any): CycleTrace {
  return {
    cycleId: d.cycleId,
    cycleNumber: d.cycleNumber ?? 0,
    startedAt: d.startedAt,
    endedAt: d.endedAt,
    durationMs: d.durationMs ?? 0,
    inputText: d.inputText ?? '',
    outputText: d.outputText ?? '',
    phases: (d.phases ?? []).map(deserializePhase),
    signals: d.signals ?? [],
    tokenUsage: d.tokenUsage ?? undefined,
    workspaceSnapshot: d.workspaceSnapshot ?? undefined,
  };
}

function deserializePhase(d: any): PhaseTrace {
  return {
    phase: d.phase,
    startedAt: d.startedAt,
    endedAt: d.endedAt,
    durationMs: d.durationMs ?? 0,
    inputSummary: d.inputSummary ?? '',
    outputSummary: d.outputSummary ?? '',
    operations: (d.operations ?? []).map(
      (op: any): OperationTrace => ({
        operation: op.operation,
        startedAt: op.startedAt,
        durationMs: op.durationMs ?? 0,
        metadata: op.metadata,
      }),
    ),
    signals: d.signals ?? [],
    error: d.error,
  };
}

// ── Stats aggregation ───────────────────────────────────────────

function computeStats(traces: readonly CycleTrace[]): TraceStats {
  const n = traces.length;
  if (n === 0) {
    return {
      cycleCount: 0,
      avgDurationMs: 0,
      avgInputTokens: 0,
      avgOutputTokens: 0,
      phaseAvgDurations: new Map(),
      signalCounts: new Map(),
      slmEscalationRate: null,
    };
  }

  let totalDuration = 0;
  let totalInput = 0;
  let totalOutput = 0;
  const phaseDurations = new Map<string, number[]>();
  const signalCounts = new Map<string, number>();
  let escalationCount = 0;

  for (const trace of traces) {
    totalDuration += trace.durationMs;
    totalInput += trace.tokenUsage?.inputTokens ?? 0;
    totalOutput += trace.tokenUsage?.outputTokens ?? 0;

    for (const phase of trace.phases) {
      const arr = phaseDurations.get(phase.phase) ?? [];
      arr.push(phase.durationMs);
      phaseDurations.set(phase.phase, arr);
    }

    let cycleEscalated = false;
    for (const sig of trace.signals) {
      const sigType = signalTypeOf(sig);
      signalCounts.set(sigType, (signalCounts.get(sigType) ?? 0) + 1);
      if (ESCALATION_SIGNAL_TYPES.has(sigType)) cycleEscalated = true;
    }
    if (cycleEscalated) escalationCount++;
  }

  const phaseAvgDurations = new Map<string, number>();
  for (const [name, durs] of phaseDurations) {
    phaseAvgDurations.set(name, durs.reduce((a, b) => a + b, 0) / durs.length);
  }

  return {
    cycleCount: n,
    avgDurationMs: totalDuration / n,
    avgInputTokens: totalInput / n,
    avgOutputTokens: totalOutput / n,
    phaseAvgDurations,
    signalCounts,
    slmEscalationRate: n > 0 ? escalationCount / n : null,
  };
}

function signalTypeOf(sig: MonitoringSignal): string {
  // MonitoringSignal carries a discriminator on `type` for some variants;
  // for others the type is implicit. Read defensively.
  const t = (sig as unknown as { type?: unknown }).type;
  return typeof t === 'string' ? t : 'unknown';
}
