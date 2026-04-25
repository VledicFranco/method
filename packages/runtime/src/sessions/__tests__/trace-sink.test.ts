// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for TraceEventBusSink — PRD 058 C-5.
 *
 * Covers translation of pacta TraceEvents into RuntimeEvents on the
 * Universal Event Bus.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TraceEventBusSink } from '../trace-sink.js';
import type {
  RuntimeEvent,
  RuntimeEventInput,
  EventBus,
  EventFilter,
  EventSubscription,
} from '../../ports/event-bus.js';
import type { TraceEvent } from '@methodts/pacta';

function makeStubBus(): EventBus & { emitted: RuntimeEventInput[] } {
  const emitted: RuntimeEventInput[] = [];
  let seq = 0;
  return {
    emitted,
    emit(event: RuntimeEventInput): RuntimeEvent {
      emitted.push(event);
      return {
        ...event,
        id: `t-${++seq}`,
        timestamp: new Date().toISOString(),
        sequence: seq,
      } as RuntimeEvent;
    },
    importEvent(_event: RuntimeEvent): void {},
    subscribe(_filter: EventFilter, _handler: (event: RuntimeEvent) => void): EventSubscription {
      return { unsubscribe: () => {} };
    },
    query(_filter: EventFilter): RuntimeEvent[] {
      return [];
    },
    registerSink(): void {},
  };
}

const baseEvent: TraceEvent = {
  eventId: 'e1',
  cycleId: 'c-1',
  kind: 'cycle-start',
  name: 'cycle-1',
  timestamp: 1_700_000_000_000,
  data: { inputText: 'hello', cycleNumber: 1 },
};

describe('TraceEventBusSink', () => {
  it('translates TraceEvent into RuntimeEvent on domain="trace"', () => {
    const bus = makeStubBus();
    const sink = new TraceEventBusSink(bus);
    sink.onEvent(baseEvent);

    assert.equal(bus.emitted.length, 1);
    const out = bus.emitted[0]!;
    assert.equal(out.domain, 'trace');
    assert.equal(out.type, 'trace.cycle_start');
    assert.equal(out.severity, 'info');
    assert.equal(out.source, 'runtime/sessions/trace-sink');
    assert.equal((out.payload as any).cycleId, 'c-1');
    assert.equal((out.payload as any).name, 'cycle-1');
  });

  it('event kind dash → underscore in RuntimeEvent type', () => {
    const bus = makeStubBus();
    const sink = new TraceEventBusSink(bus);
    sink.onEvent({ ...baseEvent, kind: 'phase-end', name: 'observe', phase: 'observe', durationMs: 12 });
    assert.equal(bus.emitted[0]!.type, 'trace.phase_end');
    assert.equal((bus.emitted[0]!.payload as any).durationMs, 12);
    assert.equal((bus.emitted[0]!.payload as any).phase, 'observe');
  });

  it('forwards context fields (sessionId, projectId, experimentId, runId)', () => {
    const bus = makeStubBus();
    const sink = new TraceEventBusSink(bus, {
      sessionId: 'sess-1',
      projectId: 'proj-1',
      experimentId: 'exp-1',
      runId: 'run-1',
    });
    sink.onEvent(baseEvent);
    const out = bus.emitted[0]!;
    assert.equal(out.sessionId, 'sess-1');
    assert.equal(out.projectId, 'proj-1');
    assert.equal((out.payload as any).experimentId, 'exp-1');
    assert.equal((out.payload as any).runId, 'run-1');
  });

  it('setContext mutates the ambient context for subsequent events', () => {
    const bus = makeStubBus();
    const sink = new TraceEventBusSink(bus);
    sink.onEvent(baseEvent);
    assert.equal(bus.emitted[0]!.sessionId, undefined);
    sink.setContext({ sessionId: 'sess-2' });
    sink.onEvent(baseEvent);
    assert.equal(bus.emitted[1]!.sessionId, 'sess-2');
  });

  it('derives severity=warning when event data carries an error string', () => {
    const bus = makeStubBus();
    const sink = new TraceEventBusSink(bus);
    sink.onEvent({
      ...baseEvent,
      kind: 'phase-end',
      name: 'observe',
      data: { error: 'something exploded' },
    });
    assert.equal(bus.emitted[0]!.severity, 'warning');
  });

  it('onTrace is a no-op (legacy flat-record path does not flow onto the bus)', () => {
    const bus = makeStubBus();
    const sink = new TraceEventBusSink(bus);
    sink.onTrace({
      moduleId: 'm' as never,
      phase: 'OBSERVE',
      timestamp: 0,
      inputHash: '',
      outputSummary: '',
      monitoring: {} as never,
      stateHash: '',
      durationMs: 0,
    });
    assert.equal(bus.emitted.length, 0);
  });
});
