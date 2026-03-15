import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, type SessionPool, type SessionChainInfo, type WorktreeInfo, type IsolationMode } from '../pool.js';
import type { PtySession, SessionStatus } from '../pty-session.js';
import { createSessionChannels, type SessionChannels } from '../channels.js';

/**
 * Create a fake PtySession for testing without spawning a real PTY process.
 */
function fakePtySession(id: string, initialStatus: SessionStatus = 'ready'): PtySession {
  let status: SessionStatus = initialStatus;
  let promptCount = 0;
  let lastActivityAt = new Date();

  return {
    id,
    get status() { return status; },
    set status(s: SessionStatus) { status = s; },
    queueDepth: 0,
    get promptCount() { return promptCount; },
    set promptCount(n: number) { promptCount = n; },
    get lastActivityAt() { return lastActivityAt; },
    set lastActivityAt(d: Date) { lastActivityAt = d; },
    get transcript() { return ''; },
    onOutput(_cb: (data: string) => void) { return () => {}; },
    onExit(_cb: (exitCode: number) => void) { /* no-op in test */ },
    async sendPrompt(_prompt: string, _timeoutMs?: number, _settleDelayMs?: number) {
      promptCount++;
      lastActivityAt = new Date();
      return { output: 'mock response', timedOut: false };
    },
    resize() { /* no-op in test */ },
    kill() {
      status = 'dead';
    },
  };
}

const DEFAULT_CHAIN: SessionChainInfo = {
  parent_session_id: null,
  depth: 0,
  children: [],
  budget: { max_depth: 3, max_agents: 10, agents_spawned: 0 },
};

const DEFAULT_WORKTREE: WorktreeInfo = {
  isolation: 'shared',
  worktree_path: null,
  worktree_branch: null,
  metals_available: true,
};

/**
 * Build a test pool that uses fakePtySession for unit testing.
 * Mirrors createPool's bookkeeping logic without PTY dependencies.
 * PRD 006: Includes session chain tracking.
 */
