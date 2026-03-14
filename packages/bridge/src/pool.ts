import { randomUUID } from 'node:crypto';
import { spawnSession, type PtySession } from './pty-session.js';

export interface SessionPool {
  create(options: { workdir: string; initialPrompt?: string }): Promise<{ sessionId: string; status: string }>;
  prompt(sessionId: string, prompt: string, timeoutMs?: number): Promise<{ output: string; timedOut: boolean }>;
  status(sessionId: string): { sessionId: string; status: string; queueDepth: number };
  kill(sessionId: string): { sessionId: string; killed: boolean };
  list(): Array<{ sessionId: string; status: string; queueDepth: number }>;
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

  return {
    async create({ workdir, initialPrompt }): Promise<{ sessionId: string; status: string }> {
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
      });

      sessions.set(sessionId, session);

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

    status(sessionId: string): { sessionId: string; status: string; queueDepth: number } {
      const session = sessions.get(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      return {
        sessionId: session.id,
        status: session.status,
        queueDepth: session.queueDepth,
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

    list(): Array<{ sessionId: string; status: string; queueDepth: number }> {
      return [...sessions.values()].map((session) => ({
        sessionId: session.id,
        status: session.status,
        queueDepth: session.queueDepth,
      }));
    },
  };
}
