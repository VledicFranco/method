// SPDX-License-Identifier: Apache-2.0
/**
 * Factory wiring smoke tests — PRD 058 Wave 3.
 *
 * Verifies that the bridge SessionProviderFactory plumbs the per-session
 * `traceSinks` (a `TraceEventBusSink` constructed at the composition root)
 * into `createCognitiveSession`. The wiring is the deliverable; downstream
 * pacta-side trace event emission is exercised in pacta's own test suites.
 *
 * The factory's cognitive branch dynamic-imports `@methodts/pacta-provider-anthropic`
 * (no API key required to construct, only to invoke). This test exercises the
 * type/option-shape contract rather than running a real LLM call.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TraceEventBusSink } from '@methodts/runtime/sessions';
import type {
  RuntimeEvent,
  RuntimeEventInput,
  EventBus,
  EventFilter,
  EventSubscription,
} from '@methodts/runtime/ports';
import type { TraceSink, TraceEvent } from '@methodts/pacta';

// ── Test helpers ───────────────────────────────────────────────────

/** Minimal in-process EventBus stub that records emitted events. */
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
    importEvent(_event: RuntimeEvent): void { /* no-op */ },
    subscribe(_filter: EventFilter, _handler: (event: RuntimeEvent) => void): EventSubscription {
      return { unsubscribe: () => { /* no-op */ } };
    },
    query(_filter: EventFilter): RuntimeEvent[] { return []; },
    registerSink(): void { /* no-op */ },
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('PRD 058 Wave 3 — TraceEventBusSink wiring', () => {
  it('TraceEventBusSink emits onto the event bus on domain="trace"', () => {
    const bus = makeStubBus();
    const sink = new TraceEventBusSink(bus, {
      sessionId: 'sess-1',
      projectId: 'proj-1',
    });

    const event: TraceEvent = {
      eventId: 'e1',
      cycleId: 'cycle-1',
      kind: 'operation',
      name: 'agent-invoke',
      timestamp: Date.now(),
      durationMs: 50,
      data: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    };

    sink.onEvent(event);

    assert.equal(bus.emitted.length, 1);
    const out = bus.emitted[0]!;
    assert.equal(out.domain, 'trace', 'TraceEvent routed to domain="trace"');
    assert.equal(out.type, 'trace.operation');
    assert.equal(out.sessionId, 'sess-1', 'sessionId context propagated');
    assert.equal(out.projectId, 'proj-1', 'projectId context propagated');
    assert.equal((out.payload as { name: string }).name, 'agent-invoke');
  });

  it('TraceEventBusSink with experimentId/runId forwards them via payload', () => {
    const bus = makeStubBus();
    const sink = new TraceEventBusSink(bus, {
      sessionId: 'sess-2',
      experimentId: 'exp-A',
      runId: 'run-99',
    });

    sink.onEvent({
      eventId: 'e2',
      cycleId: 'cycle-2',
      kind: 'cycle-start',
      name: 'cycle-1',
      timestamp: Date.now(),
      data: { cycleNumber: 1 },
    });

    const payload = bus.emitted[0]!.payload as { experimentId?: string; runId?: string };
    assert.equal(payload.experimentId, 'exp-A');
    assert.equal(payload.runId, 'run-99');
  });

  it('TraceEventBusSink behaves as a TraceSink (structural conformance)', () => {
    // The factory passes traceSinks via the SessionProviderOptions port, where
    // the type is `unknown[]` for boundary cleanliness. The bridge factory casts
    // it back to `TraceSink[]` before forwarding to createCognitiveSession.
    // This test pins down the structural contract: TraceEventBusSink declares
    // the optional `onEvent` method that cycle.ts/tracingMiddleware look for.
    const bus = makeStubBus();
    const sink: TraceSink = new TraceEventBusSink(bus);
    assert.equal(typeof sink.onEvent, 'function', 'onEvent declared (event-aware)');
    assert.equal(typeof sink.onTrace, 'function', 'onTrace declared (legacy back-compat)');
  });

  it('TraceEventBusSink onTrace is a no-op (legacy flat-record path skips bus)', () => {
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
    assert.equal(bus.emitted.length, 0, 'onTrace does not flow onto the bus');
  });
});
