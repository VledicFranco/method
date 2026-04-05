/**
 * Pipeline execution engine tests — uses mocked stages and gates.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { executePipeline } from '../pipeline.js';
import type {
  StagePort,
  GatePort,
  PipelineDefinition,
  StageInput,
  StageOutput,
  GateInput,
  GateResult,
} from '../types.js';

// ── Mock helpers ─────────────────────────────────────────────

function mockStage(
  id: string,
  transform: (data: string) => string = (d) => `[${id}:${d}]`,
  type: 'slm' | 'deterministic' = 'slm',
): StagePort {
  return {
    id,
    type,
    async execute(input: StageInput): Promise<StageOutput> {
      return {
        data: transform(input.data),
        confidence: 0.95,
        latencyMs: 10,
      };
    },
  };
}

function mockGate(id: string, passes: boolean = true): GatePort {
  return {
    id,
    async validate(_input: GateInput): Promise<GateResult> {
      return passes
        ? { pass: true, validatedData: undefined }
        : { pass: false, reason: `${id} failed` };
    },
  };
}

/** Gate that fails N times then passes. */
function mockRetryGate(id: string, failCount: number): GatePort {
  let attempts = 0;
  return {
    id,
    async validate(_input: GateInput): Promise<GateResult> {
      attempts++;
      if (attempts <= failCount) {
        return { pass: false, reason: `${id} failed attempt ${attempts}` };
      }
      return { pass: true };
    },
  };
}

