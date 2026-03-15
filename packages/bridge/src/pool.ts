import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

// ── PRD 006: Worktree isolation types ────────────────────────

export type IsolationMode = 'worktree' | 'shared';
export type WorktreeAction = 'merge' | 'keep' | 'discard';

export interface WorktreeInfo {
  isolation: IsolationMode;
  worktree_path: string | null;
  worktree_branch: string | null;
  metals_available: boolean;
}

// ── PRD 006: Stale detection types ──────────────────────────

export interface StaleConfig {
  stale_timeout_ms: number;   // Mark stale after this (default 30 min)
  kill_timeout_ms: number;    // Auto-kill after this (default 60 min)
}

// ── Existing types (extended) ─────────────────────────────────

export interface SessionStatusInfo {
  sessionId: string;
  nickname: string;
  purpose: string | null;
  status: string;
  queueDepth: number;
  metadata?: Record<string, unknown>;
  promptCount: number;
  lastActivityAt: Date;
  workdir: string;
  chain: SessionChainInfo;
  worktree: WorktreeInfo;
  stale: boolean;
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
    isolation?: IsolationMode;
    timeout_ms?: number;
    nickname?: string;
    purpose?: string;
    persistent?: boolean;
  }): Promise<{ sessionId: string; nickname: string; status: string; chain: SessionChainInfo; worktree: WorktreeInfo }>;
  prompt(sessionId: string, prompt: string, timeoutMs?: number, settleDelayMs?: number): Promise<{ output: string; timedOut: boolean }>;
  status(sessionId: string): SessionStatusInfo;
  kill(sessionId: string, worktreeAction?: WorktreeAction): { sessionId: string; killed: boolean; worktree_cleaned: boolean };
  list(): SessionStatusInfo[];
  poolStats(): PoolStats;
  removeDead(ttlMs: number): number;
  getChannels(sessionId: string): SessionChannels;
  getSession(sessionId: string): PtySession;
  checkStale(): { stale: string[]; killed: string[] };
}

export interface PoolOptions {
  maxSessions?: number;
  claudeBin?: string;
  settleDelayMs?: number;
}

const DEFAULT_MAX_SESSIONS = 5;
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_AGENTS = 10;
const DEFAULT_STALE_TIMEOUT_MS = 30 * 60 * 1000;  // 30 minutes
const DEFAULT_KILL_TIMEOUT_MS = 60 * 60 * 1000;   // 60 minutes
const WORKTREE_DIR = '.claude/worktrees';

// PRD 007: Fallback nickname word list
const NICKNAME_WORDS = [
  'alpha', 'bravo', 'cedar', 'drift', 'ember', 'flux', 'grain', 'haze',
  'iris', 'jade', 'kite', 'lumen', 'mist', 'nova', 'opal', 'prism',
  'quartz', 'ridge', 'spark', 'tide', 'umbra', 'vale', 'wave', 'xenon',
  'yield', 'zinc',
];

