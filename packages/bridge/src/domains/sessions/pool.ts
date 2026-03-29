import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createPrintSession, type PtySession, type PrintMetadata, type SessionStatus } from './print-session.js';
import { createCognitiveSession, type CognitiveSessionConfig } from './cognitive-provider.js';
import { createBridgeToolProvider } from './bridge-tools.js';
import { createSessionChannels, type SessionChannels } from './channels.js';
import { DiagnosticsTracker, type SessionDiagnostics } from './diagnostics.js';
import { installScopeHook } from './scope-hook.js';
import type { FileSystemProvider } from '../../ports/file-system.js';
import type { EventBus } from '../../ports/event-bus.js';

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

export type SessionMode = 'print' | 'cognitive-agent';

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
  waiting_for: string | null;
  /** PRD 028: Session mode — always 'print' after PTY removal. */
  mode: SessionMode;
  /** PRD 012: Per-session diagnostic metrics. */
  diagnostics: SessionDiagnostics | null;
}

export interface PoolStats {
  totalSpawned: number;
  startedAt: Date;
  maxSessions: number;
  activeSessions: number;
  deadSessions: number;
}

/** PRD 029: Snapshot of a session's state for recovery / restoration. */
export interface SessionSnapshot {
  sessionId: string;
  nickname: string;
  purpose?: string | null;
  workdir: string;
  mode: SessionMode | string;
  depth: number;
  parentSessionId?: string | null;
  isolation: IsolationMode | string;
  metadata?: Record<string, unknown>;
  promptCount: number;
  pid?: number;
}

/** SSE stream event emitted during a streaming prompt. */
export interface StreamEvent {
  type: 'text' | 'done' | 'error' | 'cycle-start' | 'cycle-action' | 'monitor' | 'affect' | 'memory' | 'reflection';
  content?: string;
  output?: string;
  metadata?: Record<string, unknown> | null;
  timed_out?: boolean;
  error?: string;
  // Cognitive event fields (PRD 033 — present only for cognitive event types)
  cycle?: number;
  maxCycles?: number;
  action?: string;
  confidence?: number;
  tokens?: number;
  intervention?: string;
  restricted?: string[];
  label?: string;
  valence?: number;
  arousal?: number;
  retrieved?: number;
  stored?: number;
  totalCards?: number;
  lessons?: string[];
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
    spawn_delay_ms?: number;
    mode?: SessionMode;
    /** PRD 014: Glob patterns of files the agent is allowed to modify. Empty array = no constraint. */
    allowed_paths?: string[];
    /** PRD 014: Scope enforcement mode. 'enforce' installs a pre-commit hook (requires worktree). 'warn' emits events only. Default: 'enforce'. */
    scope_mode?: 'enforce' | 'warn';
    /** Optional session ID — if provided, reuses this ID instead of generating a new UUID. Used for resuming sessions with Claude Code's --resume flag. */
    session_id?: string;
    /** PRD 033: Provider type — 'print' (default) or 'cognitive-agent'. */
    provider_type?: 'print' | 'cognitive-agent';
    /** PRD 033: Cognitive config name (e.g. 'baseline'). Only used when provider_type is 'cognitive-agent'. */
    cognitive_config?: Partial<CognitiveSessionConfig>;
    /** PRD 033: Cognitive pattern flags (e.g. ['P5', 'P6']). */
    cognitive_patterns?: string[];
  }): Promise<{ sessionId: string; nickname: string; status: string; chain: SessionChainInfo; worktree: WorktreeInfo; mode: SessionMode }>;
  prompt(sessionId: string, prompt: string, timeoutMs?: number, settleDelayMs?: number): Promise<{ output: string; timedOut: boolean; metadata: PrintMetadata | null }>;
  /**
   * Streaming prompt — sends a prompt and emits incremental output chunks via callback.
   * The onEvent callback receives StreamEvent objects as output arrives.
   * Returns a promise that resolves when the prompt completes.
   */
  promptStream(
    sessionId: string,
    prompt: string,
    onEvent: (event: StreamEvent) => void,
    timeoutMs?: number,
  ): Promise<void>;
  status(sessionId: string): SessionStatusInfo;
  kill(sessionId: string, worktreeAction?: WorktreeAction): { sessionId: string; killed: boolean; worktree_cleaned: boolean };
  list(): SessionStatusInfo[];
  poolStats(): PoolStats;
  removeDead(ttlMs: number): number;
  getChannels(sessionId: string): SessionChannels;
  getSession(sessionId: string): PtySession;
  checkStale(): { stale: string[]; killed: string[] };
  /** Return OS PIDs of all live child processes managed by this pool. */
  childPids(): number[];
  /** PRD 018: Set a pool-level observation hook for forwarding PTY observations to the trigger system. */
  setObservationHook(hook: ((observation: { category: string; detail: Record<string, unknown>; session_id: string }) => void) | null): void;
  /** PRD 029: Restore a session from a persisted snapshot without spawning a process. */
  restoreSession(snapshot: SessionSnapshot): void;
}

