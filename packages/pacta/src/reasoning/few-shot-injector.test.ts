/**
 * Unit tests for the few-shot injector factory.
 *
 * Tests: example formatting, system prompt composition, empty examples passthrough.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { fewShotInjector } from './few-shot-injector.js';
import type { Pact, AgentRequest, AgentResult, TokenUsage, CostReport } from '../pact.js';
import type { AgentExample } from './reasoning-policy.js';

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

describe('fewShotInjector', () => {
  it('passes through when examples array is empty', async () => {
    const middleware = fewShotInjector([]);
    const { inner, getLastRequest } = captureRequest();
    const wrapped = middleware(inner, basePact);

    await wrapped(basePact, { prompt: 'test', systemPrompt: 'original' });
    // Passthrough — request forwarded unchanged
    const req = getLastRequest()!;
    assert.equal(req.prompt, 'test');
    assert.equal(req.systemPrompt, 'original');
  });

  it('injects formatted examples into system prompt', async () => {
    const examples: AgentExample[] = [
      { prompt: 'What is 2+2?', response: '4' },
      { prompt: 'Name a color', response: 'Blue' },
    ];
    const middleware = fewShotInjector(examples);
    const { inner, getLastRequest } = captureRequest();
    const wrapped = middleware(inner, basePact);

    await wrapped(basePact, { prompt: 'test' });

    const req = getLastRequest()!;
    assert.ok(req.systemPrompt, 'should have system prompt');
    assert.ok(req.systemPrompt!.includes('Few-Shot Examples'));
    assert.ok(req.systemPrompt!.includes('User: What is 2+2?'));
    assert.ok(req.systemPrompt!.includes('Assistant: 4'));
    assert.ok(req.systemPrompt!.includes('Example 1:'));
    assert.ok(req.systemPrompt!.includes('Example 2:'));
    assert.ok(req.systemPrompt!.includes('User: Name a color'));
    assert.ok(req.systemPrompt!.includes('Assistant: Blue'));
  });

  it('preserves existing system prompt', async () => {
    const examples: AgentExample[] = [
      { prompt: 'Hello', response: 'Hi' },
    ];
    const middleware = fewShotInjector(examples);
    const { inner, getLastRequest } = captureRequest();
    const wrapped = middleware(inner, basePact);

    await wrapped(basePact, { prompt: 'test', systemPrompt: 'You are helpful.' });

    const req = getLastRequest()!;
    assert.ok(req.systemPrompt!.includes('You are helpful.'));
    assert.ok(req.systemPrompt!.includes('User: Hello'));
  });

  it('creates system prompt from scratch when none exists', async () => {
    const examples: AgentExample[] = [
      { prompt: 'Input', response: 'Output' },
    ];
    const middleware = fewShotInjector(examples);
    const { inner, getLastRequest } = captureRequest();
    const wrapped = middleware(inner, basePact);

    await wrapped(basePact, { prompt: 'test' });

    const req = getLastRequest()!;
    assert.ok(req.systemPrompt, 'should create system prompt');
    assert.ok(req.systemPrompt!.startsWith('--- Few-Shot Examples ---'));
  });

  it('numbers examples sequentially', async () => {
    const examples: AgentExample[] = [
      { prompt: 'A', response: 'a' },
      { prompt: 'B', response: 'b' },
      { prompt: 'C', response: 'c' },
    ];
    const middleware = fewShotInjector(examples);
    const { inner, getLastRequest } = captureRequest();
    const wrapped = middleware(inner, basePact);

    await wrapped(basePact, { prompt: 'test' });

    const req = getLastRequest()!;
    assert.ok(req.systemPrompt!.includes('Example 1:'));
    assert.ok(req.systemPrompt!.includes('Example 2:'));
    assert.ok(req.systemPrompt!.includes('Example 3:'));
  });
});
