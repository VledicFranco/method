// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for CascadeProvider — PRD 057 C-1.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CascadeProvider, confidenceAbove, type CascadeTier } from './cascade.js';
import type { AgentProvider, ProviderCapabilities } from '../../ports/agent-provider.js';
import type { Pact, AgentRequest, AgentResult } from '../../pact.js';

class StubProvider implements AgentProvider {
  public invocations = 0;
  constructor(
    public readonly name: string,
    private readonly result: Partial<AgentResult<unknown>>,
    private readonly throwError?: Error,
  ) {}
  capabilities(): ProviderCapabilities {
    return {
      modes: ['oneshot'],
      streaming: false,
      resumable: false,
      budgetEnforcement: 'none',
      outputValidation: 'none',
      toolModel: 'none',
    };
  }
  async invoke<T>(_pact: Pact<T>, _request: AgentRequest): Promise<AgentResult<T>> {
    this.invocations++;
    if (this.throwError) throw this.throwError;
    return {
      output: this.result.output as T,
      sessionId: this.result.sessionId ?? '',
      completed: this.result.completed ?? true,
      stopReason: this.result.stopReason ?? 'complete',
      usage: this.result.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 },
      cost: this.result.cost ?? { totalUsd: 0, perModel: {} },
      durationMs: this.result.durationMs ?? 0,
      turns: this.result.turns ?? 1,
      confidence: this.result.confidence,
    };
  }
}

const pact = {} as Pact<unknown>;
const request: AgentRequest = { prompt: 'hi' };

describe('CascadeProvider', () => {
  it('throws when constructed with zero tiers', () => {
    assert.throws(() => new CascadeProvider([]), /at least one tier/);
  });

  it('throws on duplicate tier names', () => {
    const a = new StubProvider('a', {});
    const tiers: CascadeTier[] = [
      { name: 'dup', provider: a },
      { name: 'dup', provider: a },
    ];
    assert.throws(() => new CascadeProvider(tiers), /Duplicate tier name/);
  });

  it('first tier accept=undefined → always handles', async () => {
    const slm = new StubProvider('slm', { output: 'slm-out', confidence: 0.9 });
    const frontier = new StubProvider('frontier', { output: 'frontier-out' });
    const cascade = new CascadeProvider([
      { name: 'slm', provider: slm }, // accept undefined => always
      { name: 'frontier', provider: frontier },
    ]);
    const result = await cascade.invoke(pact, request);
    assert.equal(result.output, 'slm-out');
    assert.equal(slm.invocations, 1);
    assert.equal(frontier.invocations, 0);
  });

  it('confidence-gated: SLM accepts when confidence >= threshold', async () => {
    const slm = new StubProvider('slm', { output: 'slm', confidence: 0.85 });
    const frontier = new StubProvider('frontier', { output: 'frontier' });
    const cascade = new CascadeProvider([
      { name: 'slm', provider: slm, accept: confidenceAbove(0.7) },
      { name: 'frontier', provider: frontier },
    ]);
    const result = await cascade.invoke(pact, request);
    assert.equal(result.output, 'slm');
    assert.equal(frontier.invocations, 0);
  });

  it('confidence-gated: SLM escalates to frontier when confidence < threshold', async () => {
    const slm = new StubProvider('slm', { output: 'slm', confidence: 0.3 });
    const frontier = new StubProvider('frontier', { output: 'frontier' });
    const cascade = new CascadeProvider([
      { name: 'slm', provider: slm, accept: confidenceAbove(0.7) },
      { name: 'frontier', provider: frontier },
    ]);
    const result = await cascade.invoke(pact, request);
    assert.equal(result.output, 'frontier');
    assert.equal(slm.invocations, 1);
    assert.equal(frontier.invocations, 1);
  });

  it('confidence-gated: SLM with confidence=undefined always escalates', async () => {
    const slm = new StubProvider('slm', { output: 'slm' /* no confidence */ });
    const frontier = new StubProvider('frontier', { output: 'frontier' });
    const cascade = new CascadeProvider([
      { name: 'slm', provider: slm, accept: confidenceAbove(0.5) },
      { name: 'frontier', provider: frontier },
    ]);
    const result = await cascade.invoke(pact, request);
    assert.equal(result.output, 'frontier');
  });

  it('escalates past throwing tier and uses next tier', async () => {
    const slm = new StubProvider('slm', {}, new Error('SLM down'));
    const frontier = new StubProvider('frontier', { output: 'frontier' });
    const cascade = new CascadeProvider([
      { name: 'slm', provider: slm, accept: confidenceAbove(0.5) },
      { name: 'frontier', provider: frontier },
    ]);
    const result = await cascade.invoke(pact, request);
    assert.equal(result.output, 'frontier');
  });

  it('rethrows last error when every tier fails', async () => {
    const a = new StubProvider('a', {}, new Error('a-down'));
    const b = new StubProvider('b', {}, new Error('b-down'));
    const cascade = new CascadeProvider([
      { name: 'a', provider: a },
      { name: 'b', provider: b },
    ]);
    await assert.rejects(() => cascade.invoke(pact, request), /b-down/);
  });

  it('terminal tier without accept counts as accepted in metrics', async () => {
    const slm = new StubProvider('slm', { output: 'slm', confidence: 0.1 });
    const frontier = new StubProvider('frontier', { output: 'frontier' });
    const cascade = new CascadeProvider([
      { name: 'slm', provider: slm, accept: confidenceAbove(0.5) },
      { name: 'frontier', provider: frontier },
    ]);
    await cascade.invoke(pact, request);
    const metrics = cascade.metrics;
    assert.equal(metrics.perTier.get('slm')!.invocations, 1);
    assert.equal(metrics.perTier.get('slm')!.accepted, 0);
    assert.equal(metrics.perTier.get('frontier')!.accepted, 1);
  });

  it('metrics: per-tier invocations + accepted + avg confidence', async () => {
    const a = new StubProvider('a', { output: 'a', confidence: 0.8 });
    const b = new StubProvider('b', { output: 'b' });
    const cascade = new CascadeProvider([
      { name: 'a', provider: a, accept: confidenceAbove(0.7) },
      { name: 'b', provider: b },
    ]);
    await cascade.invoke(pact, request);
    await cascade.invoke(pact, request);
    const m = cascade.metrics;
    assert.equal(m.perTier.get('a')!.invocations, 2);
    assert.equal(m.perTier.get('a')!.accepted, 2);
    assert.equal(m.perTier.get('a')!.avgConfidence, 0.8);
    assert.equal(m.perTier.get('b')!.invocations, 0);
  });

  it('resetMetrics zeroes per-tier counters', async () => {
    const slm = new StubProvider('slm', { output: 'slm', confidence: 0.9 });
    const cascade = new CascadeProvider([{ name: 'slm', provider: slm }]);
    await cascade.invoke(pact, request);
    cascade.resetMetrics();
    assert.equal(cascade.metrics.perTier.get('slm')!.invocations, 0);
  });

  it('confidenceAbove rejects out-of-range thresholds', () => {
    assert.throws(() => confidenceAbove(-0.1), /must be in/);
    assert.throws(() => confidenceAbove(1.1), /must be in/);
    assert.throws(() => confidenceAbove(NaN), /must be in/);
  });

  it('capabilities exposes intersection of tier modes', () => {
    const a = new StubProvider('a', {});
    const b = new StubProvider('b', {});
    const cascade = new CascadeProvider([
      { name: 'a', provider: a },
      { name: 'b', provider: b },
    ]);
    const caps = cascade.capabilities();
    assert.deepEqual(caps.modes.sort(), ['oneshot']);
  });
});
