import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPool,
  type SessionPool,
  type SessionChainInfo,
  type WorktreeInfo,
  type IsolationMode,
  type StaleConfig,
} from '../pool.js';
import type { PtySession, SessionStatus } from '../pty-session.js';
import {
  createSessionChannels,
  appendMessage,
  readMessages,
  type SessionChannels,
} from '../channels.js';

/**
 * Create a fake PtySession for testing without spawning a real PTY process.
 * Supports controllable lastActivityAt for stale detection tests.
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
    adaptiveSettle: null,
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
 * Test pool with stale detection support.
 * Sessions can have their lastActivityAt manipulated for stale tests.
 */
function createStaleTestPool(maxSessions = 5) {
  const sessions = new Map<string, PtySession>();
  const sessionMetadata = new Map<string, Record<string, unknown>>();
  const sessionWorkdirs = new Map<string, string>();
  const sessionChains = new Map<string, SessionChainInfo>();
  const sessionChannelsMap = new Map<string, SessionChannels>();
  const sessionStaleConfigs = new Map<string, StaleConfig>();
  const sessionStaleFlags = new Map<string, boolean>();
  let totalSpawned = 0;
  const startedAt = new Date();
  let nextId = 0;

  // Expose internals for test manipulation
  const _internals = { sessions, sessionStaleConfigs, sessionStaleFlags, sessionChannelsMap };

  const pool: SessionPool & { _internals: typeof _internals } = {
    _internals,

    async create({ workdir, initialPrompt: _initialPrompt, spawnArgs: _spawnArgs, metadata, parentSessionId, depth, budget, isolation: _isolation, timeout_ms }) {
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

      if (parentSessionId) {
        const parentChain = sessionChains.get(parentSessionId);
        if (parentChain) {
          if (effectiveDepth >= parentChain.budget.max_depth) {
            throw new Error(JSON.stringify({ error: 'DEPTH_EXCEEDED' }));
          }
          if (parentChain.budget.agents_spawned >= parentChain.budget.max_agents) {
            throw new Error(JSON.stringify({ error: 'BUDGET_EXHAUSTED' }));
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
      if (metadata) sessionMetadata.set(sessionId, metadata);

      const chainInfo: SessionChainInfo = {
        parent_session_id: parentSessionId ?? null,
        depth: effectiveDepth,
        children: [],
        budget: effectiveBudget,
      };
      sessionChains.set(sessionId, chainInfo);

      const channels = createSessionChannels();
      sessionChannelsMap.set(sessionId, channels);
      appendMessage(channels.events, 'bridge', 'started', { session_id: sessionId });

      // Stale config
      const staleConfig: StaleConfig = {
        stale_timeout_ms: timeout_ms ?? 30 * 60 * 1000,
        kill_timeout_ms: timeout_ms ? timeout_ms * 2 : 60 * 60 * 1000,
      };
      sessionStaleConfigs.set(sessionId, staleConfig);
      sessionStaleFlags.set(sessionId, false);

      if (parentSessionId) {
        const parentChain = sessionChains.get(parentSessionId);
        if (parentChain) parentChain.children.push(sessionId);
      }

      totalSpawned++;
      return { sessionId, nickname: `test-${nextId - 1}`, status: session.status, chain: chainInfo, worktree: DEFAULT_WORKTREE, mode: 'pty' as const };
    },

    async prompt(sessionId, prompt, timeoutMs, settleDelayMs) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);
      if (session.status === 'dead') throw new Error(`Session ${sessionId} is dead`);
      // Reset stale flag on activity
      sessionStaleFlags.set(sessionId, false);
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
        stale: sessionStaleFlags.get(sessionId) ?? false,
        waiting_for: null,
        mode: 'pty' as const,
        diagnostics: null,
      };
    },

    kill(sessionId, _worktreeAction) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);
      session.kill();
      const channels = sessionChannelsMap.get(sessionId);
      if (channels) {
        appendMessage(channels.events, 'bridge', 'killed', { session_id: sessionId });
      }
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
        stale: sessionStaleFlags.get(sessionId) ?? false,
        waiting_for: null,
        mode: 'pty' as const,
        diagnostics: null,
      }));
    },

    getChannels(sessionId: string): SessionChannels {
      const channels = sessionChannelsMap.get(sessionId);
      if (!channels) throw new Error(`Session not found: ${sessionId}`);
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
      return { totalSpawned, startedAt, maxSessions, activeSessions: active, deadSessions: dead };
    },

    removeDead(ttlMs: number): number {
      let removed = 0;
      for (const [sessionId, session] of sessions.entries()) {
        if (session.status === 'dead' && Date.now() - session.lastActivityAt.getTime() > ttlMs) {
          sessions.delete(sessionId);
          sessionMetadata.delete(sessionId);
          sessionWorkdirs.delete(sessionId);
          sessionChains.delete(sessionId);
          sessionChannelsMap.delete(sessionId);
          sessionStaleConfigs.delete(sessionId);
          sessionStaleFlags.delete(sessionId);
          removed++;
        }
      }
      return removed;
    },

    /**
     * Stale detection — mirrors pool.ts checkStale() logic.
     */
    checkStale() {
      const now = Date.now();
      const staleIds: string[] = [];
      const killedIds: string[] = [];

      for (const [sessionId, session] of sessions.entries()) {
        if (session.status === 'dead') continue;

        const config = sessionStaleConfigs.get(sessionId);
        if (!config) continue;

        const inactiveMs = now - session.lastActivityAt.getTime();
        const isStale = sessionStaleFlags.get(sessionId) ?? false;

        if (inactiveMs >= config.kill_timeout_ms) {
          session.kill();
          const channels = sessionChannelsMap.get(sessionId);
          if (channels) {
            appendMessage(channels.events, 'bridge', 'stale', {
              session_id: sessionId,
              inactive_ms: inactiveMs,
              action: 'auto_killed',
            });
          }
          killedIds.push(sessionId);
          sessionStaleFlags.set(sessionId, true);
          continue;
        }

        if (inactiveMs >= config.stale_timeout_ms && !isStale) {
          sessionStaleFlags.set(sessionId, true);
          const channels = sessionChannelsMap.get(sessionId);
          if (channels) {
            appendMessage(channels.events, 'bridge', 'stale', {
              session_id: sessionId,
              inactive_ms: inactiveMs,
              action: 'marked_stale',
            });
          }
          staleIds.push(sessionId);
        }
      }

      return { stale: staleIds, killed: killedIds };
    },
  };

  return pool;
}

