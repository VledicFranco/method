/**
 * Unit tests for context management implementations.
 *
 * Tests: compactionManager, noteTakingManager, subagentDelegator, systemPromptBudgetTracker.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { compactionManager } from './compaction-manager.js';
import { noteTakingManager } from './note-taking-manager.js';
import { subagentDelegator } from './subagent-delegator.js';
import { systemPromptBudgetTracker } from './system-prompt-budget-tracker.js';
import type { Pact, AgentRequest, AgentResult, TokenUsage, CostReport } from '../pact.js';
import type { AgentEvent } from '../events.js';
import type { MemoryPort, AgentNote, NoteFilter } from '../ports/memory-port.js';
import type { InvokeFn } from './context-middleware.js';

// ── Test Helpers ─────────────────────────────────────────────────

function makeUsage(total = 100): TokenUsage {
  return { inputTokens: 60, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: total };
}

function makeCost(usd = 0.01): CostReport {
  return { totalUsd: usd, perModel: {} };
}

function makeResult(output: unknown, overrides?: Partial<AgentResult>): AgentResult {
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

function makeInner(result: AgentResult<unknown>): { fn: InvokeFn; getCalls: () => number; getRequests: () => AgentRequest[] } {
  let calls = 0;
  const requests: AgentRequest[] = [];
  const fn: InvokeFn = async (_pact, request) => {
    calls++;
    requests.push(request);
    return result;
  };
  return { fn, getCalls: () => calls, getRequests: () => requests };
}

function makePact(overrides?: Partial<Pact>): Pact {
  return { mode: { type: 'oneshot' }, ...overrides };
}

function makeMockMemory(notes: AgentNote[] = []): MemoryPort & { storedNotes: AgentNote[] } {
  const storedNotes: AgentNote[] = [...notes];
  return {
    storedNotes,
    async store(key: string, value: string): Promise<void> {
      // no-op for these tests
    },
    async retrieve(key: string): Promise<string | null> {
      return null;
    },
    async writeNote(note: AgentNote): Promise<void> {
      storedNotes.push(note);
    },
    async readNotes(filter?: NoteFilter): Promise<AgentNote[]> {
      const limit = filter?.limit ?? storedNotes.length;
      return storedNotes.slice(0, limit);
    },
  };
}

// ── compactionManager Tests ─────────────────────────────────────

describe('compactionManager', () => {
  it('returns a context middleware function', () => {
    const middleware = compactionManager({ compactionThreshold: 0.8 });
    assert.equal(typeof middleware, 'function');
  });

  it('passes through when below threshold', async () => {
    const middleware = compactionManager({ compactionThreshold: 0.8 });
    const pact = makePact({ budget: { maxTokens: 1000 } });
    const { fn, getCalls } = makeInner(makeResult('ok'));
    const wrapped = middleware(fn, pact);

    const result = await wrapped(pact, { prompt: 'test' });
    assert.equal(result.output, 'ok');
    assert.equal(getCalls(), 1, 'should invoke inner once');
  });

  it('triggers compaction at threshold', async () => {
    const middleware = compactionManager({ compactionThreshold: 0.8 });
    const pact = makePact({ budget: { maxTokens: 1000 } });
    const events: AgentEvent[] = [];

    // Use high token usage to trigger compaction on second call
    const result800 = makeResult('ok', { usage: makeUsage(850) });
    const result100 = makeResult('compacted', { usage: makeUsage(100) });
    let callCount = 0;
    const fn: InvokeFn = async () => {
      callCount++;
      // First and second calls return high usage, third+ returns low
      if (callCount <= 1) return result800;
      return result100;
    };

    const wrapped = middleware(fn, pact, (e) => events.push(e));

    // First call: accumulates 850 tokens (85% of 1000 — above threshold)
    await wrapped(pact, { prompt: 'first' });

    // Second call: should trigger compaction because cumulative is 850/1000 = 85%
    await wrapped(pact, { prompt: 'second' });

    const compacted = events.find(e => e.type === 'context_compacted');
    assert.ok(compacted, 'should emit context_compacted event');
    if (compacted?.type === 'context_compacted') {
      assert.equal(compacted.fromTokens, 850, 'fromTokens should be cumulative before compaction');
    }
  });

  it('uses custom compaction instructions', async () => {
    const customInstructions = 'Keep only the task list and decisions.';
    const middleware = compactionManager({
      compactionThreshold: 0.5,
      compactionInstructions: customInstructions,
    });
    const pact = makePact({ budget: { maxTokens: 100 } });

    const requests: AgentRequest[] = [];
    let callCount = 0;
    const fn: InvokeFn = async (_p, req) => {
      callCount++;
      requests.push(req);
      return makeResult('ok', { usage: makeUsage(60) });
    };

    const wrapped = middleware(fn, pact);

    // First call: 60 tokens = 60% of 100 — above 50% threshold
    await wrapped(pact, { prompt: 'first' });
    // Second call: should trigger compaction
    await wrapped(pact, { prompt: 'second' });

    // Check that compaction request included custom instructions
    const compactionReq = requests.find(r => r.prompt.includes('CONTEXT COMPACTION'));
    assert.ok(compactionReq, 'should send a compaction request');
    assert.ok(
      compactionReq!.prompt.includes(customInstructions),
      'compaction request should include custom instructions',
    );
  });
});

// ── noteTakingManager Tests ─────────────────────────────────────

describe('noteTakingManager', () => {
  it('passes through when no memory port is provided', async () => {
    const middleware = noteTakingManager({});
    const pact = makePact();
    const { fn, getCalls } = makeInner(makeResult('ok'));
    const wrapped = middleware(fn, pact);

    const result = await wrapped(pact, { prompt: 'test' });
    assert.equal(result.output, 'ok');
    assert.equal(getCalls(), 1);
  });

  it('stores notes after each turn via MemoryPort', async () => {
    const memory = makeMockMemory();
    const middleware = noteTakingManager({ memory });
    const pact = makePact();
    const { fn } = makeInner(makeResult('some output'));
    const wrapped = middleware(fn, pact);

    await wrapped(pact, { prompt: 'test' });

    assert.equal(memory.storedNotes.length, 1, 'should store one note after turn');
    assert.ok(memory.storedNotes[0].content.includes('Turn 1'), 'note should include turn number');
    assert.ok(memory.storedNotes[0].tags?.includes('auto'), 'note should be tagged as auto');
  });

  it('retrieves notes and prepends to prompt before turn', async () => {
    const existingNotes: AgentNote[] = [
      { content: 'Important fact A', tags: ['manual'] },
      { content: 'Important fact B', tags: ['manual'] },
    ];
    const memory = makeMockMemory(existingNotes);
    const middleware = noteTakingManager({ memory });
    const pact = makePact();

    const requests: AgentRequest[] = [];
    const fn: InvokeFn = async (_p, req) => {
      requests.push(req);
      return makeResult('ok');
    };
    const wrapped = middleware(fn, pact);

    await wrapped(pact, { prompt: 'my question' });

    assert.ok(requests[0].prompt.includes('RETRIEVED NOTES'), 'prompt should include retrieved notes header');
    assert.ok(requests[0].prompt.includes('Important fact A'), 'prompt should include note A');
    assert.ok(requests[0].prompt.includes('Important fact B'), 'prompt should include note B');
    assert.ok(requests[0].prompt.includes('my question'), 'prompt should still include original question');
  });

  it('stores and retrieves notes across multiple turns', async () => {
    const memory = makeMockMemory();
    const middleware = noteTakingManager({ memory });
    const pact = makePact();
    const { fn } = makeInner(makeResult('output'));
    const wrapped = middleware(fn, pact);

    await wrapped(pact, { prompt: 'turn 1' });
    await wrapped(pact, { prompt: 'turn 2' });

    assert.equal(memory.storedNotes.length, 2, 'should store notes from both turns');
  });
});

// ── subagentDelegator Tests ─────────────────────────────────────

describe('subagentDelegator', () => {
  it('returns a context middleware function', () => {
    const middleware = subagentDelegator({ subagentSummaryTokens: 500 });
    assert.equal(typeof middleware, 'function');
  });

  it('passes through when below threshold', async () => {
    const middleware = subagentDelegator({ subagentSummaryTokens: 500 });
    const pact = makePact({ budget: { maxTokens: 10000 } });
    const { fn, getCalls } = makeInner(makeResult('ok'));
    const wrapped = middleware(fn, pact);

    const result = await wrapped(pact, { prompt: 'test' });
    assert.equal(result.output, 'ok');
    assert.equal(getCalls(), 1);
  });

  it('delegates to sub-request when context pressure detected', async () => {
    const middleware = subagentDelegator({
      compactionThreshold: 0.8,
      subagentSummaryTokens: 500,
    });
    const pact = makePact({ budget: { maxTokens: 1000 } });
    const events: AgentEvent[] = [];

    let callCount = 0;
    const fn: InvokeFn = async (_p, req) => {
      callCount++;
      if (callCount === 1) return makeResult('first result', { usage: makeUsage(900) });
      return makeResult('delegated result', { usage: makeUsage(200) });
    };

    const wrapped = middleware(fn, pact, (e) => events.push(e));

    // First call: 900 tokens — 90% of 1000
    await wrapped(pact, { prompt: 'first' });

    // Second call: should delegate
    const result = await wrapped(pact, { prompt: 'second' });

    const compacted = events.find(e => e.type === 'context_compacted');
    assert.ok(compacted, 'should emit context_compacted on delegation');
    if (compacted?.type === 'context_compacted') {
      assert.equal(compacted.fromTokens, 900, 'fromTokens should reflect pre-delegation state');
    }
  });

  it('extracts summary within token budget', async () => {
    const middleware = subagentDelegator({
      compactionThreshold: 0.5,
      subagentSummaryTokens: 10, // Very small budget — ~40 chars
    });
    const pact = makePact({ budget: { maxTokens: 100 } });

    const requests: AgentRequest[] = [];
    let callCount = 0;
    const fn: InvokeFn = async (_p, req) => {
      callCount++;
      requests.push(req);
      if (callCount === 1) return makeResult('a'.repeat(1000), { usage: makeUsage(60) });
      return makeResult('ok', { usage: makeUsage(30) });
    };

    const wrapped = middleware(fn, pact);

    // First call: 60% of 100 — above 50% threshold
    await wrapped(pact, { prompt: 'first' });
    // Second call: delegation triggers, summary should be truncated
    await wrapped(pact, { prompt: 'second' });

    // The delegation request should include a truncated summary
    const delegationReq = requests.find(r => r.prompt.includes('CONTEXT SUMMARY'));
    assert.ok(delegationReq, 'should send a delegated request with summary');
    // Summary should be truncated (10 tokens * 4 chars = 40 chars + "...")
    const summaryMatch = delegationReq!.prompt.match(/\[CONTEXT SUMMARY FROM PRIOR WINDOW\]\n([\s\S]*?)\n\n/);
    assert.ok(summaryMatch, 'should have summary section');
  });
});

// ── systemPromptBudgetTracker Tests ─────────────────────────────

describe('systemPromptBudgetTracker', () => {
  it('passes through when no system prompt is set', async () => {
    const middleware = systemPromptBudgetTracker(100);
    const pact = makePact();
    const { fn, getCalls } = makeInner(makeResult('ok'));
    const wrapped = middleware(fn, pact);

    const result = await wrapped(pact, { prompt: 'test' });
    assert.equal(result.output, 'ok');
    assert.equal(getCalls(), 1);
  });

  it('passes through when system prompt is within budget', async () => {
    const middleware = systemPromptBudgetTracker(1000);
    const pact = makePact();
    const { fn, getCalls } = makeInner(makeResult('ok'));
    const wrapped = middleware(fn, pact);

    // 100 chars / 4 = 25 tokens, well within 1000 budget
    const result = await wrapped(pact, { prompt: 'test', systemPrompt: 'a'.repeat(100) });
    assert.equal(result.output, 'ok');
    assert.equal(getCalls(), 1);
  });

  it('warns when approaching limit', async () => {
    const budget = 100; // 100 tokens = 400 chars
    const middleware = systemPromptBudgetTracker(budget);
    const pact = makePact();
    const events: AgentEvent[] = [];
    const { fn } = makeInner(makeResult('ok'));
    const wrapped = middleware(fn, pact, (e) => events.push(e));

    // 340 chars / 4 = 85 tokens — 85% of 100 budget, above 80% threshold
    await wrapped(pact, { prompt: 'test', systemPrompt: 'a'.repeat(340) });

    const warning = events.find(e => e.type === 'budget_warning');
    assert.ok(warning, 'should emit budget_warning when approaching limit');
    if (warning?.type === 'budget_warning') {
      assert.equal(warning.resource, 'tokens');
      assert.equal(warning.limit, budget);
    }
  });

  it('truncates and warns when exceeding budget', async () => {
    const budget = 50; // 50 tokens = 200 chars
    const middleware = systemPromptBudgetTracker(budget);
    const pact = makePact();
    const events: AgentEvent[] = [];

    const requests: AgentRequest[] = [];
    const fn: InvokeFn = async (_p, req) => {
      requests.push(req);
      return makeResult('ok');
    };
    const wrapped = middleware(fn, pact, (e) => events.push(e));

    // 400 chars / 4 = 100 tokens — 200% of 50 budget
    await wrapped(pact, { prompt: 'test', systemPrompt: 'x'.repeat(400) });

    const warning = events.find(e => e.type === 'budget_warning');
    assert.ok(warning, 'should emit budget_warning when exceeding limit');

    // The system prompt should be truncated to budget * 4 = 200 chars
    assert.ok(requests[0].systemPrompt, 'request should still have systemPrompt');
    assert.equal(requests[0].systemPrompt!.length, 200, 'system prompt should be truncated to budget');
  });
});
