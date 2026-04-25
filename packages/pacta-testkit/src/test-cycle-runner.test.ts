// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for TestCycleRunner — PRD 059.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TestCycleRunner } from './test-cycle-runner.js';
import type {
  CognitiveModule,
  ControlDirective,
  MonitoringSignal,
  StepResult,
} from '@methodts/pacta';
import { moduleId } from '@methodts/pacta';

interface CounterState {
  count: number;
}

class CounterModule
  implements CognitiveModule<string, string, CounterState, MonitoringSignal, ControlDirective>
{
  readonly id = moduleId('counter');
  private signalType: string;
  private throwOnInput?: string;
  constructor(signalType = 'count-incremented', throwOnInput?: string) {
    this.signalType = signalType;
    this.throwOnInput = throwOnInput;
  }
  initialState(): CounterState {
    return { count: 0 };
  }
  async step(
    input: string,
    state: CounterState,
    _control: ControlDirective,
  ): Promise<StepResult<string, CounterState, MonitoringSignal>> {
    if (this.throwOnInput && input === this.throwOnInput) {
      throw new Error('boom');
    }
    return {
      output: `${input}-#${state.count + 1}`,
      state: { count: state.count + 1 },
      monitoring: {
        source: this.id,
        timestamp: Date.now(),
        type: this.signalType,
      } as MonitoringSignal,
    };
  }
}

describe('TestCycleRunner', () => {
  it('runs N cycles, threading state, returning collected traces', async () => {
    const r = new TestCycleRunner(new CounterModule());
    const traces = await r.run(['a', 'b', 'c']);
    assert.equal(traces.length, 3);
    assert.equal(traces[0]!.output, 'a-#1');
    assert.equal(traces[1]!.output, 'b-#2');
    assert.equal(traces[2]!.output, 'c-#3');
    assert.equal(r.currentState.count, 3);
  });

  it('stores all traces accessible via .traces', async () => {
    const r = new TestCycleRunner(new CounterModule());
    await r.run(['x', 'y']);
    assert.equal(r.traces.length, 2);
  });

  it('runSingle records before/after state', async () => {
    const r = new TestCycleRunner(new CounterModule());
    const t = await r.runSingle('hi');
    assert.deepEqual(t.stateBefore, { count: 0 });
    assert.deepEqual(t.stateAfter, { count: 1 });
  });

  it('captures errors as trace.error without throwing', async () => {
    const r = new TestCycleRunner(new CounterModule('s', 'fail'));
    const t = await r.runSingle('fail');
    assert.match(t.error ?? '', /boom/);
    // After error, state is unchanged from before.
    assert.deepEqual(r.currentState, { count: 0 });
    assert.equal(t.output, undefined);
  });

  it('lastSignal returns most recent signal of the given type', async () => {
    const r = new TestCycleRunner(new CounterModule('count-incremented'));
    await r.run(['a', 'b', 'c']);
    const last = r.lastSignal('count-incremented');
    assert.notEqual(last, undefined);
    assert.equal(r.lastSignal('not-a-real-type'), undefined);
  });

  it('countSignals counts across all traces', async () => {
    const r = new TestCycleRunner(new CounterModule('s'));
    await r.run(['a', 'b', 'c', 'd']);
    assert.equal(r.countSignals('s'), 4);
    assert.equal(r.countSignals('other'), 0);
  });

  it('allSignals returns signals in order across all cycles', async () => {
    const r = new TestCycleRunner(new CounterModule('s'));
    await r.run(['a', 'b']);
    const all = r.allSignals();
    assert.equal(all.length, 2);
  });

  it('reset clears traces and restores initial state', async () => {
    const r = new TestCycleRunner(new CounterModule());
    await r.run(['a', 'b', 'c']);
    assert.equal(r.traces.length, 3);
    r.reset();
    assert.equal(r.traces.length, 0);
    assert.deepEqual(r.currentState, { count: 0 });
  });
});
