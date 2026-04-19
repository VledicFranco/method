// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for createAgent composition function.
 *
 * Tests: composition, capability validation, middleware wiring.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { createAgent, CapabilityError } from './create-agent.js';
import type { AgentProvider, ProviderCapabilities } from '../ports/agent-provider.js';
import type { Pact, AgentRequest, AgentResult, TokenUsage, CostReport } from '../pact.js';

// ── Test Helpers ─────────────────────────────────────────────────

function makeUsage(total = 100): TokenUsage {
  return { inputTokens: 60, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: total };
}

function makeCost(usd = 0.01): CostReport {
  return { totalUsd: usd, perModel: {} };
}

function makeResult(output: unknown, overrides?: Partial<AgentResult<unknown>>): AgentResult<unknown> {
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

function makeProvider(
  caps?: Partial<ProviderCapabilities>,
  invokeFn?: (pact: Pact, req: AgentRequest) => Promise<AgentResult<unknown>>,
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
    invoke: (invokeFn ?? (async () => makeResult('hello'))) as AgentProvider['invoke'],
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('createAgent', () => {
  it('creates an agent with invoke() method', () => {
    const agent = createAgent({
      pact: { mode: { type: 'oneshot' } },
      provider: makeProvider(),
    });

    assert.ok(agent.invoke, 'agent has invoke method');
    assert.ok(typeof agent.invoke === 'function');
    assert.deepStrictEqual(agent.pact.mode, { type: 'oneshot' });
    assert.equal(agent.provider.name, 'test-provider');
  });

  it('invoke() returns a result from the provider', async () => {
    const agent = createAgent({
      pact: { mode: { type: 'oneshot' } },
      provider: makeProvider(undefined, async () => makeResult('test-output')),
    });

    const result = await agent.invoke({ prompt: 'hello' });
    assert.equal(result.output, 'test-output');
    assert.equal(result.completed, true);
    assert.equal(result.stopReason, 'complete');
  });

  describe('capability validation', () => {
    it('throws CapabilityError when mode is not supported', () => {
      assert.throws(
        () => createAgent({
          pact: { mode: { type: 'resumable' } },
          provider: makeProvider({ modes: ['oneshot'] }),
        }),
        (err: unknown) => {
          assert.ok(err instanceof CapabilityError);
          assert.ok((err as CapabilityError).message.includes('resumable'));
          return true;
        },
      );
    });

    it('throws CapabilityError when streaming requested but not supported', () => {
      assert.throws(
        () => createAgent({
          pact: { mode: { type: 'oneshot' }, streaming: true },
          provider: makeProvider({ streaming: false }),
        }),
        (err: unknown) => {
          assert.ok(err instanceof CapabilityError);
          assert.ok((err as CapabilityError).message.includes('streaming'));
          return true;
        },
      );
    });

    it('accepts valid capability combinations', () => {
      const agent = createAgent({
        pact: { mode: { type: 'resumable' }, streaming: true },
        provider: makeProvider({ modes: ['oneshot', 'resumable'], streaming: true }),
      });
      assert.ok(agent);
    });
  });

  describe('middleware wiring', () => {
    it('wires budget enforcer when budget is declared', async () => {
      let invocations = 0;
      const agent = createAgent({
        pact: {
          mode: { type: 'oneshot' },
          budget: { maxTurns: 1 },
        },
        provider: makeProvider(undefined, async () => {
          invocations++;
          return makeResult('ok');
        }),
      });

      // First invoke should succeed
      await agent.invoke({ prompt: 'first' });
      assert.equal(invocations, 1);

      // Second invoke should be stopped by budget (maxTurns: 1 already consumed)
      const r2 = await agent.invoke({ prompt: 'second' });
      assert.equal(r2.stopReason, 'budget_exhausted');
      assert.equal(r2.completed, false);
      // Provider should NOT have been called again
      assert.equal(invocations, 1);
    });

    it('wires output validator when schema is declared', async () => {
      let callCount = 0;
      const agent = createAgent({
        pact: {
          mode: { type: 'oneshot' },
          output: {
            schema: {
              parse: (raw: unknown) => {
                if (typeof raw === 'string' && raw.startsWith('{')) {
                  return { success: true as const, data: raw };
                }
                return { success: false as const, errors: ['Expected JSON string'] };
              },
            },
            retryOnValidationFailure: true,
            maxRetries: 1,
          },
        },
        provider: makeProvider(undefined, async () => {
          callCount++;
          if (callCount === 1) return makeResult('not-json');
          return makeResult('{"valid": true}');
        }),
      });

      const result = await agent.invoke({ prompt: 'give me json' });
      assert.equal(callCount, 2, 'provider should be called twice (initial + retry)');
      assert.equal(result.output, '{"valid": true}');
    });
  });
});
