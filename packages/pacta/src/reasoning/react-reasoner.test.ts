// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for the ReAct reasoner factory.
 *
 * Tests: think tool injection, planning prompt injection, custom instructions,
 * passthrough when nothing is enabled.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { reactReasoner, THINK_TOOL } from './react-reasoner.js';
import type { Pact, AgentRequest, AgentResult, TokenUsage, CostReport } from '../pact.js';
import type { ToolDefinition } from '../ports/tool-provider.js';

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

function captureRequest(): { inner: (pact: Pact, req: AgentRequest) => Promise<AgentResult<unknown>>; getLastRequest: () => AgentRequest | undefined } {
  let lastRequest: AgentRequest | undefined;
  const inner = async (_pact: Pact, req: AgentRequest) => {
    lastRequest = req;
    return makeResult('ok');
  };
  return { inner, getLastRequest: () => lastRequest };
}

// ── Tests ────────────────────────────────────────────────────────

describe('reactReasoner', () => {
  it('passes through when no options are enabled', async () => {
    const middleware = reactReasoner({});
    const { inner, getLastRequest } = captureRequest();
    const wrapped = middleware(inner, basePact);

    const request: AgentRequest = { prompt: 'test', systemPrompt: 'original' };
    await wrapped(basePact, request);

    // Passthrough — request is forwarded unchanged
    const req = getLastRequest()!;
    assert.equal(req.prompt, 'test');
    assert.equal(req.systemPrompt, 'original');
    assert.equal(req.metadata, undefined, 'no metadata should be added');
  });

  it('adds think tool to metadata when thinkTool=true', async () => {
    const middleware = reactReasoner({ thinkTool: true });
    const { inner, getLastRequest } = captureRequest();
    const wrapped = middleware(inner, basePact);

    await wrapped(basePact, { prompt: 'test' });

    const req = getLastRequest()!;
    assert.ok(req.metadata, 'metadata should exist');

    const tools = req.metadata!.reasoningTools as ToolDefinition[];
    assert.ok(Array.isArray(tools), 'reasoningTools should be an array');
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, 'think');
    assert.equal(tools[0], THINK_TOOL);
  });

  it('injects planning instructions when planBetweenActions=true', async () => {
    const middleware = reactReasoner({ planBetweenActions: true });
    const { inner, getLastRequest } = captureRequest();
    const wrapped = middleware(inner, basePact);

    await wrapped(basePact, { prompt: 'test' });

    const req = getLastRequest()!;
    assert.ok(req.systemPrompt, 'systemPrompt should exist');
    assert.ok(
      req.systemPrompt!.includes('Before each tool use'),
      'should contain planning instructions',
    );
  });

  it('preserves existing system prompt when adding instructions', async () => {
    const middleware = reactReasoner({ planBetweenActions: true });
    const { inner, getLastRequest } = captureRequest();
    const wrapped = middleware(inner, basePact);

    await wrapped(basePact, { prompt: 'test', systemPrompt: 'You are a helpful agent.' });

    const req = getLastRequest()!;
    assert.ok(req.systemPrompt!.includes('You are a helpful agent.'));
    assert.ok(req.systemPrompt!.includes('Before each tool use'));
  });

  it('appends custom instructions from policy', async () => {
    const middleware = reactReasoner({ instructions: 'Always cite sources.' });
    const { inner, getLastRequest } = captureRequest();
    const wrapped = middleware(inner, basePact);

    await wrapped(basePact, { prompt: 'test' });

    const req = getLastRequest()!;
    assert.ok(req.systemPrompt!.includes('Always cite sources.'));
  });

  it('combines thinkTool + planBetweenActions + instructions', async () => {
    const middleware = reactReasoner({
      thinkTool: true,
      planBetweenActions: true,
      instructions: 'Be thorough.',
    });
    const { inner, getLastRequest } = captureRequest();
    const wrapped = middleware(inner, basePact);

    await wrapped(basePact, { prompt: 'test' });

    const req = getLastRequest()!;
    assert.ok(req.systemPrompt!.includes('Before each tool use'));
    assert.ok(req.systemPrompt!.includes('Be thorough.'));
    assert.ok(Array.isArray(req.metadata!.reasoningTools));
  });

  it('preserves existing metadata when adding think tool', async () => {
    const middleware = reactReasoner({ thinkTool: true });
    const { inner, getLastRequest } = captureRequest();
    const wrapped = middleware(inner, basePact);

    await wrapped(basePact, { prompt: 'test', metadata: { custom: 'value' } });

    const req = getLastRequest()!;
    assert.equal(req.metadata!.custom, 'value');
    assert.ok(Array.isArray(req.metadata!.reasoningTools));
  });
});