export interface PoolOptions {
  maxSessions?: number;
  claudeBin?: string;
  settleDelayMs?: number;
  minSpawnGapMs?: number;
  /** @deprecated PTY provider — no longer used after PTY removal (PRD 028 C-4). */
  ptyProvider?: unknown;
  /** @deprecated LLM provider — print-session creates its own provider internally (PRD 028 C-4). */
  llmProvider?: unknown;
  /** PRD 024 MG-1: FileSystem provider for auto-retro and other fs operations. */
  fsProvider?: FileSystemProvider;
  /** PRD 026: Event bus for unified event emission. */
  eventBus?: EventBus;
}

const DEFAULT_MAX_SESSIONS = 10;
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
  const fsProvider = options?.fsProvider;
  const eventBus = options?.eventBus;

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

  // PRD 010: Original workdir per session (pre-worktree) for retro placement
  const sessionOriginalWorkdirs = new Map<string, string>();

  // PRD 012: Per-session diagnostics trackers
  const sessionDiagnostics = new Map<string, DiagnosticsTracker>();

  // PRD 012 Phase 4: Session mode tracking
  const sessionModes = new Map<string, SessionMode>();

  // PRD 033: Cognitive SSE sink registration — allows promptStream to receive cognitive events
  const cognitiveSSESinks = new Map<string, (cb: ((event: StreamEvent) => void) | null) => void>();

  // OBS-19: Waiting-for-sub-agent state (set externally; PTY auto-detection removed in PRD 028 C-4)
  const sessionWaitingFor = new Map<string, string>();        // sessionId → what it's waiting for

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

  /**
   * PRD 010: Handle session death — previously detached PTY watcher and generated auto-retro.
   * PTY watcher removed in PRD 028 C-4. Function retained for call-site symmetry.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function handleSessionDeath(_sessionId: string, _reason: 'killed' | 'exited' | 'stale'): void {
    // PTY watcher removed in PRD 028 C-4. Auto-retro via watcher observations no longer applies.
    // Future: print-mode retro generation can be added here if needed.
  }

  return {
    async create({ workdir, initialPrompt, spawnArgs, metadata, parentSessionId, depth, budget, isolation, timeout_ms, nickname, purpose, persistent, spawn_delay_ms, mode, allowed_paths, scope_mode, session_id, provider_type, cognitive_config, cognitive_patterns }): Promise<{ sessionId: string; nickname: string; status: string; chain: SessionChainInfo; worktree: WorktreeInfo; mode: SessionMode }> {
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

      const sessionId = session_id ?? randomUUID();

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

      // PRD 014: Scope enforcement — determine effective mode and install hook
      const effectiveAllowedPaths = allowed_paths ?? [];
      const envScopeDefault = process.env.SCOPE_ENFORCEMENT_DEFAULT;
      const validatedEnvDefault: 'enforce' | 'warn' = (envScopeDefault === 'enforce' || envScopeDefault === 'warn') ? envScopeDefault : 'enforce';
      let effectiveScopeMode: 'enforce' | 'warn' = scope_mode ?? validatedEnvDefault;

      if (effectiveAllowedPaths.length > 0) {
        if (effectiveIsolation !== 'worktree' && effectiveScopeMode === 'enforce') {
          // PRD 014: Worktree fallback — can't install hook in shared mode
          console.warn(`[PRD 014] allowed_paths provided without worktree isolation — falling back to mode 'warn'. Pre-commit hook requires isolation: 'worktree'.`);
          effectiveScopeMode = 'warn';
        }

        if (effectiveScopeMode === 'enforce' && worktreePath) {
          // Install pre-commit hook in the worktree
          const hookResult = installScopeHook(worktreePath, sessionId, effectiveAllowedPaths);
          if (hookResult.error) {
            console.warn(`[PRD 014] Scope hook installation warning: ${hookResult.error}`);
          }
        }

        // Store scope constraint in metadata for PTY watcher (Phase 2)
        const existingMetadata = metadata ?? {};
        metadata = {
          ...existingMetadata,
          allowed_paths: effectiveAllowedPaths,
          scope_mode: effectiveScopeMode,
        };
      }

      // PRD 006 Component 4: Stale detection config
      // PRD 011: persistent sessions skip stale detection entirely
      const staleConfig: StaleConfig | null = persistent ? null : {
        stale_timeout_ms: timeout_ms ?? DEFAULT_STALE_TIMEOUT_MS,
        kill_timeout_ms: (timeout_ms ? timeout_ms * 2 : DEFAULT_KILL_TIMEOUT_MS),
      };

      // PRD 033: Determine session mode from provider_type (default: print)
      const effectiveMode: SessionMode = provider_type === 'cognitive-agent' ? 'cognitive-agent' : 'print';

      // PRD 012: Staggered spawn — delay before spawning process
      if (spawn_delay_ms && spawn_delay_ms > 0) {
        await new Promise(r => setTimeout(r, spawn_delay_ms));
      }

      let session: PtySession;

      if (effectiveMode === 'cognitive-agent') {
        // PRD 033: Cognitive agent session — runs reasoning cycle internally
        const { createProviderAdapter } = await import('@method/pacta');
        const { anthropicProvider } = await import('@method/pacta-provider-anthropic');

        const tools = createBridgeToolProvider(effectiveWorkdir);
        const model = typeof metadata?.model === 'string' ? metadata.model : undefined;
        const agentProvider = anthropicProvider({ model, toolProvider: tools });
        const adapter = createProviderAdapter(agentProvider, {
          pactTemplate: { mode: { type: 'oneshot' }, budget: { maxOutputTokens: 4096 } },
        });

        // Mutable SSE sink — set by promptStream(), cleared on completion.
        // Allows cognitive events to flow to both the event bus and the active SSE stream.
        let sseSink: ((event: StreamEvent) => void) | null = null;
        cognitiveSSESinks.set(sessionId, (cb) => { sseSink = cb; });

        session = createCognitiveSession({
          id: sessionId,
          workdir: effectiveWorkdir,
          adapter,
          tools,
          config: {
            name: cognitive_config?.name,
            patterns: cognitive_patterns,
            maxCycles: cognitive_config?.maxCycles,
            workspaceCapacity: cognitive_config?.workspaceCapacity,
            confidenceThreshold: cognitive_config?.confidenceThreshold,
            stagnationThreshold: cognitive_config?.stagnationThreshold,
            interventionBudget: cognitive_config?.interventionBudget,
          },
          initialPrompt: initialPrompt ?? undefined,
          onEvent: (event) => {
            // Forward to active SSE stream (if any)
            sseSink?.(event);
            // Route cognitive cycle events through the event bus
            if (eventBus) {
              eventBus.emit({
                version: 1,
                domain: 'session',
                type: `session.cognitive.${event.type}`,
                severity: 'info',
                sessionId,
                payload: event as unknown as Record<string, unknown>,
                source: 'bridge/sessions/cognitive-provider',
              });
            }
          },
        });
      } else {
        // Default: print-mode session (claude --print)
        const DEFAULT_SYSTEM_PROMPT_SUFFIX = [
          'When producing diagrams, flowcharts, or architecture visualizations, use GlyphJS ui: fenced code blocks instead of ASCII art.',
          'Available components: ui:flowchart, ui:callout, ui:table, ui:architecture, ui:timeline, ui:graph, ui:sequence, ui:tabs, ui:steps, ui:kpi, ui:mindmap.',
          'Use proper markdown tables (| col | col |) instead of ASCII-aligned columns.',
          'Example: ```ui:flowchart\\nnodes:\\n  - id: a\\n    label: Start\\nedges:\\n  - from: a\\n    to: b\\n```',
        ].join(' ');

        const userSystemPrompt = typeof metadata?.append_system_prompt === 'string' ? metadata.append_system_prompt : '';
        const effectiveSystemPrompt = userSystemPrompt
          ? `${userSystemPrompt}\n\n${DEFAULT_SYSTEM_PROMPT_SUFFIX}`
          : DEFAULT_SYSTEM_PROMPT_SUFFIX;

        session = createPrintSession({
          id: sessionId,
          workdir: effectiveWorkdir,
          initialPrompt: initialPrompt ?? undefined,
          maxBudgetUsd: typeof metadata?.max_budget_usd === 'number' ? metadata.max_budget_usd : undefined,
          appendSystemPrompt: effectiveSystemPrompt,
          permissionMode: process.env.PRINT_PERMISSION_MODE ?? 'bypassPermissions',
          model: typeof metadata?.model === 'string' ? metadata.model : undefined,
          spawnArgs,
        });
      }

      sessions.set(sessionId, session);
      sessionModes.set(sessionId, effectiveMode);
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

      // PRD 008: Create channels (legacy — retained for getChannels() compatibility)
      const channels = createSessionChannels();
      sessionChannels.set(sessionId, channels);

      // PRD 026 Phase 3: session.spawned emitted via eventBus only (appendMessage removed)
      if (eventBus) {
        eventBus.emit({
          version: 1,
          domain: 'session',
          type: 'session.spawned',
          severity: 'info',
          sessionId,
          payload: {
            session_id: sessionId,
            parent_session_id: parentSessionId ?? null,
            depth: effectiveDepth,
            mode: effectiveMode,
            workdir,
            nickname,
          },
          source: 'bridge/sessions/pool',
        });
      }

      // PRD 010: Track original workdir (pre-worktree) for auto-retro placement
      sessionOriginalWorkdirs.set(sessionId, workdir);

      totalSpawned++;

      return { sessionId, nickname: assignedNickname, status: session.status, chain: chainInfo, worktree: worktreeInfo, mode: effectiveMode };
    },

    async prompt(sessionId: string, prompt: string, timeoutMs?: number, settleDelayMs?: number): Promise<{ output: string; timedOut: boolean; metadata: PrintMetadata | null }> {
      const session = sessions.get(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      if (session.status === 'dead') {
        throw new Error(`Session ${sessionId} is dead — cannot send prompt`);
      }

      const result = await session.sendPrompt(prompt, timeoutMs, settleDelayMs);

      // PRD 012: Record settle overhead for this prompt
      const tracker = sessionDiagnostics.get(sessionId);
      if (tracker && !result.timedOut) {
        tracker.recordPromptCompletion();
      }

      // Read printMetadata in-place after sendPrompt resolves (same tick — no race)
      const printSession = session as unknown as { printMetadata?: PrintMetadata | null };
      const metadata = printSession.printMetadata ?? null;

      return { output: result.output, timedOut: result.timedOut, metadata };
    },

    async promptStream(
      sessionId: string,
      prompt: string,
      onEvent: (event: StreamEvent) => void,
      timeoutMs?: number,
    ): Promise<void> {
      const session = sessions.get(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      if (session.status === 'dead') {
        throw new Error(`Session ${sessionId} is dead — cannot send prompt`);
      }

      // PRD 033: Register SSE sink for cognitive sessions so cycle events flow to SSE
      const setSink = cognitiveSSESinks.get(sessionId);
      if (setSink) setSink(onEvent);

      try {
        let result: { output: string; timedOut: boolean };

        if (typeof session.sendPromptStream === 'function') {
          // Use the streaming path — emits incremental text chunks
          result = await session.sendPromptStream(
            prompt,
            (chunk: string) => {
              onEvent({ type: 'text', content: chunk });
            },
            timeoutMs,
          );
        } else {
          // Fallback: non-streaming path (subscribes to onOutput for single emit)
          const unsubscribe = session.onOutput((data: string) => {
            if (data.startsWith('\n[print-mode]')) return;
            onEvent({ type: 'text', content: data });
          });
          try {
            result = await session.sendPrompt(prompt, timeoutMs);
          } finally {
            unsubscribe();
          }
        }

        // Read printMetadata and map to response shape (same as non-streaming endpoint)
        const printSession = session as unknown as { printMetadata?: PrintMetadata | null };
        const raw = printSession.printMetadata ?? null;
        const metadata = raw ? {
          cost_usd: raw.total_cost_usd,
          num_turns: raw.num_turns,
          duration_ms: raw.duration_ms,
          stop_reason: raw.stop_reason,
          input_tokens: raw.usage.input_tokens,
          output_tokens: raw.usage.output_tokens,
          cache_read_tokens: raw.usage.cache_read_input_tokens,
          cache_write_tokens: raw.usage.cache_creation_input_tokens,
        } : null;

        // Send done event with full response + mapped metadata
        onEvent({
          type: 'done',
          output: result.output,
          metadata,
          timed_out: result.timedOut,
        });
      } catch (err) {
        onEvent({
          type: 'error',
          error: (err as Error).message,
        });
      } finally {
        // Clear the cognitive SSE sink to avoid leaking callbacks
        if (setSink) setSink(null);
      }
    },

    status(sessionId: string): SessionStatusInfo {
      const session = sessions.get(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      // OBS-19: Override status to 'waiting' when session is waiting for a sub-agent
      const waitingFor = sessionWaitingFor.get(sessionId) ?? null;
      const effectiveStatus = (waitingFor && session.status === 'ready') ? 'waiting' : session.status;

      // PRD 012: Build diagnostics snapshot with stall classification
      const tracker = sessionDiagnostics.get(sessionId);
      let diagnostics: SessionDiagnostics | null = null;
      if (tracker) {
        diagnostics = tracker.snapshot();
        // Classify stall reason for stale or idle sessions
        const isStale = sessionStaleFlags.get(sessionId) ?? false;
        if (isStale || (effectiveStatus === 'ready' && session.promptCount > 0)) {
          // Check if other sessions are also slow (for resource_contention classification)
          const otherSessionsSlow = [...sessionDiagnostics.entries()].some(([otherId, otherTracker]) => {
            if (otherId === sessionId) return false;
            const otherSnap = otherTracker.snapshot();
            return otherSnap.time_to_first_output_ms !== null && otherSnap.time_to_first_output_ms > 10_000;
          });
          diagnostics.stall_reason = tracker.classifyStall(otherSessionsSlow);
        }
      }

      return {
        sessionId,
        nickname: sessionNicknames.get(sessionId) ?? sessionId.substring(0, 8),
        purpose: sessionPurposes.get(sessionId) ?? null,
        status: effectiveStatus,
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
        waiting_for: waitingFor,
        mode: sessionModes.get(sessionId) ?? 'print',
        diagnostics,
      };
    },

    kill(sessionId: string, worktreeAction?: WorktreeAction): { sessionId: string; killed: boolean; worktree_cleaned: boolean } {
      const session = sessions.get(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      // PRD 010: Detach watcher and generate auto-retro before killing
      handleSessionDeath(sessionId, 'killed');

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

      // PRD 026 Phase 3: session.killed emitted via eventBus only (appendMessage removed)
      if (eventBus) {
        eventBus.emit({
          version: 1,
          domain: 'session',
          type: 'session.killed',
          severity: 'info',
          sessionId,
          payload: {
            session_id: sessionId,
            killed_by: 'api',
            worktree_action: worktreeAction ?? 'keep',
            worktree_cleaned: worktreeCleaned,
          },
          source: 'bridge/sessions/pool',
        });
      }

      return { sessionId: session.id, killed: true, worktree_cleaned: worktreeCleaned };
    },

    list(): SessionStatusInfo[] {
      return [...sessions.entries()].map(([sessionId, session]) => {
        // OBS-19: Override status to 'waiting' when session is waiting for a sub-agent
        const waitingFor = sessionWaitingFor.get(sessionId) ?? null;
        const effectiveStatus = (waitingFor && session.status === 'ready') ? 'waiting' : session.status;

        // PRD 012: Include diagnostics snapshot
        const tracker = sessionDiagnostics.get(sessionId);
        const diagnostics = tracker ? tracker.snapshot() : null;

        return {
          sessionId,
          nickname: sessionNicknames.get(sessionId) ?? sessionId.substring(0, 8),
          purpose: sessionPurposes.get(sessionId) ?? null,
          status: effectiveStatus,
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
          waiting_for: waitingFor,
          mode: sessionModes.get(sessionId) ?? 'print',
          diagnostics,
        };
      });
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
            sessionModes.delete(sessionId);
            sessionChains.delete(sessionId);
            sessionChannels.delete(sessionId);
            sessionWorktrees.delete(sessionId);
            sessionStaleConfigs.delete(sessionId);
            sessionStaleFlags.delete(sessionId);
            sessionNicknames.delete(sessionId);
            sessionPurposes.delete(sessionId);
            sessionOriginalWorkdirs.delete(sessionId);
            sessionWaitingFor.delete(sessionId);
            sessionDiagnostics.delete(sessionId);
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
          handleSessionDeath(sessionId, 'stale');
          session.kill();

          // PRD 026 Phase 3: session.stale emitted via eventBus only (appendMessage removed)
          if (eventBus) {
            eventBus.emit({
              version: 1,
              domain: 'session',
              type: 'session.stale',
              severity: 'warning',
              sessionId,
              payload: {
                session_id: sessionId,
                inactive_ms: inactiveMs,
                action: 'auto_killed',
              },
              source: 'bridge/sessions/pool',
            });
          }

          killedIds.push(sessionId);
          sessionStaleFlags.set(sessionId, true);
          continue;
        }

        // Mark stale: inactive beyond stale timeout (but not yet killed)
        if (inactiveMs >= config.stale_timeout_ms && !isStale) {
          sessionStaleFlags.set(sessionId, true);

          // PRD 026 Phase 3: session.stale emitted via eventBus only (appendMessage removed)
          if (eventBus) {
            eventBus.emit({
              version: 1,
              domain: 'session',
              type: 'session.stale',
              severity: 'warning',
              sessionId,
              payload: {
                session_id: sessionId,
                inactive_ms: inactiveMs,
                action: 'marked_stale',
                kill_in_ms: config.kill_timeout_ms - inactiveMs,
              },
              source: 'bridge/sessions/pool',
            });
          }

          staleIds.push(sessionId);
        }
      }

      return { stale: staleIds, killed: killedIds };
    },

    childPids(): number[] {
      const pids: number[] = [];
      for (const [, session] of sessions.entries()) {
        if (session.status !== 'dead' && session.pid !== null) {
          pids.push(session.pid);
        }
      }
      return pids;
    },

    setObservationHook(_hook) {
      // PTY watcher removed in PRD 028 C-4. Observation hook is now a no-op.
    },

    restoreSession(snapshot: SessionSnapshot): void {
      const sid = snapshot.sessionId;

      // Duplicate restore — silently skip if session already exists
      if (sessions.has(sid)) {
        return;
      }

      // Build a minimal PtySession stub that is compatible with pool operations.
      // The stub does not spawn a process — it is a placeholder for recovered state.
      // Sending a prompt creates a real print session under the hood (recovered mode).
      let status: SessionStatus = 'ready';
      let promptCount = snapshot.promptCount;
      let lastActivityAt = new Date();
      let transcript = '';
      const outputSubscribers = new Set<(data: string) => void>();
      const exitCallbacks: Array<(exitCode: number) => void> = [];
      let lastMetadata: PrintMetadata | null = null;

      const stubSession: PtySession & { readonly printMetadata: PrintMetadata | null } = {
        id: sid,
        get pid() { return null; },
        get status() { return status; },
        set status(s: SessionStatus) { status = s; },
        get queueDepth() { return 0; },
        get promptCount() { return promptCount; },
        set promptCount(n: number) { promptCount = n; },
        get lastActivityAt() { return lastActivityAt; },
        set lastActivityAt(d: Date) { lastActivityAt = d; },
        get transcript() { return transcript; },
        onOutput(cb: (data: string) => void): () => void {
          outputSubscribers.add(cb);
          return () => { outputSubscribers.delete(cb); };
        },
        onExit(cb: (exitCode: number) => void): void {
          exitCallbacks.push(cb);
        },
        sendPrompt(prompt: string, _timeoutMs?: number, _settleDelayMs?: number): Promise<{ output: string; timedOut: boolean }> {
          if (status === 'dead') {
            return Promise.reject(new Error(`Session ${sid} is dead — cannot send prompt`));
          }

          // Lazy upgrade: replace stub with real print session on first prompt
          const real = createPrintSession({
            id: sid,
            workdir: snapshot.workdir,
            recovered: true,
            model: typeof snapshot.metadata?.model === 'string' ? snapshot.metadata.model : undefined,
          });
          // Migrate subscribers
          for (const sub of outputSubscribers) { real.onOutput(sub); }
          for (const cb of exitCallbacks) { real.onExit(cb); }
          // Replace in pool map
          sessions.set(sid, real);

          return real.sendPrompt(prompt, _timeoutMs, _settleDelayMs);
        },
        sendPromptStream(prompt: string, onChunk: (chunk: string) => void, _timeoutMs?: number): Promise<{ output: string; timedOut: boolean }> {
          if (status === 'dead') {
            return Promise.reject(new Error(`Session ${sid} is dead — cannot send prompt`));
          }

          // Lazy upgrade: replace stub with real print session on first prompt (streaming)
          const real = createPrintSession({
            id: sid,
            workdir: snapshot.workdir,
            recovered: true,
            model: typeof snapshot.metadata?.model === 'string' ? snapshot.metadata.model : undefined,
          });
          for (const sub of outputSubscribers) { real.onOutput(sub); }
          for (const cb of exitCallbacks) { real.onExit(cb); }
          sessions.set(sid, real);

          if (typeof real.sendPromptStream === 'function') {
            return real.sendPromptStream(prompt, onChunk, _timeoutMs);
          }
          return real.sendPrompt(prompt, _timeoutMs);
        },
        resize(_cols: number, _rows: number): void { /* no-op */ },
        kill(): void {
          status = 'dead';
          outputSubscribers.clear();
          for (const cb of exitCallbacks) {
            try { cb(0); } catch { /* non-fatal */ }
          }
        },
        interrupt(): boolean { return false; },
        get adaptiveSettle() { return null; },
        get printMetadata() { return lastMetadata; },
      };

      // Hydrate all internal Maps
      sessions.set(sid, stubSession);
      sessionWorkdirs.set(sid, snapshot.workdir);
      sessionModes.set(sid, snapshot.mode as SessionMode);
      sessionNicknames.set(sid, snapshot.nickname);
      activeNicknames.add(snapshot.nickname);
      if (snapshot.purpose) {
        sessionPurposes.set(sid, snapshot.purpose);
      }
      if (snapshot.metadata) {
        sessionMetadata.set(sid, snapshot.metadata);
      }
      sessionChains.set(sid, {
        parent_session_id: snapshot.parentSessionId ?? null,
        depth: snapshot.depth,
        children: [],
        budget: { max_depth: DEFAULT_MAX_DEPTH, max_agents: DEFAULT_MAX_AGENTS, agents_spawned: 0 },
      });
      sessionWorktrees.set(sid, {
        isolation: snapshot.isolation as IsolationMode,
        worktree_path: null,
        worktree_branch: null,
        metals_available: snapshot.isolation !== 'worktree',
      });
      sessionStaleFlags.set(sid, false);
      sessionChannels.set(sid, createSessionChannels());

      // Note: totalSpawned is NOT incremented — restored sessions don't count as newly spawned.
    },
  };
}
