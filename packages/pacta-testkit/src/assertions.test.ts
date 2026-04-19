// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentResult, TokenUsage, CostReport, SchemaDefinition } from '@methodts/pacta';
import type { Recording } from './recording-provider.js';
import {
  assertToolsCalled,
  assertToolsCalledUnordered,
  assertBudgetUnder,
  assertOutputMatches,
} from './assertions.js';

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

function makeRecording(toolNames: string[]): Recording {
  return {
    events: [],
    turns: [],
    toolCalls: toolNames.map((name, i) => ({
      name,
      input: {},
      output: 'ok',
      durationMs: 10,
      toolUseId: `tu-${i}`,
    })),
    thinkingTraces: [],
    result: null,
  };
}

// ── assertToolsCalled ───────────────────────────────────────────

describe('assertToolsCalled', () => {
  it('passes when tools match in order', () => {
    const recording = makeRecording(['Read', 'Grep']);
    assertToolsCalled(recording, ['Read', 'Grep']);
  });

  it('fails on wrong order', () => {
    const recording = makeRecording(['Grep', 'Read']);
    assert.throws(
      () => assertToolsCalled(recording, ['Read', 'Grep']),
      /expected tool 'Read', got 'Grep'/
    );
  });

  it('fails on wrong count', () => {
    const recording = makeRecording(['Read']);
    assert.throws(
      () => assertToolsCalled(recording, ['Read', 'Grep']),
      /expected 2 tool calls.*got 1/
    );
  });

  it('passes with empty expectations and empty recording', () => {
    assertToolsCalled(makeRecording([]), []);
  });
});

// ── assertToolsCalledUnordered ──────────────────────────────────

describe('assertToolsCalledUnordered', () => {
  it('passes when tools match regardless of order', () => {
    const recording = makeRecording(['Grep', 'Read']);
    assertToolsCalledUnordered(recording, ['Read', 'Grep']);
  });

  it('fails when tools do not match', () => {
    const recording = makeRecording(['Read']);
    assert.throws(
      () => assertToolsCalledUnordered(recording, ['Read', 'Grep']),
      /expected tools/
    );
  });
});

// ── assertBudgetUnder ───────────────────────────────────────────

describe('assertBudgetUnder', () => {
  it('passes when all limits are satisfied', () => {
    const result = makeResult('ok', {
      usage: makeUsage(500),
      cost: makeCost(0.05),
      durationMs: 1000,
      turns: 3,
    });

    assertBudgetUnder(result, {
      maxTokens: 1000,
      maxCostUsd: 0.10,
      maxDurationMs: 5000,
      maxTurns: 5,
    });
  });

  it('fails when tokens exceed limit', () => {
    const result = makeResult('ok', { usage: makeUsage(1500) });
    assert.throws(
      () => assertBudgetUnder(result, { maxTokens: 1000 }),
      /tokens: 1500 > 1000/
    );
  });

  it('fails when cost exceeds limit', () => {
    const result = makeResult('ok', { cost: makeCost(0.50) });
    assert.throws(
      () => assertBudgetUnder(result, { maxCostUsd: 0.10 }),
      /cost: \$0\.5000 > \$0\.1000/
    );
  });

  it('fails when duration exceeds limit', () => {
    const result = makeResult('ok', { durationMs: 10000 });
    assert.throws(
      () => assertBudgetUnder(result, { maxDurationMs: 5000 }),
      /duration: 10000ms > 5000ms/
    );
  });

  it('fails when turns exceed limit', () => {
    const result = makeResult('ok', { turns: 20 });
    assert.throws(
      () => assertBudgetUnder(result, { maxTurns: 10 }),
      /turns: 20 > 10/
    );
  });

  it('reports multiple violations', () => {
    const result = makeResult('ok', {
      usage: makeUsage(2000),
      turns: 20,
    });
    assert.throws(
      () => assertBudgetUnder(result, { maxTokens: 1000, maxTurns: 10 }),
      /tokens.*turns/
    );
  });
});

// ── assertOutputMatches ─────────────────────────────────────────

describe('assertOutputMatches', () => {
  const stringSchema: SchemaDefinition<string> = {
    parse(raw: unknown) {
      if (typeof raw === 'string') return { success: true, data: raw };
      return { success: false, errors: [`expected string, got ${typeof raw}`] };
    },
    description: 'string',
  };

  it('passes and returns data when output matches', () => {
    const result = makeResult('hello');
    const data = assertOutputMatches(result, stringSchema);
    assert.equal(data, 'hello');
  });

  it('fails when output does not match', () => {
    const result = makeResult(42);
    assert.throws(
      () => assertOutputMatches(result, stringSchema),
      /expected string, got number/
    );
  });
});
