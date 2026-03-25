/**
 * Unit tests for the Reflexion reasoner factory.
 *
 * Tests: retry on failure, maxTrials respected, non-retriable stop reasons,
 * reflection events emitted, passthrough on success.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { reflexionReasoner } from './reflexion-reasoner.js';
import type { Pact, AgentRequest, AgentResult, TokenUsage, CostReport } from '../pact.js';
import type { AgentEvent, AgentReflection } from '../events.js';

// ── Test Helpers ─────────────────────────────────────────────────

function makeUsage(total = 100): TokenUsage {
  return { inputTokens: 60, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: total };
}

function makeCost(usd = 0.01): CostReport {
  return { totalUsd: usd, perModel: {} };
}

function makeResult<T>(output: T, overrides?: Partial<AgentResult<T>>): AgentResult<T> {
  return {
    output,
    sessionId: 'test-session',
    completed: true,
    stopReason: 'complete',
    usage: makeUsage(),
    cost: makeCost(),
    durationMs: 100,
    turns: 1,
    ...overrides,
  };
}

const basePact: Pact = { mode: { type: 'oneshot' } };

type InnerFn = (pact: Pact, req: AgentRequest) => Promise<AgentResult<unknown>>;

function makeSequenceInner(results: AgentResult<unknown>[]): { fn: InnerFn; getCalls: () => number } {
  let callIndex = 0;
  const fn: InnerFn = async () => {
    const result = results[Math.min(callIndex, results.length - 1)];
    callIndex++;
    return result;
  };
  return { fn, getCalls: () => callIndex };
}

// ── Tests ────────────────────────────────────────────────────────

describe('reflexionReasoner', () => {
  it('passes through on successful result (no retry)', async () => {
    const middleware = reflexionReasoner({ maxReflectionTrials: 3 });
    const { fn, getCalls } = makeSequenceInner([makeResult('ok')]);
    const wrapped = middleware(fn, basePact);

    const result = await wrapped(basePact, { prompt: 'test' });
    assert.equal(result.completed, true);
    assert.equal(result.output, 'ok');
    assert.equal(getCalls(), 1, 'should only call provider once on success');
  });

  it('retries on error stop reason up to maxTrials', async () => {
    const failResult = makeResult('bad', { completed: false, stopReason: 'error' });
    const middleware = reflexionReasoner({ maxReflectionTrials: 3 });
    const { fn, getCalls } = makeSequenceInner([failResult, failResult, failResult, failResult]);
    const wrapped = middleware(fn, basePact);

    const result = await wrapped(basePact, { prompt: 'test' });
    // 1 initial + 3 retries = 4 calls
    assert.equal(getCalls(), 4, 'should call 1 + maxTrials times');
    assert.equal(result.completed, false);
  });

  it('stops retrying when a successful result is returned', async () => {
    const failResult = makeResult('bad', { completed: false, stopReason: 'error' });
    const successResult = makeResult('fixed');
    const middleware = reflexionReasoner({ maxReflectionTrials: 3 });
    const { fn, getCalls } = makeSequenceInner([failResult, successResult]);
    const wrapped = middleware(fn, basePact);

    const result = await wrapped(basePact, { prompt: 'test' });
    assert.equal(getCalls(), 2, 'should stop after success');
    assert.equal(result.completed, true);
    assert.equal(result.output, 'fixed');
  });

  it('does not retry on budget_exhausted', async () => {
    const budgetResult = makeResult('partial', { completed: false, stopReason: 'budget_exhausted' });
    const middleware = reflexionReasoner({ maxReflectionTrials: 3 });
    const { fn, getCalls } = makeSequenceInner([budgetResult]);
    const wrapped = middleware(fn, basePact);

    const result = await wrapped(basePact, { prompt: 'test' });
    assert.equal(getCalls(), 1, 'should not retry budget exhaustion');
    assert.equal(result.stopReason, 'budget_exhausted');
  });

  it('does not retry on timeout', async () => {
    const timeoutResult = makeResult(null, { completed: false, stopReason: 'timeout' });
    const middleware = reflexionReasoner({ maxReflectionTrials: 3 });
    const { fn, getCalls } = makeSequenceInner([timeoutResult]);
    const wrapped = middleware(fn, basePact);

    await wrapped(basePact, { prompt: 'test' });
    assert.equal(getCalls(), 1, 'should not retry timeout');
  });

  it('does not retry on killed', async () => {
    const killedResult = makeResult(null, { completed: false, stopReason: 'killed' });
    const middleware = reflexionReasoner({ maxReflectionTrials: 3 });
    const { fn, getCalls } = makeSequenceInner([killedResult]);
    const wrapped = middleware(fn, basePact);

    await wrapped(basePact, { prompt: 'test' });
    assert.equal(getCalls(), 1, 'should not retry killed');
  });

  it('emits AgentReflection events on each retry', async () => {
    const failResult = makeResult('bad', { completed: false, stopReason: 'error' });
    const successResult = makeResult('ok');
    const events: AgentEvent[] = [];
    const middleware = reflexionReasoner({ maxReflectionTrials: 3 });
    const { fn } = makeSequenceInner([failResult, failResult, successResult]);
    const wrapped = middleware(fn, basePact, (e) => events.push(e));

    await wrapped(basePact, { prompt: 'test' });

    const reflections = events.filter(e => e.type === 'reflection') as AgentReflection[];
    assert.equal(reflections.length, 2, 'should emit 2 reflection events');
    assert.equal(reflections[0].trial, 1);
    assert.equal(reflections[1].trial, 2);
    assert.ok(reflections[0].critique.includes('failed'));
  });

  it('passes through when reflectOnFailure=false', async () => {
    const failResult = makeResult('bad', { completed: false, stopReason: 'error' });
    const middleware = reflexionReasoner({ reflectOnFailure: false });
    const { fn, getCalls } = makeSequenceInner([failResult]);
    const wrapped = middleware(fn, basePact);

    await wrapped(basePact, { prompt: 'test' });
    assert.equal(getCalls(), 1, 'should not retry when reflection disabled');
  });

  it('passes through when maxTrials=0', async () => {
    const failResult = makeResult('bad', { completed: false, stopReason: 'error' });
    const middleware = reflexionReasoner({ maxReflectionTrials: 0 });
    const { fn, getCalls } = makeSequenceInner([failResult]);
    const wrapped = middleware(fn, basePact);

    await wrapped(basePact, { prompt: 'test' });
    assert.equal(getCalls(), 1, 'should not retry with 0 trials');
  });

  it('uses default maxTrials=3 when not specified', async () => {
    const failResult = makeResult('bad', { completed: false, stopReason: 'error' });
    const middleware = reflexionReasoner({});
    const { fn, getCalls } = makeSequenceInner([failResult, failResult, failResult, failResult]);
    const wrapped = middleware(fn, basePact);

    await wrapped(basePact, { prompt: 'test' });
    assert.equal(getCalls(), 4, 'default: 1 initial + 3 retries');
  });
});
