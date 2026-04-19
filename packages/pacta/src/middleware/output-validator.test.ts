// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for the output validator middleware.
 *
 * Tests: schema validation, retry logic, budget interaction.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { outputValidator } from './output-validator.js';
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

// Schema that accepts only numbers
const numberSchema = {
  parse(raw: unknown) {
    if (typeof raw === 'number') {
      return { success: true as const, data: raw };
    }
    return { success: false as const, errors: [`Expected number, got ${typeof raw}`] };
  },
  description: 'A number',
};

type InvokeFn = (pact: Pact, request: AgentRequest) => Promise<AgentResult<unknown>>;

// ── Tests ────────────────────────────────────────────────────────

describe('outputValidator', () => {
  describe('valid output', () => {
    it('passes through when output matches schema', async () => {
      const pact: Pact = {
        mode: { type: 'oneshot' },
        output: { schema: numberSchema },
      };
      const inner: InvokeFn = async () => makeResult(42);
      const validated = outputValidator(inner, pact);

      const result = await validated(pact, { prompt: 'test' });
      assert.equal(result.output, 42);
      assert.equal(result.completed, true);
    });
  });

  describe('invalid output with retry', () => {
    it('retries on schema mismatch and succeeds', async () => {
      let callCount = 0;
      const pact: Pact = {
        mode: { type: 'oneshot' },
        output: {
          schema: numberSchema,
          retryOnValidationFailure: true,
          maxRetries: 2,
        },
      };
      const inner: InvokeFn = async () => {
        callCount++;
        if (callCount === 1) return makeResult('not a number');
        return makeResult(42);
      };
      const validated = outputValidator(inner, pact);

      const result = await validated(pact, { prompt: 'test' });
      assert.equal(callCount, 2);
      assert.equal(result.output, 42);
      assert.equal(result.completed, true);
    });

    it('gives up after maxRetries and returns error', async () => {
      const pact: Pact = {
        mode: { type: 'oneshot' },
        output: {
          schema: numberSchema,
          retryOnValidationFailure: true,
          maxRetries: 1,
        },
      };
      const inner: InvokeFn = async () => makeResult('not a number');
      const events: AgentEvent[] = [];
      const validated = outputValidator(inner, pact, (e) => events.push(e));

      const result = await validated(pact, { prompt: 'test' });
      assert.equal(result.completed, false);
      assert.equal(result.stopReason, 'error');

      const reflection = events.find(e => e.type === 'reflection');
      assert.ok(reflection, 'should emit reflection event on retry');

      const error = events.find(e => e.type === 'error');
      assert.ok(error, 'should emit error event when giving up');
    });

    it('emits reflection events during retries', async () => {
      let callCount = 0;
      const pact: Pact = {
        mode: { type: 'oneshot' },
        output: {
          schema: numberSchema,
          retryOnValidationFailure: true,
          maxRetries: 3,
        },
      };
      const inner: InvokeFn = async () => {
        callCount++;
        if (callCount <= 2) return makeResult('bad');
        return makeResult(42);
      };
      const events: AgentEvent[] = [];
      const validated = outputValidator(inner, pact, (e) => events.push(e));

      await validated(pact, { prompt: 'test' });
      const reflections = events.filter(e => e.type === 'reflection');
      assert.equal(reflections.length, 2, 'should emit reflection for each retry');
    });
  });

  describe('retry disabled', () => {
    it('returns error immediately when retryOnValidationFailure is false', async () => {
      const pact: Pact = {
        mode: { type: 'oneshot' },
        output: {
          schema: numberSchema,
          retryOnValidationFailure: false,
        },
      };
      const inner: InvokeFn = async () => makeResult('bad');
      const validated = outputValidator(inner, pact);

      const result = await validated(pact, { prompt: 'test' });
      assert.equal(result.completed, false);
      assert.equal(result.stopReason, 'error');
    });
  });

  describe('budget interaction', () => {
    it('does not retry when result indicates budget exhaustion', async () => {
      let callCount = 0;
      const pact: Pact = {
        mode: { type: 'oneshot' },
        output: {
          schema: numberSchema,
          retryOnValidationFailure: true,
          maxRetries: 3,
        },
      };
      const inner: InvokeFn = async () => {
        callCount++;
        return makeResult('bad', {
          completed: false,
          stopReason: 'budget_exhausted',
        });
      };
      const validated = outputValidator(inner, pact);

      const result = await validated(pact, { prompt: 'test' });
      assert.equal(callCount, 1, 'should not retry when budget is exhausted');
      assert.equal(result.stopReason, 'budget_exhausted');
    });
  });

  describe('no schema', () => {
    it('passes through when no schema is defined', async () => {
      const pact: Pact = {
        mode: { type: 'oneshot' },
        output: {},
      };
      const inner: InvokeFn = async () => makeResult('anything');
      const validated = outputValidator(inner, pact);

      const result = await validated(pact, { prompt: 'test' });
      assert.equal(result.output, 'anything');
      assert.equal(result.completed, true);
    });
  });
});
