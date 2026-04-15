/**
 * Unit tests for `createMethodAgent` — covers the core PRD-058 acceptance
 * criteria for the factory (not the sample app end-to-end).
 *
 * Gates exercised here:
 *   - G-BUDGET-SINGLE-AUTHORITY (enforcer wires in predictive mode for Cortex provider)
 *   - G-STRICT-MODE-REFUSAL
 *   - G-EVENTS-MUTEX (events() + onEvent mutex)
 *   - G-AUDIT-WIRED (audit middleware bumps auditEventCount)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Pact } from '@method/pacta';
import { createMethodAgent } from './create-method-agent.js';
import { ConfigurationError, MissingCtxError, IllegalStateError } from './errors.js';
import { makeMockCtx } from './test-support/mock-ctx.js';

function oneshotPact(): Pact<{ ok: boolean }> {
  return {
    mode: { type: 'oneshot' },
    budget: {
      maxTurns: 3,
      maxTokens: 10_000,
      maxCostUsd: 0.01, // tiny — exercises predictive mode (no rejection on exhaustion)
      onExhaustion: 'stop',
    },
  };
}

describe('createMethodAgent factory', () => {
  it('returns a MethodAgent and invokes ctx.llm.complete once', async () => {
    const { ctx, spies } = makeMockCtx({ appId: 'triage-app', tier: 'tool' });
    const agent = createMethodAgent({ ctx, pact: oneshotPact() });
    const result = await agent.invoke({ prompt: 'triage this' });
    assert.strictEqual(spies.llmComplete.callCount(), 1, 'ctx.llm.complete called once');
    assert.strictEqual(result.appId, 'triage-app');
    assert.ok(result.auditEventCount > 0, 'auditEventCount should be > 0');
  });

  it('G-AUDIT-WIRED: ctx.audit.event called at least once per invocation', async () => {
    const { ctx, spies } = makeMockCtx();
    const agent = createMethodAgent({ ctx, pact: oneshotPact() });
    await agent.invoke({ prompt: 'go' });
    assert.ok(spies.auditEvent.callCount() >= 1, 'audit emitted');
  });

  it('G-BUDGET-SINGLE-AUTHORITY: cost exhaustion does NOT stop the agent in predictive mode', async () => {
    // LLM reports $0.03 — way over pact.budget.maxCostUsd=$0.01. In predictive
    // mode the enforcer emits warning but does not reject.
    const { ctx } = makeMockCtx({
      llmResponse: { costUsd: 0.03 },
    });
    const agent = createMethodAgent({ ctx, pact: oneshotPact() });
    const result = await agent.invoke({ prompt: 'over budget' });
    // Completed normally even though we're > maxCostUsd.
    assert.strictEqual(result.stopReason, 'complete');
    assert.strictEqual(result.completed, true);
  });

  it('G-STRICT-MODE-REFUSAL: custom provider + tier=service + strict throws ConfigurationError', () => {
    const { ctx } = makeMockCtx({ tier: 'service' });
    const fakeProvider = {
      name: 'fake',
      capabilities: () => ({
        modes: ['oneshot' as const],
        streaming: false,
        resumable: false,
        budgetEnforcement: 'none' as const,
        outputValidation: 'none' as const,
        toolModel: 'none' as const,
      }),
      invoke: async () => {
        throw new Error('never');
      },
    };
    assert.throws(
      () =>
        createMethodAgent({
          ctx,
          pact: oneshotPact(),
          provider: fakeProvider,
        }),
      (err: unknown) => err instanceof ConfigurationError && err.reasons.includes('strict-mode-custom-provider'),
    );
  });

  it('MissingCtxError when ctx.llm is absent', () => {
    const { ctx } = makeMockCtx();
    const broken = { ...ctx, llm: undefined } as unknown as Parameters<typeof createMethodAgent>[0]['ctx'];
    assert.throws(
      () => createMethodAgent({ ctx: broken, pact: oneshotPact() }),
      MissingCtxError,
    );
  });

  it('G-EVENTS-MUTEX: events() after onEvent throws IllegalStateError', () => {
    const { ctx } = makeMockCtx();
    const agent = createMethodAgent({
      ctx,
      pact: oneshotPact(),
      onEvent: () => {
        /* no-op */
      },
      eventsChannel: 'async-iterable',
    });
    assert.throws(() => agent.events(), IllegalStateError);
  });

  it('events() iterable delivers the agent event stream', async () => {
    const { ctx } = makeMockCtx();
    const agent = createMethodAgent({
      ctx,
      pact: oneshotPact(),
      eventsChannel: 'async-iterable',
    });
    const iterator = agent.events()[Symbol.asyncIterator]();
    const resultP = agent.invoke({ prompt: 'hello' });
    const first = await iterator.next();
    assert.strictEqual(first.done, false);
    await resultP;
  });

  it('dispose() is idempotent', async () => {
    const { ctx } = makeMockCtx();
    const agent = createMethodAgent({ ctx, pact: oneshotPact() });
    await agent.dispose();
    await agent.dispose();
  });

  it('abort() is cooperative (no-op for unknown sessionId)', async () => {
    const { ctx } = makeMockCtx();
    const agent = createMethodAgent({ ctx, pact: oneshotPact() });
    await agent.abort('no-such-session');
  });

  it('auto-wires event connector when ctx.events present', async () => {
    const { ctx, spies } = makeMockCtx({ includeEvents: true });
    const agent = createMethodAgent({ ctx, pact: oneshotPact() });
    await agent.invoke({ prompt: 'go' });
    assert.ok(spies.eventsPublish.callCount() >= 1, 'events publish called');
  });
});
