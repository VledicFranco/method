// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for InProcessCrossAppInvoker (PRD-067 Track A simulator).
 *
 * Covers:
 *   - Basic register + invoke happy path
 *   - Idempotency caching
 *   - Depth-cap rejection (G-DELEGATION-DEPTH-CAP)
 *   - Unknown target app / operation (simulator analogue of allowlist failure)
 *   - Allowlist override (G-TARGET-ALLOWLIST)
 *   - Target handler throws → wrapped as CrossAppTargetError (G-FAILURE-ISOLATION)
 *   - capabilities() reports registered apps
 *   - assertCrossAppTargetsAllowed compose-time check
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CrossAppDelegationDepthExceededError,
  CrossAppTargetError,
  CrossAppTargetNotDeclaredError,
  CrossAppTargetUnknownError,
  NullCrossAppInvoker,
  CrossAppNotConfiguredError,
  assertCrossAppTargetsAllowed,
  CROSS_APP_DEFAULT_MAX_DELEGATION_DEPTH,
  type DelegationCarry,
} from '../ports/cross-app-invoker.js';
import { InProcessCrossAppInvoker } from './in-process-cross-app-invoker.js';

function delegation(currentDepth = 0): DelegationCarry {
  return {
    parentToken: 'test-token',
    currentDepth,
    originatingRequestId: 'req-test',
  };
}

describe('InProcessCrossAppInvoker', () => {
  it('dispatches a registered operation and returns typed output', async () => {
    const invoker = new InProcessCrossAppInvoker();
    invoker.registerApp('feature-dev-agent', {
      commission_fix: (input: { label: string }) => ({
        pr_url: `https://example/pr?label=${input.label}`,
        effort: 'S',
      }),
    });

    const result = await invoker.invoke<{ label: string }, { pr_url: string; effort: string }>({
      targetAppId: 'feature-dev-agent',
      operation: 'commission_fix',
      input: { label: 'defect' },
      delegation: delegation(1),
      caller: { sessionId: 's1', nodeId: 'commission' },
    });

    assert.equal(result.output.pr_url, 'https://example/pr?label=defect');
    assert.equal(result.output.effort, 'S');
    assert.ok(result.targetDecisionId.startsWith('in-proc-decision-'));
    assert.equal(result.callerCostUsd, 0);
    assert.ok(result.latencyMs >= 0);
  });

  it('caches results by idempotency key', async () => {
    const invoker = new InProcessCrossAppInvoker();
    let callCount = 0;
    invoker.registerApp('worker', {
      do: () => {
        callCount += 1;
        return { callCount };
      },
    });

    const req = {
      targetAppId: 'worker',
      operation: 'do',
      input: {},
      idempotencyKey: 'fixed-key',
      delegation: delegation(0),
      caller: { sessionId: 's', nodeId: 'n' },
    } as const;
    const r1 = await invoker.invoke(req);
    const r2 = await invoker.invoke(req);
    assert.equal(callCount, 1, 'handler must run once for same idempotency key');
    assert.deepEqual(r1.output, r2.output);
    assert.equal(r1.targetDecisionId, r2.targetDecisionId);

    invoker.clearIdempotencyCache();
    await invoker.invoke(req);
    assert.equal(callCount, 2, 'clearIdempotencyCache allows re-execution');
  });

  it('rejects when delegation depth >= max (G-DELEGATION-DEPTH-CAP)', async () => {
    const invoker = new InProcessCrossAppInvoker();
    invoker.registerApp('a', { op: () => ({}) });
    await assert.rejects(
      () =>
        invoker.invoke({
          targetAppId: 'a',
          operation: 'op',
          input: {},
          delegation: delegation(CROSS_APP_DEFAULT_MAX_DELEGATION_DEPTH),
          caller: { sessionId: 's', nodeId: 'n' },
        }),
      CrossAppDelegationDepthExceededError,
    );
  });

  it('throws CrossAppTargetUnknownError for unknown app or operation', async () => {
    const invoker = new InProcessCrossAppInvoker();
    invoker.registerApp('known', { op1: () => ({}) });

    await assert.rejects(
      () =>
        invoker.invoke({
          targetAppId: 'missing',
          operation: 'op',
          input: {},
          delegation: delegation(),
          caller: { sessionId: 's', nodeId: 'n' },
        }),
      CrossAppTargetUnknownError,
    );
    await assert.rejects(
      () =>
        invoker.invoke({
          targetAppId: 'known',
          operation: 'missing-op',
          input: {},
          delegation: delegation(),
          caller: { sessionId: 's', nodeId: 'n' },
        }),
      CrossAppTargetUnknownError,
    );
  });

  it('wraps target handler throws as CrossAppTargetError (G-FAILURE-ISOLATION)', async () => {
    const invoker = new InProcessCrossAppInvoker();
    invoker.registerApp('bad', {
      boom: () => {
        throw new Error('target exploded');
      },
    });

    await assert.rejects(
      () =>
        invoker.invoke({
          targetAppId: 'bad',
          operation: 'boom',
          input: {},
          delegation: delegation(),
          caller: { sessionId: 's', nodeId: 'n' },
        }),
      (err: unknown) => {
        assert.ok(err instanceof CrossAppTargetError);
        assert.equal(err.targetAppId, 'bad');
        assert.equal(err.operation, 'boom');
        assert.ok(err.targetDecisionId.startsWith('in-proc-decision-'));
        return true;
      },
    );
  });

  it('capabilities() reports registered apps as allowed set', () => {
    const invoker = new InProcessCrossAppInvoker();
    invoker.registerApp('alpha', { o: () => ({}) });
    invoker.registerApp('beta', { o: () => ({}) });
    const caps = invoker.capabilities();
    assert.equal(caps.enabled, true);
    assert.equal(caps.maxDelegationDepth, CROSS_APP_DEFAULT_MAX_DELEGATION_DEPTH);
    assert.deepEqual(
      [...(caps.allowedTargetAppIds ?? [])].sort(),
      ['alpha', 'beta'],
    );
  });

  it('honors allowedTargetAppIdsOverride (models manifest-declared apps not yet registered)', async () => {
    const invoker = new InProcessCrossAppInvoker({
      allowedTargetAppIdsOverride: new Set(['only-this-one']),
    });
    invoker.registerApp('only-this-one', { op: () => ({ ok: true }) });

    // Target NOT in override → unknown (manifest hasn't declared it).
    await assert.rejects(
      () =>
        invoker.invoke({
          targetAppId: 'other',
          operation: 'op',
          input: {},
          delegation: delegation(),
          caller: { sessionId: 's', nodeId: 'n' },
        }),
      CrossAppTargetUnknownError,
    );

    // Target IN override → dispatches.
    const result = await invoker.invoke({
      targetAppId: 'only-this-one',
      operation: 'op',
      input: {},
      delegation: delegation(),
      caller: { sessionId: 's', nodeId: 'n' },
    });
    assert.deepEqual(result.output, { ok: true });
  });
});

