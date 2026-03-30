/**
 * Test suite for Genesis Spawner — PRD 029 C-3 dedup behavior
 *
 * Covers:
 * - No recovered genesis session -> spawn new session
 * - Recovered genesis session (idle/running/recovering) -> adopt existing
 * - Dead recovered genesis session -> spawn new session
 * - getGenesisStatus, isGenesisRunning, getGenesisSessionId
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionPool, SessionStatusInfo } from '../sessions/pool.js';
import {
  spawnGenesis,
  getGenesisStatus,
  isGenesisRunning,
  getGenesisSessionId,
} from './spawner.js';

// ── Mock helpers ─────────────────────────────────────────────

function makeSessionStatus(overrides: Partial<SessionStatusInfo> = {}): SessionStatusInfo {
  return {
    sessionId: 'test-session-id',
    nickname: 'test-session',
    purpose: null,
    status: 'idle',
    queueDepth: 0,
    metadata: {},
    promptCount: 0,
    lastActivityAt: new Date(),
    workdir: '/test',
    chain: {
      parent_session_id: null,
      depth: 0,
      children: [],
      budget: { max_depth: 1, max_agents: 1, agents_spawned: 0 },
    },
    worktree: {
      isolation: 'shared' as const,
      worktree_path: null,
      worktree_branch: null,
      metals_available: false,
    },
    stale: false,
    waiting_for: null,
    mode: 'print' as const,
    diagnostics: null,
    ...overrides,
  };
}

function createMockPool(sessions: SessionStatusInfo[] = []): SessionPool & { createCalled: boolean } {
  const mock = {
    createCalled: false,
    list: () => sessions,
    create: async (opts: any) => {
      mock.createCalled = true;
      return {
        sessionId: 'new-genesis-id',
        nickname: opts.nickname ?? 'genesis-root',
        status: 'initializing',
        chain: {
          parent_session_id: null,
          depth: 0,
          children: [],
          budget: { max_depth: 1, max_agents: 1, agents_spawned: 0 },
        },
        worktree: {
          isolation: 'shared' as const,
          worktree_path: null,
          worktree_branch: null,
          metals_available: false,
        },
        mode: 'print' as const,
      };
    },
    status: (_id: string) => makeSessionStatus(),
    prompt: async () => ({ output: '', timedOut: false, metadata: null }),
    promptStream: async (_sid: string, _p: string, onEvent: (e: any) => void) => {
      onEvent({ type: 'done', output: '', metadata: null, timed_out: false });
    },
    kill: () => ({ sessionId: '', killed: true, worktree_cleaned: false }),
    poolStats: () => ({ totalSpawned: 0, startedAt: new Date(), maxSessions: 10, activeSessions: 0, deadSessions: 0 }),
    removeDead: () => 0,
    getChannels: () => { throw new Error('Not implemented'); },
    getSession: () => { throw new Error('Not implemented'); },
    checkStale: () => ({ stale: [], killed: [] }),
    childPids: () => [],
    setObservationHook: () => {},
    restoreSession: () => {},
    cleanupStaleCognitiveSessions: () => ({ killed: [] }),
  } as SessionPool & { createCalled: boolean };
  return mock;
}

// ── spawnGenesis tests ───────────────────────────────────────

describe('Genesis Spawner — dedup (PRD 029 C-3)', () => {
  test('spawns new session when no genesis session exists in pool', async () => {
    const pool = createMockPool([]);

    const result = await spawnGenesis(pool, '/test-workdir', 50000);

    assert.equal(pool.createCalled, true, 'pool.create() should be called');
    assert.equal(result.sessionId, 'new-genesis-id');
    assert.equal(result.initialized, true);
    assert.equal(result.projectId, 'root');
    assert.equal(result.budgetTokensPerDay, 50000);
  });

  test('adopts recovered genesis session in idle state', async () => {
    const recoveredSession = makeSessionStatus({
      sessionId: 'recovered-genesis-abc',
      nickname: 'genesis-root',
      status: 'idle',
      metadata: { genesis: true, project_id: 'root', budget_tokens_per_day: 50000 },
    });
    const pool = createMockPool([recoveredSession]);

    const result = await spawnGenesis(pool, '/test-workdir', 50000);

    assert.equal(pool.createCalled, false, 'pool.create() should NOT be called');
    assert.equal(result.sessionId, 'recovered-genesis-abc');
    assert.equal(result.nickname, 'genesis-root');
    assert.equal(result.status, 'idle');
    assert.equal(result.initialized, false, 'adopted sessions are not freshly initialized');
    assert.equal(result.projectId, 'root');
    assert.equal(result.budgetTokensPerDay, 50000);
  });

  test('adopts recovered genesis session in running state', async () => {
    const recoveredSession = makeSessionStatus({
      sessionId: 'recovered-genesis-running',
      nickname: 'genesis-root',
      status: 'running',
      metadata: { genesis: true, project_id: 'root' },
    });
    const pool = createMockPool([recoveredSession]);

    const result = await spawnGenesis(pool, '/test-workdir', 75000);

    assert.equal(pool.createCalled, false);
    assert.equal(result.sessionId, 'recovered-genesis-running');
    assert.equal(result.status, 'running');
    assert.equal(result.initialized, false);
    assert.equal(result.budgetTokensPerDay, 75000);
  });

  test('adopts recovered genesis session in recovering state', async () => {
    const recoveredSession = makeSessionStatus({
      sessionId: 'recovered-genesis-recovering',
      nickname: 'genesis-root',
      status: 'recovering',
      metadata: { genesis: true, project_id: 'root' },
    });
    const pool = createMockPool([recoveredSession]);

    const result = await spawnGenesis(pool, '/test-workdir', 50000);

    assert.equal(pool.createCalled, false);
    assert.equal(result.sessionId, 'recovered-genesis-recovering');
    assert.equal(result.status, 'recovering');
    assert.equal(result.initialized, false);
  });

  test('spawns new session when recovered genesis is dead', async () => {
    const deadSession = makeSessionStatus({
      sessionId: 'dead-genesis',
      nickname: 'genesis-root',
      status: 'dead',
      metadata: { genesis: true, project_id: 'root' },
    });
    const pool = createMockPool([deadSession]);

    const result = await spawnGenesis(pool, '/test-workdir', 50000);

    assert.equal(pool.createCalled, true, 'pool.create() should be called for dead genesis');
    assert.equal(result.sessionId, 'new-genesis-id');
    assert.equal(result.initialized, true);
  });

  test('ignores non-genesis sessions in pool during dedup check', async () => {
    const regularSession = makeSessionStatus({
      sessionId: 'regular-session',
      nickname: 'agent-1',
      status: 'idle',
      metadata: { project_id: 'some-project' },
    });
    const pool = createMockPool([regularSession]);

    const result = await spawnGenesis(pool, '/test-workdir', 50000);

    assert.equal(pool.createCalled, true, 'pool.create() should be called — no genesis in pool');
    assert.equal(result.sessionId, 'new-genesis-id');
    assert.equal(result.initialized, true);
  });

  test('uses default budget of 50000 tokens/day', async () => {
    const pool = createMockPool([]);

    const result = await spawnGenesis(pool, '/test-workdir');

    assert.equal(result.budgetTokensPerDay, 50000);
  });

  test('throws on pool.create failure', async () => {
    const pool = createMockPool([]);
    pool.create = async () => { throw new Error('PTY spawn failed'); };

    await assert.rejects(
      () => spawnGenesis(pool, '/test-workdir'),
      /Failed to spawn Genesis: PTY spawn failed/,
    );
  });
});

// ── getGenesisStatus tests ───────────────────────────────────

describe('getGenesisStatus', () => {
  test('returns undefined when no genesis session exists', () => {
    const pool = createMockPool([]);
    assert.equal(getGenesisStatus(pool), undefined);
  });

  test('returns genesis session when it exists', () => {
    const genesisSession = makeSessionStatus({
      sessionId: 'genesis-123',
      metadata: { genesis: true, project_id: 'root' },
    });
    const pool = createMockPool([genesisSession]);
    const result = getGenesisStatus(pool);
    assert.equal(result?.sessionId, 'genesis-123');
  });

  test('finds genesis among multiple sessions', () => {
    const sessions = [
      makeSessionStatus({ sessionId: 'other-1', metadata: { project_id: 'proj-a' } }),
      makeSessionStatus({ sessionId: 'genesis-456', metadata: { genesis: true, project_id: 'root' } }),
      makeSessionStatus({ sessionId: 'other-2', metadata: { project_id: 'proj-b' } }),
    ];
    const pool = createMockPool(sessions);
    const result = getGenesisStatus(pool);
    assert.equal(result?.sessionId, 'genesis-456');
  });
});

// ── isGenesisRunning tests ───────────────────────────────────

describe('isGenesisRunning', () => {
  test('returns false when no genesis exists', () => {
    const pool = createMockPool([]);
    assert.equal(isGenesisRunning(pool), false);
  });

  test('returns true when genesis is running', () => {
    const pool = createMockPool([
      makeSessionStatus({ sessionId: 'g1', status: 'running', metadata: { genesis: true } }),
    ]);
    assert.equal(isGenesisRunning(pool), true);
  });

  test('returns true when genesis is idle', () => {
    const pool = createMockPool([
      makeSessionStatus({ sessionId: 'g1', status: 'idle', metadata: { genesis: true } }),
    ]);
    assert.equal(isGenesisRunning(pool), true);
  });

  test('returns false when genesis is dead', () => {
    const pool = createMockPool([
      makeSessionStatus({ sessionId: 'g1', status: 'dead', metadata: { genesis: true } }),
    ]);
    assert.equal(isGenesisRunning(pool), false);
  });
});

// ── getGenesisSessionId tests ────────────────────────────────

describe('getGenesisSessionId', () => {
  test('returns undefined when no genesis exists', () => {
    const pool = createMockPool([]);
    assert.equal(getGenesisSessionId(pool), undefined);
  });

  test('returns session ID when genesis exists', () => {
    const pool = createMockPool([
      makeSessionStatus({ sessionId: 'genesis-789', metadata: { genesis: true } }),
    ]);
    assert.equal(getGenesisSessionId(pool), 'genesis-789');
  });
});
