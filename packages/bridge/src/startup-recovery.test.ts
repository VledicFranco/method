/**
 * Startup Recovery tests.
 *
 * Tests the three-phase recovery process:
 *   1. Discover — persistence + native session discovery
 *   2. Reconcile — cross-reference by sessionId
 *   3. Hydrate — call restoreSession for recoverable sessions
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runStartupRecovery } from './startup-recovery.js';
import type { RecoveryDeps, PersistedSessionForRecovery, SessionSnapshot } from './startup-recovery.js';
import type { NativeSessionInfo, NativeSessionDiscovery } from './ports/native-session-discovery.js';
import type { BridgeEvent, BridgeEventInput } from './ports/event-bus.js';

// ── Test helpers ────────────────────────────────────────────────

function makePersistedSession(overrides: Partial<PersistedSessionForRecovery> = {}): PersistedSessionForRecovery {
  return {
    session_id: 'session-1',
    workdir: '/projects/test',
    nickname: 'test-agent',
    purpose: 'testing',
    mode: 'pty',
    status: 'running',
    created_at: '2026-03-26T00:00:00.000Z',
    last_activity_at: '2026-03-26T01:00:00.000Z',
    prompt_count: 5,
    depth: 0,
    parent_session_id: null,
    isolation: 'none',
    ...overrides,
  };
}

function makeNativeSession(overrides: Partial<NativeSessionInfo> = {}): NativeSessionInfo {
  return {
    sessionId: 'session-1',
    pid: 12345,
    projectPath: '/projects/test',
    startedAt: Date.now() - 60000,
    ...overrides,
  };
}

function createMockDeps(options: {
  persisted?: PersistedSessionForRecovery[];
  native?: NativeSessionInfo[];
  discoveryThrows?: boolean;
  persistenceThrows?: boolean;
} = {}): {
  deps: RecoveryDeps;
  restored: SessionSnapshot[];
  events: BridgeEventInput[];
} {
  const restored: SessionSnapshot[] = [];
  const events: BridgeEventInput[] = [];

  const discovery: NativeSessionDiscovery = {
    async listLiveSessions(): Promise<NativeSessionInfo[]> {
      if (options.discoveryThrows) {
        throw new Error('Discovery failed');
      }
      return options.native ?? [];
    },
  };

  let seq = 0;

  const deps: RecoveryDeps = {
    persistence: {
      async loadAll(): Promise<PersistedSessionForRecovery[]> {
        if (options.persistenceThrows) {
          throw new Error('Persistence failed');
        }
        return options.persisted ?? [];
      },
    },
    discovery,
    restoreSession: (snapshot: SessionSnapshot) => {
      restored.push(snapshot);
    },
    eventBus: {
      emit(event: BridgeEventInput): BridgeEvent {
        events.push(event);
        return {
          ...event,
          id: `evt-${++seq}`,
          timestamp: new Date().toISOString(),
          sequence: seq,
        };
      },
    },
  };

  return { deps, restored, events };
}

// ── Tests ───────────────────────────────────────────────────────

describe('runStartupRecovery', () => {
  it('full round-trip: persisted + alive sessions are restored', async () => {
    const { deps, restored, events } = createMockDeps({
      persisted: [
        makePersistedSession({ session_id: 'sess-a', nickname: 'agent-a' }),
        makePersistedSession({ session_id: 'sess-b', nickname: 'agent-b' }),
      ],
      native: [
        makeNativeSession({ sessionId: 'sess-a', pid: 1001 }),
        makeNativeSession({ sessionId: 'sess-b', pid: 1002 }),
      ],
    });

    const report = await runStartupRecovery(deps);

    assert.strictEqual(report.recovered, 2);
    assert.strictEqual(report.failed, 0);
    assert.strictEqual(report.tombstoned, 0);
    assert.strictEqual(report.skipped, 0);
    assert.ok(report.durationMs >= 0);

    // Verify restoreSession was called with correct data
    assert.strictEqual(restored.length, 2);
    assert.strictEqual(restored[0].sessionId, 'sess-a');
    assert.strictEqual(restored[0].pid, 1001);
    assert.strictEqual(restored[0].nickname, 'agent-a');
    assert.strictEqual(restored[1].sessionId, 'sess-b');
    assert.strictEqual(restored[1].pid, 1002);

    // Verify events
    const eventTypes = events.map((e) => e.type);
    assert.ok(eventTypes.includes('system.recovery_started'));
    assert.ok(eventTypes.includes('system.recovery_completed'));

    const completedEvent = events.find((e) => e.type === 'system.recovery_completed')!;
    assert.strictEqual(completedEvent.payload.recovered, 2);
    assert.strictEqual(completedEvent.payload.failed, 0);
    assert.strictEqual(completedEvent.payload.tombstoned, 0);
  });

  it('empty state: no persisted, no native returns zeroes', async () => {
    const { deps, restored, events } = createMockDeps({
      persisted: [],
      native: [],
    });

    const report = await runStartupRecovery(deps);

    assert.strictEqual(report.recovered, 0);
    assert.strictEqual(report.failed, 0);
    assert.strictEqual(report.tombstoned, 0);
    assert.strictEqual(report.skipped, 0);
    assert.strictEqual(restored.length, 0);

    // Events still emitted
    assert.strictEqual(events.length, 2);
  });

  it('all dead: persisted sessions with no live PIDs are tombstoned', async () => {
    const { deps, restored } = createMockDeps({
      persisted: [
        makePersistedSession({ session_id: 'dead-1' }),
        makePersistedSession({ session_id: 'dead-2' }),
        makePersistedSession({ session_id: 'dead-3' }),
      ],
      native: [], // No live sessions
    });

    const report = await runStartupRecovery(deps);

    assert.strictEqual(report.recovered, 0);
    assert.strictEqual(report.failed, 0);
    assert.strictEqual(report.tombstoned, 3);
    assert.strictEqual(restored.length, 0);
  });

  it('mixed: some alive, some dead — correct classification', async () => {
    const { deps, restored } = createMockDeps({
      persisted: [
        makePersistedSession({ session_id: 'alive-1', nickname: 'worker' }),
        makePersistedSession({ session_id: 'dead-1', nickname: 'gone' }),
        makePersistedSession({ session_id: 'alive-2', nickname: 'runner' }),
      ],
      native: [
        makeNativeSession({ sessionId: 'alive-1', pid: 2001 }),
        makeNativeSession({ sessionId: 'alive-2', pid: 2002 }),
      ],
    });

    const report = await runStartupRecovery(deps);

    assert.strictEqual(report.recovered, 2);
    assert.strictEqual(report.tombstoned, 1);
    assert.strictEqual(report.failed, 0);

    assert.strictEqual(restored.length, 2);
    const restoredIds = restored.map((r) => r.sessionId);
    assert.ok(restoredIds.includes('alive-1'));
    assert.ok(restoredIds.includes('alive-2'));
  });

  it('native sessions without persistence are skipped', async () => {
    const { deps, restored } = createMockDeps({
      persisted: [
        makePersistedSession({ session_id: 'known-1' }),
      ],
      native: [
        makeNativeSession({ sessionId: 'known-1', pid: 3001 }),
        makeNativeSession({ sessionId: 'unknown-1', pid: 3002 }),
        makeNativeSession({ sessionId: 'unknown-2', pid: 3003 }),
      ],
    });

    const report = await runStartupRecovery(deps);

    assert.strictEqual(report.recovered, 1);
    assert.strictEqual(report.skipped, 2);
    assert.strictEqual(restored.length, 1);
    assert.strictEqual(restored[0].sessionId, 'known-1');
  });

  it('discovery throws — recovery still completes with persistence data (all tombstoned)', async () => {
    const { deps, restored } = createMockDeps({
      persisted: [
        makePersistedSession({ session_id: 'orphan-1' }),
        makePersistedSession({ session_id: 'orphan-2' }),
      ],
      discoveryThrows: true,
    });

    const report = await runStartupRecovery(deps);

    // All persisted sessions become tombstoned since discovery returned empty
    assert.strictEqual(report.recovered, 0);
    assert.strictEqual(report.tombstoned, 2);
    assert.strictEqual(report.failed, 0);
    assert.strictEqual(restored.length, 0);
  });

  it('persistence throws — recovery still completes with empty state', async () => {
    const { deps, restored } = createMockDeps({
      native: [
        makeNativeSession({ sessionId: 'native-only', pid: 4001 }),
      ],
      persistenceThrows: true,
    });

    const report = await runStartupRecovery(deps);

    assert.strictEqual(report.recovered, 0);
    assert.strictEqual(report.tombstoned, 0);
    assert.strictEqual(report.skipped, 1); // native without persistence
    assert.strictEqual(restored.length, 0);
  });

  it('restoreSession failure increments failed count', async () => {
    let callCount = 0;

    const { deps } = createMockDeps({
      persisted: [
        makePersistedSession({ session_id: 'ok-1' }),
        makePersistedSession({ session_id: 'fail-1' }),
        makePersistedSession({ session_id: 'ok-2' }),
      ],
      native: [
        makeNativeSession({ sessionId: 'ok-1', pid: 5001 }),
        makeNativeSession({ sessionId: 'fail-1', pid: 5002 }),
        makeNativeSession({ sessionId: 'ok-2', pid: 5003 }),
      ],
    });

    // Override restoreSession to fail on the second call
    deps.restoreSession = (_snapshot: SessionSnapshot) => {
      callCount++;
      if (callCount === 2) {
        throw new Error('Restore failed for this session');
      }
    };

    const report = await runStartupRecovery(deps);

    assert.strictEqual(report.recovered, 2);
    assert.strictEqual(report.failed, 1);
    assert.strictEqual(report.tombstoned, 0);
  });

  it('session snapshot contains all persisted metadata', async () => {
    const metadata = { commission_id: 'C-42', task_summary: 'Build feature' };
    const { deps, restored } = createMockDeps({
      persisted: [
        makePersistedSession({
          session_id: 'meta-1',
          workdir: '/proj/meta',
          nickname: 'meta-agent',
          purpose: 'implementing feature',
          mode: 'print',
          prompt_count: 10,
          depth: 2,
          parent_session_id: 'parent-1',
          isolation: 'worktree',
          metadata,
        }),
      ],
      native: [
        makeNativeSession({ sessionId: 'meta-1', pid: 6001 }),
      ],
    });

    await runStartupRecovery(deps);

    assert.strictEqual(restored.length, 1);
    const snap = restored[0];
    assert.strictEqual(snap.sessionId, 'meta-1');
    assert.strictEqual(snap.workdir, '/proj/meta');
    assert.strictEqual(snap.nickname, 'meta-agent');
    assert.strictEqual(snap.purpose, 'implementing feature');
    assert.strictEqual(snap.mode, 'print');
    assert.strictEqual(snap.pid, 6001);
    assert.strictEqual(snap.promptCount, 10);
    assert.strictEqual(snap.depth, 2);
    assert.strictEqual(snap.parentSessionId, 'parent-1');
    assert.strictEqual(snap.isolation, 'worktree');
    assert.deepStrictEqual(snap.metadata, metadata);
  });
});
