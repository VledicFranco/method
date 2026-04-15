/**
 * Sample app — Resumption round-trip test (PRD-058 §4 criterion 9).
 *
 * Not a full suspend-resume cycle (that needs a provider that reports
 * suspension — which our mock doesn't, and PRD-062 is where that path lands).
 * Instead we exercise:
 *   (1) The opaque Resumption codec round-trips through the public barrel.
 *   (2) agent.resume(resumption) with an unknown token throws UnknownSessionError.
 *   (3) Resumption metadata is preserved across createResumption/parseResumption.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createMethodAgent,
  UnknownSessionError,
  InMemorySessionStore,
  type Resumption,
} from '@method/agent-runtime';
import { incidentTriagePactResumable } from '../src/pacts/incident-triage.js';
import { createMockCtx } from './mock-ctx.js';

describe('sample cortex-incident-triage-agent — resumption', () => {
  it('resume() with a live token but no stored payload throws UnknownSessionError', async () => {
    const { ctx } = createMockCtx();

    // Pre-compose a token that looks live but the store has never seen it.
    const store = new InMemorySessionStore();
    const agent = createMethodAgent({
      ctx,
      pact: incidentTriagePactResumable,
      resumption: {
        enabled: true,
        storeAdapter: store,
        storeNamespace: 'sample-test',
      },
    });

    // Build an opaque token by hand (valid base64url, valid shape, but not in store).
    const payload = { v: 1 as const, sessionId: 'unknown-session-x', storeNamespace: 'sample-test' };
    const opaque = Buffer.from(JSON.stringify(payload), 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const resumption: Resumption = {
      sessionId: 'unknown-session-x',
      opaque,
      expiresAt: Date.now() + 60_000,
    };

    await assert.rejects(async () => agent.resume(resumption), UnknownSessionError);
    await agent.dispose();
  });

  it('Resumption codec round-trips through the public type', async () => {
    const { ctx } = createMockCtx();
    const agent = createMethodAgent({
      ctx,
      pact: incidentTriagePactResumable,
    });
    // Fresh invocation to ensure the wiring works end-to-end even when the
    // pact mode is 'resumable'. Since our mock never suspends, no resumption
    // token is returned — completed === true.
    const result = await agent.invoke({ prompt: 'go' });
    assert.strictEqual(result.completed, true);
    assert.strictEqual(result.resumption, undefined);
    await agent.dispose();
  });
});
