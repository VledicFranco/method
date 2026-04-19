// SPDX-License-Identifier: Apache-2.0
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentResult, AgentEvent, TokenUsage, CostReport } from '@methodts/pacta';
import { RecordingProvider } from './recording-provider.js';
import { pactBuilder, agentRequestBuilder } from './builders.js';

// ── Helpers ─────────────────────────────────────────────────────

function makeUsage(total = 100): TokenUsage {
  return { inputTokens: 60, outputTokens: 30, cacheReadTokens: 10, cacheWriteTokens: 0, totalTokens: total };
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
    durationMs: 500,
    turns: 1,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────

describe('RecordingProvider', () => {
  let provider: RecordingProvider;

  beforeEach(() => {
    provider = new RecordingProvider();
  });

  it('has name "recording"', () => {
    assert.equal(provider.name, 'recording');
  });

  it('reports full capabilities', () => {
    const caps = provider.capabilities();
    assert.deepEqual(caps.modes, ['oneshot', 'resumable', 'persistent']);
    assert.equal(caps.streaming, false);
  });

  it('throws when no response is configured', async () => {
    const pact = pactBuilder().build();
    const request = agentRequestBuilder().build();
    await assert.rejects(() => provider.invoke(pact, request), /no scripted response/);
  });

  it('returns scripted result and creates a recording', async () => {
    const result = makeResult('hello');
    provider.addResponse({ result });

    const pact = pactBuilder().build();
    const request = agentRequestBuilder().build();
    const actual = await provider.invoke(pact, request);

    assert.equal(actual.output, 'hello');
    assert.equal(provider.recordings.length, 1);
    assert.equal(provider.lastRecording?.result?.output, 'hello');
  });

  it('uses default result when scripted responses are exhausted', async () => {
    provider.setDefaultResult(makeResult('default'));

    const pact = pactBuilder().build();
    const request = agentRequestBuilder().build();
    const r1 = await provider.invoke(pact, request);
    const r2 = await provider.invoke(pact, request);

    assert.equal(r1.output, 'default');
    assert.equal(r2.output, 'default');
    assert.equal(provider.recordings.length, 2);
  });

  it('records tool calls from events', async () => {
    const events: AgentEvent[] = [
      { type: 'tool_use', tool: 'Read', input: { path: '/a.ts' }, toolUseId: 'tu-1' },
      { type: 'tool_result', tool: 'Read', output: 'contents', toolUseId: 'tu-1', durationMs: 42 },
      { type: 'turn_complete', turnNumber: 1, usage: makeUsage() },
      { type: 'tool_use', tool: 'Grep', input: { pattern: 'foo' }, toolUseId: 'tu-2' },
      { type: 'tool_result', tool: 'Grep', output: 'match', toolUseId: 'tu-2', durationMs: 15 },
      { type: 'turn_complete', turnNumber: 2, usage: makeUsage() },
    ];

    provider.addResponse({ events, result: makeResult('done') });
    await provider.invoke(pactBuilder().build(), agentRequestBuilder().build());

    const recording = provider.lastRecording!;
    assert.equal(recording.toolCalls.length, 2);
    assert.equal(recording.toolCalls[0].name, 'Read');
    assert.equal(recording.toolCalls[0].durationMs, 42);
    assert.equal(recording.toolCalls[1].name, 'Grep');
  });

  it('records thinking traces', async () => {
    const events: AgentEvent[] = [
      { type: 'thinking', content: 'I should read the file first' },
      { type: 'thinking', content: 'Now I understand the structure' },
    ];

    provider.addResponse({ events, result: makeResult('done') });
    await provider.invoke(pactBuilder().build(), agentRequestBuilder().build());

    const recording = provider.lastRecording!;
    assert.equal(recording.thinkingTraces.length, 2);
    assert.equal(recording.thinkingTraces[0], 'I should read the file first');
  });

  it('consumes scripted responses in order', async () => {
    provider.addResponse({ result: makeResult('first') });
    provider.addResponse({ result: makeResult('second') });

    const pact = pactBuilder().build();
    const request = agentRequestBuilder().build();

    const r1 = await provider.invoke(pact, request);
    const r2 = await provider.invoke(pact, request);

    assert.equal(r1.output, 'first');
    assert.equal(r2.output, 'second');
  });

  it('reset clears recordings and responses', async () => {
    provider.addResponse({ result: makeResult('x') });
    provider.setDefaultResult(makeResult('default'));
    await provider.invoke(pactBuilder().build(), agentRequestBuilder().build());

    provider.reset();

    assert.equal(provider.recordings.length, 0);
    assert.equal(provider.lastRecording, undefined);
    await assert.rejects(() =>
      provider.invoke(pactBuilder().build(), agentRequestBuilder().build()),
      /no scripted response/
    );
  });
});