describe('NullCrossAppInvoker + assertCrossAppTargetsAllowed', () => {
  it('NullCrossAppInvoker.invoke throws CrossAppNotConfiguredError', async () => {
    const invoker = new NullCrossAppInvoker();
    await assert.rejects(
      () =>
        invoker.invoke({
          targetAppId: 'x',
          operation: 'y',
          input: {},
          delegation: delegation(),
          caller: { sessionId: 's', nodeId: 'n' },
        }),
      CrossAppNotConfiguredError,
    );
    assert.equal(invoker.capabilities().enabled, false);
  });

  it('assertCrossAppTargetsAllowed skips check when allowedTargetAppIds undefined', () => {
    const permissive = {
      invoke: async () => {
        throw new Error('not used');
      },
      capabilities: () => ({
        enabled: true,
        maxDelegationDepth: 2,
        allowedTargetAppIds: undefined,
      }),
    };
    assert.doesNotThrow(() =>
      assertCrossAppTargetsAllowed(permissive, ['anything', 'goes']),
    );
  });

  it('assertCrossAppTargetsAllowed rejects undeclared targets (G-TARGET-ALLOWLIST)', () => {
    const invoker = new InProcessCrossAppInvoker();
    invoker.registerApp('declared', { op: () => ({}) });
    assert.throws(
      () => assertCrossAppTargetsAllowed(invoker, ['declared', 'undeclared']),
      CrossAppTargetNotDeclaredError,
    );
    // All-declared case passes
    assert.doesNotThrow(() => assertCrossAppTargetsAllowed(invoker, ['declared']));
  });
});
