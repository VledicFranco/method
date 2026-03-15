import { randomUUID } from 'node:crypto';
import { spawnSession, type PtySession } from './pty-session.js';
import { createSessionChannels, appendMessage, type SessionChannels } from './channels.js';

// ── PRD 006: Session chain types ──────────────────────────────

export interface SessionBudget {
  max_depth: number;
  max_agents: number;
  agents_spawned: number;
}

export interface SessionChainInfo {
  parent_session_id: string | null;
  depth: number;
  children: string[];
  budget: SessionBudget;
}

// ── Existing types (extended) ─────────────────────────────────

export interface SessionStatusInfo {
  sessionId: string;
  status: string;
  queueDepth: number;
  metadata?: Record<string, unknown>;
  promptCount: number;
  lastActivityAt: Date;
  workdir: string;
  chain: SessionChainInfo;
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
    parentSessionId?: string;
    depth?: number;
    budget?: Partial<SessionBudget>;
  }): Promise<{ sessionId: string; status: string; chain: SessionChainInfo }>;
  prompt(sessionId: string, prompt: string, timeoutMs?: number, settleDelayMs?: number): Promise<{ output: string; timedOut: boolean }>;
  status(sessionId: string): SessionStatusInfo;
  kill(sessionId: string): { sessionId: string; killed: boolean };
  list(): SessionStatusInfo[];
  poolStats(): PoolStats;
  removeDead(ttlMs: number): number;
  getChannels(sessionId: string): SessionChannels;
}

export interface PoolOptions {
  maxSessions?: number;
  claudeBin?: string;
  settleDelayMs?: number;
}

const DEFAULT_MAX_SESSIONS = 5;
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_AGENTS = 10;

/**
 * Create a session pool that manages multiple Claude Code PTY sessions.
 *
 * The pool enforces a maximum session count and provides a uniform interface
 * for creating, prompting, inspecting, and killing sessions.
 *
 * PRD 006: Sessions now track parent-child chains with budget enforcement.
 */
