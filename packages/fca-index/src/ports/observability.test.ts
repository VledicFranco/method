/**
 * observability.test.ts — Contract tests for ObservabilityPort and its
 * bundled implementations (Null, Stderr, Recording).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  NullObservabilitySink,
  scoped,
  type ObservabilityEvent,
} from './observability.js';
import { StderrObservabilitySink } from '../cli/stderr-observability-sink.js';
import { RecordingObservabilitySink } from '../testkit/recording-observability-sink.js';

// ── NullObservabilitySink ────────────────────────────────────────────────────

describe('NullObservabilitySink', () => {
  it('accepts any event without throwing', () => {
    const sink = new NullObservabilitySink();
    expect(() =>
      sink.emit({ event: 'done', scope: 'query', ts: new Date().toISOString() }),
    ).not.toThrow();
  });
});

// ── RecordingObservabilitySink ───────────────────────────────────────────────

describe('RecordingObservabilitySink', () => {
  it('captures every emitted event in order', () => {
    const sink = new RecordingObservabilitySink();
    sink.emit({ event: 'start', scope: 'query', ts: '2026-04-13T00:00:00Z' });
    sink.emit({ event: 'done', scope: 'query', ts: '2026-04-13T00:00:01Z', fields: { results: 5 } });

    expect(sink.events).toHaveLength(2);
    expect(sink.events[0].event).toBe('start');
    expect(sink.events[1].fields?.results).toBe(5);
  });

  it('find() filters by scope and optional event name', () => {
    const sink = new RecordingObservabilitySink();
    sink.emit({ event: 'start', scope: 'query', ts: 't1' });
    sink.emit({ event: 'done', scope: 'query', ts: 't2' });
    sink.emit({ event: 'rate_limited', scope: 'embed', ts: 't3' });

    expect(sink.find('query')).toHaveLength(2);
    expect(sink.find('query', 'done')).toHaveLength(1);
    expect(sink.find('embed')).toHaveLength(1);
  });

  it('assertEmitted returns the matching event when present', () => {
    const sink = new RecordingObservabilitySink();
    sink.emit({ event: 'done', scope: 'query', ts: 't1', fields: { results: 3 } });
    const evt = sink.assertEmitted('query', 'done');
    expect(evt.fields?.results).toBe(3);
  });

  it('assertEmitted throws with a helpful message when missing', () => {
    const sink = new RecordingObservabilitySink();
    sink.emit({ event: 'start', scope: 'query', ts: 't1' });
    expect(() => sink.assertEmitted('query', 'done')).toThrow(/Expected event 'query\.done'/);
  });

  it('clear() resets the events list', () => {
    const sink = new RecordingObservabilitySink();
    sink.emit({ event: 'x', scope: 'y', ts: 'z' });
    sink.clear();
    expect(sink.events).toHaveLength(0);
  });
});

// ── StderrObservabilitySink ──────────────────────────────────────────────────

describe('StderrObservabilitySink', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes one JSON line with [prefix.scope] preamble per event', () => {
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const sink = new StderrObservabilitySink();

    sink.emit({
      event: 'done',
      scope: 'query',
      ts: '2026-04-13T00:00:01Z',
      severity: 'info',
      fields: { results: 5, mode: 'production' },
    });

    expect(writeSpy).toHaveBeenCalledOnce();
    const line = writeSpy.mock.calls[0][0] as string;
    expect(line.startsWith('[fca-index.query] ')).toBe(true);
    expect(line.endsWith('\n')).toBe(true);
    const jsonPart = line.slice('[fca-index.query] '.length).trim();
    const parsed = JSON.parse(jsonPart);
    expect(parsed.event).toBe('done');
    expect(parsed.results).toBe(5);
    expect(parsed.mode).toBe('production');
  });

  it('custom prefix overrides the default', () => {
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const sink = new StderrObservabilitySink({ prefix: 'my-tool' });
    sink.emit({ event: 'x', scope: 'y', ts: 't' });
    expect((writeSpy.mock.calls[0][0] as string).startsWith('[my-tool.y] ')).toBe(true);
  });

  it('minSeverity filters out lower-severity events', () => {
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const sink = new StderrObservabilitySink({ minSeverity: 'warn' });

    sink.emit({ event: 'debug-event', scope: 'query', ts: 't', severity: 'debug' });
    sink.emit({ event: 'info-event', scope: 'query', ts: 't', severity: 'info' });
    sink.emit({ event: 'warn-event', scope: 'query', ts: 't', severity: 'warn' });
    sink.emit({ event: 'err-event', scope: 'query', ts: 't', severity: 'error' });

    expect(writeSpy).toHaveBeenCalledTimes(2);
  });

  it('never throws on serialization failure (non-throwing contract)', () => {
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const sink = new StderrObservabilitySink();

    // Circular ref — JSON.stringify will throw
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() =>
      sink.emit({ event: 'x', scope: 'y', ts: 't', fields: { circular } }),
    ).not.toThrow();

    // Write shouldn't have been called (the error was swallowed before write)
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('error field is included when present', () => {
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const sink = new StderrObservabilitySink();

    sink.emit({
      event: 'error',
      scope: 'query',
      ts: 't',
      severity: 'error',
      error: { message: 'boom', code: 'QUERY_FAILED' },
    });

    const line = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(line.slice('[fca-index.query] '.length).trim());
    expect(parsed.error).toEqual({ message: 'boom', code: 'QUERY_FAILED' });
  });
});

// ── scoped() helper ──────────────────────────────────────────────────────────

describe('scoped()', () => {
  it('binds a scope and fills ts automatically', () => {
    const sink = new RecordingObservabilitySink();
    const emit = scoped(sink, 'query');

    emit('start', { topK: 5 });

    expect(sink.events).toHaveLength(1);
    const evt = sink.events[0];
    expect(evt.scope).toBe('query');
    expect(evt.event).toBe('start');
    expect(evt.fields?.topK).toBe(5);
    // ts is an ISO-8601 string filled by the helper
    expect(typeof evt.ts).toBe('string');
    expect(Number.isNaN(Date.parse(evt.ts))).toBe(false);
  });

  it('forwards optional severity', () => {
    const sink = new RecordingObservabilitySink();
    const emit = scoped(sink, 'embed');
    emit('rate_limited', { wait_ms: 5000 }, 'warn');
    expect(sink.events[0].severity).toBe('warn');
  });
});

// ── Port contract (any ObservabilityPort impl) ───────────────────────────────

describe('ObservabilityPort contract', () => {
  const impls = [
    { name: 'NullObservabilitySink', make: () => new NullObservabilitySink() },
    { name: 'RecordingObservabilitySink', make: () => new RecordingObservabilitySink() },
    {
      name: 'StderrObservabilitySink',
      make: () => {
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        return new StderrObservabilitySink();
      },
    },
  ];

  for (const { name, make } of impls) {
    it(`${name} emit() returns void`, () => {
      const sink = make();
      const evt: ObservabilityEvent = { event: 'x', scope: 'y', ts: 't' };
      const result = sink.emit(evt);
      expect(result).toBeUndefined();
      vi.restoreAllMocks();
    });
  }
});
