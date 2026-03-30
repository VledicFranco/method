/**
 * Experiments domain — JSONL event persistence (PRD 041 Phase 2).
 *
 * Per-run JSONL event log with filtering support for trace reads.
 * Uses the file-system port (DR-15).
 *
 * Persistence invariants:
 * - Each BridgeEvent is appended as one JSON line to events.jsonl
 * - The file is append-only during a run lifecycle
 * - readEvents() always returns events in the order they were written
 * - readTraces() is a projection of readEvents() filtered to cognitive events
 *
 * EventSink contract:
 * - Subscribes to BridgeEvents with domain='cognitive'
 * - Extracts experimentId and runId from event.payload
 * - Appends the full BridgeEvent to the corresponding run's events.jsonl
 * - Events without valid experimentId + runId are silently dropped
 */

import { join } from 'node:path';
import type { FileSystemProvider } from '../../ports/file-system.js';
import type { BridgeEvent, EventSink } from '../../ports/event-bus.js';
import type { TraceRecord, TraceFilter } from './types.js';

// ── Port injection ──────────────────────────────────────────────

let _fs: FileSystemProvider | null = null;

/** Configure file-system port for persistence. Called from composition root. */
export function setPersistencePorts(fs: FileSystemProvider): void {
  _fs = fs;
}

function getFs(): FileSystemProvider {
  if (!_fs) throw new Error('Experiments persistence: file-system port not configured. Call setPersistencePorts().');
  return _fs;
}

// ── Data directory resolution ───────────────────────────────────

let _dataDir = 'data/experiments';

/** Override the data directory (for tests or alternate instances). */
export function setPersistenceDataDir(dir: string): void {
  _dataDir = dir;
}

function eventsFilePath(experimentId: string, runId: string): string {
  return join(_dataDir, experimentId, 'runs', runId, 'events.jsonl');
}

function runDirectory(experimentId: string, runId: string): string {
  return join(_dataDir, experimentId, 'runs', runId);
}

// ── Core persistence operations ─────────────────────────────────

/**
 * Append a BridgeEvent as a JSON line to the run's events.jsonl.
 *
 * Creates the directory and file if they don't exist.
 * The line is terminated with a newline character.
 */
export async function appendEvent(
  experimentId: string,
  runId: string,
  event: BridgeEvent,
): Promise<void> {
  const fs = getFs();

  const dir = runDirectory(experimentId, runId);
  await fs.mkdir(dir, { recursive: true });

  const line = JSON.stringify(event) + '\n';
  await fs.appendFile(eventsFilePath(experimentId, runId), line, 'utf-8');
}

/**
 * Read and parse all events from a run's events.jsonl.
 *
 * Returns events in the order they were written. Lines that fail to parse
 * are silently skipped (defensive — corrupt lines should not break reads).
 */
export async function readEvents(
  experimentId: string,
  runId: string,
): Promise<BridgeEvent[]> {
  const fs = getFs();

  const filePath = eventsFilePath(experimentId, runId);

  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch {
    // File doesn't exist yet — return empty array
    return [];
  }

  const events: BridgeEvent[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as BridgeEvent);
    } catch {
      // Skip malformed lines
    }
  }

  return events;
}

/**
 * Read trace records for a run, with optional filtering.
 *
 * Filters events to those with domain='cognitive', then maps each
 * BridgeEvent to a TraceRecord. Optional filters narrow by cycleNumber,
 * moduleId, or phase.
 */
export async function readTraces(
  experimentId: string,
  runId: string,
  filter?: TraceFilter,
): Promise<TraceRecord[]> {
  const events = await readEvents(experimentId, runId);

  return events
    .filter((event) => event.domain === 'cognitive')
    .map((event): TraceRecord => ({
      id: event.id,
      timestamp: event.timestamp,
      type: event.type,
      experimentId: String(event.payload.experimentId ?? ''),
      runId: String(event.payload.runId ?? ''),
      cycleNumber:
        typeof event.payload.cycleNumber === 'number'
          ? event.payload.cycleNumber
          : undefined,
      moduleId:
        typeof event.payload.moduleId === 'string'
          ? event.payload.moduleId
          : undefined,
      phase:
        typeof event.payload.phase === 'string'
          ? event.payload.phase
          : undefined,
      payload: event.payload,
    }))
    .filter((trace) => {
      if (!filter) return true;
      if (filter.cycleNumber !== undefined && trace.cycleNumber !== filter.cycleNumber) {
        return false;
      }
      if (filter.moduleId !== undefined && trace.moduleId !== filter.moduleId) {
        return false;
      }
      if (filter.phase !== undefined && trace.phase !== filter.phase) {
        return false;
      }
      return true;
    });
}

// ── EventSink factory ───────────────────────────────────────────

/**
 * Create an EventSink that persists cognitive domain events to run JSONL files.
 *
 * The sink subscribes to all events. It filters to `domain === 'cognitive'`
 * events, extracts experimentId and runId from the event payload, and appends
 * the event to the corresponding run file.
 *
 * Events without a valid experimentId + runId in the payload are silently dropped
 * (they are not experiment-scoped events).
 *
 * Registration happens in the composition root (server-entry.ts). The domain
 * exports this factory — it does not register the sink itself.
 */
export function createExperimentEventSink(): EventSink {
  return {
    name: 'experiment-persistence',

    async onEvent(event: BridgeEvent): Promise<void> {
      // Only persist cognitive domain events
      if (event.domain !== 'cognitive') return;

      // Extract experiment and run context from payload
      const experimentId = event.payload.experimentId;
      const runId = event.payload.runId;

      if (typeof experimentId !== 'string' || !experimentId) return;
      if (typeof runId !== 'string' || !runId) return;

      try {
        await appendEvent(experimentId, runId, event);
      } catch {
        // Non-fatal — persistence failures must not interrupt the event bus
      }
    },

    onError(error: Error, event: BridgeEvent): void {
      // Log but don't throw — sink errors are always non-fatal
      console.error(
        `[experiment-persistence] Sink error for event ${event.id} (${event.type}): ${error.message}`,
      );
    },
  };
}
