// SPDX-License-Identifier: Apache-2.0
/**
 * SqliteTraceStore — better-sqlite3-backed TraceStore + TraceSink.
 *
 * Wave 0 skeleton — implementation lands in Wave 2 (commission C-4).
 * See `docs/prds/058-hierarchical-trace-observability.md` (Surface 3 +
 * Wave 2 plan).
 */

import type { TraceEvent } from '../algebra/trace-events.js';
import type { CycleTrace, TraceStats } from '../algebra/trace-cycle.js';
import type { TraceSink, TraceRecord } from '../algebra/trace.js';
import type {
  TraceStore,
  TraceStoreQueryOptions,
  TraceStoreStatsOptions,
} from '../algebra/trace-store.js';

export interface SqliteTraceStoreOptions {
  /** Path to the SQLite database file. */
  readonly dbPath: string;
  /** Days to retain. Cycles older than this are deleted on initialize(). Default 7. */
  readonly retentionDays?: number;
}

/**
 * Persistent TraceStore over SQLite. Consumes TraceEvents (assembling
 * internally) and exposes the `TraceStore` query API.
 */
export class SqliteTraceStore implements TraceSink, TraceStore {
  constructor(_options: SqliteTraceStoreOptions) {
    // implementation in Wave 2
  }

  /** Create tables, run retention cleanup. */
  async initialize(): Promise<void> {
    throw new Error('SqliteTraceStore: not implemented (PRD-058 Wave 2, commission C-4)');
  }

  onTrace(_record: TraceRecord): void {
    throw new Error('SqliteTraceStore: not implemented (PRD-058 Wave 2, commission C-4)');
  }

  async onEvent(_event: TraceEvent): Promise<void> {
    throw new Error('SqliteTraceStore: not implemented (PRD-058 Wave 2, commission C-4)');
  }

  async storeCycle(_trace: CycleTrace): Promise<void> {
    throw new Error('SqliteTraceStore: not implemented (PRD-058 Wave 2, commission C-4)');
  }

  async getCycle(_cycleId: string): Promise<CycleTrace | null> {
    throw new Error('SqliteTraceStore: not implemented (PRD-058 Wave 2, commission C-4)');
  }

  async getCycles(_options?: TraceStoreQueryOptions): Promise<readonly CycleTrace[]> {
    throw new Error('SqliteTraceStore: not implemented (PRD-058 Wave 2, commission C-4)');
  }

  async getStats(_options?: TraceStoreStatsOptions): Promise<TraceStats> {
    throw new Error('SqliteTraceStore: not implemented (PRD-058 Wave 2, commission C-4)');
  }
}