// ── Worktree Isolation Tests (PRD 006 Component 2) ───────────

describe('Worktree Isolation (PRD 006 Component 2)', () => {
  describe('WorktreeInfo defaults', () => {
    it('shared session has metals_available: true and no worktree path', async () => {
      const pool = createStaleTestPool();
      const result = await pool.create({ workdir: '/tmp/test' });

      assert.equal(result.worktree.isolation, 'shared');
      assert.equal(result.worktree.worktree_path, null);
      assert.equal(result.worktree.worktree_branch, null);
      assert.equal(result.worktree.metals_available, true);
    });

    it('status includes worktree info', async () => {
      const pool = createStaleTestPool();
      const result = await pool.create({ workdir: '/tmp/test' });
      const status = pool.status(result.sessionId);

      assert.equal(status.worktree.isolation, 'shared');
      assert.equal(status.worktree.metals_available, true);
    });

    it('list includes worktree info for all sessions', async () => {
      const pool = createStaleTestPool();
      await pool.create({ workdir: '/tmp/a' });
      await pool.create({ workdir: '/tmp/b' });

      const sessions = pool.list();
      assert.equal(sessions.length, 2);

      for (const s of sessions) {
        assert.equal(s.worktree.isolation, 'shared');
        assert.equal(s.worktree.metals_available, true);
      }
    });
  });

  describe('kill with worktree_action', () => {
    it('kill returns worktree_cleaned: false for shared sessions', async () => {
      const pool = createStaleTestPool();
      const result = await pool.create({ workdir: '/tmp/test' });
      const killResult = pool.kill(result.sessionId, 'discard');

      assert.equal(killResult.killed, true);
      assert.equal(killResult.worktree_cleaned, false);
    });

    it('kill without worktree_action defaults to keep', async () => {
      const pool = createStaleTestPool();
      const result = await pool.create({ workdir: '/tmp/test' });
      const killResult = pool.kill(result.sessionId);

      assert.equal(killResult.killed, true);
      assert.equal(killResult.worktree_cleaned, false);
    });
  });
});

// ── Stale Detection Tests (PRD 006 Component 4) ─────────────

