// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for cortexTokenExchangeMiddleware (PRD-059 §5.1 / SC-05).
 *
 * Covers:
 *   - G-TOKEN-DEPTH-CAP: exchangeForSubAgent throws at actAs.length >= 2
 *     WITHOUT calling ctx.auth.exchange.
 *   - Compose-time validation (missing ctx.auth, invalid appId, invalid narrowScope).
 *   - wrap(): per-invocation user → agent exchange; ScopedToken attached
 *     to request.metadata.__cortexDelegatedToken.
 *   - Scope escalation rejected client-side.
 *   - No parentUserToken → wrap is a no-op (non-user-initiated path).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Pact, AgentRequest, AgentResult } from '@methodts/pacta';
import {
  cortexTokenExchangeMiddleware,
  CortexDelegationDepthExceededError,
  CortexScopeEscalationError,
  MAX_DELEGATION_DEPTH,
  parseActChain,
} from './token-exchange-middleware.js';
import { CortexAdapterComposeError } from './adapter.js';
import type {
  ActAsEntry,
  CortexAuthCtx,
  ScopedToken,
  TokenExchangeRequest,
} from './ctx-types.js';

// ── Helpers ──────────────────────────────────────────────────────

function makeToken(actAs: ActAsEntry[], scope: string[] = ['read']): ScopedToken {
  return {
    token: 'fake-jwt',
    audience: 'aud',
    actAs,
    scope,
    expiresAt: Date.now() + 3600_000,
  };
}

function makeAuth(overrides?: {
  exchangeReturns?: ScopedToken;
  throwOnExchange?: boolean;
  recorder?: { calls: TokenExchangeRequest[] };
}): { ctx: CortexAuthCtx; calls: TokenExchangeRequest[] } {
  const calls: TokenExchangeRequest[] = overrides?.recorder?.calls ?? [];
  const ctx: CortexAuthCtx = {
    async exchange(req: TokenExchangeRequest): Promise<ScopedToken> {
      calls.push(req);
      if (overrides?.throwOnExchange) throw new Error('exchange failed');
      return (
        overrides?.exchangeReturns ??
        makeToken([{ sub: 'user-1' }], ['read'])
      );
    },
    serviceAccountToken: 'svc-jwt',
  };
  return { ctx, calls };
}

function oneshotPact(): Pact<unknown> {
  return { mode: { type: 'oneshot' } };
}

// ── G-TOKEN-DEPTH-CAP ────────────────────────────────────────────

describe('cortexTokenExchangeMiddleware — G-TOKEN-DEPTH-CAP (SC-05)', () => {
  it('rejects depth === MAX_DELEGATION_DEPTH without calling ctx.auth.exchange', async () => {
    const { ctx, calls } = makeAuth();
    const composed = cortexTokenExchangeMiddleware({
      appId: 'app-a',
      narrowScope: s => s,
    }).compose({ ctx: { auth: ctx }, pact: oneshotPact() });

    const depth2 = makeToken([{ sub: 'u' }, { sub: 'agent-a' }]); // length 2
    await assert.rejects(
      () => composed.exchangeForSubAgent(depth2, 'child-app', ['read']),
      (err: unknown) => {
        assert.ok(err instanceof CortexDelegationDepthExceededError);
        assert.equal((err as CortexDelegationDepthExceededError).depth, 2);
        assert.equal(
          (err as CortexDelegationDepthExceededError).max,
          MAX_DELEGATION_DEPTH,
        );
        return true;
      },
    );
    assert.deepEqual(calls, [], 'ctx.auth.exchange MUST NOT be called');
  });

  it('rejects depth > MAX_DELEGATION_DEPTH', async () => {
    const { ctx, calls } = makeAuth();
    const composed = cortexTokenExchangeMiddleware({
      appId: 'app-a',
      narrowScope: s => s,
    }).compose({ ctx: { auth: ctx }, pact: oneshotPact() });

    const depth3 = makeToken([
      { sub: 'u' },
      { sub: 'agent-a' },
      { sub: 'agent-b' },
    ]);
    await assert.rejects(
      () => composed.exchangeForSubAgent(depth3, 'child', []),
      CortexDelegationDepthExceededError,
    );
    assert.deepEqual(calls, []);
  });

  it('allows depth 0 → 1 (first delegation)', async () => {
    const { ctx, calls } = makeAuth();
    const composed = cortexTokenExchangeMiddleware({
      appId: 'app-a',
      narrowScope: s => s,
    }).compose({ ctx: { auth: ctx }, pact: oneshotPact() });
    const parent = makeToken([{ sub: 'user' }], ['read', 'write']);
    const child = await composed.exchangeForSubAgent(parent, 'child-app', ['read']);
    assert.ok(child);
    assert.equal(calls.length, 1);
  });

  it('rejects scope escalation', async () => {
    const { ctx } = makeAuth();
    const composed = cortexTokenExchangeMiddleware({
      appId: 'app-a',
      narrowScope: s => s,
    }).compose({ ctx: { auth: ctx }, pact: oneshotPact() });
    const parent = makeToken([{ sub: 'u' }], ['read']);
    await assert.rejects(
      () => composed.exchangeForSubAgent(parent, 'child', ['read', 'write']),
      CortexScopeEscalationError,
    );
  });
});

// ── Compose gates ────────────────────────────────────────────────

