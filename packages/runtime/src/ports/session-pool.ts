/**
 * SessionPool Port — Cross-domain interface for session pool access.
 *
 * PRD-057 / S2 §6: Session-pool port types migrated to @method/runtime. The
 * full `SessionPool` interface is defined here along with the new
 * `SessionProviderFactory` port that both @method/bridge (PTY factory) and
 * @method/agent-runtime (Cortex factory) will implement.
 *
 * Design: DR-15 compliant — domains accept the port via injection.
 * The composition root wires the real pool implementation to consumers.
 *
 * NOTE (C1): The `SessionPool` concrete interface still references types from
 * the bridge's `domains/sessions/pool.ts` (`SessionChannels`,
 * `SessionDiagnostics`, `PtySession`, etc.). Those types move to runtime in
 * C5 (`runtime-sessions-subpath`). For C1 the bridge-side
 * `packages/bridge/src/ports/session-pool.ts` continues to expose the full
 * `SessionPool` interface by re-exporting from its local pool.ts.
 */

// ── Base session types (pure, no implementation deps) ──────────

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

export type SessionMode = 'print' | 'cognitive-agent';

export type IsolationMode = 'worktree' | 'shared';
export type WorktreeAction = 'merge' | 'keep' | 'discard';

export interface WorktreeInfo {
  isolation: IsolationMode;
  worktree_path: string | null;
  worktree_branch: string | null;
  metals_available: boolean;
}

/**
 * SSE stream event emitted during a streaming prompt.
 *
 * Shared across providers — print-mode, cognitive-mode, and (eventually)
 * Cortex-backed sessions all emit the same shape.
 */
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
  /** PRD 028: Session mode. */
  mode: SessionMode;
  /** PRD 012: Per-session diagnostic metrics (concrete shape defined in sessions subpath). */
  diagnostics: unknown | null;
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

// ── SessionProviderFactory (new in PRD-057, S2 §6) ─────────────

/**
 * Forward-declared minimal PtySession shape for the factory contract.
 *
 * The real PtySession interface is defined in the sessions subpath (C5);
 * this forward declaration keeps C1 self-contained. Consumers that import
 * `PtySession` directly should continue to import from
 * `@method/runtime/sessions` once C5 lands.
 */
export interface PtySessionHandle {
  sessionId: string;
  nickname?: string;
  kill(): void;
}

/**
 * Options passed to the SessionProviderFactory when the pool needs a new
 * session. Bridge's factory (PTY+print+cognitive) and agent-runtime's
 * factory (Cortex-ctx.llm-backed) both receive this shape.
 */
export interface SessionProviderOptions {
  sessionId: string;
  mode: SessionMode;
  workdir: string;
  allowedTools?: string[];
  allowedPaths?: string[];
  metadata?: Record<string, unknown>;
  /** Invoked on every stream event (text, cycle-start, monitor, etc.). */
  onEvent: (event: StreamEvent) => void;
  /** Optional cognitive config (only used when mode === 'cognitive-agent'). Shape defined in sessions subpath. */
  cognitiveConfig?: Record<string, unknown>;
  /** Optional sink for typed cognitive events (PRD 041 experiment lab). Shape defined in sessions subpath. */
  cognitiveSink?: unknown;
}

/**
 * Factory that produces the concrete session implementation for a given
 * session mode. Injected at pool construction — bridge provides a
 * PTY+print factory; agent-runtime provides an HTTP/ctx.llm factory.
 *
 * The pool handles lifecycle, queueing, diagnostics, channels, and chain
 * bookkeeping. The factory owns ONLY the "how does a prompt actually
 * execute" part.
 */
export interface SessionProviderFactory {
  createSession(options: SessionProviderOptions): Promise<PtySessionHandle>;
}