function createTestPool(maxSessions = 5) {
  const sessions = new Map<string, PtySession>();
  const sessionMetadata = new Map<string, Record<string, unknown>>();
  const sessionWorkdirs = new Map<string, string>();
  const sessionChains = new Map<string, SessionChainInfo>();
  const sessionChannelsMap = new Map<string, SessionChannels>();
  let totalSpawned = 0;
  const startedAt = new Date();
  let nextId = 0;

  const pool: SessionPool = {
    async create({ workdir, initialPrompt: _initialPrompt, spawnArgs: _spawnArgs, metadata, parentSessionId, depth, budget }) {
      const activeSessions = [...sessions.values()].filter((s) => s.status !== 'dead').length;
      if (activeSessions >= maxSessions) {
        throw new Error(`Session pool full — maximum ${maxSessions} active sessions`);
      }

      const effectiveDepth = depth ?? 0;
      const effectiveBudget = {
        max_depth: budget?.max_depth ?? 3,
        max_agents: budget?.max_agents ?? 10,
        agents_spawned: budget?.agents_spawned ?? 0,
      };

      // Budget validation for child sessions
      if (parentSessionId) {
        const parentChain = sessionChains.get(parentSessionId);
        if (parentChain) {
          if (effectiveDepth >= parentChain.budget.max_depth) {
            throw new Error(JSON.stringify({
              error: 'DEPTH_EXCEEDED',
              message: `Depth limit exceeded: depth ${effectiveDepth} >= max_depth ${parentChain.budget.max_depth}`,
              budget: parentChain.budget,
            }));
          }
          if (parentChain.budget.agents_spawned >= parentChain.budget.max_agents) {
            throw new Error(JSON.stringify({
              error: 'BUDGET_EXHAUSTED',
              message: `Agent budget exceeded: ${parentChain.budget.agents_spawned}/${parentChain.budget.max_agents}`,
              budget: parentChain.budget,
            }));
          }
          parentChain.budget.agents_spawned++;
          effectiveBudget.max_depth = parentChain.budget.max_depth;
          effectiveBudget.max_agents = parentChain.budget.max_agents;
          effectiveBudget.agents_spawned = parentChain.budget.agents_spawned;
        }
      }

      const sessionId = `test-session-${nextId++}`;
      const session = fakePtySession(sessionId);
      sessions.set(sessionId, session);
      sessionWorkdirs.set(sessionId, workdir);
      if (metadata) {
        sessionMetadata.set(sessionId, metadata);
      }

      const chainInfo: SessionChainInfo = {
        parent_session_id: parentSessionId ?? null,
        depth: effectiveDepth,
        children: [],
        budget: effectiveBudget,
      };
      sessionChains.set(sessionId, chainInfo);
      sessionChannelsMap.set(sessionId, createSessionChannels());

      if (parentSessionId) {
        const parentChain = sessionChains.get(parentSessionId);
        if (parentChain) {
          parentChain.children.push(sessionId);
        }
      }

      totalSpawned++;

      return { sessionId, nickname: `test-${nextId - 1}`, status: session.status, chain: chainInfo, worktree: DEFAULT_WORKTREE };
    },

    async prompt(sessionId, prompt, timeoutMs, settleDelayMs) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);
      if (session.status === 'dead') throw new Error(`Session ${sessionId} is dead — cannot send prompt`);
      return session.sendPrompt(prompt, timeoutMs, settleDelayMs);
    },

    status(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);
      return {
        sessionId: session.id,
        nickname: session.id,
        purpose: null,
        status: session.status,
        queueDepth: session.queueDepth,
        metadata: sessionMetadata.get(sessionId),
        promptCount: session.promptCount,
        lastActivityAt: session.lastActivityAt,
        workdir: sessionWorkdirs.get(sessionId) ?? '',
        chain: sessionChains.get(sessionId) ?? DEFAULT_CHAIN,
        worktree: DEFAULT_WORKTREE,
        stale: false,
        waiting_for: null,
      };
    },

    kill(sessionId, _worktreeAction) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);
      session.kill();
      return { sessionId: session.id, killed: true, worktree_cleaned: false };
    },

    list() {
      return [...sessions.entries()].map(([sessionId, session]) => ({
        sessionId: session.id,
        nickname: session.id,
        purpose: null,
        status: session.status,
        queueDepth: session.queueDepth,
        metadata: sessionMetadata.get(sessionId),
        promptCount: session.promptCount,
        lastActivityAt: session.lastActivityAt,
        workdir: sessionWorkdirs.get(sessionId) ?? '',
        chain: sessionChains.get(sessionId) ?? DEFAULT_CHAIN,
        worktree: DEFAULT_WORKTREE,
        stale: false,
        waiting_for: null,
      }));
    },

    getChannels(sessionId: string): SessionChannels {
      const channels = sessionChannelsMap.get(sessionId);
      if (!channels) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      return channels;
    },

    getSession(sessionId: string): PtySession {
      const session = sessions.get(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);
      return session;
    },

    poolStats() {
      const allSessions = [...sessions.values()];
      const active = allSessions.filter((s) => s.status !== 'dead').length;
      const dead = allSessions.filter((s) => s.status === 'dead').length;
      return {
        totalSpawned,
        startedAt,
        maxSessions,
        activeSessions: active,
        deadSessions: dead,
      };
    },

    removeDead(ttlMs: number): number {
      let removed = 0;
      for (const [sessionId, session] of sessions.entries()) {
        if (session.status === 'dead') {
          if (Date.now() - session.lastActivityAt.getTime() > ttlMs) {
            sessions.delete(sessionId);
            sessionMetadata.delete(sessionId);
            sessionWorkdirs.delete(sessionId);
            sessionChains.delete(sessionId);
            sessionChannelsMap.delete(sessionId);
            removed++;
          }
        }
      }
      return removed;
    },

    checkStale() {
      return { stale: [], killed: [] };
    },
  };

  return pool;
}