// PRD 007: Method short names for methodology-derived nicknames
const METHOD_SHORT_NAMES: Record<string, string> = {
  'M1-COUNCIL': 'council',
  'M1-IMPL': 'impl',
  'M1-PLAN': 'plan',
  'M1-REVIEW': 'review',
  'M1-MDES': 'mdes',
  'M2-ORCH': 'orch',
  'M3-TMP': 'tmp',
};

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
  const sessionWorktrees = new Map<string, WorktreeInfo>();
  const sessionStaleConfigs = new Map<string, StaleConfig>();
  const sessionStaleFlags = new Map<string, boolean>();
  const sessionNicknames = new Map<string, string>();   // sessionId → nickname
  const sessionPurposes = new Map<string, string>();     // sessionId → purpose
  const activeNicknames = new Set<string>();              // uniqueness guard

  // Pool-level counters
  let totalSpawned = 0;
  const startedAt = new Date();
  let nicknameWordIndex = 0;
  const methodNicknameCounts = new Map<string, number>(); // method-short → next sequence

  /**
   * PRD 007: Generate a unique nickname for a session.
   * Priority: explicit > methodology-derived > fallback word list.
   */
  function generateNickname(explicit?: string, metadata?: Record<string, unknown>): string {
    // 1. Explicit nickname — use if unique
    if (explicit) {
      const candidate = explicit.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (candidate && !activeNicknames.has(candidate)) {
        return candidate;
      }
      // If collision, append sequence number
      for (let i = 2; i < 100; i++) {
        const suffixed = `${candidate}-${i}`;
        if (!activeNicknames.has(suffixed)) return suffixed;
      }
    }

    // 2. Methodology-derived: if metadata has methodology_session_id, try to extract method
    if (metadata?.methodology_session_id) {
      const msid = String(metadata.methodology_session_id);
      // Try to match known method patterns
      for (const [methodId, shortName] of Object.entries(METHOD_SHORT_NAMES)) {
        if (msid.includes(methodId) || msid.toLowerCase().includes(shortName)) {
          const count = (methodNicknameCounts.get(shortName) ?? 0) + 1;
          methodNicknameCounts.set(shortName, count);
          const candidate = `${shortName}-${count}`;
          if (!activeNicknames.has(candidate)) return candidate;
        }
      }
    }

    // 3. Fallback word list
    for (let attempts = 0; attempts < NICKNAME_WORDS.length; attempts++) {
      const candidate = NICKNAME_WORDS[nicknameWordIndex % NICKNAME_WORDS.length];
      nicknameWordIndex++;
      if (!activeNicknames.has(candidate)) return candidate;
    }

    // Last resort: word + counter
    const base = NICKNAME_WORDS[nicknameWordIndex % NICKNAME_WORDS.length];
    nicknameWordIndex++;
    for (let i = 2; i < 100; i++) {
      const candidate = `${base}-${i}`;
      if (!activeNicknames.has(candidate)) return candidate;
    }

    // Absolute fallback
    return `agent-${totalSpawned + 1}`;
  }

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
    async create({ workdir, initialPrompt, spawnArgs, metadata, parentSessionId, depth, budget, isolation, timeout_ms, nickname, purpose, persistent }): Promise<{ sessionId: string; nickname: string; status: string; chain: SessionChainInfo; worktree: WorktreeInfo }> {
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

      // PRD 007: Generate and register nickname
      const assignedNickname = generateNickname(nickname, metadata);
      activeNicknames.add(assignedNickname);

      // PRD 006 Component 2: Worktree isolation
      const effectiveIsolation: IsolationMode = isolation ?? 'shared';
      let worktreePath: string | null = null;
      let worktreeBranch: string | null = null;
      let effectiveWorkdir = workdir;

      if (effectiveIsolation === 'worktree') {
        worktreeBranch = `worktree-${sessionId.substring(0, 8)}`;
        const worktreeRelDir = join(WORKTREE_DIR, sessionId.substring(0, 8));
        worktreePath = resolve(workdir, worktreeRelDir);

        try {
          execSync(
            `git worktree add "${worktreeRelDir}" -b "${worktreeBranch}"`,
            { cwd: workdir, stdio: 'pipe' },
          );
          effectiveWorkdir = worktreePath;
        } catch (e) {
          throw new Error(`Worktree creation failed: ${(e as Error).message}`);
        }
      }

      const worktreeInfo: WorktreeInfo = {
        isolation: effectiveIsolation,
        worktree_path: worktreePath,
        worktree_branch: worktreeBranch,
        metals_available: effectiveIsolation !== 'worktree',
      };

      // PRD 006 Component 4: Stale detection config
      // PRD 011: persistent sessions skip stale detection entirely
      const staleConfig: StaleConfig | null = persistent ? null : {
        stale_timeout_ms: timeout_ms ?? DEFAULT_STALE_TIMEOUT_MS,
        kill_timeout_ms: (timeout_ms ? timeout_ms * 2 : DEFAULT_KILL_TIMEOUT_MS),
      };

      // PRD 008 / EXP-008-2: Inject session ID into initial prompt
      const injectedPrompt = initialPrompt
        ? `Your bridge_session_id is ${sessionId}. Use this in bridge_progress and bridge_event calls.\n\n${initialPrompt}`
        : undefined;

      const session = spawnSession({
        id: sessionId,
        workdir: effectiveWorkdir,
        claudeBin,
        settleDelayMs,
        initialPrompt: injectedPrompt,
        spawnArgs,
      });

      sessions.set(sessionId, session);
      sessionWorkdirs.set(sessionId, effectiveWorkdir);
      if (metadata) {
        sessionMetadata.set(sessionId, metadata);
      }
      sessionWorktrees.set(sessionId, worktreeInfo);
      if (staleConfig) {
        sessionStaleConfigs.set(sessionId, staleConfig);
      }
      sessionStaleFlags.set(sessionId, false);
      sessionNicknames.set(sessionId, assignedNickname);
      if (purpose) {
        sessionPurposes.set(sessionId, purpose);
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

      return { sessionId, nickname: assignedNickname, status: session.status, chain: chainInfo, worktree: worktreeInfo };
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
        nickname: sessionNicknames.get(sessionId) ?? session.id.substring(0, 8),
        purpose: sessionPurposes.get(sessionId) ?? null,
        status: session.status,
        queueDepth: session.queueDepth,
        metadata: sessionMetadata.get(sessionId),
        promptCount: session.promptCount,
        lastActivityAt: session.lastActivityAt,
        workdir: sessionWorkdirs.get(sessionId) ?? '',
        chain: getChain(sessionId),
        worktree: sessionWorktrees.get(sessionId) ?? {
          isolation: 'shared', worktree_path: null, worktree_branch: null, metals_available: true,
        },
        stale: sessionStaleFlags.get(sessionId) ?? false,
      };
    },

    kill(sessionId: string, worktreeAction?: WorktreeAction): { sessionId: string; killed: boolean; worktree_cleaned: boolean } {
      const session = sessions.get(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      session.kill();

      // PRD 006 Component 2: Handle worktree cleanup
      let worktreeCleaned = false;
      const wtInfo = sessionWorktrees.get(sessionId);
      if (wtInfo && wtInfo.isolation === 'worktree' && wtInfo.worktree_path) {
        const action = worktreeAction ?? 'keep';
        const originalWorkdir = resolve(wtInfo.worktree_path, '..', '..', '..');

        if (action === 'discard') {
          try {
            execSync(`git worktree remove "${wtInfo.worktree_path}" --force`, {
              cwd: originalWorkdir, stdio: 'pipe',
            });
            if (wtInfo.worktree_branch) {
              execSync(`git branch -D "${wtInfo.worktree_branch}"`, {
                cwd: originalWorkdir, stdio: 'pipe',
              });
            }
            worktreeCleaned = true;
          } catch {
            // Worktree cleanup failure is non-fatal
          }
        } else if (action === 'merge') {
          try {
            if (wtInfo.worktree_branch) {
              execSync(`git merge "${wtInfo.worktree_branch}" --no-edit`, {
                cwd: originalWorkdir, stdio: 'pipe',
              });
            }
            execSync(`git worktree remove "${wtInfo.worktree_path}" --force`, {
              cwd: originalWorkdir, stdio: 'pipe',
            });
            worktreeCleaned = true;
          } catch {
            // Merge failure is non-fatal — worktree preserved for manual merge
          }
        }
        // action === 'keep': leave worktree on disk
      }

      // PRD 008: Auto-generate 'killed' event
      const channels = sessionChannels.get(sessionId);
      if (channels) {
        appendMessage(channels.events, 'bridge', 'killed', {
          session_id: sessionId,
          killed_by: 'api',
          worktree_action: worktreeAction ?? 'keep',
          worktree_cleaned: worktreeCleaned,
        });
      }

      return { sessionId: session.id, killed: true, worktree_cleaned: worktreeCleaned };
    },

    list(): SessionStatusInfo[] {
      return [...sessions.entries()].map(([sessionId, session]) => ({
        sessionId: session.id,
        nickname: sessionNicknames.get(sessionId) ?? session.id.substring(0, 8),
        purpose: sessionPurposes.get(sessionId) ?? null,
        status: session.status,
        queueDepth: session.queueDepth,
        metadata: sessionMetadata.get(sessionId),
        promptCount: session.promptCount,
        lastActivityAt: session.lastActivityAt,
        workdir: sessionWorkdirs.get(sessionId) ?? '',
        chain: getChain(sessionId),
        worktree: sessionWorktrees.get(sessionId) ?? {
          isolation: 'shared' as IsolationMode, worktree_path: null, worktree_branch: null, metals_available: true,
        },
        stale: sessionStaleFlags.get(sessionId) ?? false,
      }));
    },

    getChannels(sessionId: string): SessionChannels {
      const channels = sessionChannels.get(sessionId);
      if (!channels) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      return channels;
    },

    getSession(sessionId: string): PtySession {
      const session = sessions.get(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      return session;
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
            const nick = sessionNicknames.get(sessionId);
            if (nick) activeNicknames.delete(nick);
            sessions.delete(sessionId);
            sessionMetadata.delete(sessionId);
            sessionWorkdirs.delete(sessionId);
            sessionChains.delete(sessionId);
            sessionChannels.delete(sessionId);
            sessionWorktrees.delete(sessionId);
            sessionStaleConfigs.delete(sessionId);
            sessionStaleFlags.delete(sessionId);
            sessionNicknames.delete(sessionId);
            sessionPurposes.delete(sessionId);
            removed++;
          }
        }
      }
      return removed;
    },

    /**
     * PRD 006 Component 4: Check all sessions for staleness.
     * - Sessions inactive > stale_timeout_ms → marked stale, 'stale' event emitted
     * - Sessions inactive > kill_timeout_ms → auto-killed
     * Returns lists of newly-stale and newly-killed session IDs.
     */
    checkStale(): { stale: string[]; killed: string[] } {
      const now = Date.now();
      const staleIds: string[] = [];
      const killedIds: string[] = [];

      for (const [sessionId, session] of sessions.entries()) {
        if (session.status === 'dead') continue;

        const config = sessionStaleConfigs.get(sessionId);
        if (!config) continue;

        const inactiveMs = now - session.lastActivityAt.getTime();
        const isStale = sessionStaleFlags.get(sessionId) ?? false;

        // Auto-kill: inactive beyond kill timeout
        if (inactiveMs >= config.kill_timeout_ms) {
          session.kill();

          const channels = sessionChannels.get(sessionId);
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

        // Mark stale: inactive beyond stale timeout (but not yet killed)
        if (inactiveMs >= config.stale_timeout_ms && !isStale) {
          sessionStaleFlags.set(sessionId, true);

          const channels = sessionChannels.get(sessionId);
          if (channels) {
            appendMessage(channels.events, 'bridge', 'stale', {
              session_id: sessionId,
              inactive_ms: inactiveMs,
              action: 'marked_stale',
              kill_in_ms: config.kill_timeout_ms - inactiveMs,
            });
          }

          staleIds.push(sessionId);
        }
      }

      return { stale: staleIds, killed: killedIds };
    },
  };
}
