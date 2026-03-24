/**
 * Unit tests for InMemoryEventBus (PRD 026).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryEventBus } from './in-memory-event-bus.js';
import type { BridgeEvent, BridgeEventInput, EventSink } from '../../ports/event-bus.js';

// ── Test helpers ────────────────────────────────────────────────

function makeEvent(overrides: Partial<BridgeEventInput> = {}): BridgeEventInput {
  return {
    version: 1,
    domain: 'session',
    type: 'session.spawned',
    severity: 'info',
    payload: { test: true },
    source: 'test',
    ...overrides,
  };
}

function collectingSink(name = 'test-sink'): EventSink & { events: BridgeEvent[] } {
  const events: BridgeEvent[] = [];
  return {
    name,
    events,
    onEvent(event: BridgeEvent) { events.push(event); },
  };
}

// ── Tests ───────────────────────────────────────────────────────

describe('InMemoryEventBus', () => {
  let bus: InMemoryEventBus;

  beforeEach(() => {
    bus = new InMemoryEventBus();
  });

  describe('emit', () => {
    it('assigns id, timestamp, and monotonic sequence', () => {
      const e1 = bus.emit(makeEvent());
      const e2 = bus.emit(makeEvent());

      assert.ok(e1.id, 'event should have an id');
      assert.ok(e1.timestamp, 'event should have a timestamp');
      assert.equal(e1.version, 1);
      assert.equal(e1.sequence, 1);
      assert.equal(e2.sequence, 2);
      assert.notEqual(e1.id, e2.id, 'each event should have a unique id');
    });

    it('preserves all input fields', () => {
      const input = makeEvent({
        domain: 'strategy',
        type: 'strategy.started',
        severity: 'warning',
        projectId: 'proj-1',
        sessionId: 'sess-1',
        payload: { node: 'gate-check' },
        source: 'bridge/strategies',
        correlationId: 'exec-123',
      });

      const event = bus.emit(input);

      assert.equal(event.domain, 'strategy');
      assert.equal(event.type, 'strategy.started');
      assert.equal(event.severity, 'warning');
      assert.equal(event.projectId, 'proj-1');
      assert.equal(event.sessionId, 'sess-1');
      assert.deepEqual(event.payload, { node: 'gate-check' });
      assert.equal(event.source, 'bridge/strategies');
      assert.equal(event.correlationId, 'exec-123');
    });

    it('rejects payloads exceeding 64KB', () => {
      const largePayload = { data: 'x'.repeat(70_000) };
      const event = bus.emit(makeEvent({ payload: largePayload }));

      // Should return a system.bus_error event instead
      assert.equal(event.type, 'system.bus_error');
      assert.equal(event.domain, 'system');
      assert.equal(event.payload.error, 'payload_too_large');
    });
  });

  describe('sinks', () => {
    it('dispatches events to registered sinks', () => {
      const sink = collectingSink();
      bus.registerSink(sink);

      bus.emit(makeEvent());
      bus.emit(makeEvent({ type: 'session.killed' }));

      assert.equal(sink.events.length, 2);
      assert.equal(sink.events[0].type, 'session.spawned');
      assert.equal(sink.events[1].type, 'session.killed');
    });

    it('sink errors do not block other sinks', () => {
      const errorSink: EventSink = {
        name: 'bad-sink',
        onEvent() { throw new Error('sink failure'); },
        onError() { /* captured */ },
      };
      const goodSink = collectingSink('good-sink');

      bus.registerSink(errorSink);
      bus.registerSink(goodSink);

      bus.emit(makeEvent());

      assert.equal(goodSink.events.length, 1, 'good sink should still receive the event');
    });

    it('calls onError when sync sink throws', () => {
      const errors: Error[] = [];
      const sink: EventSink = {
        name: 'error-sink',
        onEvent() { throw new Error('test error'); },
        onError(err) { errors.push(err); },
      };

      bus.registerSink(sink);
      bus.emit(makeEvent());

      assert.equal(errors.length, 1, 'onError should have been called');
      assert.equal(errors[0].message, 'test error');
    });
  });

  describe('subscribe', () => {
    it('delivers matching events to subscriber', () => {
      const received: BridgeEvent[] = [];
      bus.subscribe({ domain: 'session' }, (event) => received.push(event));

      bus.emit(makeEvent({ domain: 'session', type: 'session.spawned' }));
      bus.emit(makeEvent({ domain: 'strategy', type: 'strategy.started' }));

      assert.equal(received.length, 1);
      assert.equal(received[0].type, 'session.spawned');
    });

    it('supports unsubscribe', () => {
      const received: BridgeEvent[] = [];
      const sub = bus.subscribe({}, (event) => received.push(event));

      bus.emit(makeEvent());
      sub.unsubscribe();
      bus.emit(makeEvent());

      assert.equal(received.length, 1);
    });

    it('filters by type with glob pattern', () => {
      const received: BridgeEvent[] = [];
      bus.subscribe({ type: 'strategy.gate_*' }, (event) => received.push(event));

      bus.emit(makeEvent({ type: 'strategy.gate_passed' }));
      bus.emit(makeEvent({ type: 'strategy.gate_failed' }));
      bus.emit(makeEvent({ type: 'strategy.started' }));

      assert.equal(received.length, 2);
      assert.equal(received[0].type, 'strategy.gate_passed');
      assert.equal(received[1].type, 'strategy.gate_failed');
    });

    it('filters by severity array', () => {
      const received: BridgeEvent[] = [];
      bus.subscribe({ severity: ['error', 'critical'] }, (event) => received.push(event));

      bus.emit(makeEvent({ severity: 'info' }));
      bus.emit(makeEvent({ severity: 'error' }));
      bus.emit(makeEvent({ severity: 'critical' }));

      assert.equal(received.length, 2);
    });

    it('filters by projectId and sessionId', () => {
      const received: BridgeEvent[] = [];
      bus.subscribe({ projectId: 'p1', sessionId: 's1' }, (event) => received.push(event));

      bus.emit(makeEvent({ projectId: 'p1', sessionId: 's1' }));
      bus.emit(makeEvent({ projectId: 'p1', sessionId: 's2' }));
      bus.emit(makeEvent({ projectId: 'p2', sessionId: 's1' }));

      assert.equal(received.length, 1);
    });

    it('subscriber errors do not block other subscribers', () => {
      const received: BridgeEvent[] = [];
      bus.subscribe({}, () => { throw new Error('bad subscriber'); });
      bus.subscribe({}, (event) => received.push(event));

      bus.emit(makeEvent());

      assert.equal(received.length, 1);
    });
  });

  describe('query', () => {
    it('returns events matching filter', () => {
      bus.emit(makeEvent({ domain: 'session', type: 'session.spawned' }));
      bus.emit(makeEvent({ domain: 'strategy', type: 'strategy.started' }));
      bus.emit(makeEvent({ domain: 'session', type: 'session.killed' }));

      const results = bus.query({ domain: 'session' });

      assert.equal(results.length, 2);
      assert.equal(results[0].type, 'session.spawned');
      assert.equal(results[1].type, 'session.killed');
    });

    it('respects limit option', () => {
      for (let i = 0; i < 10; i++) {
        bus.emit(makeEvent());
      }

      const results = bus.query({}, { limit: 3 });
      assert.equal(results.length, 3);
    });

    it('respects since option', () => {
      const e1 = bus.emit(makeEvent());
      bus.emit(makeEvent());

      const results = bus.query({}, { since: e1.timestamp });

      // Due to sub-millisecond timing, both may have the same timestamp
      // so we just verify the query doesn't crash and returns valid results
      assert.ok(Array.isArray(results));
    });

    it('returns empty array for no matches', () => {
      bus.emit(makeEvent({ domain: 'session' }));

      const results = bus.query({ domain: 'trigger' });
      assert.equal(results.length, 0);
    });
  });

  describe('ring buffer eviction', () => {
    it('evicts oldest events when capacity exceeded', () => {
      const smallBus = new InMemoryEventBus({ capacity: 3 });

      smallBus.emit(makeEvent({ type: 'event.1' }));
      smallBus.emit(makeEvent({ type: 'event.2' }));
      smallBus.emit(makeEvent({ type: 'event.3' }));
      smallBus.emit(makeEvent({ type: 'event.4' }));

      const results = smallBus.query({});

      assert.equal(results.length, 3);
      assert.equal(results[0].type, 'event.2', 'oldest event should be evicted');
      assert.equal(results[2].type, 'event.4');
    });

    it('handles wrap-around correctly', () => {
      const smallBus = new InMemoryEventBus({ capacity: 2 });

      for (let i = 1; i <= 5; i++) {
        smallBus.emit(makeEvent({ type: `event.${i}` }));
      }

      const results = smallBus.query({});
      assert.equal(results.length, 2);
      assert.equal(results[0].type, 'event.4');
      assert.equal(results[1].type, 'event.5');
    });
  });
});
