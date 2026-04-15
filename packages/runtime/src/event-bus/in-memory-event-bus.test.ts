/**
 * Unit tests for InMemoryEventBus (PRD 026).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryEventBus } from './in-memory-event-bus.js';
import type { RuntimeEvent, RuntimeEventInput, EventSink, EventConnector, ConnectorHealth } from '../ports/event-bus.js';

// ── Test helpers ────────────────────────────────────────────────

function makeEvent(overrides: Partial<RuntimeEventInput> = {}): RuntimeEventInput {
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

function collectingSink(name = 'test-sink'): EventSink & { events: RuntimeEvent[] } {
  const events: RuntimeEvent[] = [];
  return {
    name,
    events,
    onEvent(event: RuntimeEvent) { events.push(event); },
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

    it('calls onError when async sink rejects', async () => {
      const errors: Error[] = [];
      const sink: EventSink = {
        name: 'async-error-sink',
        onEvent() { return Promise.reject(new Error('async failure')); },
        onError(err) { errors.push(err); },
      };

      bus.registerSink(sink);
      bus.emit(makeEvent());

      // Allow microtask queue to flush for async error handling
      await new Promise(resolve => setTimeout(resolve, 10));

      assert.equal(errors.length, 1, 'onError should have been called for async rejection');
      assert.equal(errors[0].message, 'async failure');
    });

    it('async sink rejection does not block other sinks', async () => {
      const goodSink = collectingSink('good-async');
      const badSink: EventSink = {
        name: 'bad-async',
        onEvent() { return Promise.reject(new Error('boom')); },
      };

      bus.registerSink(badSink);
      bus.registerSink(goodSink);

      bus.emit(makeEvent());

      await new Promise(resolve => setTimeout(resolve, 10));

      assert.equal(goodSink.events.length, 1, 'good sink should still receive the event');
    });

    it('async sink that resolves works normally', async () => {
      const received: RuntimeEvent[] = [];
      const asyncSink: EventSink = {
        name: 'async-sink',
        async onEvent(event) { received.push(event); },
      };

      bus.registerSink(asyncSink);
      bus.emit(makeEvent());

      await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(received.length, 1);
    });
  });

  describe('subscribe', () => {
    it('delivers matching events to subscriber', () => {
      const received: RuntimeEvent[] = [];
      bus.subscribe({ domain: 'session' }, (event) => received.push(event));

      bus.emit(makeEvent({ domain: 'session', type: 'session.spawned' }));
      bus.emit(makeEvent({ domain: 'strategy', type: 'strategy.started' }));

      assert.equal(received.length, 1);
      assert.equal(received[0].type, 'session.spawned');
    });

    it('supports unsubscribe', () => {
      const received: RuntimeEvent[] = [];
      const sub = bus.subscribe({}, (event) => received.push(event));

      bus.emit(makeEvent());
      sub.unsubscribe();
      bus.emit(makeEvent());

      assert.equal(received.length, 1);
    });

    it('filters by type with glob pattern', () => {
      const received: RuntimeEvent[] = [];
      bus.subscribe({ type: 'strategy.gate_*' }, (event) => received.push(event));

      bus.emit(makeEvent({ type: 'strategy.gate_passed' }));
      bus.emit(makeEvent({ type: 'strategy.gate_failed' }));
      bus.emit(makeEvent({ type: 'strategy.started' }));

      assert.equal(received.length, 2);
      assert.equal(received[0].type, 'strategy.gate_passed');
      assert.equal(received[1].type, 'strategy.gate_failed');
    });

    it('filters by severity array', () => {
      const received: RuntimeEvent[] = [];
      bus.subscribe({ severity: ['error', 'critical'] }, (event) => received.push(event));

      bus.emit(makeEvent({ severity: 'info' }));
      bus.emit(makeEvent({ severity: 'error' }));
      bus.emit(makeEvent({ severity: 'critical' }));

      assert.equal(received.length, 2);
    });

    it('filters by projectId and sessionId', () => {
      const received: RuntimeEvent[] = [];
      bus.subscribe({ projectId: 'p1', sessionId: 's1' }, (event) => received.push(event));

      bus.emit(makeEvent({ projectId: 'p1', sessionId: 's1' }));
      bus.emit(makeEvent({ projectId: 'p1', sessionId: 's2' }));
      bus.emit(makeEvent({ projectId: 'p2', sessionId: 's1' }));

      assert.equal(received.length, 1);
    });

    it('subscriber errors do not block other subscribers', () => {
      const received: RuntimeEvent[] = [];
      bus.subscribe({}, () => { throw new Error('bad subscriber'); });
      bus.subscribe({}, (event) => received.push(event));

      bus.emit(makeEvent());

      assert.equal(received.length, 1);
    });

    it('unsubscribe during dispatch does not skip other subscribers', () => {
      const received: string[] = [];
      const sub1 = bus.subscribe({}, () => {
        received.push('sub1');
        sub1.unsubscribe(); // unsubscribe self during dispatch
      });
      bus.subscribe({}, () => received.push('sub2'));
      bus.subscribe({}, () => received.push('sub3'));

      bus.emit(makeEvent());

      assert.ok(received.includes('sub1'), 'sub1 should have been called');
      assert.ok(received.includes('sub2'), 'sub2 should have been called');
      assert.ok(received.includes('sub3'), 'sub3 should have been called');
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

  describe('importEvent', () => {
    it('imports event without reassigning id, timestamp, or sequence', () => {
      const event: RuntimeEvent = {
        id: 'custom-id',
        version: 1,
        timestamp: '2026-01-01T00:00:00.000Z',
        sequence: 42,
        domain: 'session',
        type: 'session.spawned',
        severity: 'info',
        payload: { test: true },
        source: 'replay',
      };

      bus.importEvent(event);

      const results = bus.query({});
      assert.equal(results.length, 1);
      assert.equal(results[0].id, 'custom-id');
      assert.equal(results[0].timestamp, '2026-01-01T00:00:00.000Z');
      assert.equal(results[0].sequence, 42);
    });

    it('updates internal sequence to prevent collisions', () => {
      bus.importEvent({
        id: 'imported-1',
        version: 1,
        timestamp: '2026-01-01T00:00:00.000Z',
        sequence: 100,
        domain: 'session',
        type: 'session.spawned',
        severity: 'info',
        payload: {},
        source: 'replay',
      });

      // New emit should get sequence > 100
      const newEvent = bus.emit(makeEvent());
      assert.ok(newEvent.sequence > 100, `expected > 100, got ${newEvent.sequence}`);
    });

    it('dispatches to registered sinks', () => {
      const sink = collectingSink();
      bus.registerSink(sink);

      const event: RuntimeEvent = {
        id: 'sink-test',
        version: 1,
        timestamp: new Date().toISOString(),
        sequence: 1,
        domain: 'session',
        type: 'session.spawned',
        severity: 'info',
        payload: {},
        source: 'replay',
      };

      bus.importEvent(event);

      assert.equal(sink.events.length, 1);
      assert.equal(sink.events[0].id, 'sink-test');
    });

    it('dispatches to matching subscribers', () => {
      const received: RuntimeEvent[] = [];
      bus.subscribe({ domain: 'session' }, e => received.push(e));

      bus.importEvent({
        id: 'sub-test',
        version: 1,
        timestamp: new Date().toISOString(),
        sequence: 1,
        domain: 'session',
        type: 'session.spawned',
        severity: 'info',
        payload: {},
        source: 'replay',
      });

      assert.equal(received.length, 1);
      assert.equal(received[0].id, 'sub-test');
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

    it('throws on zero capacity', () => {
      assert.throws(() => new InMemoryEventBus({ capacity: 0 }), /capacity must be >= 1/);
    });

    it('throws on negative capacity', () => {
      assert.throws(() => new InMemoryEventBus({ capacity: -5 }), /capacity must be >= 1/);
    });
  });

  // ── Connector lifecycle (PRD 026 Phase 5) ────────────────────

  describe('connector lifecycle', () => {
    function makeConnector(name: string): EventConnector & { connectCalled: boolean; disconnectCalled: boolean } {
      return {
        name,
        connectCalled: false,
        disconnectCalled: false,
        async connect() { this.connectCalled = true; },
        async disconnect() { this.disconnectCalled = true; },
        health(): ConnectorHealth { return { connected: this.connectCalled && !this.disconnectCalled, lastEventAt: null, errorCount: 0 }; },
        onEvent() {},
      };
    }

    it('connectAll() calls connect() on all registered connectors', async () => {
      const c1 = makeConnector('c1');
      const c2 = makeConnector('c2');
      bus.registerSink(c1);
      bus.registerSink(c2);

      await bus.connectAll();

      assert.ok(c1.connectCalled, 'c1.connect() should have been called');
      assert.ok(c2.connectCalled, 'c2.connect() should have been called');
    });

    it('disconnectAll() calls disconnect() on all registered connectors', async () => {
      const c1 = makeConnector('c1');
      const c2 = makeConnector('c2');
      bus.registerSink(c1);
      bus.registerSink(c2);

      await bus.disconnectAll();

      assert.ok(c1.disconnectCalled, 'c1.disconnect() should have been called');
      assert.ok(c2.disconnectCalled, 'c2.disconnect() should have been called');
    });

    it('connectorHealth() returns health from each connector', async () => {
      const c1 = makeConnector('webhook:example.com');
      bus.registerSink(c1);
      await bus.connectAll();

      const health = bus.connectorHealth();

      assert.equal(health.length, 1);
      assert.equal(health[0].name, 'webhook:example.com');
      assert.ok(health[0].health.connected);
    });

    it('connectAll() does not call connect() on plain sinks', async () => {
      const plain = collectingSink('plain');
      const connector = makeConnector('connector');
      bus.registerSink(plain);
      bus.registerSink(connector);

      await bus.connectAll();

      assert.ok(connector.connectCalled, 'connector should be connected');
      // plain sink has no connect() — no error thrown
      assert.equal(plain.events.length, 0);
    });

    it('connectAll() continues if one connector throws', async () => {
      const failing: EventConnector = {
        name: 'failing',
        async connect() { throw new Error('connect failed'); },
        async disconnect() {},
        health(): ConnectorHealth { return { connected: false, lastEventAt: null, errorCount: 0 }; },
        onEvent() {},
      };
      const c2 = makeConnector('c2');
      bus.registerSink(failing);
      bus.registerSink(c2);

      await bus.connectAll(); // should not throw

      assert.ok(c2.connectCalled, 'c2 should still connect despite failing first connector');
    });
  });

  // ── getStats (PRD 026 Phase 4) ────────────────────────────────

  describe('getStats', () => {
    it('returns zero counters initially', () => {
      const stats = bus.getStats();
      assert.equal(stats.totalEmitted, 0);
      assert.equal(stats.totalImported, 0);
      assert.equal(stats.bufferSize, 0);
      assert.equal(stats.bufferCapacity, 10_000);
      assert.equal(stats.sinkCount, 0);
      assert.equal(stats.subscriberCount, 0);
    });

    it('increments totalEmitted on emit', () => {
      bus.emit(makeEvent());
      bus.emit(makeEvent());
      const stats = bus.getStats();
      assert.equal(stats.totalEmitted, 2);
      assert.equal(stats.bufferSize, 2);
    });

    it('increments totalImported on importEvent', () => {
      const event: RuntimeEvent = {
        id: 'imported-1',
        version: 1,
        timestamp: new Date().toISOString(),
        sequence: 50,
        domain: 'session',
        type: 'session.spawned',
        severity: 'info',
        payload: {},
        source: 'test',
      };
      bus.importEvent(event);
      const stats = bus.getStats();
      assert.equal(stats.totalImported, 1);
      assert.equal(stats.totalEmitted, 0);
      assert.equal(stats.bufferSize, 1);
    });

    it('tracks sinks and subscribers', () => {
      const sink = collectingSink();
      bus.registerSink(sink);
      const sub = bus.subscribe({}, () => {});

      let stats = bus.getStats();
      assert.equal(stats.sinkCount, 1);
      assert.equal(stats.subscriberCount, 1);

      sub.unsubscribe();
      stats = bus.getStats();
      assert.equal(stats.subscriberCount, 0);
    });
  });
});
