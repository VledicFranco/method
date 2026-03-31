/**
 * Observer DSL Codec — encode ObserverSignalInput[] to compact training format,
 * decode DSL output back to ObserverReport.
 *
 * The SLM was trained on this specific format (see phase-2-dsl corpus).
 *
 * Input format:
 *   OBS-SIGNALS:
 *   [observer:main] novelty=0.06 processed=False content=text
 *   [observer:ctx] novelty=0.74 processed=True content=tool-result
 *
 * Output DSL format:
 *   PRIORITY: high
 *   FOCUS: reasoner, planner, reflector
 *   NOVELTY: 0.97
 *   NOTE: "Unprocessed input with high novelty"
 */

import type {
  ObserverSignalInput,
  ObserverReport,
  ObserverPriority,
} from './observer-types.js';

// ── Valid values (mirrors shared/metrics/accuracy.py) ────────

const VALID_PRIORITIES = new Set<string>(['high', 'medium', 'low']);

// ── Encode: ObserverSignalInput[] → compact training format ──

export function encodeObserverSignals(signals: ObserverSignalInput[]): string {
  if (signals.length === 0) {
    return 'OBS-SIGNALS:\n(none)';
  }

  const parts: string[] = ['OBS-SIGNALS:'];

  for (const s of signals) {
    const noveltyStr = s.novelty.toFixed(2);
    const processedStr = s.processed ? 'True' : 'False';
    parts.push(
      `[observer:${s.id}] novelty=${noveltyStr} processed=${processedStr} content=${s.content}`,
    );
  }

  return parts.join('\n');
}

// ── Decode: DSL text → ObserverReport ────────────────────────

export function parseObserverDsl(dsl: string): ObserverReport | null {
  try {
    return parseObserverStrict(dsl);
  } catch {
    return null;
  }
}

function parseObserverStrict(dsl: string): ObserverReport {
  const lines = dsl.trim().split('\n');
  let priority: ObserverPriority | undefined;
  let focus: string[] | undefined;
  let novelty: number | undefined;
  let note: string | null | undefined;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('PRIORITY: ')) {
      const val = line.slice('PRIORITY: '.length).trim();
      if (!VALID_PRIORITIES.has(val)) {
        throw new Error(`Invalid PRIORITY: ${val}`);
      }
      priority = val as ObserverPriority;
    } else if (line.startsWith('FOCUS: ')) {
      const rest = line.slice('FOCUS: '.length).trim();
      if (rest === 'none') {
        focus = [];
      } else {
        focus = rest.split(',').map((m) => m.trim()).filter(Boolean).sort();
      }
    } else if (line.startsWith('NOVELTY: ')) {
      const val = parseFloat(line.slice('NOVELTY: '.length).trim());
      if (isNaN(val)) {
        throw new Error(`Invalid NOVELTY: ${line}`);
      }
      novelty = val;
    } else if (line.startsWith('NOTE: ')) {
      const rest = line.slice('NOTE: '.length).trim();
      if (rest === 'none') {
        note = null;
      } else if (rest.startsWith('"') && rest.endsWith('"')) {
        note = rest.slice(1, -1);
      } else if (rest.length > 0) {
        // Tolerate unquoted notes (same leniency as Python parser)
        note = rest;
      } else {
        note = null;
      }
    } else {
      throw new Error(`Unexpected line: ${line}`);
    }
  }

  // Validate required fields
  if (priority === undefined) throw new Error('Missing required field: PRIORITY');
  if (focus === undefined) throw new Error('Missing required field: FOCUS');
  if (novelty === undefined) throw new Error('Missing required field: NOVELTY');

  // NOTE is optional — default to null if missing
  if (note === undefined) note = null;

  return { priority, focus, novelty, note };
}
