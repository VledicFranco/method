// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for diagnostic helpers — PRD 059.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeModule,
  describeSignals,
  describeWorkspace,
  diffStates,
  signalSummary,
  describeTrace,
} from './diagnostics.js';
import type { CognitiveModule, MonitoringSignal, WorkspaceEntry } from '@methodts/pacta';
import { moduleId } from '@methodts/pacta';

class FakeObserverState {
  callCount = 0;
}

class FakeObserver implements CognitiveModule<string, string, FakeObserverState, MonitoringSignal, never> {
  readonly id = moduleId('observer');
  initialState(): FakeObserverState {
    return new FakeObserverState();
  }
  async step(_input: string, state: FakeObserverState): Promise<never> {
    return { output: 'ok', state, monitoring: { source: this.id, timestamp: 0 } } as unknown as never;
  }
}

describe('describeModule', () => {
  it('returns a one-line summary with id, class, state', () => {
    const out = describeModule(new FakeObserver() as never);
    assert.match(out, /^Module\(/);
    assert.match(out, /id='observer'/);
    assert.match(out, /class=FakeObserver/);
    assert.match(out, /state=FakeObserverState/);
  });
});

describe('describeSignals', () => {
  it('returns "(no signals)" when empty', () => {
    assert.equal(describeSignals([]), '(no signals)');
  });

  it('lists each signal with index, type, source, severity', () => {
    const sigs: MonitoringSignal[] = [
      { source: moduleId('observer'), timestamp: 0, type: 'observer-saw', severity: 0.4, novelty: 0.7 } as never,
      { source: moduleId('reasoner'), timestamp: 1, type: 'confidence-low', severity: 0.65 } as never,
    ];
    const out = describeSignals(sigs);
    assert.match(out, /^2 signal\(s\):/);
    assert.match(out, /\[0\] observer-saw from 'observer' severity=0\.40/);
    assert.match(out, /\[1\] confidence-low from 'reasoner' severity=0\.65/);
  });

  it('emits unknown for signals without a type discriminator', () => {
    const sigs: MonitoringSignal[] = [{ source: moduleId('x'), timestamp: 0 } as never];
    assert.match(describeSignals(sigs), /unknown from 'x'/);
  });
});

describe('describeWorkspace', () => {
  it('returns header + (empty) for empty workspace', () => {
    const out = describeWorkspace({ snapshot: () => [] });
    assert.match(out, /^Workspace\(size=0\)/);
    assert.match(out, /\(empty\)/);
  });

  it('sorts by salience desc and limits output to N entries', () => {
    const entries: WorkspaceEntry[] = [
      { source: moduleId('a'), content: 'A', salience: 0.1 } as unknown as WorkspaceEntry,
      { source: moduleId('b'), content: 'B', salience: 0.9 } as unknown as WorkspaceEntry,
      { source: moduleId('c'), content: 'C', salience: 0.5 } as unknown as WorkspaceEntry,
      { source: moduleId('d'), content: 'D', salience: 0.7 } as unknown as WorkspaceEntry,
    ];
    const out = describeWorkspace({ snapshot: () => entries }, 2);
    // First entry shown should be highest salience (0.9 — "B")
    assert.match(out, /\[0\][^\n]+'b'.*B/);
    // Second is 0.7 — "D"
    assert.match(out, /\[1\][^\n]+'d'.*D/);
    // ... and a "more" footer
    assert.match(out, /\(2 more\)/);
  });

  it('respects a "pinned" entry marker', () => {
    const entries: WorkspaceEntry[] = [
      { source: moduleId('a'), content: 'A', salience: 0.5, pinned: true } as unknown as WorkspaceEntry,
    ];
    const out = describeWorkspace({ snapshot: () => entries });
    assert.match(out, /\[0\]\*/);
  });
});

describe('diffStates', () => {
  it('returns empty record for identical objects', () => {
    assert.deepEqual(diffStates({ a: 1, b: 'x' }, { a: 1, b: 'x' }), {});
  });

  it('reports per-key [before, after] for changed fields', () => {
    const out = diffStates({ a: 1, b: 'x', c: true }, { a: 2, b: 'x', c: false });
    assert.deepEqual(out.a, [1, 2]);
    assert.equal(out.b, undefined);
    assert.deepEqual(out.c, [true, false]);
  });

  it('handles added/removed keys', () => {
    const out = diffStates({ a: 1 }, { a: 1, b: 2 });
    assert.deepEqual(out.b, [undefined, 2]);
  });

  it('falls back to _value for non-object differences', () => {
    const out = diffStates(5 as unknown as object, 7 as unknown as object);
    assert.deepEqual(out._value, [5, 7]);
  });
});

describe('signalSummary', () => {
  it('counts signals by type across multiple traces', () => {
    const a: MonitoringSignal[] = [{ source: moduleId('o'), timestamp: 0, type: 'x' } as never, { source: moduleId('o'), timestamp: 1, type: 'y' } as never];
    const b: MonitoringSignal[] = [{ source: moduleId('o'), timestamp: 2, type: 'x' } as never];
    const traces = [{ signals: a }, { signals: b }];
    const out = signalSummary(traces);
    assert.equal(out.get('x'), 2);
    assert.equal(out.get('y'), 1);
  });
});

describe('describeTrace', () => {
  it('formats a one-line summary', () => {
    const out = describeTrace({
      cycle: 3,
      input: 'in',
      output: 'out',
      signals: [],
      durationMs: 12.45,
    });
    assert.match(out, /^Cycle\[3\] \(12\.45ms\) ok/);
    assert.match(out, /signals=0/);
  });

  it('shows ERROR when error is set', () => {
    const out = describeTrace({
      cycle: 0,
      input: 'in',
      output: undefined,
      signals: [],
      durationMs: 5,
      error: 'bang',
    });
    assert.match(out, /ERROR: bang/);
  });
});
