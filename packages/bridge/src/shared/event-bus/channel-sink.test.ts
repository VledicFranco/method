/**
 * Unit tests for ChannelSink (PRD 026 Phase 3).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelSink, getChannelTarget } from './channel-sink.js';
import type { BridgeEvent } from '../../ports/event-bus.js';

// ── Test helpers ───────────────────────────────────────────────

function makeEvent(seq: number, overrides: Partial<BridgeEvent> = {}): BridgeEvent {
  return {
    id: `evt-${seq}`,
    version: 1,
    timestamp: new Date(Date.now() + seq).toISOString(),
    sequence: seq,
    domain: 'session',
    type: 'session.spawned',
    severity: 'info',
    payload: {},
    source: 'test',
    sessionId: 'sess-1',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe('ChannelSink', () => {
  let sink: ChannelSink;

  beforeEach(() => {
    sink = new ChannelSink({ capacity: 5 });
  });

  describe('onEvent', () => {
    it('buffers events by sessionId', () => {
      sink.onEvent(makeEvent(1, { sessionId: 'sess-1' }));
      sink.onEvent(makeEvent(2, { sessionId: 'sess-2' }));
      sink.onEvent(makeEvent(3, { sessionId: 'sess-1' }));

      const s1 = sink.getEvents('sess-1');
      const s2 = sink.getEvents('sess-2');

      assert.equal(s1.messages.length, 2);
      assert.equal(s2.messages.length, 1);
    });

    it('ignores events without sessionId', () => {
      sink.onEvent(makeEvent(1, { sessionId: undefined }));

      assert.deepEqual(sink.getSessionIds(), []);
    });

    it('evicts oldest when buffer exceeds capacity', () => {
      for (let i = 1; i <= 7; i++) {
        sink.onEvent(makeEvent(i, { sessionId: 'sess-1' }));
      }

      const result = sink.getEvents('sess-1');
      assert.equal(result.messages.length, 5, 'buffer should cap at capacity');
      assert.equal(result.messages[0].sequence, 3, 'oldest events evicted');
      assert.equal(result.messages[4].sequence, 7);
    });
  });

  describe('cursor recovery', () => {
    it('skips events at or below cursor', () => {
      sink.initFromCursor(5);

      sink.onEvent(makeEvent(3, { sessionId: 'sess-1' }));
      sink.onEvent(makeEvent(5, { sessionId: 'sess-1' }));
      sink.onEvent(makeEvent(6, { sessionId: 'sess-1' }));

      const result = sink.getEvents('sess-1');
      assert.equal(result.messages.length, 1);
      assert.equal(result.messages[0].sequence, 6);
    });

    it('exposes current cursor', () => {
      sink.onEvent(makeEvent(10, { sessionId: 'sess-1' }));
      assert.equal(sink.cursor, 10);
    });
  });

  describe('getEvents', () => {
    it('filters by sinceSequence', () => {
      sink.onEvent(makeEvent(1, { sessionId: 'sess-1' }));
      sink.onEvent(makeEvent(2, { sessionId: 'sess-1' }));
      sink.onEvent(makeEvent(3, { sessionId: 'sess-1' }));

      const result = sink.getEvents('sess-1', 1);
      assert.equal(result.messages.length, 2);
      assert.equal(result.messages[0].sequence, 2);
    });

    it('filters by channel target (progress)', () => {
      sink.onEvent(makeEvent(1, {
        sessionId: 'sess-1',
        type: 'methodology.step_completed',
        payload: {},
      }));
      sink.onEvent(makeEvent(2, {
        sessionId: 'sess-1',
        type: 'session.spawned',
        payload: {},
      }));

      const progress = sink.getEvents('sess-1', 0, 'progress');
      assert.equal(progress.messages.length, 1);
      assert.equal(progress.messages[0].type, 'methodology.step_completed');
    });

    it('filters by channel target (events)', () => {
      sink.onEvent(makeEvent(1, {
        sessionId: 'sess-1',
        type: 'session.observation.idle',
        payload: { channelTarget: 'progress' },
      }));
      sink.onEvent(makeEvent(2, {
        sessionId: 'sess-1',
        type: 'session.killed',
        payload: {},
      }));

      const events = sink.getEvents('sess-1', 0, 'events');
      assert.equal(events.messages.length, 1);
      assert.equal(events.messages[0].type, 'session.killed');
    });

    it('returns empty for unknown session', () => {
      const result = sink.getEvents('nonexistent');
      assert.equal(result.messages.length, 0);
      assert.equal(result.last_sequence, 0);
    });

    it('returns backward-compatible ChannelMessage shape', () => {
      sink.onEvent(makeEvent(1, {
        sessionId: 'sess-1',
        source: 'bridge/sessions/pool',
        payload: { test: true },
      }));

      const result = sink.getEvents('sess-1');
      const msg = result.messages[0];

      assert.equal(typeof msg.sequence, 'number');
      assert.equal(typeof msg.timestamp, 'string');
      assert.equal(typeof msg.sender, 'string');
      assert.equal(msg.sender, 'bridge/sessions/pool');
      assert.equal(typeof msg.type, 'string');
      assert.deepEqual(msg.content, { test: true });
    });
  });

  describe('getAggregated', () => {
    it('aggregates events across sessions', () => {
      sink.onEvent(makeEvent(1, { sessionId: 'sess-1', type: 'session.killed', payload: {} }));
      sink.onEvent(makeEvent(2, { sessionId: 'sess-2', type: 'session.spawned', payload: {} }));

      const result = sink.getAggregated();
      assert.equal(result.events.length, 2);
    });

    it('filters by sinceSequence', () => {
      sink.onEvent(makeEvent(1, { sessionId: 'sess-1', type: 'session.killed', payload: {} }));
      sink.onEvent(makeEvent(2, { sessionId: 'sess-1', type: 'session.spawned', payload: {} }));

      const result = sink.getAggregated(1);
      assert.equal(result.events.length, 1);
      assert.equal(result.events[0].message.sequence, 2);
    });

    it('only includes events-channel events', () => {
      sink.onEvent(makeEvent(1, {
        sessionId: 'sess-1',
        type: 'methodology.step_completed',
        payload: {},
      }));
      sink.onEvent(makeEvent(2, {
        sessionId: 'sess-1',
        type: 'session.killed',
        payload: {},
      }));

      const result = sink.getAggregated();
      assert.equal(result.events.length, 1, 'progress events excluded from aggregation');
    });

    it('sorts by timestamp', () => {
      // Events arrive in sequence order but with different timestamps
      sink.onEvent(makeEvent(1, {
        sessionId: 'sess-2',
        timestamp: '2026-01-01T00:00:02.000Z',
        type: 'session.killed',
        payload: {},
      }));
      sink.onEvent(makeEvent(2, {
        sessionId: 'sess-1',
        timestamp: '2026-01-01T00:00:01.000Z',
        type: 'session.spawned',
        payload: {},
      }));

      const result = sink.getAggregated();
      assert.equal(result.events[0].message.timestamp, '2026-01-01T00:00:01.000Z');
      assert.equal(result.events[1].message.timestamp, '2026-01-01T00:00:02.000Z');
    });
  });

  describe('push notifications', () => {
    it('calls pushToParent for warning/error/critical events', () => {
      const pushed: Array<{ sessionId: string; event: BridgeEvent }> = [];
      const pushSink = new ChannelSink({
        capacity: 10,
        pushToParent: (sid, evt) => pushed.push({ sessionId: sid, event: evt }),
      });

      pushSink.onEvent(makeEvent(1, { sessionId: 'sess-1', severity: 'info' }));
      pushSink.onEvent(makeEvent(2, { sessionId: 'sess-1', severity: 'warning' }));
      pushSink.onEvent(makeEvent(3, { sessionId: 'sess-1', severity: 'error' }));
      pushSink.onEvent(makeEvent(4, { sessionId: 'sess-1', severity: 'critical' }));

      assert.equal(pushed.length, 3, 'info should not trigger push');
      assert.equal(pushed[0].event.severity, 'warning');
      assert.equal(pushed[1].event.severity, 'error');
      assert.equal(pushed[2].event.severity, 'critical');
    });

    it('does not push events without sessionId', () => {
      const pushed: unknown[] = [];
      const pushSink = new ChannelSink({
        pushToParent: () => pushed.push(1),
      });

      pushSink.onEvent(makeEvent(1, { sessionId: undefined, severity: 'error' }));
      assert.equal(pushed.length, 0);
    });

    it('push failure is non-fatal', () => {
      const pushSink = new ChannelSink({
        pushToParent: () => { throw new Error('push failed'); },
      });

      // Should not throw
      pushSink.onEvent(makeEvent(1, { sessionId: 'sess-1', severity: 'error' }));
      assert.equal(pushSink.cursor, 1, 'event still processed despite push failure');
    });
  });

  describe('removeSession', () => {
    it('removes session buffer', () => {
      sink.onEvent(makeEvent(1, { sessionId: 'sess-1' }));
      sink.removeSession('sess-1');

      const result = sink.getEvents('sess-1');
      assert.equal(result.messages.length, 0);
    });
  });
});

describe('getChannelTarget', () => {
  it('returns progress for methodology step events', () => {
    assert.equal(getChannelTarget(makeEvent(1, { type: 'methodology.step_completed', payload: {} })), 'progress');
    assert.equal(getChannelTarget(makeEvent(1, { type: 'methodology.step_started', payload: {} })), 'progress');
  });

  it('returns progress when payload has channelTarget progress', () => {
    assert.equal(getChannelTarget(makeEvent(1, { payload: { channelTarget: 'progress' } })), 'progress');
  });

  it('returns events when payload has channelTarget events', () => {
    assert.equal(getChannelTarget(makeEvent(1, { payload: { channelTarget: 'events' } })), 'events');
  });

  it('defaults to events for other types', () => {
    assert.equal(getChannelTarget(makeEvent(1, { type: 'session.spawned', payload: {} })), 'events');
    assert.equal(getChannelTarget(makeEvent(1, { type: 'strategy.started', payload: {} })), 'events');
  });
});
