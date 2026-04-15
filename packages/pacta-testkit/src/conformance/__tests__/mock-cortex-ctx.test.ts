import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockCortexCtx } from '../mock-cortex-ctx.js';

describe('MockCortexCtx — recorder + facade behaviour', () => {
  it('records every facade invocation in order with monotonic `at`', async () => {
    const ctx = createMockCortexCtx({ appId: 'test-app' });
    await ctx.audit.event({ kind: 'method.agent.started' });
    await ctx.storage!.put('k', { v: 1 });
    const got = await ctx.storage!.get('k');
    assert.deepEqual(got, { v: 1 });

    const calls = ctx.recorder.calls;
    assert.equal(calls.length, 3);
    assert.equal(calls[0]!.facade, 'audit');
    assert.equal(calls[1]!.facade, 'storage');
    assert.equal(calls[1]!.method, 'put');
    assert.equal(calls[2]!.method, 'get');
    // Monotonic
    assert.equal(calls[0]!.at, 0);
    assert.equal(calls[1]!.at, 1);
    assert.equal(calls[2]!.at, 2);
  });

  it('emulates ctx.llm.complete with scripted responses', async () => {
    const ctx = createMockCortexCtx({ appId: 'x' });
    ctx.scriptLlmResponse({
      text: 'hello',
      usage: { inputTokens: 10, outputTokens: 5 },
      costUsd: 0.001,
      toolsRequested: ['Grep'],
    });
    const result = await ctx.llm.complete({ tier: 'balanced', prompt: 'p' });
    assert.equal(result.text, 'hello');
    assert.equal(result.tokensIn, 10);
    assert.equal(result.costUsd, 0.001);

    const llmCalls = ctx.recorder.where('llm');
    assert.equal(llmCalls.length, 1);
    assert.deepEqual(llmCalls[0]!.args.toolsRequested, ['Grep']);
  });

  it('throws ConformanceRunError(INVALID_FIXTURE) when llm script is empty', async () => {
    const ctx = createMockCortexCtx({ appId: 'x' });
    await assert.rejects(
      () => ctx.llm.complete({ tier: 'balanced', prompt: 'p' }),
      (err: Error & { code?: string }) => err.name === 'ConformanceRunError' && err.code === 'INVALID_FIXTURE',
    );
  });

  it('stamps handlersRegistered=true after registerBudgetHandlers call', async () => {
    const ctx = createMockCortexCtx({ appId: 'x' });
    ctx.llm.registerBudgetHandlers!({
      onBudgetWarning: () => undefined,
      onBudgetCritical: () => undefined,
      onBudgetExceeded: () => undefined,
    });
    ctx.scriptLlmResponse({
      text: 't',
      usage: { inputTokens: 1, outputTokens: 1 },
      costUsd: 0,
    });
    await ctx.llm.complete({ tier: 'balanced', prompt: 'p' });
    const complete = ctx.recorder.where('llm').find((c) => c.method === 'complete');
    assert.ok(complete);
    assert.equal(complete!.args.handlersRegistered, true);
  });

  it('tracks delegation depth via exchangeForAgent chain', async () => {
    const ctx = createMockCortexCtx({ appId: 'x' });
    const first = await ctx.auth!.exchangeForAgent!('parent-token-0', ['a']);
    assert.equal(first.token, 'ext-token-d1');
    const second = await ctx.auth!.exchangeForAgent!(first.token, ['a']);
    assert.equal(second.token, 'ext-token-d2');
    // maxDelegationDepth derivable from result tokens
    const calls = ctx.recorder.where('auth');
    assert.equal(calls.length, 2);
  });

  it('reset() clears recorder, storage, and script', async () => {
    const ctx = createMockCortexCtx({ appId: 'x' });
    ctx.scriptLlmResponse({
      text: 't',
      usage: { inputTokens: 1, outputTokens: 1 },
      costUsd: 0,
    });
    await ctx.audit.event({ kind: 'method.agent.started' });
    await ctx.storage!.put('k', { v: 1 });
    ctx.reset();
    assert.equal(ctx.recorder.calls.length, 0);
    const after = await ctx.storage!.get('k');
    assert.equal(after, null);
  });

  it('exposes recorder.count and recorder.firstIndexOf', async () => {
    const ctx = createMockCortexCtx({ appId: 'x' });
    await ctx.audit.event({ kind: 'a' });
    await ctx.audit.event({ kind: 'b' });
    await ctx.audit.event({ kind: 'a' });
    assert.equal(
      ctx.recorder.count((c) => c.facade === 'audit' && c.args.kind === 'a'),
      2,
    );
    assert.equal(
      ctx.recorder.firstIndexOf((c) => c.args.kind === 'b'),
      1,
    );
  });
});