describe('Stale Detection (PRD 006 Component 4)', () => {
  describe('stale flag defaults', () => {
    it('new session is not stale', async () => {
      const pool = createStaleTestPool();
      const result = await pool.create({ workdir: '/tmp/test' });
      const status = pool.status(result.sessionId);

      assert.equal(status.stale, false);
    });

    it('list includes stale flag', async () => {
      const pool = createStaleTestPool();
      await pool.create({ workdir: '/tmp/a' });

      const sessions = pool.list();
      assert.equal(sessions[0].stale, false);
    });
  });

  describe('checkStale()', () => {
    it('returns empty arrays when no sessions are stale', async () => {
      const pool = createStaleTestPool();
      await pool.create({ workdir: '/tmp/test' });

      const result = pool.checkStale();
      assert.deepEqual(result.stale, []);
      assert.deepEqual(result.killed, []);
    });

    it('marks session stale after stale_timeout_ms', async () => {
      const pool = createStaleTestPool();
      // Create with very short timeout for testing
      const created = await pool.create({ workdir: '/tmp/test', timeout_ms: 50 });

      // Simulate inactivity by backdating lastActivityAt well beyond the threshold
      const session = pool._internals.sessions.get(created.sessionId)!;
      session.lastActivityAt = new Date(Date.now() - 5000); // 5s ago, well past 50ms stale but under 100ms kill

      // Override stale config to ensure kill timeout is far away
      pool._internals.sessionStaleConfigs.set(created.sessionId, {
        stale_timeout_ms: 50,
        kill_timeout_ms: 999_999,
      });

      const result = pool.checkStale();
      assert.deepEqual(result.stale, [created.sessionId]);
      assert.deepEqual(result.killed, []);

      // Status should now show stale
      const status = pool.status(created.sessionId);
      assert.equal(status.stale, true);
    });

    it('does not mark dead sessions as stale', async () => {
      const pool = createStaleTestPool();
      const created = await pool.create({ workdir: '/tmp/test', timeout_ms: 50 });

      // Kill it first
      pool.kill(created.sessionId);

      // Backdate
      const session = pool._internals.sessions.get(created.sessionId)!;
      session.lastActivityAt = new Date(Date.now() - 100);

      const result = pool.checkStale();
      assert.deepEqual(result.stale, []);
      assert.deepEqual(result.killed, []);
    });

    it('auto-kills session after kill_timeout_ms', async () => {
      const pool = createStaleTestPool();
      const created = await pool.create({ workdir: '/tmp/test', timeout_ms: 50 });
      // kill_timeout_ms = 50 * 2 = 100

      // Backdate beyond kill timeout
      const session = pool._internals.sessions.get(created.sessionId)!;
      session.lastActivityAt = new Date(Date.now() - 150); // 150ms ago, > 100ms kill timeout

      const result = pool.checkStale();
      assert.deepEqual(result.stale, []);
      assert.deepEqual(result.killed, [created.sessionId]);

      // Session should now be dead
      assert.equal(session.status, 'dead');
    });

    it('emits stale event to channels when marking stale', async () => {
      const pool = createStaleTestPool();
      const created = await pool.create({ workdir: '/tmp/test', timeout_ms: 50 });

      // Backdate
      const session = pool._internals.sessions.get(created.sessionId)!;
      session.lastActivityAt = new Date(Date.now() - 75); // Past stale, not past kill

      pool.checkStale();

      // Read events channel — should have 'started' + 'stale'
      const channels = pool.getChannels(created.sessionId);
      const events = readMessages(channels.events, 0);
      assert.equal(events.messages.length, 2); // started + stale
      assert.equal(events.messages[1].type, 'stale');
      assert.equal(events.messages[1].content.action, 'marked_stale');
    });

    it('emits stale event with auto_killed action when killing', async () => {
      const pool = createStaleTestPool();
      const created = await pool.create({ workdir: '/tmp/test', timeout_ms: 50 });

      const session = pool._internals.sessions.get(created.sessionId)!;
      session.lastActivityAt = new Date(Date.now() - 150); // Past kill timeout

      pool.checkStale();

      const channels = pool.getChannels(created.sessionId);
      const events = readMessages(channels.events, 0);

      const staleEvent = events.messages.find(m => m.type === 'stale');
      assert.ok(staleEvent);
      assert.equal(staleEvent!.content.action, 'auto_killed');
    });

    it('does not double-mark already stale sessions', async () => {
      const pool = createStaleTestPool();
      const created = await pool.create({ workdir: '/tmp/test', timeout_ms: 50 });

      const session = pool._internals.sessions.get(created.sessionId)!;
      session.lastActivityAt = new Date(Date.now() - 75); // Past stale, not kill

      // First check — marks stale
      const result1 = pool.checkStale();
      assert.deepEqual(result1.stale, [created.sessionId]);

      // Second check — already stale, should not re-mark
      const result2 = pool.checkStale();
      assert.deepEqual(result2.stale, []);
    });

    it('uses custom timeout_ms when provided', async () => {
      const pool = createStaleTestPool();
      // 10ms stale timeout, 20ms kill timeout
      const created = await pool.create({ workdir: '/tmp/test', timeout_ms: 10 });

      const session = pool._internals.sessions.get(created.sessionId)!;
      session.lastActivityAt = new Date(Date.now() - 15); // Past 10ms stale, not 20ms kill

      const result = pool.checkStale();
      assert.deepEqual(result.stale, [created.sessionId]);
      assert.deepEqual(result.killed, []);
    });

    it('multiple sessions can be stale independently', async () => {
      const pool = createStaleTestPool();
      const s1 = await pool.create({ workdir: '/tmp/a', timeout_ms: 50 });
      const s2 = await pool.create({ workdir: '/tmp/b', timeout_ms: 50 });
      const s3 = await pool.create({ workdir: '/tmp/c', timeout_ms: 50 });

      // Make s1 and s3 stale, leave s2 active
      pool._internals.sessions.get(s1.sessionId)!.lastActivityAt = new Date(Date.now() - 75);
      pool._internals.sessions.get(s3.sessionId)!.lastActivityAt = new Date(Date.now() - 75);

      const result = pool.checkStale();
      assert.equal(result.stale.length, 2);
      assert.ok(result.stale.includes(s1.sessionId));
      assert.ok(result.stale.includes(s3.sessionId));
      assert.deepEqual(result.killed, []);

      // s2 should not be stale
      assert.equal(pool.status(s2.sessionId).stale, false);
    });
  });
});
