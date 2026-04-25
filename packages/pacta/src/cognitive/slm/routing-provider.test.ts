// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for RoutingProvider — PRD 057 Wave 3.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RoutingProvider } from './routing-provider.js';
import type { TierRouter } from '../../ports/tier-router.js';
import { TierRouterError } from '../../ports/tier-router.js';
import type { AgentProvider, ProviderCapabilities } from '../../ports/agent-provider.js';
import type { Pact, AgentRequest, AgentResult } from '../../pact.js';

class StubProvider implements AgentProvider {
  public invocations = 0;
  constructor(
    public readonly name: string,
    private readonly result: Partial<AgentResult<unknown>> = {},
    private readonly modes: ProviderCapabilities['modes'] = ['oneshot'],
  ) {}
  capabilities(): ProviderCapabilities {
    return {
      modes: this.modes,
      streaming: false,
      resumable: false,
      budgetEnforcement: 'none',
      outputValidation: 'none',
      toolModel: 'none',
    };
  }
  async invoke<T>(_pact: Pact<T>, _request: AgentRequest): Promise<AgentResult<T>> {
    this.invocations++;
    return {
      output: (this.result.output ?? 'out') as T,
      sessionId: '',
      completed: true,
      stopReason: 'complete',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 },
      cost: { totalUsd: 0, perModel: {} },
      durationMs: 0,
      turns: 1,
      confidence: this.result.confidence,
    };
  }
}

class StubRouter implements TierRouter {
  constructor(private readonly behavior: string | (() => string | Promise<string>) | Error) {}
  async select<T>(_pact: Pact<T>, _request: AgentRequest): Promise<string> {
    if (this.behavior instanceof Error) throw this.behavior;
    if (typeof this.behavior === 'function') return await this.behavior();
    return this.behavior;
  }
}

const pact = {} as Pact<unknown>;
const request: AgentRequest = { prompt: 'hi' };

describe('RoutingProvider', () => {
  it('throws on empty providers map', () => {
    const router = new StubRouter('a');
    assert.throws(
      () =>
        new RoutingProvider({
          router,
          providers: new Map(),
          defaultTier: 'a',
        }),
      /at least one provider/,
    );
  });

  it('throws when defaultTier is not in providers', () => {
    const a = new StubProvider('a');
    const router = new StubRouter('a');
    assert.throws(
      () =>
        new RoutingProvider({
          router,
          providers: new Map([['a', a]]),
          defaultTier: 'b',
        }),
      /defaultTier "b" is not in providers/,
    );
  });

  it('happy path: dispatches to the tier the router selects', async () => {
    const a = new StubProvider('a', { output: 'a-out' });
    const b = new StubProvider('b', { output: 'b-out' });
    const router = new StubRouter('b');
    const rp = new RoutingProvider({
      router,
      providers: new Map([
        ['a', a],
        ['b', b],
      ]),
      defaultTier: 'a',
    });
    const result = await rp.invoke(pact, request);
    assert.equal(result.output, 'b-out');
    assert.equal(a.invocations, 0);
    assert.equal(b.invocations, 1);
  });

  it('falls back to defaultTier on TierRouterError', async () => {
    const a = new StubProvider('a', { output: 'a-out' });
    const b = new StubProvider('b', { output: 'b-out' });
    const router = new StubRouter(new TierRouterError('cannot decide'));
    const rp = new RoutingProvider({
      router,
      providers: new Map([
        ['a', a],
        ['b', b],
      ]),
      defaultTier: 'a',
    });
    const result = await rp.invoke(pact, request);
    assert.equal(result.output, 'a-out');
    assert.equal(a.invocations, 1);
    assert.equal(b.invocations, 0);
    assert.equal(rp.metrics.defaultFallbacks, 1);
  });

  it('falls back to defaultTier on unknown tier name', async () => {
    const a = new StubProvider('a', { output: 'a-out' });
    const router = new StubRouter('does-not-exist');
    const rp = new RoutingProvider({
      router,
      providers: new Map([['a', a]]),
      defaultTier: 'a',
    });
    const result = await rp.invoke(pact, request);
    assert.equal(result.output, 'a-out');
    assert.equal(a.invocations, 1);
    assert.equal(rp.metrics.defaultFallbacks, 1);
  });

  it('rethrows non-TierRouterError errors from the router', async () => {
    const a = new StubProvider('a');
    const router = new StubRouter(new Error('boom'));
    const rp = new RoutingProvider({
      router,
      providers: new Map([['a', a]]),
      defaultTier: 'a',
    });
    await assert.rejects(() => rp.invoke(pact, request), /boom/);
    assert.equal(a.invocations, 0);
    assert.equal(rp.metrics.defaultFallbacks, 0);
  });

  it('tracks per-tier dispatch counts and average latency', async () => {
    const a = new StubProvider('a');
    const b = new StubProvider('b');
    let pick: 'a' | 'b' = 'a';
    const router = new StubRouter(() => pick);
    const rp = new RoutingProvider({
      router,
      providers: new Map([
        ['a', a],
        ['b', b],
      ]),
      defaultTier: 'a',
    });
    await rp.invoke(pact, request);
    pick = 'b';
    await rp.invoke(pact, request);
    await rp.invoke(pact, request);
    const m = rp.metrics;
    assert.equal(m.perTier.get('a')!.dispatched, 1);
    assert.equal(m.perTier.get('b')!.dispatched, 2);
    assert.ok(m.perTier.get('a')!.avgLatencyMs >= 0);
    assert.ok(m.perTier.get('b')!.avgLatencyMs >= 0);
    assert.equal(m.defaultFallbacks, 0);
  });

  it('resetMetrics zeroes counters and defaultFallbacks', async () => {
    const a = new StubProvider('a');
    const router = new StubRouter('a');
    const rp = new RoutingProvider({
      router,
      providers: new Map([['a', a]]),
      defaultTier: 'a',
    });
    await rp.invoke(pact, request);
    rp.resetMetrics();
    assert.equal(rp.metrics.perTier.get('a')!.dispatched, 0);
    assert.equal(rp.metrics.defaultFallbacks, 0);
  });

  it('capabilities exposes intersection of provider modes', () => {
    const a = new StubProvider('a', {}, ['oneshot', 'resumable']);
    const b = new StubProvider('b', {}, ['oneshot']);
    const router = new StubRouter('a');
    const rp = new RoutingProvider({
      router,
      providers: new Map([
        ['a', a],
        ['b', b],
      ]),
      defaultTier: 'a',
    });
    const caps = rp.capabilities();
    assert.deepEqual(caps.modes.sort(), ['oneshot']);
  });

  it('dispatch metrics still increment on provider error', async () => {
    const failing: AgentProvider = {
      name: 'a',
      capabilities: () => ({
        modes: ['oneshot'],
        streaming: false,
        resumable: false,
        budgetEnforcement: 'none',
        outputValidation: 'none',
        toolModel: 'none',
      }),
      invoke: async () => {
        throw new Error('downstream-fail');
      },
    };
    const router = new StubRouter('a');
    const rp = new RoutingProvider({
      router,
      providers: new Map([['a', failing]]),
      defaultTier: 'a',
    });
    await assert.rejects(() => rp.invoke(pact, request), /downstream-fail/);
    assert.equal(rp.metrics.perTier.get('a')!.dispatched, 1);
  });
});
