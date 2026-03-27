/**
 * SessionCheckpointSink — PRD 029 Phase C-2.
 *
 * Persists session snapshots to the session persistence store whenever
 * session-domain lifecycle events fire. Uses debounced writes: multiple
 * events for the same session within a 200ms window collapse into a
 * single save() call.
 *
 * Depends on two narrow callbacks (not the pool directly) to respect
 * G-BOUNDARY. The composition root wires:
 *   - poolList(): current session status snapshots
 *   - save(): writes a PersistedSession record
 */

import type { BridgeEvent, EventSink } from '../../ports/event-bus.js';

// ── Types ────────────────────────────────────────────────────────

/**
 * Minimal persisted session shape accepted by the save callback.
 * Mirrors PersistedSession from sessions/session-persistence.ts.
 */
export interface PersistedSessionInput {
  session_id: string;
  workdir: string;
  nickname: string;
  purpose: string | null;
  mode: 'pty' | 'print';
  status: string;
  created_at: string;
  last_activity_at: string;
  prompt_count: number;
  depth: number;
  parent_session_id: string | null;
  isolation: string;
  metadata?: Record<string, unknown>;
}

/**
 * Minimal session status info returned by the poolList callback.
 * Matches the relevant fields of SessionStatusInfo from the sessions domain.
 */
export interface SessionStatusInfo {
  sessionId: string;
  nickname: string;
  purpose: string | null;
  status: string;
  promptCount: number;
  lastActivityAt: Date;
  workdir: string;
  mode: string;
  chain: {
    parent_session_id: string | null;
    depth: number;
  };
  worktree: {
    isolation: string;
  };
  metadata?: Record<string, unknown>;
}

export interface SessionCheckpointSinkOptions {
  /** Persist a session snapshot. */
  save: (session: PersistedSessionInput) => Promise<void>;
  /** Get current session statuses from the pool. */
  poolList: () => SessionStatusInfo[];
  /** Debounce window in milliseconds (default: 200). */
  debounceMs?: number;
}

// ── Event types that trigger checkpoints ─────────────────────────

const SESSION_EVENT_TYPES = new Set([
  'session.spawned',
  'session.prompt.completed',
  'session.killed',
  'session.dead',
  'session.state_changed',
]);

const DEFAULT_DEBOUNCE_MS = 200;

// ── SessionCheckpointSink ────────────────────────────────────────

export class SessionCheckpointSink implements EventSink {
  readonly name = 'session-checkpoint';

  private readonly save: (session: PersistedSessionInput) => Promise<void>;
  private readonly poolList: () => SessionStatusInfo[];
  private readonly debounceMs: number;

  /** Pending debounce timers keyed by sessionId. */
  private readonly pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: SessionCheckpointSinkOptions) {
    this.save = options.save;
    this.poolList = options.poolList;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  // ── EventSink interface ──────────────────────────────────────

  onEvent(event: BridgeEvent): void {
    // Only react to session-domain lifecycle events
    if (!SESSION_EVENT_TYPES.has(event.type)) return;

    // Must have a sessionId to checkpoint
    const sessionId = event.sessionId ?? (event.payload.sessionId as string | undefined);
    if (!sessionId) return;

    // Debounce: if a timer is already running for this session, reset it
    const existing = this.pendingTimers.get(sessionId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.pendingTimers.delete(sessionId);
      this.checkpoint(sessionId);
    }, this.debounceMs);

    this.pendingTimers.set(sessionId, timer);
  }

  onError(error: Error, event: BridgeEvent): void {
    console.error(`[session-checkpoint-sink] Error processing event ${event.id}:`, error.message);
  }

  // ── Checkpoint logic ──────────────────────────────────────────

  private checkpoint(sessionId: string): void {
    try {
      const sessions = this.poolList();
      const info = sessions.find(s => s.sessionId === sessionId);

      if (!info) {
        // Session may have been removed from pool already (e.g., dead + cleaned up)
        return;
      }

      const persisted: PersistedSessionInput = {
        session_id: info.sessionId,
        workdir: info.workdir,
        nickname: info.nickname,
        purpose: info.purpose,
        mode: info.mode as 'pty' | 'print',
        status: info.status,
        created_at: info.lastActivityAt.toISOString(), // best available
        last_activity_at: info.lastActivityAt.toISOString(),
        prompt_count: info.promptCount,
        depth: info.chain.depth,
        parent_session_id: info.chain.parent_session_id,
        isolation: info.worktree.isolation,
        metadata: info.metadata,
      };

      this.save(persisted).catch(err => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[session-checkpoint-sink] Failed to save session ${sessionId}: ${msg}`);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[session-checkpoint-sink] Checkpoint error for ${sessionId}: ${msg}`);
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  /** Clean up pending timers. Call on shutdown. */
  dispose(): void {
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
  }

  /** Number of pending debounce timers (for testing/monitoring). */
  get pendingCount(): number {
    return this.pendingTimers.size;
  }
}
