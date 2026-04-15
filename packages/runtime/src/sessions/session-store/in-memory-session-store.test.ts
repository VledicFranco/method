/**
 * Unit tests for the in-memory SessionStore reference impl. Covers the
 * gate invariants: port purity, lease semantics, fencing, schema rejection.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createInMemorySessionStore } from './in-memory-session-store.js';
import { isSessionStoreError } from '../../ports/session-store-errors.js';
import type {
  Checkpoint,
  SessionSnapshot,
} from '../../ports/session-store-types.js';

function makeSnapshot(sessionId = 'ses_1'): SessionSnapshot {
  return {
    schemaVersion: 1,
    sessionId,
    scopeId: 'app_test',
    pactRef: { id: 'p', version: '1.0.0', fingerprint: 'sha256:abc' },
    status: 'initializing',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    latestCheckpointSequence: null,
    depth: 0,
  };
}

function makeCheckpoint(sessionId: string, sequence: number): Checkpoint {
  return {
    schemaVersion: 1,
    sequence,
    sessionId,
    createdAt: new Date().toISOString(),
    eventCursor: { sequence: sequence * 10, id: `evt_${sequence}` },
    agentState: { kind: 'inline', data: { step: sequence } },
    pendingBudget: null,
    nextAction: { kind: 'await-prompt' },
  };
}

describe('InMemorySessionStore — lifecycle', () => {
  it('create + load round-trips a snapshot', async () => {
    const store = createInMemorySessionStore();
    const snap = makeSnapshot();
    await store.create(snap);
    const loaded = await store.load('ses_1');
    assert.ok(loaded);
    assert.equal(loaded?.sessionId, 'ses_1');
  });

  it('create rejects duplicate sessionId with DUPLICATE', async () => {
    const store = createInMemorySessionStore();
    const snap = makeSnapshot();
    await store.create(snap);
    await assert.rejects(
      () => store.create(snap),
      (err: unknown) => isSessionStoreError(err) && err.code === 'DUPLICATE',
    );
  });

  it('load returns null for unknown session', async () => {
    const store = createInMemorySessionStore();
    assert.equal(await store.load('missing'), null);
  });

  it('rejects non-v1 schema on create', async () => {
    const store = createInMemorySessionStore();
    const snap = { ...makeSnapshot(), schemaVersion: 2 as unknown as 1 };
    await assert.rejects(
      () => store.create(snap),
      (err: unknown) => isSessionStoreError(err) && err.code === 'SCHEMA_INCOMPATIBLE' && err.retryable === false,
    );
  });
});

describe('InMemorySessionStore — lease + fencing (G-RESUME-IDEMPOTENT, G-LEASE-FENCING)', () => {
  it('resume acquires a lease and returns a fencing token', async () => {
    const store = createInMemorySessionStore();
    await store.create(makeSnapshot());
    const rc = await store.resume('ses_1', 'worker-a');
    assert.ok(rc.fencingToken.length > 0);
    assert.equal(rc.snapshot.sessionId, 'ses_1');
  });

  it('is idempotent: same worker resuming twice gets the same token', async () => {
    const store = createInMemorySessionStore();
    await store.create(makeSnapshot());
    const first = await store.resume('ses_1', 'worker-a');
    const second = await store.resume('ses_1', 'worker-a');
    assert.equal(first.fencingToken, second.fencingToken);
    assert.equal(first.leaseExpiresAt, second.leaseExpiresAt);
  });

  it('blocks a different worker with FENCED while the lease is live', async () => {
    const store = createInMemorySessionStore();
    await store.create(makeSnapshot());
    await store.resume('ses_1', 'worker-a');
    await assert.rejects(
      () => store.resume('ses_1', 'worker-b'),
      (err: unknown) => isSessionStoreError(err) && err.code === 'FENCED',
    );
  });

  it('allows a new worker to reclaim a stale lease', async () => {
    let t = 1_000_000;
    const store = createInMemorySessionStore({ now: () => t, defaultLeaseTtlMs: 1000 });
    await store.create(makeSnapshot());
    await store.resume('ses_1', 'worker-a');
    // Advance past TTL.
    t += 5_000;
    const rc = await store.resume('ses_1', 'worker-b');
    assert.ok(rc.fencingToken.length > 0);
  });

  it('rejects appendCheckpoint with a stale fencing token', async () => {
    const store = createInMemorySessionStore();
    await store.create(makeSnapshot());
    await store.resume('ses_1', 'worker-a');
    await assert.rejects(
      () => store.appendCheckpoint('ses_1', makeCheckpoint('ses_1', 1), 'bogus-token'),
      (err: unknown) => isSessionStoreError(err) && err.code === 'FENCED',
    );
  });

  it('renewLease fails with FENCED when the token is unknown', async () => {
    const store = createInMemorySessionStore();
    await store.create(makeSnapshot());
    await store.resume('ses_1', 'worker-a');
    await assert.rejects(
      () => store.renewLease('ses_1', 'wrong'),
      (err: unknown) => isSessionStoreError(err) && err.code === 'FENCED',
    );
  });

  it('releaseLease is idempotent', async () => {
    const store = createInMemorySessionStore();
    await store.create(makeSnapshot());
    const rc = await store.resume('ses_1', 'worker-a');
    await store.releaseLease('ses_1', rc.fencingToken);
    await store.releaseLease('ses_1', rc.fencingToken); // no throw
  });

  it('fingerprint mismatch throws FINGERPRINT_MISMATCH', async () => {
    const store = createInMemorySessionStore();
    await store.create(makeSnapshot());
    await assert.rejects(
      () =>
        store.resume('ses_1', 'worker-a', {
          requireFingerprint: true,
          expectedFingerprint: 'sha256:different',
        }),
      (err: unknown) => isSessionStoreError(err) && err.code === 'FINGERPRINT_MISMATCH',
    );
  });
});

describe('InMemorySessionStore — checkpoints', () => {
  it('appends monotonically and loadLatest returns the latest', async () => {
    const store = createInMemorySessionStore();
    await store.create(makeSnapshot());
    const rc = await store.resume('ses_1', 'worker-a');
    await store.appendCheckpoint('ses_1', makeCheckpoint('ses_1', 1), rc.fencingToken);
    await store.appendCheckpoint('ses_1', makeCheckpoint('ses_1', 2), rc.fencingToken);
    const latest = await store.loadLatestCheckpoint('ses_1');
    assert.equal(latest?.sequence, 2);

    const snap = await store.load('ses_1');
    assert.equal(snap?.latestCheckpointSequence, 2);
  });

  it('rejects non-monotonic sequences', async () => {
    const store = createInMemorySessionStore();
    await store.create(makeSnapshot());
    const rc = await store.resume('ses_1', 'worker-a');
    await store.appendCheckpoint('ses_1', makeCheckpoint('ses_1', 1), rc.fencingToken);
    await assert.rejects(
      () => store.appendCheckpoint('ses_1', makeCheckpoint('ses_1', 5), rc.fencingToken),
      (err: unknown) => isSessionStoreError(err) && err.code === 'INTERNAL',
    );
  });

  it('listCheckpoints returns most-recent first, bounded by limit', async () => {
    const store = createInMemorySessionStore();
    await store.create(makeSnapshot());
    const rc = await store.resume('ses_1', 'worker-a');
    for (let i = 1; i <= 5; i++) {
      await store.appendCheckpoint('ses_1', makeCheckpoint('ses_1', i), rc.fencingToken);
    }
    const listed = await store.listCheckpoints('ses_1', 3);
    assert.equal(listed.length, 3);
    assert.equal(listed[0]?.sequence, 5);
    assert.equal(listed[2]?.sequence, 3);
  });

  it('ring retention caps the stored checkpoint count', async () => {
    const store = createInMemorySessionStore({ checkpointRingSize: 3 });
    await store.create(makeSnapshot());
    const rc = await store.resume('ses_1', 'worker-a');
    for (let i = 1; i <= 6; i++) {
      await store.appendCheckpoint('ses_1', makeCheckpoint('ses_1', i), rc.fencingToken);
    }
    const listed = await store.listCheckpoints('ses_1', 10);
    assert.equal(listed.length, 3);
    assert.equal(listed[0]?.sequence, 6);
    assert.equal(listed[2]?.sequence, 4);
    // Earlier sequence falls out of the ring.
    assert.equal(await store.loadCheckpoint('ses_1', 1), null);
  });

  it('finalize releases any held lease and records status', async () => {
    const store = createInMemorySessionStore();
    await store.create(makeSnapshot());
    await store.resume('ses_1', 'worker-a');
    await store.finalize('ses_1', 'completed', 'ok');
    const snap = await store.load('ses_1');
    assert.equal(snap?.status, 'completed');
    // A different worker can resume after finalize — lease is released.
    const rc = await store.resume('ses_1', 'worker-b');
    assert.ok(rc.fencingToken.length > 0);
  });

  it('destroy removes the session', async () => {
    const store = createInMemorySessionStore();
    await store.create(makeSnapshot());
    await store.destroy('ses_1');
    assert.equal(await store.load('ses_1'), null);
  });
});
