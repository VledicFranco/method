/**
 * Unit tests for the Cortex-backed SessionStore adapter.
 *
 * Uses an in-memory CortexStorageFacade to exercise the KV wiring without
 * spinning up a real Mongo. Covers lease semantics, fencing, ring retention,
 * and schema rejection.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createCortexSessionStore } from './session-store.js';
import type { CortexStorageFacade } from './ctx-types.js';
import { isSessionStoreError } from '@method/runtime/ports';
import type {
  Checkpoint,
  PersistedSessionSnapshot as SessionSnapshot,
} from '@method/runtime/ports';

function makeInMemoryStorage(): CortexStorageFacade {
  const data = new Map<string, Record<string, unknown>>();
  return {
    async get(key) {
      return data.get(key) ?? null;
    },
    async put(key, value) {
      data.set(key, { ...value });
    },
    async delete(key) {
      data.delete(key);
    },
  };
}

function makeSnapshot(sessionId = 'ses_1'): SessionSnapshot {
  return {
    schemaVersion: 1,
    sessionId,
    scopeId: 'app_cortex_test',
    pactRef: { id: 'p', version: '1.0.0', fingerprint: 'sha256:zzz' },
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

describe('CortexSessionStore — lifecycle', () => {
  it('create + load round-trips through ctx.storage', async () => {
    const storage = makeInMemoryStorage();
    const store = createCortexSessionStore({ ctx: { storage } });
    await store.create(makeSnapshot());
    const loaded = await store.load('ses_1');
    assert.equal(loaded?.sessionId, 'ses_1');
  });

  it('create rejects duplicate', async () => {
    const store = createCortexSessionStore({ ctx: { storage: makeInMemoryStorage() } });
    await store.create(makeSnapshot());
    await assert.rejects(
      () => store.create(makeSnapshot()),
      (err: unknown) => isSessionStoreError(err) && err.code === 'DUPLICATE',
    );
  });

  it('rejects non-v1 schema', async () => {
    const store = createCortexSessionStore({ ctx: { storage: makeInMemoryStorage() } });
    await assert.rejects(
      () => store.create({ ...makeSnapshot(), schemaVersion: 2 as unknown as 1 }),
      (err: unknown) => isSessionStoreError(err) && err.code === 'SCHEMA_INCOMPATIBLE',
    );
  });
});

describe('CortexSessionStore — lease + fencing', () => {
  it('is idempotent within the lease window', async () => {
    const store = createCortexSessionStore({ ctx: { storage: makeInMemoryStorage() } });
    await store.create(makeSnapshot());
    const a = await store.resume('ses_1', 'worker-a');
    const b = await store.resume('ses_1', 'worker-a');
    assert.equal(a.fencingToken, b.fencingToken);
  });

  it('FENCED for a different worker while lease is live', async () => {
    const store = createCortexSessionStore({ ctx: { storage: makeInMemoryStorage() } });
    await store.create(makeSnapshot());
    await store.resume('ses_1', 'worker-a');
    await assert.rejects(
      () => store.resume('ses_1', 'worker-b'),
      (err: unknown) => isSessionStoreError(err) && err.code === 'FENCED',
    );
  });

  it('reclaims after TTL expires', async () => {
    let t = 1_000_000;
    const store = createCortexSessionStore({
      ctx: { storage: makeInMemoryStorage() },
      now: () => t,
      defaultLeaseTtlMs: 1000,
    });
    await store.create(makeSnapshot());
    await store.resume('ses_1', 'worker-a');
    t += 10_000;
    const rc = await store.resume('ses_1', 'worker-b');
    assert.ok(rc.fencingToken.length > 0);
  });

  it('appendCheckpoint rejects stale token with FENCED', async () => {
    const store = createCortexSessionStore({ ctx: { storage: makeInMemoryStorage() } });
    await store.create(makeSnapshot());
    await store.resume('ses_1', 'worker-a');
    await assert.rejects(
      () => store.appendCheckpoint('ses_1', makeCheckpoint('ses_1', 1), 'bogus'),
      (err: unknown) => isSessionStoreError(err) && err.code === 'FENCED',
    );
  });

  it('renewLease FENCED with unknown token', async () => {
    const store = createCortexSessionStore({ ctx: { storage: makeInMemoryStorage() } });
    await store.create(makeSnapshot());
    await store.resume('ses_1', 'worker-a');
    await assert.rejects(
      () => store.renewLease('ses_1', 'wrong'),
      (err: unknown) => isSessionStoreError(err) && err.code === 'FENCED',
    );
  });

  it('fingerprint check drives FINGERPRINT_MISMATCH', async () => {
    const store = createCortexSessionStore({ ctx: { storage: makeInMemoryStorage() } });
    await store.create(makeSnapshot());
    await assert.rejects(
      () =>
        store.resume('ses_1', 'worker-a', {
          expectedFingerprint: 'sha256:different',
          requireFingerprint: true,
        }),
      (err: unknown) => isSessionStoreError(err) && err.code === 'FINGERPRINT_MISMATCH',
    );
  });
});

describe('CortexSessionStore — checkpoints', () => {
  it('appends monotonically and updates latestCheckpointSequence', async () => {
    const store = createCortexSessionStore({ ctx: { storage: makeInMemoryStorage() } });
    await store.create(makeSnapshot());
    const rc = await store.resume('ses_1', 'worker-a');
    await store.appendCheckpoint('ses_1', makeCheckpoint('ses_1', 1), rc.fencingToken);
    await store.appendCheckpoint('ses_1', makeCheckpoint('ses_1', 2), rc.fencingToken);
    const latest = await store.loadLatestCheckpoint('ses_1');
    assert.equal(latest?.sequence, 2);
    const snap = await store.load('ses_1');
    assert.equal(snap?.latestCheckpointSequence, 2);
  });

  it('ring retention evicts oldest entries', async () => {
    const store = createCortexSessionStore({
      ctx: { storage: makeInMemoryStorage() },
      checkpointRingSize: 3,
    });
    await store.create(makeSnapshot());
    const rc = await store.resume('ses_1', 'worker-a');
    for (let i = 1; i <= 5; i++) {
      await store.appendCheckpoint('ses_1', makeCheckpoint('ses_1', i), rc.fencingToken);
    }
    const listed = await store.listCheckpoints('ses_1', 10);
    assert.equal(listed.length, 3);
    assert.equal(listed[0]?.sequence, 5);
    assert.equal(await store.loadCheckpoint('ses_1', 1), null);
  });

  it('finalize + destroy clean up', async () => {
    const store = createCortexSessionStore({ ctx: { storage: makeInMemoryStorage() } });
    await store.create(makeSnapshot());
    const rc = await store.resume('ses_1', 'worker-a');
    await store.appendCheckpoint('ses_1', makeCheckpoint('ses_1', 1), rc.fencingToken);
    await store.finalize('ses_1', 'completed', 'done');
    const snap = await store.load('ses_1');
    assert.equal(snap?.status, 'completed');
    await store.destroy('ses_1');
    assert.equal(await store.load('ses_1'), null);
  });
});