export function createPool(options?: PoolOptions): SessionPool {
  const maxSessions = options?.maxSessions ?? DEFAULT_MAX_SESSIONS;
  const claudeBin = options?.claudeBin;
  const settleDelayMs = options?.settleDelayMs;

  const sessions = new Map<string, PtySession>();
  const sessionMetadata = new Map<string, Record<string, unknown>>();
  const sessionWorkdirs = new Map<string, string>();
  const sessionChains = new Map<string, SessionChainInfo>();
  const sessionChannels = new Map<string, SessionChannels>();

  // Pool-level counters
  let totalSpawned = 0;
  const startedAt = new Date();

  function getChain(sessionId: string): SessionChainInfo {
    return sessionChains.get(sessionId) ?? {
      parent_session_id: null,
      depth: 0,
      children: [],
      budget: { max_depth: DEFAULT_MAX_DEPTH, max_agents: DEFAULT_MAX_AGENTS, agents_spawned: 0 },
    };
  }

  /**
   * Find the root session of a chain and return its shared budget reference.
   * Budget is tracked at the root — all agents in a chain share the same budget.
   */
  function getRootBudget(sessionId: string): SessionBudget | null {
    const chain = sessionChains.get(sessionId);
    if (!chain) return null;

    // Walk up to root
    let currentId = sessionId;
    let current = chain;
    while (current.parent_session_id) {
      const parent = sessionChains.get(current.parent_session_id);
      if (!parent) break;
      currentId = current.parent_session_id;
      current = parent;
    }
    return current.budget;
  }

  return {
    async create({ workdir, initialPrompt, spawnArgs, metadata, parentSessionId, depth, budget }): Promise<{ sessionId: string; status: string; chain: SessionChainInfo }> {
      // Count active (non-dead) sessions toward the limit
      const activeSessions = [...sessions.values()].filter((s) => s.status !== 'dead').length;
      if (activeSessions >= maxSessions) {
        throw new Error(`Session pool full — maximum ${maxSessions} active sessions`);
      }

      // Determine chain properties
      const effectiveDepth = depth ?? 0;
      const effectiveBudget: SessionBudget = {
        max_depth: budget?.max_depth ?? DEFAULT_MAX_DEPTH,
        max_agents: budget?.max_agents ?? DEFAULT_MAX_AGENTS,
        agents_spawned: budget?.agents_spawned ?? 0,
      };

      // If this is a child session, inherit and validate budget from parent
      if (parentSessionId) {
        const parentChain = sessionChains.get(parentSessionId);
        if (parentChain) {
          // Use parent's budget as the source of truth (shared budget across chain)
          const rootBudget = getRootBudget(parentSessionId) ?? parentChain.budget;

          // Depth check
          if (effectiveDepth >= rootBudget.max_depth) {
            throw new Error(
              JSON.stringify({
                error: 'DEPTH_EXCEEDED',
                message: `Depth limit exceeded: depth ${effectiveDepth} >= max_depth ${rootBudget.max_depth}. Cannot spawn deeper.`,
                budget: rootBudget,
              }),
            );
          }

          // Agent count check
          if (rootBudget.agents_spawned >= rootBudget.max_agents) {
            throw new Error(
              JSON.stringify({
                error: 'BUDGET_EXHAUSTED',
                message: `Agent budget exceeded: ${rootBudget.agents_spawned}/${rootBudget.max_agents} agents spawned. Increase budget or complete existing work.`,
                budget: rootBudget,
              }),
            );
          }

          // Increment the root budget's agent count
          rootBudget.agents_spawned++;

          // Copy current root budget values for the child
          effectiveBudget.max_depth = rootBudget.max_depth;
          effectiveBudget.max_agents = rootBudget.max_agents;
          effectiveBudget.agents_spawned = rootBudget.agents_spawned;
        }
      }

      const sessionId = randomUUID();

      // PRD 008 / EXP-008-2: Inject session ID into initial prompt
      const injectedPrompt = initialPrompt
        ? `Your bridge_session_id is ${sessionId}. Use this in bridge_progress and bridge_event calls.\n\n${initialPrompt}`
        : undefined;

      const session = spawnSession({
        id: sessionId,
        workdir,
        claudeBin,
        settleDelayMs,
        initialPrompt: injectedPrompt,
        spawnArgs,
      });

      sessions.set(sessionId, session);
      sessionWorkdirs.set(sessionId, workdir);
      if (metadata) {
        sessionMetadata.set(sessionId, metadata);
      }

      // Record chain info
      const chainInfo: SessionChainInfo = {
        parent_session_id: parentSessionId ?? null,
        depth: effectiveDepth,
        children: [],
        budget: effectiveBudget,
      };
      sessionChains.set(sessionId, chainInfo);

      // Register as child of parent
      if (parentSessionId) {
        const parentChain = sessionChains.get(parentSessionId);
        if (parentChain) {
          parentChain.children.push(sessionId);
        }
      }

      // PRD 008: Create channels and emit 'started' event
      const channels = createSessionChannels();
      sessionChannels.set(sessionId, channels);
      appendMessage(channels.events, 'bridge', 'started', {
        session_id: sessionId,
        parent_session_id: parentSessionId ?? null,
        depth: effectiveDepth,
      });

      totalSpawned++;

      return { sessionId, status: session.status, chain: chainInfo };
    },

    async prompt(sessionId: string, prompt: string, timeoutMs?: number, settleDelayMs?: number): Promise<{ output: string; timedOut: boolean }> {
      const session = sessions.get(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      if (session.status === 'dead') {
        throw new Error(`Session ${sessionId} is dead — cannot send prompt`);
      }

      return session.sendPrompt(prompt, timeoutMs, settleDelayMs);
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
        chain: getChain(sessionId),
      };
    },

    kill(sessionId: string): { sessionId: string; killed: boolean } {
      const session = sessions.get(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      session.kill();

      // PRD 008: Auto-generate 'killed' event
      const channels = sessionChannels.get(sessionId);
      if (channels) {
        appendMessage(channels.events, 'bridge', 'killed', {
          session_id: sessionId,
          killed_by: 'api',
        });
      }

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
        chain: getChain(sessionId),
      }));
    },

    getChannels(sessionId: string): SessionChannels {
      const channels = sessionChannels.get(sessionId);
      if (!channels) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      return channels;
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

    removeDead(ttlMs: number): number {
      let removed = 0;
      for (const [sessionId, session] of sessions.entries()) {
        if (session.status === 'dead') {
          // Use lastActivityAt as the "died at" timestamp (it's the last activity before death)
          if (Date.now() - session.lastActivityAt.getTime() > ttlMs) {
            sessions.delete(sessionId);
            sessionMetadata.delete(sessionId);
            sessionWorkdirs.delete(sessionId);
            sessionChains.delete(sessionId);
            sessionChannels.delete(sessionId);
            removed++;
          }
        }
      }
      return removed;
    },
  };
}
