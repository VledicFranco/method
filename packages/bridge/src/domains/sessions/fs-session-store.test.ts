// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for the FS-backed SessionStore adapter.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFsSessionStore } from './fs-session-store.js';
import { NodeFileSystemProvider } from '../../ports/file-system.js';

const createNodeFileSystemProvider = (): NodeFileSystemProvider => new NodeFileSystemProvider();
import { isSessionStoreError } from '@methodts/runtime/ports';
import type {
  Checkpoint,
  PersistedSessionSnapshot as SessionSnapshot,
} from '@methodts/runtime/ports';
import {
  DEFAULT_SESSION_STORE_FIXTURES,
  runSessionStoreConformance,
} from '@methodts/runtime/sessions';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'fs-session-store-'));
}

function makeSnapshot(sessionId = 'ses_1'): SessionSnapshot {
  return {
    schemaVersion: 1,
    sessionId,
    scopeId: 'app_bridge_test',
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

describe('FsSessionStore — disk round-trip', () => {
  it('create + load persists the snapshot', async () => {
    const dir = makeTmpDir();
    try {
      const store = createFsSessionStore({
        baseDir: dir,
        fs: createNodeFileSystemProvider(),
      });
      const snap = makeSnapshot();
      await store.create(snap);
      const loaded = await store.load('ses_1');
      assert.equal(loaded?.sessionId, 'ses_1');
      assert.equal(loaded?.status, 'initializing');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('survives a simulated restart — new store instance reads prior state', async () => {
    const dir = makeTmpDir();
    try {
      const first = createFsSessionStore({
        baseDir: dir,
        fs: createNodeFileSystemProvider(),
      });
      await first.create(makeSnapshot());
      const rc = await first.resume('ses_1', 'worker-a');
      await first.appendCheckpoint('ses_1', makeCheckpoint('ses_1', 1), rc.fencingToken);
      await first.releaseLease('ses_1', rc.fencingToken);

      // Drop reference; instantiate fresh.
      const second = createFsSessionStore({
        baseDir: dir,
        fs: createNodeFileSystemProvider(),
      });
      const loaded = await second.loadLatestCheckpoint('ses_1');
      assert.equal(loaded?.sequence, 1);
      const snap = await second.load('ses_1');
      assert.equal(snap?.latestCheckpointSequence, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects cross-worker resume with FENCED', async () => {
    const dir = makeTmpDir();
    try {
      const store = createFsSessionStore({
        baseDir: dir,
        fs: createNodeFileSystemProvider(),
      });
      await store.create(makeSnapshot());
      await store.resume('ses_1', 'worker-a');
      await assert.rejects(
        () => store.resume('ses_1', 'worker-b'),
        (err: unknown) => isSessionStoreError(err) && err.code === 'FENCED',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects unsafe session ids', async () => {
    const dir = makeTmpDir();
    try {
      const store = createFsSessionStore({
        baseDir: dir,
        fs: createNodeFileSystemProvider(),
      });
      const snap = makeSnapshot('../../etc/passwd');
      await assert.rejects(
        () => store.create(snap),
        (err: unknown) => isSessionStoreError(err) && err.code === 'INTERNAL',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects unknown schemaVersion with SCHEMA_INCOMPATIBLE', async () => {
    const dir = makeTmpDir();
    try {
      const store = createFsSessionStore({
        baseDir: dir,
        fs: createNodeFileSystemProvider(),
      });
      await assert.rejects(
        () =>
          store.create({ ...makeSnapshot(), schemaVersion: 2 as unknown as 1 }),
        (err: unknown) =>
          isSessionStoreError(err) &&
          err.code === 'SCHEMA_INCOMPATIBLE' &&
          err.retryable === false,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ring retention trims older checkpoints', async () => {
    const dir = makeTmpDir();
    try {
      const store = createFsSessionStore({
        baseDir: dir,
        fs: createNodeFileSystemProvider(),
        checkpointRingSize: 3,
      });
      await store.create(makeSnapshot());
      const rc = await store.resume('ses_1', 'worker-a');
      for (let i = 1; i <= 6; i++) {
        await store.appendCheckpoint('ses_1', makeCheckpoint('ses_1', i), rc.fencingToken);
      }
      const listed = await store.listCheckpoints('ses_1', 10);
      assert.equal(listed.length, 3);
      assert.equal(listed[0]?.sequence, 6);
      assert.equal(await store.loadCheckpoint('ses_1', 1), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes all SessionStore conformance fixtures', async () => {
    const dir = makeTmpDir();
    try {
      // Share one store across "workers" — simulates multi-worker on same disk.
      const store = createFsSessionStore({
        baseDir: dir,
        fs: createNodeFileSystemProvider(),
      });
      const results = await runSessionStoreConformance(() => store, DEFAULT_SESSION_STORE_FIXTURES);
      for (const r of results) {
        assert.equal(r.result.passed, true, `${r.name}: ${r.result.passed ? '' : r.result.reason}`);
      }
      assert.equal(results.length, 3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('projectLegacy fires on each snapshot mutation', async () => {
    const dir = makeTmpDir();
    try {
      const projections: string[] = [];
      const store = createFsSessionStore({
        baseDir: dir,
        fs: createNodeFileSystemProvider(),
        projectLegacy: (s) => projections.push(s.status),
      });
      await store.create(makeSnapshot());
      const rc = await store.resume('ses_1', 'worker-a');
      await store.appendCheckpoint('ses_1', makeCheckpoint('ses_1', 1), rc.fencingToken);
      await store.finalize('ses_1', 'completed');
      // create (1) + resume (1) + appendCheckpoint (1) + finalize (1)
      assert.ok(projections.length >= 3);
      assert.equal(projections[projections.length - 1], 'completed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
