// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for SessionCheckpointSink (PRD 029 Phase C-2).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SessionCheckpointSink, type SessionStatusInfo, type PersistedSessionInput } from './session-checkpoint-sink.js';
import type { RuntimeEvent } from '../ports/event-bus.js';

// ── Test helpers ───────────────────────────────────────────────

function makeEvent(seq: number, overrides: Partial<RuntimeEvent> = {}): RuntimeEvent {
  return {
    id: `evt-${seq}`,
    version: 1,
    timestamp: new Date(Date.now() + seq).toISOString(),
    sequence: seq,
    domain: 'session',
    type: 'session.spawned',
    severity: 'info',
    payload: {},
    source: 'test',
    sessionId: 'sess-1',
    ...overrides,
  };
}

function makeSessionInfo(sessionId: string, overrides: Partial<SessionStatusInfo> = {}): SessionStatusInfo {
  return {
    sessionId,
    nickname: `agent-${sessionId}`,
    purpose: 'test purpose',
    status: 'running',
    promptCount: 1,
    lastActivityAt: new Date(),
    workdir: '/tmp/project',
    mode: 'print',
    chain: {
      parent_session_id: null,
      depth: 0,
    },
    worktree: {
      isolation: 'shared',
    },
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe('SessionCheckpointSink', () => {
  let sink: SessionCheckpointSink;
  let saved: PersistedSessionInput[];
  let poolSessions: SessionStatusInfo[];

  beforeEach(() => {
    saved = [];
    poolSessions = [makeSessionInfo('sess-1')];

    sink = new SessionCheckpointSink({
      save: async (session) => { saved.push(session); },
      poolList: () => poolSessions,
      debounceMs: 50, // Short for testing
    });
  });

  afterEach(() => {
    sink.dispose();
  });

  describe('event filtering', () => {
    it('fires on session.spawned', async () => {
      sink.onEvent(makeEvent(1, { type: 'session.spawned', sessionId: 'sess-1' }));

      await new Promise(r => setTimeout(r, 100));

      assert.equal(saved.length, 1);
      assert.equal(saved[0].session_id, 'sess-1');
    });

    it('fires on session.prompt.completed', async () => {
      sink.onEvent(makeEvent(1, { type: 'session.prompt.completed', sessionId: 'sess-1' }));

      await new Promise(r => setTimeout(r, 100));

      assert.equal(saved.length, 1);
    });

    it('fires on session.killed', async () => {
      sink.onEvent(makeEvent(1, { type: 'session.killed', sessionId: 'sess-1' }));

      await new Promise(r => setTimeout(r, 100));

      assert.equal(saved.length, 1);
    });

    it('fires on session.dead', async () => {
      sink.onEvent(makeEvent(1, { type: 'session.dead', sessionId: 'sess-1' }));

      await new Promise(r => setTimeout(r, 100));

      assert.equal(saved.length, 1);
    });

    it('fires on session.state_changed', async () => {
      sink.onEvent(makeEvent(1, { type: 'session.state_changed', sessionId: 'sess-1' }));

      await new Promise(r => setTimeout(r, 100));

      assert.equal(saved.length, 1);
    });

    it('ignores strategy events', async () => {
      sink.onEvent(makeEvent(1, { type: 'strategy.started', domain: 'strategy', sessionId: 'sess-1' }));

      await new Promise(r => setTimeout(r, 100));

      assert.equal(saved.length, 0);
    });

    it('ignores trigger events', async () => {
      sink.onEvent(makeEvent(1, { type: 'trigger.fired', domain: 'trigger', sessionId: 'sess-1' }));

      await new Promise(r => setTimeout(r, 100));

      assert.equal(saved.length, 0);
    });

    it('ignores system events', async () => {
      sink.onEvent(makeEvent(1, { type: 'system.startup', domain: 'system', sessionId: 'sess-1' }));

      await new Promise(r => setTimeout(r, 100));

      assert.equal(saved.length, 0);
    });

    it('ignores events without sessionId', async () => {
      sink.onEvent(makeEvent(1, { type: 'session.spawned', sessionId: undefined }));

      await new Promise(r => setTimeout(r, 100));

      assert.equal(saved.length, 0);
    });
  });

  describe('debouncing', () => {
    it('collapses two events within debounce window into one save', async () => {
      sink.onEvent(makeEvent(1, { type: 'session.spawned', sessionId: 'sess-1' }));
      sink.onEvent(makeEvent(2, { type: 'session.prompt.completed', sessionId: 'sess-1' }));

      await new Promise(r => setTimeout(r, 150));

      assert.equal(saved.length, 1, 'should debounce to single save');
    });

    it('saves separately for different sessions', async () => {
      poolSessions.push(makeSessionInfo('sess-2'));

      sink.onEvent(makeEvent(1, { type: 'session.spawned', sessionId: 'sess-1' }));
      sink.onEvent(makeEvent(2, { type: 'session.spawned', sessionId: 'sess-2' }));

      await new Promise(r => setTimeout(r, 150));

      assert.equal(saved.length, 2, 'different sessions should not debounce together');
    });

    it('fires again after debounce window passes', async () => {
      sink.onEvent(makeEvent(1, { type: 'session.spawned', sessionId: 'sess-1' }));

      await new Promise(r => setTimeout(r, 100));

      sink.onEvent(makeEvent(2, { type: 'session.prompt.completed', sessionId: 'sess-1' }));

      await new Promise(r => setTimeout(r, 100));

      assert.equal(saved.length, 2, 'events after debounce window should trigger new save');
    });
  });

  describe('data mapping', () => {
    it('maps SessionStatusInfo to PersistedSessionInput', async () => {
      poolSessions = [makeSessionInfo('sess-1', {
        nickname: 'builder',
        purpose: 'implement feature',
        status: 'working',
        promptCount: 5,
        workdir: '/projects/app',
        mode: 'print',
        chain: { parent_session_id: 'parent-1', depth: 2 },
        worktree: { isolation: 'worktree' },
        metadata: { tag: 'v1' },
      })];

      sink.onEvent(makeEvent(1, { type: 'session.spawned', sessionId: 'sess-1' }));

      await new Promise(r => setTimeout(r, 100));

      assert.equal(saved.length, 1);
      const s = saved[0];
      assert.equal(s.session_id, 'sess-1');
      assert.equal(s.nickname, 'builder');
      assert.equal(s.purpose, 'implement feature');
      assert.equal(s.status, 'working');
      assert.equal(s.prompt_count, 5);
      assert.equal(s.workdir, '/projects/app');
      assert.equal(s.mode, 'print');
      assert.equal(s.depth, 2);
      assert.equal(s.parent_session_id, 'parent-1');
      assert.equal(s.isolation, 'worktree');
      assert.deepEqual(s.metadata, { tag: 'v1' });
    });
  });

  describe('error handling', () => {
    it('handles save() errors without throwing', async () => {
      const failingSink = new SessionCheckpointSink({
        save: async () => { throw new Error('disk full'); },
        poolList: () => poolSessions,
        debounceMs: 50,
      });

      // Should not throw
      failingSink.onEvent(makeEvent(1, { type: 'session.spawned', sessionId: 'sess-1' }));

      await new Promise(r => setTimeout(r, 100));

      // Sink should still be functional — no exception bubbled
      assert.equal(failingSink.pendingCount, 0, 'timer should be cleared after checkpoint');

      failingSink.dispose();
    });

    it('handles poolList() errors without throwing', async () => {
      const failingSink = new SessionCheckpointSink({
        save: async (session) => { saved.push(session); },
        poolList: () => { throw new Error('pool broken'); },
        debounceMs: 50,
      });

      // Should not throw
      failingSink.onEvent(makeEvent(1, { type: 'session.spawned', sessionId: 'sess-1' }));

      await new Promise(r => setTimeout(r, 100));

      assert.equal(saved.length, 0, 'no save should happen when poolList fails');

      failingSink.dispose();
    });

    it('skips save when session not found in pool', async () => {
      poolSessions = []; // empty pool

      sink.onEvent(makeEvent(1, { type: 'session.spawned', sessionId: 'sess-1' }));

      await new Promise(r => setTimeout(r, 100));

      assert.equal(saved.length, 0, 'no save when session not in pool');
    });
  });

  describe('dispose', () => {
    it('clears pending timers on dispose', () => {
      sink.onEvent(makeEvent(1, { type: 'session.spawned', sessionId: 'sess-1' }));
      assert.equal(sink.pendingCount, 1);

      sink.dispose();
      assert.equal(sink.pendingCount, 0);
    });
  });

  describe('payload sessionId fallback', () => {
    it('reads sessionId from payload when top-level sessionId is absent', async () => {
      sink.onEvent(makeEvent(1, {
        type: 'session.spawned',
        sessionId: undefined,
        payload: { sessionId: 'sess-1' },
      }));

      await new Promise(r => setTimeout(r, 100));

      assert.equal(saved.length, 1);
      assert.equal(saved[0].session_id, 'sess-1');
    });
  });
});