describe('cortexTokenExchangeMiddleware — compose gates', () => {
  it('throws on missing ctx.auth', () => {
    const adapter = cortexTokenExchangeMiddleware({
      appId: 'x',
      narrowScope: s => s,
    });
    assert.throws(
      () => adapter.compose({ ctx: {} as any, pact: oneshotPact() }),
      (err: unknown) =>
        err instanceof CortexAdapterComposeError &&
        err.reason === 'missing_ctx_service',
    );
  });

  it('throws on empty appId', () => {
    const { ctx } = makeAuth();
    const adapter = cortexTokenExchangeMiddleware({
      appId: '',
      narrowScope: s => s,
    });
    assert.throws(
      () => adapter.compose({ ctx: { auth: ctx }, pact: oneshotPact() }),
      (err: unknown) =>
        err instanceof CortexAdapterComposeError && err.reason === 'invalid_config',
    );
  });

  it('throws when narrowScope is not a function', () => {
    const { ctx } = makeAuth();
    const adapter = cortexTokenExchangeMiddleware({
      appId: 'x',
      narrowScope: undefined as unknown as (s: ReadonlyArray<string>, p: Pact<unknown>) => ReadonlyArray<string>,
    });
    assert.throws(
      () => adapter.compose({ ctx: { auth: ctx }, pact: oneshotPact() }),
      (err: unknown) =>
        err instanceof CortexAdapterComposeError &&
        err.reason === 'invalid_config' &&
        err.details.field === 'narrowScope',
    );
  });

  it('successful compose returns name "cortex-token-exchange" + requires [auth]', () => {
    const { ctx } = makeAuth();
    const composed = cortexTokenExchangeMiddleware({
      appId: 'x',
      narrowScope: s => s,
    }).compose({ ctx: { auth: ctx }, pact: oneshotPact() });
    assert.equal(composed.name, 'cortex-token-exchange');
    assert.deepEqual([...composed.requires], ['auth']);
  });
});

// ── wrap(): per-invocation exchange ──────────────────────────────

describe('cortexTokenExchangeMiddleware — wrap()', () => {
  it('attaches exchanged token to request.metadata.__cortexDelegatedToken', async () => {
    const delegated = makeToken([{ sub: 'user-1' }], ['read']);
    const { ctx, calls } = makeAuth({ exchangeReturns: delegated });
    const composed = cortexTokenExchangeMiddleware({
      appId: 'my-app',
      narrowScope: s => s,
    }).compose({ ctx: { auth: ctx }, pact: oneshotPact() });

    let receivedMeta: Record<string, unknown> | undefined;
    const inner = async (
      _p: Pact<unknown>,
      req: AgentRequest,
    ): Promise<AgentResult<unknown>> => {
      receivedMeta = req.metadata;
      return {
        output: null,
        sessionId: 's',
        completed: true,
        stopReason: 'complete',
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0,
        },
        cost: { totalUsd: 0, perModel: {} },
        durationMs: 0,
        turns: 0,
      };
    };

    const wrapped = composed.wrap(inner);
    await wrapped(oneshotPact(), {
      prompt: 'x',
      metadata: {
        parentUserToken: 'user-jwt',
        parentUserScope: ['read', 'write'],
      },
    });

    assert.equal(calls.length, 1, 'exactly one exchange call');
    assert.equal(calls[0].subjectToken, 'user-jwt');
    assert.equal(calls[0].actorToken, 'svc-jwt');
    assert.equal(calls[0].audience, 'my-app');
    assert.equal(receivedMeta?.__cortexDelegatedToken, delegated);
  });

  it('wrap() is a no-op when no parentUserToken is present', async () => {
    const { ctx, calls } = makeAuth();
    const composed = cortexTokenExchangeMiddleware({
      appId: 'my-app',
      narrowScope: s => s,
    }).compose({ ctx: { auth: ctx }, pact: oneshotPact() });

    const inner = async (): Promise<AgentResult<unknown>> => ({
      output: null,
      sessionId: 's',
      completed: true,
      stopReason: 'complete',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
      },
      cost: { totalUsd: 0, perModel: {} },
      durationMs: 0,
      turns: 0,
    });

    const wrapped = composed.wrap(inner);
    await wrapped(oneshotPact(), { prompt: 'x' });
    assert.deepEqual(calls, [], 'no exchange when no parentUserToken');
  });

  it('narrowScope must return a subset of user scope', async () => {
    const { ctx } = makeAuth();
    const composed = cortexTokenExchangeMiddleware({
      appId: 'my-app',
      narrowScope: (_userScope, _pact) => ['superuser'], // escalation
    }).compose({ ctx: { auth: ctx }, pact: oneshotPact() });

    const inner = async (): Promise<AgentResult<unknown>> => ({
      output: null,
      sessionId: 's',
      completed: true,
      stopReason: 'complete',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
      },
      cost: { totalUsd: 0, perModel: {} },
      durationMs: 0,
      turns: 0,
    });

    const wrapped = composed.wrap(inner);
    await assert.rejects(
      () =>
        wrapped(oneshotPact(), {
          prompt: 'x',
          metadata: { parentUserToken: 'u', parentUserScope: ['read'] },
        }),
      CortexScopeEscalationError,
    );
  });
});

// ── parseActChain helper ─────────────────────────────────────────

describe('parseActChain', () => {
  it('returns the actAs array from a structural token', () => {
    const t = makeToken([{ sub: 'user' }, { sub: 'agent' }]);
    const chain = parseActChain(t);
    assert.equal(chain.length, 2);
    assert.equal(chain[0].sub, 'user');
  });

  it('returns [] for a token with no actAs', () => {
    const t: ScopedToken = {
      token: 't',
      audience: 'a',
      actAs: [] as ActAsEntry[],
      scope: [],
      expiresAt: 0,
    };
    assert.deepEqual([...parseActChain(t)], []);
  });
});
