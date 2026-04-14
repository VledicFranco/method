/**
 * PersistenceSink — PRD 026 Phase 3.
 *
 * Writes every RuntimeEvent to a JSONL file via the FileSystemProvider port.
 * Uses write-ahead batching: events accumulate in memory and flush every
 * 1 second or 100 events (whichever comes first). On flush failure, emits
 * system.sink_overflow via a callback — never crashes.
 *
 * Also handles event replay on startup: reads the JSONL file, filters by
 * a configurable replay window, and returns events for import into the bus.
 *
 * Cursor recovery: persists last-processed sequence per sink in a JSON file.
 * On restart, sinks resume from their last cursor.
 */

import type { RuntimeEvent, EventSink } from '../ports/event-bus.js';
import type { EventReader } from '../ports/event-reader.js';
import type { FileSystemProvider } from '../ports/file-system.js';

// ── Configuration ───────────────────────────────────────────────

export interface PersistenceSinkOptions {
  fs: FileSystemProvider;
  logPath?: string;              // default: .method/events.jsonl
  cursorsPath?: string;          // default: .method/events-cursors.json
  replayWindowHours?: number;    // default: 24, env: EVENT_REPLAY_WINDOW_HOURS
  flushIntervalMs?: number;      // default: 1000
  flushBatchSize?: number;       // default: 100
}

const DEFAULT_LOG_PATH = '.method/events.jsonl';
const DEFAULT_CURSORS_PATH = '.method/events-cursors.json';
const DEFAULT_REPLAY_WINDOW_HOURS = 24;
const DEFAULT_FLUSH_INTERVAL_MS = 1000;
const DEFAULT_FLUSH_BATCH_SIZE = 100;

// ── PersistenceSink ─────────────────────────────────────────────

export class PersistenceSink implements EventSink, EventReader {
  readonly name = 'persistence';

  private readonly fs: FileSystemProvider;
  private readonly logPath: string;
  private readonly cursorsPath: string;
  private readonly replayWindowHours: number;
  private readonly flushIntervalMs: number;
  private readonly flushBatchSize: number;

  private buffer: RuntimeEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private lastSequence = 0;
  private overflowCallback: ((msg: string) => void) | null = null;

  constructor(options: PersistenceSinkOptions) {
    this.fs = options.fs;
    this.logPath = options.logPath ?? DEFAULT_LOG_PATH;
    this.cursorsPath = options.cursorsPath ?? DEFAULT_CURSORS_PATH;
    this.replayWindowHours = options.replayWindowHours ?? DEFAULT_REPLAY_WINDOW_HOURS;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.flushBatchSize = options.flushBatchSize ?? DEFAULT_FLUSH_BATCH_SIZE;
  }

  /**
   * Set a callback to notify when flush fails (e.g., emit system.sink_overflow).
   * Called from composition root after bus is created.
   */
  setOverflowCallback(cb: (msg: string) => void): void {
    this.overflowCallback = cb;
  }

  /**
   * Initialize from persisted cursor state. Call before registering as a sink.
   */
  async init(): Promise<void> {
    const cursors = await this.loadCursors();
    this.lastSequence = cursors[this.name] ?? 0;
  }

  // ── EventSink interface ──────────────────────────────────────

  onEvent(event: RuntimeEvent): void {
    // Skip events already persisted (cursor recovery on replay)
    if (event.sequence <= this.lastSequence) return;

    this.buffer.push(event);
    this.lastSequence = event.sequence;

    // Flush immediately if batch size reached
    if (this.buffer.length >= this.flushBatchSize) {
      this.flush().catch(() => { /* handled in flush */ });
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush().catch(() => { /* handled in flush */ });
      }, this.flushIntervalMs);
    }
  }

  onError(error: Error, event: RuntimeEvent): void {
    console.error(`[persistence-sink] Error processing event ${event.id}:`, error.message);
  }

  // ── Flush ────────────────────────────────────────────────────

  async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;

    this.flushing = true;

    // Swap buffer so new events accumulate in a fresh array during write
    const batch = this.buffer;
    this.buffer = [];

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    try {
      const lines = batch.map(e => JSON.stringify(e)).join('\n') + '\n';
      await this.fs.appendFile(this.logPath, lines, 'utf-8');
      await this.saveCursor();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[persistence-sink] Flush failed: ${msg}`);

      if (this.overflowCallback) {
        try { this.overflowCallback(msg); } catch { /* double fault */ }
      }

      // Put events back for retry on next flush
      this.buffer = [...batch, ...this.buffer];
    } finally {
      this.flushing = false;
    }
  }

  // ── Replay ───────────────────────────────────────────────────

  /**
   * Read and parse all events from the JSONL log file.
   * Skips corrupt lines gracefully. Returns empty array if the log is missing.
   * Shared by replay() (time-window filter) and readEventsSince() (cursor filter).
   */
  private async readAllEvents(): Promise<RuntimeEvent[]> {
    let content: string;
    try {
      content = await this.fs.readFile(this.logPath, 'utf-8');
    } catch {
      console.warn(`[persistence-sink] No event log at ${this.logPath}, starting fresh`);
      return [];
    }

    const events: RuntimeEvent[] = [];

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed) as RuntimeEvent;
        events.push(event);
      } catch {
        console.warn('[persistence-sink] Skipping corrupt JSONL line');
      }
    }

    return events;
  }

  /**
   * Read events from JSONL file for replay into the bus.
   * Filters by replay window. Skips corrupt lines gracefully.
   */
  async replay(): Promise<RuntimeEvent[]> {
    const all = await this.readAllEvents();
    const windowMs = this.replayWindowHours * 60 * 60 * 1000;
    const cutoff = Date.now() - windowMs;
    return all.filter(e => new Date(e.timestamp).getTime() >= cutoff);
  }

  // ── EventReader interface ────────────────────────────────────

  /**
   * Read events from the persistent log where sequence > sinceSeq.
   * Returns events in append order. Corrupt JSONL lines are skipped gracefully.
   */
  async readEventsSince(sinceSeq: number): Promise<RuntimeEvent[]> {
    const all = await this.readAllEvents();
    return all.filter(e => e.sequence > sinceSeq);
  }

  // ── Cursor management ────────────────────────────────────────

  async loadCursors(): Promise<Record<string, number>> {
    try {
      const content = await this.fs.readFile(this.cursorsPath, 'utf-8');
      return JSON.parse(content) as Record<string, number>;
    } catch {
      return {};
    }
  }

  async saveCursors(cursors: Record<string, number>): Promise<void> {
    await this.fs.writeFile(this.cursorsPath, JSON.stringify(cursors, null, 2), 'utf-8');
  }

  private async saveCursor(): Promise<void> {
    try {
      const cursors = await this.loadCursors();
      cursors[this.name] = this.lastSequence;
      await this.saveCursors(cursors);
    } catch (err) {
      console.error('[persistence-sink] Failed to save cursor:', err);
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────

  /** Flush remaining buffer and clean up timers. */
  async dispose(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }
}
