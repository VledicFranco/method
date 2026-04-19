// SPDX-License-Identifier: Apache-2.0
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type {
  MonitoringSignal,
  ControlDirective,
  ModuleId,
  StepResult,
} from '@methodts/pacta';
import { moduleId } from '@methodts/pacta';
import { RecordingModule } from './recording-module.js';

// ── Helpers ─────────────────────────────────────────────────────

interface TestInput { content: string }
interface TestOutput { result: string }
interface TestState { count: number }

interface TestMonitoring extends MonitoringSignal {
  type: 'test';
  confidence: number;
}

interface TestControl extends ControlDirective {
  strategy: string;
}

function makeMonitoring(source: ModuleId, confidence = 0.9): TestMonitoring {
  return {
    source,
    timestamp: Date.now(),
    type: 'test',
    confidence,
  };
}

function makeControl(target: ModuleId, strategy = 'default'): TestControl {
  return {
    target,
    timestamp: Date.now(),
    strategy,
  };
}

function makeStepResult(
  source: ModuleId,
  output: string,
  count: number,
  confidence = 0.9,
): StepResult<TestOutput, TestState, TestMonitoring> {
  return {
    output: { result: output },
    state: { count },
    monitoring: makeMonitoring(source, confidence),
  };
}

// ── Tests ───────────────────────────────────────────────────────

describe('RecordingModule', () => {
  const testId = moduleId('test-recorder');
  let mod: RecordingModule<TestInput, TestOutput, TestState, TestMonitoring, TestControl>;

  beforeEach(() => {
    mod = new RecordingModule(testId, { count: 0 });
  });

  // Scenario 1: captures step invocations
  it('captures step invocations with input, state, and control', async () => {
    mod.setDefaultResult(makeStepResult(testId, 'ok', 1));

    const input: TestInput = { content: 'hello' };
    const state: TestState = { count: 0 };
    const control = makeControl(testId, 'cot');

    await mod.step(input, state, control);

    assert.equal(mod.stepCount, 1);
    assert.equal(mod.invocations.length, 1);

    const inv = mod.invocations[0];
    assert.deepEqual(inv.input, { content: 'hello' });
    assert.deepEqual(inv.state, { count: 0 });
    assert.equal(inv.control.strategy, 'cot');
    assert.equal(inv.control.target, testId);
  });

  // Scenario 2: scripted responses play back in FIFO order
  it('plays back scripted responses in FIFO order', async () => {
    const first = makeStepResult(testId, 'first', 1, 0.8);
    const second = makeStepResult(testId, 'second', 2, 0.95);

    mod.addStepResponse(first);
    mod.addStepResponse(second);

    const control = makeControl(testId);
    const state: TestState = { count: 0 };
    const input: TestInput = { content: 'query' };

    const r1 = await mod.step(input, state, control);
    const r2 = await mod.step(input, state, control);

    assert.equal(r1.output.result, 'first');
    assert.equal(r1.state.count, 1);
    assert.equal(r1.monitoring.confidence, 0.8);

    assert.equal(r2.output.result, 'second');
    assert.equal(r2.state.count, 2);
    assert.equal(r2.monitoring.confidence, 0.95);

    assert.equal(mod.stepCount, 2);
  });

  // Scenario 3: records monitoring signals from returned results
  it('records monitoring signals emitted via returnedSignals', async () => {
    const lowConfidence = makeStepResult(testId, 'uncertain', 1, 0.3);
    const highConfidence = makeStepResult(testId, 'certain', 2, 0.99);

    mod.addStepResponse(lowConfidence);
    mod.addStepResponse(highConfidence);

    const control = makeControl(testId);
    const state: TestState = { count: 0 };
    const input: TestInput = { content: 'test' };

    await mod.step(input, state, control);
    await mod.step(input, state, control);

    assert.equal(mod.returnedSignals.length, 2);
    assert.equal(mod.returnedSignals[0].confidence, 0.3);
    assert.equal(mod.returnedSignals[1].confidence, 0.99);

    // Verify signals are inspectable via type
    const lowSignals = mod.returnedSignals.filter(s => s.confidence < 0.5);
    assert.equal(lowSignals.length, 1);
  });

  it('uses default result when scripted queue is empty', async () => {
    mod.setDefaultResult(makeStepResult(testId, 'default', 0));

    const control = makeControl(testId);
    const r = await mod.step({ content: 'x' }, { count: 0 }, control);

    assert.equal(r.output.result, 'default');
  });

  it('throws when no response is available', async () => {
    const control = makeControl(testId);
    await assert.rejects(
      () => mod.step({ content: 'x' }, { count: 0 }, control),
      /no scripted response/,
    );
  });

  it('returns initial state', () => {
    assert.deepEqual(mod.initialState(), { count: 0 });
  });

  it('has correct id', () => {
    assert.equal(mod.id, testId);
  });
});
