/**
 * Unit tests for the budget enforcer middleware.
 *
 * Tests: turn counting, cost tracking, exhaustion behavior, warning events.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { budgetEnforcer, BudgetExhaustedError } from './budget-enforcer.js';
import type { Pact, AgentRequest, AgentResult, TokenUsage, CostReport } from '../pact.js';
import type { AgentEvent } from '../events.js';

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

type InvokeFn = (pact: Pact, request: AgentRequest) => Promise<AgentResult<unknown>>;

function makeInner(result: AgentResult<unknown>): { fn: InvokeFn; getCalls: () => number } {
  let calls = 0;
  const fn: InvokeFn = async () => {
    calls++;
    return result;
  };
  return { fn, getCalls: () => calls };
}

// ── Tests ────────────────────────────────────────────────────────

describe('budgetEnforcer', () => {
  describe('turn counting', () => {
    it('allows invocations within turn limit', async () => {
      const pact: Pact = { mode: { type: 'oneshot' }, budget: { maxTurns: 3 } };
      const { fn } = makeInner(makeResult('ok'));
      const enforced = budgetEnforcer(fn, pact);

      const r1 = await enforced(pact, { prompt: '1' });
      assert.equal(r1.stopReason, 'complete');

      const r2 = await enforced(pact, { prompt: '2' });
      assert.equal(r2.stopReason, 'complete');

      const r3 = await enforced(pact, { prompt: '3' });
      // Third invocation reaches the limit (3 turns consumed = maxTurns)
      assert.equal(r3.stopReason, 'budget_exhausted');
    });

    it('stops execution when maxTurns exceeded (pre-check)', async () => {
      const pact: Pact = { mode: { type: 'oneshot' }, budget: { maxTurns: 1 } };
      const { fn, getCalls } = makeInner(makeResult('ok'));
      const enforced = budgetEnforcer(fn, pact);

      await enforced(pact, { prompt: '1' });
      const r2 = await enforced(pact, { prompt: '2' });

      assert.equal(r2.stopReason, 'budget_exhausted');
      assert.equal(r2.completed, false);
      assert.equal(getCalls(), 1, 'provider should only be called once');
    });
  });

  describe('token tracking', () => {
    it('emits budget_exhausted when token limit exceeded', async () => {
      const pact: Pact = { mode: { type: 'oneshot' }, budget: { maxTokens: 150 } };
      const events: AgentEvent[] = [];
      const { fn } = makeInner(makeResult('ok', { usage: makeUsage(200) }));
      const enforced = budgetEnforcer(fn, pact, (e) => events.push(e));

      const result = await enforced(pact, { prompt: 'test' });
      assert.equal(result.stopReason, 'budget_exhausted');

      const exhausted = events.find(e => e.type === 'budget_exhausted');
      assert.ok(exhausted, 'should emit budget_exhausted event');
      if (exhausted?.type === 'budget_exhausted') {
        assert.equal(exhausted.resource, 'tokens');
      }
    });
  });

  describe('cost tracking', () => {
    it('emits budget_warning at 80% cost consumption', async () => {
      const pact: Pact = { mode: { type: 'oneshot' }, budget: { maxCostUsd: 1.0 } };
      const events: AgentEvent[] = [];
      const { fn } = makeInner(makeResult('ok', { cost: makeCost(0.85) }));
      const enforced = budgetEnforcer(fn, pact, (e) => events.push(e));

      await enforced(pact, { prompt: 'test' });

      const warning = events.find(e => e.type === 'budget_warning');
      assert.ok(warning, 'should emit budget_warning event');
      if (warning?.type === 'budget_warning') {
        assert.equal(warning.resource, 'cost');
      }
    });
  });

  describe('exhaustion policies', () => {
    it('stops execution with onExhaustion=stop (default)', async () => {
      const pact: Pact = { mode: { type: 'oneshot' }, budget: { maxTurns: 1, onExhaustion: 'stop' } };
      const { fn } = makeInner(makeResult('ok'));
      const enforced = budgetEnforcer(fn, pact);

      await enforced(pact, { prompt: '1' });
      const r2 = await enforced(pact, { prompt: '2' });
      assert.equal(r2.stopReason, 'budget_exhausted');
      assert.equal(r2.completed, false);
    });

    it('throws BudgetExhaustedError with onExhaustion=error', async () => {
      const pact: Pact = { mode: { type: 'oneshot' }, budget: { maxTurns: 2, onExhaustion: 'error' } };
      const { fn } = makeInner(makeResult('ok'));
      const enforced = budgetEnforcer(fn, pact);

      // First call succeeds (1 turn consumed, limit is 2)
      await enforced(pact, { prompt: '1' });
      // Second call succeeds in invoke but post-check hits limit (2 turns = maxTurns)
      await assert.rejects(
        () => enforced(pact, { prompt: '2' }),
        (err: unknown) => {
          assert.ok(err instanceof BudgetExhaustedError);
          assert.equal((err as BudgetExhaustedError).resource, 'turns');
          return true;
        },
      );
    });

    it('continues with warning on onExhaustion=warn', async () => {
      const pact: Pact = { mode: { type: 'oneshot' }, budget: { maxTurns: 1, onExhaustion: 'warn' } };
      const events: AgentEvent[] = [];
      const { fn } = makeInner(makeResult('ok'));
      const enforced = budgetEnforcer(fn, pact, (e) => events.push(e));

      const r1 = await enforced(pact, { prompt: '1' });
      // With 'warn', the post-check emits exhausted but doesn't stop
      assert.equal(r1.completed, true);

      // The exhausted event should still be emitted
      const exhausted = events.find(e => e.type === 'budget_exhausted');
      assert.ok(exhausted, 'should still emit budget_exhausted event');
    });
  });

  describe('no budget declared', () => {
    it('passes through when no budget is set', async () => {
      const pact: Pact = { mode: { type: 'oneshot' } };
      const { fn } = makeInner(makeResult('ok'));
      const enforced = budgetEnforcer(fn, pact);

      const result = await enforced(pact, { prompt: 'test' });
      assert.equal(result.stopReason, 'complete');
      assert.equal(result.completed, true);
    });
  });

  // ── PRD-059 / S3 §4 — Predictive mode ────────────────────────────
  describe('predictive mode (PRD-059)', () => {
    it('emits tokens budget_exhausted event but does NOT stop', async () => {
      const pact: Pact = { mode: { type: 'oneshot' }, budget: { maxTokens: 150 } };
      const events: AgentEvent[] = [];
      const { fn } = makeInner(makeResult('ok', { usage: makeUsage(200) }));
      const enforced = budgetEnforcer(fn, pact, (e) => events.push(e), { mode: 'predictive' });

      const result = await enforced(pact, { prompt: 'test' });

      // Inner result flows through — no stopReason override, no throw.
      assert.equal(result.stopReason, 'complete');
      assert.equal(result.completed, true);

      // But the event IS emitted (observability path).
      const exhausted = events.find(e => e.type === 'budget_exhausted');
      assert.ok(exhausted, 'predictive mode should still emit budget_exhausted');
      if (exhausted?.type === 'budget_exhausted') {
        assert.equal(exhausted.resource, 'tokens');
      }
    });

    it('emits cost budget_exhausted event but does NOT stop', async () => {
      const pact: Pact = { mode: { type: 'oneshot' }, budget: { maxCostUsd: 0.5 } };
      const events: AgentEvent[] = [];
      const { fn } = makeInner(makeResult('ok', { cost: makeCost(1.0) }));
      const enforced = budgetEnforcer(fn, pact, (e) => events.push(e), { mode: 'predictive' });

      const result = await enforced(pact, { prompt: 'test' });
      assert.equal(result.stopReason, 'complete');
      assert.equal(result.completed, true);

      const exhausted = events.find(e => e.type === 'budget_exhausted');
      assert.ok(exhausted);
      if (exhausted?.type === 'budget_exhausted') {
        assert.equal(exhausted.resource, 'cost');
      }
    });

    it('does NOT throw on onExhaustion=error for cost/tokens in predictive mode', async () => {
      const pact: Pact = {
        mode: { type: 'oneshot' },
        budget: { maxTokens: 50, onExhaustion: 'error' },
      };
      const { fn } = makeInner(makeResult('ok', { usage: makeUsage(200) }));
      const enforced = budgetEnforcer(fn, pact, undefined, { mode: 'predictive' });

      // Should NOT throw — predictive mode downgrades cost/tokens.
      const result = await enforced(pact, { prompt: 'test' });
      assert.equal(result.completed, true);
    });

    it('still enforces turns authoritatively in predictive mode (pre-check stop)', async () => {
      const pact: Pact = { mode: { type: 'oneshot' }, budget: { maxTurns: 1 } };
      const { fn, getCalls } = makeInner(makeResult('ok'));
      const enforced = budgetEnforcer(fn, pact, undefined, { mode: 'predictive' });

      await enforced(pact, { prompt: '1' });
      const r2 = await enforced(pact, { prompt: '2' });

      assert.equal(r2.stopReason, 'budget_exhausted');
      assert.equal(r2.completed, false);
      assert.equal(getCalls(), 1, 'provider should only be called once');
    });

    it('still enforces turns authoritatively on post-check in predictive mode', async () => {
      const pact: Pact = { mode: { type: 'oneshot' }, budget: { maxTurns: 1 } };
      const { fn } = makeInner(makeResult('ok'));
      const enforced = budgetEnforcer(fn, pact, undefined, { mode: 'predictive' });

      // First call — turns reaches the limit on post-check.
      const r1 = await enforced(pact, { prompt: '1' });
      assert.equal(r1.stopReason, 'budget_exhausted', 'post-check turns should stop');
    });

    it('still enforces duration authoritatively in predictive mode', async () => {
      const pact: Pact = { mode: { type: 'oneshot' }, budget: { maxDurationMs: 0 } };
      const { fn } = makeInner(makeResult('ok'));
      const enforced = budgetEnforcer(fn, pact, undefined, { mode: 'predictive' });

      // maxDurationMs: 0 with any post-check delay triggers exhaustion.
      const r1 = await enforced(pact, { prompt: '1' });
      // The first invocation's pre-check sees elapsed=0 which is not >= 0? Actually
      // the pre-check uses `elapsed >= budget.maxDurationMs` so 0 >= 0 => exhausted on first call.
      assert.equal(r1.stopReason, 'budget_exhausted');
      assert.equal(r1.completed, false);
    });

    it('default mode (authoritative) is byte-equivalent to omitting options', async () => {
      // Regression: passing { mode: 'authoritative' } must behave identically
      // to calling without options.
      const pact: Pact = { mode: { type: 'oneshot' }, budget: { maxTokens: 50 } };
      const { fn: fnA } = makeInner(makeResult('ok', { usage: makeUsage(200) }));
      const enforcedA = budgetEnforcer(fnA, pact);
      const rA = await enforcedA(pact, { prompt: 'test' });

      const { fn: fnB } = makeInner(makeResult('ok', { usage: makeUsage(200) }));
      const enforcedB = budgetEnforcer(fnB, pact, undefined, { mode: 'authoritative' });
      const rB = await enforcedB(pact, { prompt: 'test' });

      assert.equal(rA.stopReason, rB.stopReason);
      assert.equal(rA.completed, rB.completed);
      assert.equal(rA.stopReason, 'budget_exhausted');
    });
  });
});
