/**
 * Unit tests for GenesisSink (PRD 026 Phase 4).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GenesisSink } from './genesis-sink.js';
import type { RuntimeEvent } from '../ports/event-bus.js';

// ── Test helpers ───────────────────────────────────────────────

function makeEvent(seq: number, overrides: Partial<RuntimeEvent> = {}): RuntimeEvent {
  return {
    id: `evt-${seq}`,
    version: 1,
    timestamp: new Date(Date.now() + seq).toISOString(),
    sequence: seq,
    domain: 'session',
    type: 'session.stale',
    severity: 'warning',
    payload: {},
    source: 'test',
    sessionId: 'sess-1',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe('GenesisSink', () => {
  let sink: GenesisSink;
  let prompts: Array<{ sessionId: string; prompt: string }>;
  let promptCallback: (sessionId: string, prompt: string) => Promise<void>;

  beforeEach(() => {
    prompts = [];
    promptCallback = async (sessionId, prompt) => {
      prompts.push({ sessionId, prompt });
    };
    sink = new GenesisSink({
      promptSession: promptCallback,
      sessionId: 'genesis-1',
      batchWindowMs: 50, // Short for testing
    });
  });

  afterEach(() => {
    sink.dispose();
  });

  describe('severity filtering', () => {
    it('accepts warning/error/critical events', () => {
      sink.onEvent(makeEvent(1, { severity: 'warning' }));
      sink.onEvent(makeEvent(2, { severity: 'error' }));
      sink.onEvent(makeEvent(3, { severity: 'critical' }));

      assert.equal(sink.bufferedCount, 3);
    });

    it('rejects info events by default', () => {
      sink.onEvent(makeEvent(1, { severity: 'info' }));
      assert.equal(sink.bufferedCount, 0);
    });

    it('respects custom severity filter', () => {
      sink.dispose();
      sink = new GenesisSink({
        promptSession: promptCallback,
        sessionId: 'genesis-1',
        batchWindowMs: 50,
        severityFilter: ['critical'],
      });

      sink.onEvent(makeEvent(1, { severity: 'warning' }));
      sink.onEvent(makeEvent(2, { severity: 'critical' }));

      assert.equal(sink.bufferedCount, 1);
    });
  });

  describe('batching', () => {
    it('buffers events and flushes after batch window', async () => {
      sink.onEvent(makeEvent(1, { severity: 'warning' }));
      sink.onEvent(makeEvent(2, { severity: 'error' }));

      assert.equal(prompts.length, 0, 'should not prompt before batch window');

      // Wait for batch window to fire
      await new Promise((r) => setTimeout(r, 100));

      assert.equal(prompts.length, 1);
      assert.equal(prompts[0].sessionId, 'genesis-1');
      assert.ok(prompts[0].prompt.includes('2 event(s)'));
    });

    it('manual flush sends immediately', async () => {
      sink.onEvent(makeEvent(1, { severity: 'error' }));
      sink.onEvent(makeEvent(2, { severity: 'warning' }));

      await sink.flush();

      assert.equal(prompts.length, 1);
      assert.equal(sink.bufferedCount, 0);
    });

    it('flush with empty buffer is a no-op', async () => {
      await sink.flush();
      assert.equal(prompts.length, 0);
    });
  });

  describe('graceful when Genesis is dead', () => {
    it('handles promptSession rejection silently', async () => {
      const failingSink = new GenesisSink({
        promptSession: async () => { throw new Error('session dead'); },
        sessionId: 'genesis-dead',
        batchWindowMs: 50,
      });

      failingSink.onEvent(makeEvent(1, { severity: 'error' }));
      await failingSink.flush();

      // No throw — events are silently lost
      assert.equal(failingSink.bufferedCount, 0);
      failingSink.dispose();
    });
  });

  describe('dispose', () => {
    it('stops accepting events after dispose', () => {
      sink.dispose();
      sink.onEvent(makeEvent(1, { severity: 'error' }));
      assert.equal(sink.bufferedCount, 0);
    });

    it('clears pending timer on dispose', async () => {
      sink.onEvent(makeEvent(1, { severity: 'error' }));
      sink.dispose();

      // Wait past batch window — no prompt should fire
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(prompts.length, 0);
    });
  });

  describe('summarize', () => {
    it('groups by domain', () => {
      const events: RuntimeEvent[] = [
        makeEvent(1, { domain: 'session', type: 'session.stale', severity: 'warning' }),
        makeEvent(2, { domain: 'strategy', type: 'strategy.gate_failed', severity: 'error', payload: { gate: 'G-TEST' } }),
        makeEvent(3, { domain: 'session', type: 'session.killed', severity: 'error' }),
      ];

      const summary = GenesisSink.summarize(events);

      assert.ok(summary.includes('[session] (2 events)'));
      assert.ok(summary.includes('[strategy] (1 event)'));
      assert.ok(summary.includes('strategy.gate_failed [error]'));
      assert.ok(summary.includes('gate=G-TEST'));
    });

    it('includes severity counts', () => {
      const events: RuntimeEvent[] = [
        makeEvent(1, { severity: 'critical' }),
        makeEvent(2, { severity: 'error' }),
        makeEvent(3, { severity: 'warning' }),
        makeEvent(4, { severity: 'warning' }),
      ];

      const summary = GenesisSink.summarize(events);

      assert.ok(summary.includes('1 critical'));
      assert.ok(summary.includes('1 error'));
      assert.ok(summary.includes('2 warning'));
    });

    it('includes session and project context', () => {
      const events: RuntimeEvent[] = [
        makeEvent(1, { sessionId: 'abcdef12', projectId: 'my-project', severity: 'error' }),
      ];

      const summary = GenesisSink.summarize(events);

      assert.ok(summary.includes('session=abcdef12'));
      assert.ok(summary.includes('project=my-project'));
    });

    it('includes payload details', () => {
      const events: RuntimeEvent[] = [
        makeEvent(1, { severity: 'error', payload: { error: 'connection timeout' } }),
      ];

      const summary = GenesisSink.summarize(events);

      assert.ok(summary.includes('connection timeout'));
    });
  });
});
