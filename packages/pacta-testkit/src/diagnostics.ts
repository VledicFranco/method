// SPDX-License-Identifier: Apache-2.0
/**
 * Diagnostic helpers for cognitive-module testing — PRD 059.
 *
 * Pure read-only inspection utilities. Each function returns a string or
 * a structured value; none mutate state, none perform I/O. Suitable for
 * test-failure debug dumps and for ad-hoc inspection during development.
 *
 * @see docs/prds/059-pacta-testkit-diagnostics.md
 */

import type {
  CognitiveModule,
  MonitoringSignal,
  WorkspaceManager,
  ReadonlyWorkspaceSnapshot,
  WorkspaceEntry,
} from '@methodts/pacta';

// ── describeModule ───────────────────────────────────────────────

/**
 * One-line summary of a module's identity and state shape.
 *
 * Example: `Module(id='observer', class=Observer, state=ObserverState)`.
 */
export function describeModule(
  module: CognitiveModule<any, any, any, any, any>,
): string {
  const className = (module as object).constructor?.name ?? 'unknown';
  let stateName = 'unknown';
  try {
    const state = module.initialState();
    stateName = state === null
      ? 'null'
      : typeof state === 'object' && state !== null
        ? state.constructor?.name ?? 'object'
        : typeof state;
  } catch (e) {
    stateName = `<unavailable: ${(e as Error).message}>`;
  }
  return `Module(id='${String(module.id)}', class=${className}, state=${stateName})`;
}

// ── describeSignals ──────────────────────────────────────────────

/**
 * Formatted multi-line list of monitoring signals.
 *
 * Returns "(no signals)" when the list is empty.
 */
export function describeSignals(signals: readonly MonitoringSignal[]): string {
  if (signals.length === 0) return '(no signals)';
  const lines: string[] = [`${signals.length} signal(s):`];
  for (let i = 0; i < signals.length; i++) {
    const s = signals[i]!;
    const type = signalDiscriminator(s);
    const source = String(s.source ?? 'unknown');
    const sev = severityFor(s);
    lines.push(`  [${i}] ${type} from '${source}' severity=${sev.toFixed(2)}`);
    const detailKeys = otherKeys(s, ['source', 'timestamp', 'type', 'severity']);
    if (detailKeys.length > 0) {
      const sample: Record<string, unknown> = {};
      for (const k of detailKeys.slice(0, 5)) sample[k] = (s as never as Record<string, unknown>)[k];
      lines.push(`      details=${JSON.stringify(sample)}`);
    }
  }
  return lines.join('\n');
}

// ── describeWorkspace ────────────────────────────────────────────

/**
 * Formatted snapshot of the workspace sorted by salience (descending),
 * showing up to `limit` entries (default 10).
 */
export function describeWorkspace(
  workspace: WorkspaceManager | { snapshot: () => ReadonlyWorkspaceSnapshot },
  limit = 10,
): string {
  const snapshot = workspace.snapshot();
  const sorted = [...snapshot].sort((a, b) => salienceOf(b) - salienceOf(a));
  const lines: string[] = [`Workspace(size=${snapshot.length})`];
  if (sorted.length === 0) {
    lines.push('  (empty)');
    return lines.join('\n');
  }
  const shown = sorted.slice(0, limit);
  for (let i = 0; i < shown.length; i++) {
    const e = shown[i]!;
    const sal = salienceOf(e);
    const pin = (e as { pinned?: boolean }).pinned ? '*' : ' ';
    const partition = (e as { partition?: { value?: string } | string }).partition;
    const partStr = partition === undefined ? '' : `[${typeof partition === 'object' && partition !== null ? partition.value ?? 'unknown' : partition}] `;
    const source = String(e.source ?? 'unknown');
    const content = formatContent(e);
    lines.push(`  [${i}]${pin} ${partStr}salience=${sal.toFixed(3)} source='${source}' content=${content}`);
  }
  if (sorted.length > limit) {
    lines.push(`  ... (${sorted.length - limit} more)`);
  }
  return lines.join('\n');
}

// ── diffStates ───────────────────────────────────────────────────

/**
 * Return changed fields between two state values as `[before, after]` tuples.
 * Works on plain objects; falls back to `[before, after]` under key `_value`
 * for non-object values that differ.
 */
export function diffStates<S>(
  before: S,
  after: S,
): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  if (
    before !== null &&
    after !== null &&
    typeof before === 'object' &&
    typeof after === 'object'
  ) {
    const keys = new Set<string>([
      ...Object.keys(before as object),
      ...Object.keys(after as object),
    ]);
    for (const key of keys) {
      const b = (before as Record<string, unknown>)[key];
      const a = (after as Record<string, unknown>)[key];
      if (!shallowEqual(b, a)) out[key] = [b, a];
    }
    return out;
  }
  if (!shallowEqual(before, after)) {
    out._value = [before, after];
  }
  return out;
}

// ── signalSummary ────────────────────────────────────────────────

/**
 * Count signals by type across a list of trace-like records.
 * Returns a Map keyed on the signal's `type` discriminator (when present)
 * or the literal `'unknown'`.
 */
export function signalSummary(
  traces: readonly { signals: readonly MonitoringSignal[] }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of traces) {
    for (const s of t.signals) {
      const k = signalDiscriminator(s);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return counts;
}

// ── describeTrace ────────────────────────────────────────────────

/** Shape consumed by describeTrace. Matches TestCycleTrace and similar. */
export interface DescribableTrace {
  cycle: number;
  input: unknown;
  output: unknown;
  signals: readonly MonitoringSignal[];
  durationMs: number;
  error?: string;
}

/**
 * One-line summary of a single cycle trace.
 *
 * Example: `Cycle[3] (12.45ms) ok input='in' output='out' signals=2`.
 */
export function describeTrace(trace: DescribableTrace): string {
  const status = trace.error ? `ERROR: ${trace.error}` : 'ok';
  const inp = formatValue(trace.input, 40);
  const out = formatValue(trace.output, 40);
  return `Cycle[${trace.cycle}] (${trace.durationMs.toFixed(2)}ms) ${status} input=${inp} output=${out} signals=${trace.signals.length}`;
}

// ── Internal helpers ─────────────────────────────────────────────

function signalDiscriminator(s: MonitoringSignal): string {
  const t = (s as unknown as { type?: unknown }).type;
  return typeof t === 'string' ? t : 'unknown';
}

function severityFor(s: MonitoringSignal): number {
  const v = (s as unknown as { severity?: unknown }).severity;
  return typeof v === 'number' ? v : 0;
}

function otherKeys(obj: object, exclude: readonly string[]): string[] {
  const ex = new Set(exclude);
  return Object.keys(obj).filter((k) => !ex.has(k));
}

function salienceOf(entry: WorkspaceEntry): number {
  const v = (entry as { salience?: unknown }).salience;
  return typeof v === 'number' ? v : 0;
}

function formatContent(e: WorkspaceEntry): string {
  const c = (e as { content?: unknown }).content;
  if (c === undefined || c === null) return 'undefined';
  if (typeof c === 'string') return JSON.stringify(c.length > 60 ? c.slice(0, 57) + '...' : c);
  return formatValue(c, 60);
}

function formatValue(v: unknown, maxLen: number): string {
  if (v === undefined) return 'undefined';
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return JSON.stringify(s.length > maxLen ? s.slice(0, maxLen - 3) + '...' : s);
  } catch {
    return String(v);
  }
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object' || a === null || b === null) return false;
  // For objects, do a JSON-equality check. Sufficient for state-snapshot diffing.
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