/** Stage that returns different output each call (for retry testing). */
function mockVariableStage(id: string): StagePort {
  let callCount = 0;
  return {
    id,
    type: 'slm',
    async execute(input: StageInput): Promise<StageOutput> {
      callCount++;
      return {
        data: `${input.data}-attempt${callCount}`,
        confidence: 0.9,
        latencyMs: 5,
      };
    },
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('executePipeline', () => {

  it('runs a simple 2-stage pipeline with passing gates', async () => {
    const pipeline: PipelineDefinition = {
      id: 'simple',
      stages: [
        { type: 'stage', stage: mockStage('s1') },
        { type: 'gate', gate: mockGate('g1'), onFail: { maxRetries: 0, escalation: 'abort' } },
        { type: 'stage', stage: mockStage('s2') },
        { type: 'gate', gate: mockGate('g2'), onFail: { maxRetries: 0, escalation: 'abort' } },
      ],
    };

    const result = await executePipeline(pipeline, 'input');
    assert.equal(result.success, true);
    assert.equal(result.data, '[s2:[s1:input]]');
    assert.equal(result.metrics.endToEndSuccess, true);
    assert.equal(result.metrics.gatePassRate, 1.0);
  });

  it('aborts when gate fails and escalation is abort', async () => {
    const pipeline: PipelineDefinition = {
      id: 'abort-test',
      stages: [
        { type: 'stage', stage: mockStage('s1') },
        { type: 'gate', gate: mockGate('g1', false), onFail: { maxRetries: 0, escalation: 'abort' } },
        { type: 'stage', stage: mockStage('s2') },
      ],
    };

    const result = await executePipeline(pipeline, 'input');
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('g1 failed'));
  });

  it('skips when gate fails and escalation is skip', async () => {
    const pipeline: PipelineDefinition = {
      id: 'skip-test',
      stages: [
        { type: 'stage', stage: mockStage('s1') },
        { type: 'gate', gate: mockGate('g1', false), onFail: { maxRetries: 0, escalation: 'skip' } },
        { type: 'stage', stage: mockStage('s2') },
      ],
    };

    const result = await executePipeline(pipeline, 'input');
    assert.equal(result.success, true);
    // s2 should still run on s1's output despite gate failure
    assert.equal(result.data, '[s2:[s1:input]]');
  });

  it('retries and succeeds when gate fails then passes', async () => {
    const pipeline: PipelineDefinition = {
      id: 'retry-test',
      stages: [
        { type: 'stage', stage: mockVariableStage('s1') },
        {
          type: 'gate',
          gate: mockRetryGate('g1', 1), // fails once, then passes
          onFail: { maxRetries: 2, escalation: 'abort' },
        },
      ],
    };

    const result = await executePipeline(pipeline, 'data');
    assert.equal(result.success, true);
  });

  it('records correct metrics for multi-stage pipeline', async () => {
    const pipeline: PipelineDefinition = {
      id: 'metrics-test',
      stages: [
        { type: 'stage', stage: mockStage('s1') },
        { type: 'gate', gate: mockGate('g1'), onFail: { maxRetries: 0, escalation: 'abort' } },
        { type: 'stage', stage: mockStage('s2') },
        { type: 'gate', gate: mockGate('g2'), onFail: { maxRetries: 0, escalation: 'abort' } },
        { type: 'stage', stage: mockStage('s3') },
      ],
    };

    const result = await executePipeline(pipeline, 'x');
    assert.equal(result.metrics.stages.length, 3); // s1, s2, s3
    assert.equal(result.metrics.gates.length, 2); // g1, g2
    assert.equal(result.metrics.gatePassRate, 1.0);
    assert.equal(result.metrics.escalationRate, 0);
    assert.ok(result.metrics.totalLatencyMs > 0);
  });

  it('handles stage execution error gracefully', async () => {
    const errorStage: StagePort = {
      id: 'error-stage',
      type: 'slm',
      async execute(): Promise<StageOutput> {
        throw new Error('Model server unreachable');
      },
    };

    const pipeline: PipelineDefinition = {
      id: 'error-test',
      stages: [{ type: 'stage', stage: errorStage }],
    };

    const result = await executePipeline(pipeline, 'input');
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('Model server unreachable'));
  });

  it('propagates context through stages', async () => {
    const contextCapture: string[] = [];

    const capturingStage: StagePort = {
      id: 'ctx-stage',
      type: 'deterministic',
      async execute(input: StageInput): Promise<StageOutput> {
        contextCapture.push(input.context.pipelineId);
        contextCapture.push(input.context.originalInput);
        return { data: input.data, confidence: 1.0, latencyMs: 0 };
      },
    };

    const pipeline: PipelineDefinition = {
      id: 'ctx-pipeline',
      stages: [{ type: 'stage', stage: capturingStage }],
    };

    await executePipeline(pipeline, 'original-data');
    assert.deepEqual(contextCapture, ['ctx-pipeline', 'original-data']);
  });

  it('runs single stage pipeline with no gates', async () => {
    const pipeline: PipelineDefinition = {
      id: 'no-gates',
      stages: [{ type: 'stage', stage: mockStage('only') }],
    };

    const result = await executePipeline(pipeline, 'in');
    assert.equal(result.success, true);
    assert.equal(result.data, '[only:in]');
    assert.equal(result.metrics.gates.length, 0);
    assert.equal(result.metrics.gatePassRate, 1.0);
  });

  it('gate state propagates to subsequent stages', async () => {
    const stateGate: GatePort = {
      id: 'state-gate',
      async validate(_input: GateInput): Promise<GateResult> {
        return {
          pass: true,
          stateUpdates: new Map([['myKey', 'myValue']]),
        };
      },
    };

    let capturedState: ReadonlyMap<string, unknown> | undefined;
    const stateReader: StagePort = {
      id: 'state-reader',
      type: 'deterministic',
      async execute(input: StageInput): Promise<StageOutput> {
        capturedState = input.context.state;
        return { data: input.data, confidence: 1.0, latencyMs: 0 };
      },
    };

    const pipeline: PipelineDefinition = {
      id: 'state-test',
      stages: [
        { type: 'stage', stage: mockStage('s1') },
        { type: 'gate', gate: stateGate, onFail: { maxRetries: 0, escalation: 'abort' } },
        { type: 'stage', stage: stateReader },
      ],
    };

    await executePipeline(pipeline, 'x');
    assert.ok(capturedState);
    assert.equal(capturedState.get('myKey'), 'myValue');
  });
});
