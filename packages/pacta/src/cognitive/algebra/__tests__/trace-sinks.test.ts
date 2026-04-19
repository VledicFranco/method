// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for trace sinks (PRD 030, C-2).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryTraceSink, ConsoleTraceSink } from '../trace-sinks.js';
import type { TraceRecord } from '../trace.js';
import { moduleId } from '../module.js';

// ── Test Helpers ────────────────────────────────────────────────

function makeTrace(overrides?: Partial<TraceRecord>): TraceRecord {
  return {
    moduleId: moduleId('test-module'),
    phase: 'REASON',
    timestamp: Date.now(),
    inputHash: 'abc123',
    outputSummary: 'test output',
    monitoring: {
      source: moduleId('test-module'),
      timestamp: Date.now(),
    },
    stateHash: 'def456',
    durationMs: 42,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────

describe('InMemoryTraceSink', () => {
  it('1. stores and retrieves traces', () => {
    const sink = new InMemoryTraceSink();

    assert.strictEqual(sink.traces().length, 0);

    const trace1 = makeTrace({ phase: 'OBSERVE' });
    const trace2 = makeTrace({ phase: 'REASON' });
    const trace3 = makeTrace({ phase: 'ACT' });

    sink.onTrace(trace1);
    sink.onTrace(trace2);
    sink.onTrace(trace3);

    const traces = sink.traces();
    assert.strictEqual(traces.length, 3);
    assert.strictEqual(traces[0].phase, 'OBSERVE');
    assert.strictEqual(traces[1].phase, 'REASON');
    assert.strictEqual(traces[2].phase, 'ACT');

    // Clear resets
    sink.clear();
    assert.strictEqual(sink.traces().length, 0);
  });
});

describe('ConsoleTraceSink', () => {
  it('2. formats without error', () => {
    const sink = new ConsoleTraceSink();

    // Capture console.log to verify no errors
    const originalLog = console.log;
    const logged: string[] = [];
    console.log = (...args: unknown[]) => { logged.push(args.join(' ')); };

    try {
      sink.onTrace(makeTrace());
      sink.onTrace(makeTrace({
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 150,
        },
      }));

      assert.strictEqual(logged.length, 2);
      assert.ok(logged[0].includes('test-module'));
      assert.ok(logged[0].includes('REASON'));
      assert.ok(logged[0].includes('42ms'));
      assert.ok(logged[1].includes('tokens'));
      assert.ok(logged[1].includes('100in'));
      assert.ok(logged[1].includes('50out'));
    } finally {
      console.log = originalLog;
    }
  });
});
