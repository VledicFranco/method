/**
 * Unit tests for the effort mapper factory.
 *
 * Tests: effort level mapping, metadata injection, passthrough on undefined effort.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { effortMapper, getEffortParams } from './effort-mapper.js';
import type { EffortParams } from './effort-mapper.js';
import type { Pact, AgentRequest, AgentResult, TokenUsage, CostReport } from '../pact.js';

// ── Test Helpers ─────────────────────────────────────────────────

function makeUsage(total = 100): TokenUsage {
  return { inputTokens: 60, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: total };
}

function makeCost(usd = 0.01): CostReport {
  return { totalUsd: usd, perModel: {} };
}

function makeResult<T>(output: T): AgentResult<T> {
  return {
    output,
    sessionId: 'test-session',
    completed: true,
    stopReason: 'complete',
    usage: makeUsage(),
    cost: makeCost(),
    durationMs: 100,
    turns: 1,
  };
}

const basePact: Pact = { mode: { type: 'oneshot' } };

function captureRequest(): {
  inner: (pact: Pact, req: AgentRequest) => Promise<AgentResult<unknown>>;
  getLastRequest: () => AgentRequest | undefined;
} {
  let lastRequest: AgentRequest | undefined;
  const inner = async (_pact: Pact, req: AgentRequest) => {
    lastRequest = req;
    return makeResult('ok');
  };
  return { inner, getLastRequest: () => lastRequest };
}

// ── Tests ────────────────────────────────────────────────────────

describe('effortMapper', () => {
  it('passes through when effort is undefined', async () => {
    const middleware = effortMapper(undefined);
    const { inner, getLastRequest } = captureRequest();
    const wrapped = middleware(inner, basePact);

    await wrapped(basePact, { prompt: 'test' });
    // Passthrough — request forwarded unchanged
    const req = getLastRequest()!;
    assert.equal(req.prompt, 'test');
    assert.equal(req.metadata, undefined, 'no metadata should be added');
  });

  it('maps low effort to small thinking budget', async () => {
    const middleware = effortMapper('low');
    const { inner, getLastRequest } = captureRequest();
    const wrapped = middleware(inner, basePact);

    await wrapped(basePact, { prompt: 'test' });

    const req = getLastRequest()!;
    const params = req.metadata!.effortParams as EffortParams;
    assert.equal(params.thinkingBudgetTokens, 1024);
    assert.equal(params.temperature, 0.0);
    assert.equal(params.maxTokens, 2048);
  });

  it('maps medium effort to moderate thinking budget', async () => {
    const middleware = effortMapper('medium');
    const { inner, getLastRequest } = captureRequest();
    const wrapped = middleware(inner, basePact);

    await wrapped(basePact, { prompt: 'test' });

    const req = getLastRequest()!;
    const params = req.metadata!.effortParams as EffortParams;
    assert.equal(params.thinkingBudgetTokens, 4096);
    assert.equal(params.temperature, 0.3);
    assert.equal(params.maxTokens, 4096);
  });

  it('maps high effort to large thinking budget', async () => {
    const middleware = effortMapper('high');
    const { inner, getLastRequest } = captureRequest();
    const wrapped = middleware(inner, basePact);

    await wrapped(basePact, { prompt: 'test' });

    const req = getLastRequest()!;
    const params = req.metadata!.effortParams as EffortParams;
    assert.equal(params.thinkingBudgetTokens, 16384);
    assert.equal(params.temperature, 0.5);
    assert.equal(params.maxTokens, 8192);
  });

  it('preserves existing metadata', async () => {
    const middleware = effortMapper('medium');
    const { inner, getLastRequest } = captureRequest();
    const wrapped = middleware(inner, basePact);

    await wrapped(basePact, { prompt: 'test', metadata: { model: 'test-model' } });

    const req = getLastRequest()!;
    assert.equal(req.metadata!.model, 'test-model');
    assert.ok(req.metadata!.effortParams, 'should also have effortParams');
  });

  it('increasing effort gives strictly increasing thinking budgets', () => {
    const low = getEffortParams('low');
    const medium = getEffortParams('medium');
    const high = getEffortParams('high');

    assert.ok(low.thinkingBudgetTokens < medium.thinkingBudgetTokens);
    assert.ok(medium.thinkingBudgetTokens < high.thinkingBudgetTokens);
  });
});

describe('getEffortParams', () => {
  it('returns a copy (not the internal object)', () => {
    const a = getEffortParams('low');
    const b = getEffortParams('low');
    assert.notEqual(a, b, 'should return different references');
    assert.deepEqual(a, b, 'should have same values');
  });

  it('returns valid EffortParams for all levels', () => {
    for (const level of ['low', 'medium', 'high'] as const) {
      const params = getEffortParams(level);
      assert.equal(typeof params.thinkingBudgetTokens, 'number');
      assert.equal(typeof params.temperature, 'number');
      assert.equal(typeof params.maxTokens, 'number');
      assert.ok(params.thinkingBudgetTokens > 0);
      assert.ok(params.maxTokens > 0);
      assert.ok(params.temperature >= 0 && params.temperature <= 1);
    }
  });
});
