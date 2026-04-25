// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for TraceAssembler — PRD 058 C-1.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TraceAssembler } from './assembler.js';
import type { TraceEvent } from '../algebra/trace-events.js';

const T0 = 1_700_000_000_000;

function ev(overrides: Partial<TraceEvent> & Pick<TraceEvent, 'kind' | 'name' | 'cycleId'>): TraceEvent {
  return {
    eventId: overrides.eventId ?? `ev-${Math.random().toString(36).slice(2, 10)}`,
    cycleId: overrides.cycleId,
    kind: overrides.kind,
    name: overrides.name,
    timestamp: overrides.timestamp ?? T0,
    durationMs: overrides.durationMs,
    phase: overrides.phase,
    data: overrides.data,
    signals: overrides.signals,
  };
}

describe('TraceAssembler', () => {
  it('returns null until cycle-end is fed', () => {
    const a = new TraceAssembler();
    const cycleId = 'c1';
    assert.equal(
      a.feed(ev({ cycleId, kind: 'cycle-start', name: 'cycle-1', timestamp: T0 })),
      null,
    );
    assert.equal(
      a.feed(ev({ cycleId, kind: 'phase-start', name: 'observe', phase: 'observe', timestamp: T0 + 1 })),
      null,
    );
    assert.equal(
      a.feed(ev({ cycleId, kind: 'phase-end', name: 'observe', phase: 'observe', timestamp: T0 + 5, durationMs: 4 })),
      null,
    );
    const trace = a.feed(ev({ cycleId, kind: 'cycle-end', name: 'cycle-1', timestamp: T0 + 10, durationMs: 10 }));
    assert.notEqual(trace, null);
  });

  it('produces a structurally correct CycleTrace round-trip (AC-2)', () => {
    const a = new TraceAssembler();
    const cycleId = 'c-round-trip';
    a.feed(ev({
      cycleId,
      kind: 'cycle-start',
      name: 'cycle-3',
      timestamp: T0,
      data: { inputText: 'hello world', cycleNumber: 3 },
    }));

    a.feed(ev({ cycleId, kind: 'phase-start', name: 'observe', phase: 'observe', timestamp: T0 + 1 }));
    a.feed(ev({
      cycleId,
      kind: 'operation',
      name: 'llm-complete',
      phase: 'observe',
      timestamp: T0 + 2,
      durationMs: 150,
      data: { operation: 'llm-complete', inputTokens: 50, outputTokens: 30, model: 'sonnet-4.6' },
    }));
    a.feed(ev({
      cycleId,
      kind: 'phase-end',
      name: 'observe',
      phase: 'observe',
      timestamp: T0 + 200,
      durationMs: 199,
      data: { outputSummary: 'observed user wave' },
    }));

    a.feed(ev({ cycleId, kind: 'phase-start', name: 'reason', phase: 'reason', timestamp: T0 + 201 }));
    a.feed(ev({
      cycleId,
      kind: 'phase-end',
      name: 'reason',
      phase: 'reason',
      timestamp: T0 + 500,
      durationMs: 299,
      data: { outputSummary: 'plan formed' },
    }));

    const trace = a.feed(ev({
      cycleId,
      kind: 'cycle-end',
      name: 'cycle-3',
      timestamp: T0 + 510,
      durationMs: 510,
      data: { outputText: 'done' },
    }));
    assert.notEqual(trace, null);
    if (!trace) return;

    assert.equal(trace.cycleId, cycleId);
    assert.equal(trace.cycleNumber, 3);
    assert.equal(trace.startedAt, T0);
    assert.equal(trace.endedAt, T0 + 510);
    assert.equal(trace.durationMs, 510);
    assert.equal(trace.inputText, 'hello world');
    assert.equal(trace.outputText, 'done');
    assert.equal(trace.phases.length, 2);

    const observe = trace.phases[0]!;
    assert.equal(observe.phase, 'observe');
    assert.equal(observe.outputSummary, 'observed user wave');
    assert.equal(observe.operations.length, 1);
    assert.equal(observe.operations[0]!.operation, 'llm-complete');
    assert.equal(observe.operations[0]!.durationMs, 150);

    const reason = trace.phases[1]!;
    assert.equal(reason.phase, 'reason');
    assert.equal(reason.operations.length, 0);

    // Token usage aggregated from operation metadata.
    assert.notEqual(trace.tokenUsage, undefined);
    assert.equal(trace.tokenUsage?.inputTokens, 50);
    assert.equal(trace.tokenUsage?.outputTokens, 30);
  });

  it('degrades gracefully when cycle-start is missing (AC-2 partial)', () => {
    const a = new TraceAssembler();
    const cycleId = 'c-partial';
    a.feed(ev({ cycleId, kind: 'phase-start', name: 'reason', phase: 'reason', timestamp: T0 + 100 }));
    a.feed(ev({
      cycleId,
      kind: 'phase-end',
      name: 'reason',
      phase: 'reason',
      timestamp: T0 + 200,
      durationMs: 100,
    }));
    const trace = a.feed(ev({
      cycleId,
      kind: 'cycle-end',
      name: 'cycle-x',
      timestamp: T0 + 250,
      durationMs: 250,
    }));
    assert.notEqual(trace, null);
    if (!trace) return;

    // Falls back to first event's timestamp as startedAt.
    assert.equal(trace.startedAt, T0 + 100);
    assert.equal(trace.endedAt, T0 + 250);
    assert.equal(trace.cycleNumber, 0); // no cycleNumber in data
    assert.equal(trace.inputText, ''); // no inputText
    assert.equal(trace.phases.length, 1);
  });

  it('separates events by cycleId — interleaved cycles do not bleed', () => {
    const a = new TraceAssembler();
    a.feed(ev({ cycleId: 'A', kind: 'cycle-start', name: 'A', timestamp: T0 }));
    a.feed(ev({ cycleId: 'B', kind: 'cycle-start', name: 'B', timestamp: T0 + 1 }));
    a.feed(ev({ cycleId: 'A', kind: 'phase-start', name: 'p', phase: 'p', timestamp: T0 + 2 }));
    a.feed(ev({ cycleId: 'B', kind: 'phase-start', name: 'p', phase: 'p', timestamp: T0 + 3 }));
    a.feed(ev({ cycleId: 'A', kind: 'phase-end', name: 'p', phase: 'p', timestamp: T0 + 5, durationMs: 3 }));

    const aTrace = a.feed(ev({ cycleId: 'A', kind: 'cycle-end', name: 'A', timestamp: T0 + 6, durationMs: 6 }));
    assert.notEqual(aTrace, null);
    assert.equal(aTrace?.cycleId, 'A');
    assert.equal(aTrace?.phases.length, 1);

    // Cycle B is still pending.
    assert.deepEqual(a.pendingCycleIds().slice().sort(), ['B']);

    // Finish B.
    a.feed(ev({ cycleId: 'B', kind: 'phase-end', name: 'p', phase: 'p', timestamp: T0 + 10, durationMs: 7 }));
    const bTrace = a.feed(ev({ cycleId: 'B', kind: 'cycle-end', name: 'B', timestamp: T0 + 11, durationMs: 10 }));
    assert.equal(bTrace?.cycleId, 'B');
    assert.deepEqual(a.pendingCycleIds(), []);
  });

  it('preserves phase order in assembled CycleTrace', () => {
    const a = new TraceAssembler();
    const cycleId = 'c-order';
    a.feed(ev({ cycleId, kind: 'cycle-start', name: 'x', timestamp: T0 }));
    const phases = ['observe', 'attend', 'reason', 'act'];
    let t = T0 + 1;
    for (const p of phases) {
      a.feed(ev({ cycleId, kind: 'phase-start', name: p, phase: p, timestamp: t++ }));
      a.feed(ev({ cycleId, kind: 'phase-end', name: p, phase: p, timestamp: t++, durationMs: 1 }));
    }
    const trace = a.feed(ev({ cycleId, kind: 'cycle-end', name: 'x', timestamp: t, durationMs: t - T0 }));
    assert.deepEqual(
      trace?.phases.map((p) => p.phase),
      phases,
    );
  });
});
