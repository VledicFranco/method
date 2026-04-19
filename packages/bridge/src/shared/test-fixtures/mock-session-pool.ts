// SPDX-License-Identifier: Apache-2.0
/**
 * Shared MockSessionPool for tests that need a SessionPool implementation.
 *
 * Extracted from genesis test files (MG-10) to eliminate duplication across
 * domains that test against the SessionPool interface.
 */

import type { SessionPool, SessionStatusInfo } from '@methodts/runtime/sessions';

export class MockSessionPool implements SessionPool {
  private sessions = new Map<string, SessionStatusInfo>();
  private sessionCount = 0;

  async create(options: any): Promise<any> {
    const sessionId = `mock-${++this.sessionCount}`;
    const status: SessionStatusInfo = {
      sessionId,
      nickname: options.nickname || 'mock',
      purpose: options.purpose || 'test',
      status: 'running',
      queueDepth: 0,
      metadata: options.metadata,
      promptCount: 0,
      lastActivityAt: new Date(),
      workdir: options.workdir,
      chain: {
        parent_session_id: null,
        depth: 0,
        children: [],
        budget: { max_depth: 3, max_agents: 10, agents_spawned: 0 },
      },
      worktree: {
        isolation: 'shared',
        worktree_path: null,
        worktree_branch: null,
        metals_available: true,
      },
      stale: false,
      waiting_for: null,
      mode: options.mode || 'pty',
      diagnostics: null,
    };
    this.sessions.set(sessionId, status);

    return {
      sessionId,
      nickname: options.nickname || 'mock',
      status: 'running',
      chain: status.chain,
      worktree: status.worktree,
      mode: status.mode,
    };
  }

  async prompt(): Promise<any> {
    return { output: '', timedOut: false };
  }

  async promptStream(
    _sessionId: string,
    _prompt: string,
    onEvent: (event: any) => void,
  ): Promise<void> {
    onEvent({ type: 'done', output: '', metadata: null, timed_out: false });
  }

  status(sessionId: string): SessionStatusInfo {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    return session;
  }

  kill(): any {
    return { sessionId: '', killed: true, worktree_cleaned: true };
  }

  list(): SessionStatusInfo[] {
    return Array.from(this.sessions.values());
  }

  poolStats(): any {
    return {
      totalSpawned: this.sessions.size,
      startedAt: new Date(),
      maxSessions: 10,
      activeSessions: this.sessions.size,
      deadSessions: 0,
    };
  }

  removeDead(): number {
    return 0;
  }

  getChannels(): any {
    return { messages: [] };
  }

  getSession(): any {
    return {};
  }

  checkStale(): any {
    return { stale: [], killed: [] };
  }

  childPids(): number[] {
    return [];
  }

  setObservationHook(): void {}

  restoreSession(): void {}
  cleanupStaleCognitiveSessions(): { killed: string[] } { return { killed: [] }; }
}
