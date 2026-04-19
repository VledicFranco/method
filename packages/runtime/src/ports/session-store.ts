// SPDX-License-Identifier: Apache-2.0
/**
 * SessionStore — persistence port for agent sessions and checkpoints.
 *
 * Owner: @methodts/runtime
 * Consumers: @methodts/pacta (ResumableMode), @methodts/methodts (strategy executor),
 *            @methodts/bridge (sessions + strategies domains), @methodts/agent-runtime
 * Producers: FsSessionStore (bridge JSONL+FS), CortexSessionStore (ctx.storage)
 * Direction: runtime ↔ adapter (CRUD + lease)
 * Co-designed: 2026-04-14 (FCD surface session `fcd-surface-session-store`)
 * PRD: .method/sessions/fcd-design-prd-061-session-store/prd.md
 *
 * Contract invariants:
 *   I-1  load(sessionId) is idempotent; it never mutates state.
 *   I-2  resume(sessionId, workerId) acquires a lease; concurrent callers receive
 *        FENCED from that point until the lease expires or is released.
 *   I-3  appendCheckpoint rejects stale fencing tokens with FENCED.
 *   I-4  Checkpoints for a given session are totally ordered by `sequence`.
 *   I-5  The store never blocks emit of bus events — CheckpointSink is async.
 *   I-6  Implementations must not leak backend-specific types through this port.
 */

import type {
  Checkpoint,
  CheckpointMeta,
  ResumeContext,
  ResumeOptions,
  SessionSnapshot,
  SessionStatus,
} from './session-store-types.js';

export interface SessionStore {
  // ── Session lifecycle ─────────────────────────────────────────

  /** Create a new session record. Throws DUPLICATE if sessionId exists. */
  create(snapshot: SessionSnapshot): Promise<void>;

  /** Load the latest snapshot or null. Pure read; no lease. */
  load(sessionId: string): Promise<SessionSnapshot | null>;

  /**
   * Resume a session. Atomically:
   *   (1) loads the latest snapshot + latest checkpoint,
   *   (2) acquires a lease owned by `workerId`,
   *   (3) returns a ResumeContext carrying a fencingToken.
   *
   * If a live lease is held by a different worker: `SessionStoreError{ FENCED }`.
   * If the caller's lease is still valid (same workerId), the existing token is
   * returned (idempotent re-fetch — invariant for G-RESUME-IDEMPOTENT).
   */
  resume(sessionId: string, workerId: string, opts?: ResumeOptions): Promise<ResumeContext>;

  /** Release a lease early. Idempotent. */
  releaseLease(sessionId: string, fencingToken: string): Promise<void>;

  /**
   * Renew a lease before it expires. Throws FENCED if stolen.
   * Returns the new expiry timestamp.
   */
  renewLease(sessionId: string, fencingToken: string, ttlMs?: number): Promise<string>;

  // ── Checkpoint lifecycle ──────────────────────────────────────

  /**
   * Append a new checkpoint. Must carry a valid fencingToken from an
   * active lease held by this worker. Rejects stale tokens with FENCED.
   * Updates the snapshot's `latestCheckpointSequence` atomically.
   */
  appendCheckpoint(
    sessionId: string,
    checkpoint: Checkpoint,
    fencingToken: string,
  ): Promise<void>;

  /** Load a specific checkpoint or null. */
  loadCheckpoint(sessionId: string, sequence: number): Promise<Checkpoint | null>;

  /** Load the latest checkpoint or null. */
  loadLatestCheckpoint(sessionId: string): Promise<Checkpoint | null>;

  /**
   * List checkpoints for a session (most-recent first).
   * Bounded by `limit`; default 10.
   */
  listCheckpoints(sessionId: string, limit?: number): Promise<CheckpointMeta[]>;

  // ── Cleanup ───────────────────────────────────────────────────

  /**
   * Mark a session terminal. Sets status, persists the final snapshot,
   * releases any held lease. Checkpoint ring is retained per the store's
   * retention policy.
   */
  finalize(sessionId: string, status: SessionStatus, reason?: string): Promise<void>;

  /** Remove a session and all its checkpoints. Irreversible. */
  destroy(sessionId: string): Promise<void>;
}