describe('SessionPool', () => {
  let pool: SessionPool;

  beforeEach(() => {
    pool = createTestPool(3);
  });

  describe('create()', () => {
    it('accepts and stores metadata on session creation', async () => {
      const meta = { role: 'worker', task: 'build' };
      const result = await pool.create({
        workdir: '/tmp/test',
        metadata: meta,
      });

      assert.ok(result.sessionId);
      assert.equal(result.status, 'ready');

      const status = pool.status(result.sessionId);
      assert.deepEqual(status.metadata, meta);
    });

    it('creates a session without metadata', async () => {
      const result = await pool.create({ workdir: '/tmp/test' });

      assert.ok(result.sessionId);
      const status = pool.status(result.sessionId);
      assert.equal(status.metadata, undefined);
    });

    it('stores workdir with the session', async () => {
      const result = await pool.create({ workdir: '/home/user/project' });

      const status = pool.status(result.sessionId);
      assert.equal(status.workdir, '/home/user/project');
    });

    it('accepts spawnArgs parameter', async () => {
      // spawnArgs are passed to spawnSession — we just verify create() doesn't reject them
      const result = await pool.create({
        workdir: '/tmp/test',
        spawnArgs: ['--model', 'opus'],
      });

      assert.ok(result.sessionId);
    });

    it('increments totalSpawned on each create', async () => {
      assert.equal(pool.poolStats().totalSpawned, 0);

      await pool.create({ workdir: '/tmp/a' });
      assert.equal(pool.poolStats().totalSpawned, 1);

      await pool.create({ workdir: '/tmp/b' });
      assert.equal(pool.poolStats().totalSpawned, 2);
    });

    it('enforces max session limit', async () => {
      await pool.create({ workdir: '/tmp/a' });
      await pool.create({ workdir: '/tmp/b' });
      await pool.create({ workdir: '/tmp/c' });

      await assert.rejects(
        () => pool.create({ workdir: '/tmp/d' }),
        /pool full/,
      );
    });
  });

  describe('status()', () => {
    it('returns metadata, promptCount, lastActivityAt, workdir', async () => {
      const meta = { env: 'test' };
      const result = await pool.create({
        workdir: '/tmp/project',
        metadata: meta,
      });

      const status = pool.status(result.sessionId);

      assert.equal(status.sessionId, result.sessionId);
      assert.equal(status.status, 'ready');
      assert.equal(status.queueDepth, 0);
      assert.deepEqual(status.metadata, meta);
      assert.equal(status.promptCount, 0);
      assert.ok(status.lastActivityAt instanceof Date);
      assert.equal(status.workdir, '/tmp/project');
    });

    it('reflects updated promptCount after sending a prompt', async () => {
      const result = await pool.create({ workdir: '/tmp/test' });

      await pool.prompt(result.sessionId, 'hello');

      const status = pool.status(result.sessionId);
      assert.equal(status.promptCount, 1);
    });

    it('updates lastActivityAt after sending a prompt', async () => {
      const result = await pool.create({ workdir: '/tmp/test' });
      const before = pool.status(result.sessionId).lastActivityAt;

      // Small delay to ensure timestamp differs
      await new Promise((r) => setTimeout(r, 10));
      await pool.prompt(result.sessionId, 'test prompt');

      const after = pool.status(result.sessionId).lastActivityAt;
      assert.ok(after.getTime() >= before.getTime());
    });

    it('throws for unknown session', () => {
      assert.throws(
        () => pool.status('nonexistent-id'),
        /not found/,
      );
    });
  });

  describe('list()', () => {
    it('returns metadata, promptCount, lastActivityAt, workdir for each session', async () => {
      await pool.create({ workdir: '/tmp/a', metadata: { role: 'alpha' } });
      await pool.create({ workdir: '/tmp/b', metadata: { role: 'beta' } });

      const sessions = pool.list();

      assert.equal(sessions.length, 2);

      const alpha = sessions.find((s) => s.workdir === '/tmp/a');
      const beta = sessions.find((s) => s.workdir === '/tmp/b');

      assert.ok(alpha);
      assert.ok(beta);
      assert.deepEqual(alpha.metadata, { role: 'alpha' });
      assert.deepEqual(beta.metadata, { role: 'beta' });
      assert.equal(alpha.promptCount, 0);
      assert.equal(beta.promptCount, 0);
      assert.ok(alpha.lastActivityAt instanceof Date);
      assert.ok(beta.lastActivityAt instanceof Date);
    });

    it('includes sessions without metadata', async () => {
      await pool.create({ workdir: '/tmp/no-meta' });

      const sessions = pool.list();
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].metadata, undefined);
      assert.equal(sessions[0].workdir, '/tmp/no-meta');
    });
  });

  describe('poolStats()', () => {
    it('returns correct stats after creation and kills', async () => {
      const stats0 = pool.poolStats();
      assert.equal(stats0.totalSpawned, 0);
      assert.equal(stats0.maxSessions, 3);
      assert.equal(stats0.activeSessions, 0);
      assert.equal(stats0.deadSessions, 0);
      assert.ok(stats0.startedAt instanceof Date);

      const s1 = await pool.create({ workdir: '/tmp/a' });
      await pool.create({ workdir: '/tmp/b' });

      const stats1 = pool.poolStats();
      assert.equal(stats1.totalSpawned, 2);
      assert.equal(stats1.activeSessions, 2);
      assert.equal(stats1.deadSessions, 0);

      pool.kill(s1.sessionId);

      const stats2 = pool.poolStats();
      assert.equal(stats2.totalSpawned, 2);
      assert.equal(stats2.activeSessions, 1);
      assert.equal(stats2.deadSessions, 1);
    });

    it('startedAt is set at pool creation time', () => {
      const before = new Date();
      const freshPool = createTestPool();
      const stats = freshPool.poolStats();
      const after = new Date();

      assert.ok(stats.startedAt.getTime() >= before.getTime());
      assert.ok(stats.startedAt.getTime() <= after.getTime());
    });
  });

  describe('removeDead()', () => {
    it('removes dead sessions older than TTL', async () => {
      const s1 = await pool.create({ workdir: '/tmp/a' });
      const s2 = await pool.create({ workdir: '/tmp/b' });

      pool.kill(s1.sessionId);

      // Small delay so that the dead session's lastActivityAt is in the past
      await new Promise((r) => setTimeout(r, 15));

      // With TTL of 10ms, the dead session (killed >15ms ago) should be removed
      const removed = pool.removeDead(10);
      assert.equal(removed, 1);

      // The dead session should no longer be found
      assert.throws(() => pool.status(s1.sessionId), /not found/);

      // The alive session should still exist
      const status = pool.status(s2.sessionId);
      assert.equal(status.status, 'ready');
    });

    it('does not remove dead sessions younger than TTL', async () => {
      const s1 = await pool.create({ workdir: '/tmp/a' });
      pool.kill(s1.sessionId);

      // With a very high TTL, nothing should be removed
      const removed = pool.removeDead(999_999_999);
      assert.equal(removed, 0);

      // Session should still exist
      const status = pool.status(s1.sessionId);
      assert.equal(status.status, 'dead');
    });

    it('does not remove alive sessions', async () => {
      await pool.create({ workdir: '/tmp/a' });
      await pool.create({ workdir: '/tmp/b' });

      const removed = pool.removeDead(0);
      assert.equal(removed, 0);

      assert.equal(pool.list().length, 2);
    });

    it('returns 0 when no sessions exist', () => {
      const removed = pool.removeDead(0);
      assert.equal(removed, 0);
    });
  });

  // ── PRD 006: Session Chain Tests ──────────────────────────────

  describe('session chains (PRD 006)', () => {
    it('root session has depth 0 and no parent', async () => {
      const result = await pool.create({ workdir: '/tmp/root' });
      const status = pool.status(result.sessionId);

      assert.equal(status.chain.depth, 0);
      assert.equal(status.chain.parent_session_id, null);
      assert.deepEqual(status.chain.children, []);
    });

    it('child session records parent and depth', async () => {
      const parent = await pool.create({ workdir: '/tmp/parent' });
      const child = await pool.create({
        workdir: '/tmp/child',
        parentSessionId: parent.sessionId,
        depth: 1,
      });

      const childStatus = pool.status(child.sessionId);
      assert.equal(childStatus.chain.parent_session_id, parent.sessionId);
      assert.equal(childStatus.chain.depth, 1);

      const parentStatus = pool.status(parent.sessionId);
      assert.deepEqual(parentStatus.chain.children, [child.sessionId]);
    });

    it('rejects spawn when depth exceeds max_depth', async () => {
      const root = await pool.create({
        workdir: '/tmp/root',
        budget: { max_depth: 2, max_agents: 10 },
      });

      await assert.rejects(
        () => pool.create({
          workdir: '/tmp/deep',
          parentSessionId: root.sessionId,
          depth: 2,
        }),
        /DEPTH_EXCEEDED/,
      );
    });

    it('rejects spawn when agent budget is exhausted', async () => {
      const root = await pool.create({
        workdir: '/tmp/root',
        budget: { max_depth: 5, max_agents: 1 },
      });

      // First child — should succeed (agents_spawned goes from 0 to 1)
      await pool.create({
        workdir: '/tmp/child1',
        parentSessionId: root.sessionId,
        depth: 1,
      });

      // Second child — should fail (agents_spawned = 1, max_agents = 1)
      await assert.rejects(
        () => pool.create({
          workdir: '/tmp/child2',
          parentSessionId: root.sessionId,
          depth: 1,
        }),
        /BUDGET_EXHAUSTED/,
      );
    });

    it('returns chain info from create()', async () => {
      const result = await pool.create({
        workdir: '/tmp/root',
        budget: { max_depth: 5, max_agents: 20 },
      });

      assert.equal(result.chain.depth, 0);
      assert.equal(result.chain.parent_session_id, null);
      assert.equal(result.chain.budget.max_depth, 5);
      assert.equal(result.chain.budget.max_agents, 20);
    });

    it('list() includes chain info for all sessions', async () => {
      const root = await pool.create({ workdir: '/tmp/root' });
      await pool.create({
        workdir: '/tmp/child',
        parentSessionId: root.sessionId,
        depth: 1,
      });

      const sessions = pool.list();
      assert.equal(sessions.length, 2);

      const rootSession = sessions.find(s => s.chain.depth === 0);
      const childSession = sessions.find(s => s.chain.depth === 1);

      assert.ok(rootSession);
      assert.ok(childSession);
      assert.equal(childSession!.chain.parent_session_id, rootSession!.sessionId);
    });
  });
});
