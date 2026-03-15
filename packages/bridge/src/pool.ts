import { randomUUID } from 'node:crypto';
import { spawnSession, type PtySession } from './pty-session.js';

export interface SessionStatusInfo {
  sessionId: string;
  status: string;
  queueDepth: number;
  metadata?: Record<string, unknown>;
  promptCount: number;
  lastActivityAt: Date;
  workdir: string;
}

export interface PoolStats {
  totalSpawned: number;
  startedAt: Date;
  maxSessions: number;
  activeSessions: number;
  deadSessions: number;
}

export interface SessionPool {
  create(options: {
    workdir: string;
    initialPrompt?: string;
    spawnArgs?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<{ sessionId: string; status: string }>;
  prompt(sessionId: string, prompt: string, timeoutMs?: number): Promise<{ output: string; timedOut: boolean }>;
  status(sessionId: string): SessionStatusInfo;
  kill(sessionId: string): { sessionId: string; killed: boolean };
  list(): SessionStatusInfo[];
  poolStats(): PoolStats;
}

export interface PoolOptions {
  maxSessions?: number;
  claudeBin?: string;
  settleDelayMs?: number;
}

const DEFAULT_MAX_SESSIONS = 5;

/**
 * Create a session pool that manages multiple Claude Code PTY sessions.
 *
 * The pool enforces a maximum session count and provides a uniform interface
 * for creating, prompting, inspecting, and killing sessions.
 */
export function createPool(options?: PoolOptions): SessionPool {
  const maxSessions = options?.maxSessions ?? DEFAULT_MAX_SESSIONS;
  const claudeBin = options?.claudeBin;
  const settleDelayMs = options?.settleDelayMs;

  const sessions = new Map<string, PtySession>();
  const sessionMetadata = new Map<string, Record<string, unknown>>();
  const sessionWorkdirs = new Map<string, string>();

  // Pool-level counters
  let totalSpawned = 0;
  const startedAt = new Date();

  return {
    async create({ workdir, initialPrompt, spawnArgs, metadata }): Promise<{ sessionId: string; status: string }> {
      // Count active (non-dead) sessions toward the limit
      const activeSessions = [...sessions.values()].filter((s) => s.status !== 'dead').length;
      if (activeSessions >= maxSessions) {
        throw new Error(`Session pool full — maximum ${maxSessions} active sessions`);
      }

      const sessionId = randomUUID();

      const session = spawnSession({
        id: sessionId,
        workdir,
        claudeBin,
        settleDelayMs,
        initialPrompt,
        spawnArgs,
      });

      sessions.set(sessionId, session);
      sessionWorkdirs.set(sessionId, workdir);
      if (metadata) {
        sessionMetadata.set(sessionId, metadata);
      }
      totalSpawned++;

      return { sessionId, status: session.status };
    },

    async prompt(sessionId: string, prompt: string, timeoutMs?: number): Promise<{ output: string; timedOut: boolean }> {
      const session = sessions.get(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      if (session.status === 'dead') {
        throw new Error(`Session ${sessionId} is dead — cannot send prompt`);
      }

      return session.sendPrompt(prompt, timeoutMs);
    },

    status(sessionId: string): SessionStatusInfo {
      const session = sessions.get(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      return {
        sessionId: session.id,
        status: session.status,
        queueDepth: session.queueDepth,
        metadata: sessionMetadata.get(sessionId),
        promptCount: session.promptCount,
        lastActivityAt: session.lastActivityAt,
        workdir: sessionWorkdirs.get(sessionId) ?? '',
      };
    },

    kill(sessionId: string): { sessionId: string; killed: boolean } {
      const session = sessions.get(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      session.kill();

      return { sessionId: session.id, killed: true };
    },

    list(): SessionStatusInfo[] {
      return [...sessions.entries()].map(([sessionId, session]) => ({
        sessionId: session.id,
        status: session.status,
        queueDepth: session.queueDepth,
        metadata: sessionMetadata.get(sessionId),
        promptCount: session.promptCount,
        lastActivityAt: session.lastActivityAt,
        workdir: sessionWorkdirs.get(sessionId) ?? '',
      }));
    },

    poolStats(): PoolStats {
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
  };
}
