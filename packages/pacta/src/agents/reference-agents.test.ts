// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for reference agents and .with() customization pattern.
 *
 * Tests: default configuration, .with() deep merge, immutability.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { codeAgent } from './code-agent.js';
import { researchAgent } from './research-agent.js';
import { reviewAgent } from './review-agent.js';
import type { AgentProvider, ProviderCapabilities } from '../ports/agent-provider.js';
import type { Pact, AgentRequest, AgentResult, TokenUsage, CostReport } from '../pact.js';

// ── Test Helpers ─────────────────────────────────────────────────

function makeUsage(total = 100): TokenUsage {
  return { inputTokens: 60, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: total };
}

function makeCost(usd = 0.01): CostReport {
  return { totalUsd: usd, perModel: {} };
}

function makeResult(output: unknown): AgentResult<unknown> {
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

function makeProvider(
  caps?: Partial<ProviderCapabilities>,
): AgentProvider {
  return {
    name: 'test-provider',
    capabilities() {
      return {
        modes: ['oneshot', 'resumable', 'persistent'],
        streaming: true,
        resumable: true,
        budgetEnforcement: 'client',
        outputValidation: 'client',
        toolModel: 'none',
        ...caps,
      };
    },
    invoke: (async () => makeResult('ok')) as AgentProvider['invoke'],
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('codeAgent', () => {
  it('creates agent with correct defaults', () => {
    const agent = codeAgent({ provider: makeProvider() });

    assert.deepStrictEqual(agent.pact.mode, { type: 'oneshot' });
    assert.equal(agent.pact.budget?.maxTurns, 20);
    assert.equal(agent.pact.budget?.maxCostUsd, 2.0);
    assert.deepStrictEqual(agent.pact.scope?.allowedTools, [
      'Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash',
    ]);
  });

  it('invoke() delegates to provider and returns result', async () => {
    const provider = makeProvider();
    const agent = codeAgent({ provider });
    const result = await agent.invoke({ prompt: 'Fix the bug', workdir: '/project' });

    assert.equal(result.output, 'ok');
    assert.equal(result.completed, true);
  });

  it('.with() overrides budget without mutating original', () => {
    const original = codeAgent({ provider: makeProvider() });
    const customized = original.with({ pact: { budget: { maxTurns: 10 } } });

    // Customized agent has new budget
    assert.equal(customized.pact.budget?.maxTurns, 10);
    // maxCostUsd is preserved from deep merge
    assert.equal(customized.pact.budget?.maxCostUsd, 2.0);

    // Original is NOT mutated
    assert.equal(original.pact.budget?.maxTurns, 20);
    assert.equal(original.pact.budget?.maxCostUsd, 2.0);
  });

  it('.with() deep merges pact (nested objects merged, not replaced)', () => {
    const original = codeAgent({ provider: makeProvider() });
    const customized = original.with({
      pact: {
        budget: { maxCostUsd: 5.0 },
        scope: { model: 'claude-sonnet-4-6' },
      },
    });

    // Budget fields are merged
    assert.equal(customized.pact.budget?.maxTurns, 20, 'maxTurns preserved');
    assert.equal(customized.pact.budget?.maxCostUsd, 5.0, 'maxCostUsd overridden');

    // Scope fields are merged
    assert.deepStrictEqual(
      customized.pact.scope?.allowedTools,
      ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'],
      'allowedTools preserved',
    );
    assert.equal(customized.pact.scope?.model, 'claude-sonnet-4-6', 'model added');
  });

  it('.with() can swap provider', () => {
    const provider1 = makeProvider();
    const provider2: AgentProvider = {
      ...makeProvider(),
      name: 'provider-2',
    };

    const original = codeAgent({ provider: provider1 });
    const customized = original.with({ provider: provider2 });

    assert.equal(original.provider.name, 'test-provider');
    assert.equal(customized.provider.name, 'provider-2');
  });
});

describe('researchAgent', () => {
  it('has correct default scope', () => {
    const agent = researchAgent({ provider: makeProvider() });

    assert.deepStrictEqual(agent.pact.mode, { type: 'oneshot' });
    assert.equal(agent.pact.budget?.maxTurns, 30);
    assert.equal(agent.pact.budget?.maxCostUsd, 1.0);
    assert.deepStrictEqual(agent.pact.scope?.allowedTools, [
      'Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch',
    ]);
  });

  it('.with() returns customized agent', () => {
    const agent = researchAgent({ provider: makeProvider() });
    const customized = agent.with({ pact: { budget: { maxTurns: 10 } } });

    assert.equal(customized.pact.budget?.maxTurns, 10);
    assert.equal(customized.pact.budget?.maxCostUsd, 1.0);
    // Original unchanged
    assert.equal(agent.pact.budget?.maxTurns, 30);
  });
});

describe('reviewAgent', () => {
  it('has correct default scope (read-only tools)', () => {
    const agent = reviewAgent({ provider: makeProvider() });

    assert.deepStrictEqual(agent.pact.mode, { type: 'oneshot' });
    assert.equal(agent.pact.budget?.maxTurns, 15);
    assert.equal(agent.pact.budget?.maxCostUsd, 1.0);
    assert.deepStrictEqual(agent.pact.scope?.allowedTools, [
      'Read', 'Grep', 'Glob',
    ]);
  });

  it('.with() preserves default scope tools when overriding budget', () => {
    const agent = reviewAgent({ provider: makeProvider() });
    const customized = agent.with({ pact: { budget: { maxTurns: 5 } } });

    assert.equal(customized.pact.budget?.maxTurns, 5);
    assert.deepStrictEqual(customized.pact.scope?.allowedTools, [
      'Read', 'Grep', 'Glob',
    ]);
  });
});

describe('.with() immutability', () => {
  it('chained .with() calls each produce independent agents', () => {
    const base = codeAgent({ provider: makeProvider() });
    const a = base.with({ pact: { budget: { maxTurns: 5 } } });
    const b = base.with({ pact: { budget: { maxTurns: 50 } } });

    assert.equal(base.pact.budget?.maxTurns, 20);
    assert.equal(a.pact.budget?.maxTurns, 5);
    assert.equal(b.pact.budget?.maxTurns, 50);
  });

  it('.with() on a .with() result works correctly', () => {
    const base = codeAgent({ provider: makeProvider() });
    const step1 = base.with({ pact: { budget: { maxTurns: 10 } } });
    const step2 = step1.with({ pact: { budget: { maxCostUsd: 5.0 } } });

    assert.equal(step2.pact.budget?.maxTurns, 10, 'preserves step1 maxTurns');
    assert.equal(step2.pact.budget?.maxCostUsd, 5.0, 'overrides maxCostUsd');
    // Previous steps unchanged
    assert.equal(step1.pact.budget?.maxCostUsd, 2.0);
    assert.equal(base.pact.budget?.maxTurns, 20);
  });
});
