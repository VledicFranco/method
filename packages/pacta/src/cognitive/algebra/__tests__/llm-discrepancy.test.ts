/**
 * Tests for LLM-based discrepancy function (PRD 045 frontier evaluator).
 *
 * Covers: prompt construction, response parsing, buildLLMGoalDiscrepancy
 * integration with mock provider, and fallback behavior on parse failure.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { _buildDiscrepancyPrompt, _parseDiscrepancyResponse, buildLLMGoalDiscrepancy } from '../llm-discrepancy.js';
import { moduleId } from '../module.js';
import type { GoalRepresentation } from '../goal-types.js';
import type { WorkspaceEntry } from '../workspace-types.js';
import type { ProviderAdapter, ProviderAdapterResult } from '../provider-adapter.js';

// ── Helpers ────────────────────────────────────────────────────

function entry(content: string): WorkspaceEntry {
  return {
    source: moduleId('test'),
    content,
    salience: 0.5,
    timestamp: Date.now(),
  };
}

const TEST_GOAL: GoalRepresentation = {
  objective: 'Fix the applyDiscount function to compute price minus discount correctly',
  constraints: ['Do not modify the test expectations'],
  subgoals: [],
  aspiration: 0.80,
};

function mockProvider(output: string): ProviderAdapter {
  return {
    async invoke(): Promise<ProviderAdapterResult> {
      return {
        output,
        usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 150 },
        cost: { totalUsd: 0, perModel: {} },
      };
    },
  };
}

function failingProvider(): ProviderAdapter {
  return {
    async invoke(): Promise<ProviderAdapterResult> {
      throw new Error('provider unavailable');
    },
  };
}

// ── Prompt Construction ───────────────────────────────────────

describe('LLM discrepancy: prompt construction', () => {
  it('includes goal objective', () => {
    const prompt = _buildDiscrepancyPrompt(TEST_GOAL, [], 1, 15);
    assert.ok(prompt.includes('Fix the applyDiscount function'));
  });

  it('includes constraints', () => {
    const prompt = _buildDiscrepancyPrompt(TEST_GOAL, [], 1, 15);
    assert.ok(prompt.includes('Do not modify the test expectations'));
  });

  it('includes cycle info', () => {
    const prompt = _buildDiscrepancyPrompt(TEST_GOAL, [], 5, 15);
    assert.ok(prompt.includes('CYCLE: 5 of 15'));
  });

  it('includes previous discrepancy when provided', () => {
    const prompt = _buildDiscrepancyPrompt(TEST_GOAL, [], 3, 15, 0.65);
    assert.ok(prompt.includes('Previous discrepancy: 0.650'));
  });

  it('includes workspace entries', () => {
    const ws = [entry('Created file src/pricing.ts'), entry('Write: fixed formula')];
    const prompt = _buildDiscrepancyPrompt(TEST_GOAL, ws, 2, 15);
    assert.ok(prompt.includes('Created file src/pricing.ts'));
    assert.ok(prompt.includes('Write: fixed formula'));
  });

  it('handles empty workspace', () => {
    const prompt = _buildDiscrepancyPrompt(TEST_GOAL, [], 1, 15);
    assert.ok(prompt.includes('empty — no actions taken yet'));
  });

  it('includes subgoals when present', () => {
    const goalWithSubs: GoalRepresentation = {
      ...TEST_GOAL,
      subgoals: [
        { description: 'Find the bug', satisfied: true, evidence: 'found it' },
        { description: 'Fix the formula', satisfied: false },
      ],
    };
    const prompt = _buildDiscrepancyPrompt(goalWithSubs, [], 1, 15);
    assert.ok(prompt.includes('[DONE] Find the bug'));
    assert.ok(prompt.includes('[PENDING] Fix the formula'));
  });
});

// ── Response Parsing ──────────────────────────────────────────

describe('LLM discrepancy: response parsing', () => {
  it('parses well-formed response', () => {
    const response = `<assessment>
<discrepancy>0.35</discrepancy>
<confidence>0.80</confidence>
<satisfied>false</satisfied>
<summary>Agent created the file but formula is still wrong</summary>
</assessment>`;
    const result = _parseDiscrepancyResponse(response);
    assert.ok(result);
    assert.equal(result.discrepancy, 0.35);
    assert.equal(result.confidence, 0.80);
    assert.equal(result.satisfied, false);
    assert.equal(result.summary, 'Agent created the file but formula is still wrong');
  });

  it('parses satisfied=true', () => {
    const response = `<assessment>
<discrepancy>0.05</discrepancy>
<confidence>0.95</confidence>
<satisfied>true</satisfied>
<summary>Goal fully met</summary>
</assessment>`;
    const result = _parseDiscrepancyResponse(response);
    assert.ok(result);
    assert.equal(result.satisfied, true);
  });

  it('clamps discrepancy to [0, 1]', () => {
    const response = `<assessment>
<discrepancy>1.50</discrepancy>
<confidence>-0.20</confidence>
<satisfied>false</satisfied>
<summary>test</summary>
</assessment>`;
    const result = _parseDiscrepancyResponse(response);
    assert.ok(result);
    assert.equal(result.discrepancy, 1.0);
    assert.equal(result.confidence, 0.0);
  });

  it('returns null on missing assessment tags', () => {
    assert.equal(_parseDiscrepancyResponse('just some text'), null);
  });

  it('returns null on missing required fields', () => {
    const response = `<assessment>
<discrepancy>0.5</discrepancy>
</assessment>`;
    assert.equal(_parseDiscrepancyResponse(response), null);
  });

  it('returns null on non-numeric values', () => {
    const response = `<assessment>
<discrepancy>high</discrepancy>
<confidence>medium</confidence>
<satisfied>false</satisfied>
<summary>test</summary>
</assessment>`;
    assert.equal(_parseDiscrepancyResponse(response), null);
  });

  it('handles extra whitespace', () => {
    const response = `<assessment>
  <discrepancy>  0.42  </discrepancy>
  <confidence>  0.77  </confidence>
  <satisfied>  true  </satisfied>
  <summary>  All done  </summary>
</assessment>`;
    const result = _parseDiscrepancyResponse(response);
    assert.ok(result);
    assert.equal(result.discrepancy, 0.42);
    assert.equal(result.confidence, 0.77);
    assert.equal(result.satisfied, true);
    assert.equal(result.summary, 'All done');
  });
});

// ── buildLLMGoalDiscrepancy Integration ───────────────────────

describe('LLM discrepancy: buildLLMGoalDiscrepancy', () => {
  it('returns GoalDiscrepancy from valid LLM response', async () => {
    const provider = mockProvider(`<assessment>
<discrepancy>0.40</discrepancy>
<confidence>0.85</confidence>
<satisfied>false</satisfied>
<summary>File created but logic incomplete</summary>
</assessment>`);

    const result = await buildLLMGoalDiscrepancy(
      provider, [entry('some work')], TEST_GOAL, 3, 15, undefined, moduleId('evaluator'),
    );

    assert.ok(result);
    assert.equal(result.discrepancy.type, 'goal-discrepancy');
    assert.equal(result.discrepancy.discrepancy, 0.40);
    assert.equal(result.discrepancy.confidence, 0.85);
    assert.equal(result.discrepancy.satisfied, false);
    assert.ok(result.discrepancy.basis.startsWith('llm-assessment:'));
    assert.equal(result.tokensUsed, 150);
  });

  it('computes positive rate when discrepancy decreases', async () => {
    const provider = mockProvider(`<assessment>
<discrepancy>0.30</discrepancy>
<confidence>0.80</confidence>
<satisfied>false</satisfied>
<summary>Progress made</summary>
</assessment>`);

    const result = await buildLLMGoalDiscrepancy(
      provider, [entry('work')], TEST_GOAL, 2, 15, 0.60, moduleId('evaluator'),
    );

    assert.ok(result);
    // rate = previousDiscrepancy - current = 0.60 - 0.30 = 0.30 (positive = improving)
    assert.ok(result.discrepancy.rate > 0, `Expected positive rate, got ${result.discrepancy.rate}`);
  });

  it('returns null on provider error (for fallback)', async () => {
    const provider = failingProvider();
    const result = await buildLLMGoalDiscrepancy(
      provider, [entry('work')], TEST_GOAL, 1, 15, undefined, moduleId('evaluator'),
    );
    assert.equal(result, null);
  });

  it('returns null on unparseable LLM output (for fallback)', async () => {
    const provider = mockProvider('Sorry, I cannot assess this task properly.');
    const result = await buildLLMGoalDiscrepancy(
      provider, [entry('work')], TEST_GOAL, 1, 15, undefined, moduleId('evaluator'),
    );
    assert.equal(result, null);
  });
});
