// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for the adapter-agnostic resume algorithm.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { performResume } from './resume.js';
import { createInMemorySessionStore } from './in-memory-session-store.js';
import { isSessionStoreError } from '../../ports/session-store-errors.js';
import type {
  BudgetReservation,
  SessionSnapshot,
} from '../../ports/session-store-types.js';
import type { BudgetEnforcer, TimerBindings } from './resume.js';

function snap(fingerprint = 'sha256:same'): SessionSnapshot {
  return {
    schemaVersion: 1,
    sessionId: 'ses_1',
    scopeId: 'app_test',
    pactRef: { id: 'p', version: '1.0.0', fingerprint },
    status: 'paused',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    latestCheckpointSequence: null,
    depth: 0,
  };
}

function fakeBudget(): BudgetEnforcer & { calls: number; last: BudgetReservation | null } {
  const bucket = {
    calls: 0,
    last: null as BudgetReservation | null,
    rehydrateOrReserve(prior: BudgetReservation | null): Promise<BudgetReservation> {
      bucket.calls += 1;
      bucket.last = prior;
      const fresh: BudgetReservation = {
        handle: 'rsv_fresh',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        amount: { usd: 0.01, tokens: 1000 },
        issuer: 'ctx.llm',
      };
      return Promise.resolve(fresh);
    },
  };
  return bucket;
}

function fakeTimers(): TimerBindings & { started: number; cleared: number } {
  let started = 0;
  let cleared = 0;
  const bindings: TimerBindings & { started: number; cleared: number } = {
    get started() { return started; },
    get cleared() { return cleared; },
    setInterval: (_fn, _ms) => {
      started += 1;
      return { id: started };
    },
    clearInterval: (_handle) => {
      cleared += 1;
    },
  };
  return bindings;
}

describe('performResume — 5-step algorithm', () => {
  it('acquires a lease, rehydrates budget, returns fencing token', async () => {
    const store = createInMemorySessionStore();
    await store.create(snap());

    const timers = fakeTimers();
    const budget = fakeBudget();
    const out = await performResume({
      store,
      sessionId: 'ses_1',
      workerId: 'worker-a',
      pact: { id: 'p', version: '1.0.0', fingerprint: 'sha256:same' },
      budget,
      timers,
    });

    assert.ok(out.fencingToken.length > 0);
    assert.equal(budget.calls, 1);
    assert.equal(out.freshBudget.handle, 'rsv_fresh');
    assert.equal(out.nextAction.kind, 'await-prompt'); // no checkpoint → default
    assert.equal(timers.started, 1);

    out.heartbeat.stop();
    assert.equal(timers.cleared, 1);
  });

  it('raises FINGERPRINT_MISMATCH when pacts have drifted', async () => {
    const store = createInMemorySessionStore();
    await store.create(snap('sha256:original'));

    const budget = fakeBudget();
    const timers = fakeTimers();
    await assert.rejects(
      () =>
        performResume({
          store,
          sessionId: 'ses_1',
          workerId: 'worker-a',
          pact: { id: 'p', version: '1.0.0', fingerprint: 'sha256:drifted' },
          budget,
          timers,
        }),
      (err: unknown) =>
        isSessionStoreError(err) && err.code === 'FINGERPRINT_MISMATCH' && !err.retryable,
    );
  });

  it('is idempotent: duplicate resume returns the same fencing token (G-RESUME-IDEMPOTENT)', async () => {
    const store = createInMemorySessionStore();
    await store.create(snap());
    const budget = fakeBudget();
    const timers = fakeTimers();
    const first = await performResume({
      store,
      sessionId: 'ses_1',
      workerId: 'worker-a',
      pact: { id: 'p', version: '1.0.0', fingerprint: 'sha256:same' },
      budget,
      timers,
    });
    const second = await performResume({
      store,
      sessionId: 'ses_1',
      workerId: 'worker-a',
      pact: { id: 'p', version: '1.0.0', fingerprint: 'sha256:same' },
      budget,
      timers,
    });
    assert.equal(first.fencingToken, second.fencingToken);
    first.heartbeat.stop();
    second.heartbeat.stop();
  });
});
