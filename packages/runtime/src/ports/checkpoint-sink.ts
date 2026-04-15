/**
 * CheckpointSink — event-bus adapter that writes SessionStore checkpoints.
 *
 * Co-designed in S4 (`fcd-surface-session-store`). Replaces the bridge's
 * legacy `SessionCheckpointSink` with a store-backed writer.
 *
 * Owner: @method/runtime
 * Producer: composition root (bridge server-entry, agent-runtime bootstrap)
 * Consumer: EventBus (via registerSink)
 *
 * Per S4 D-3: per-turn checkpoint is the default; `checkpointOnEvent(filter)`
 * enables per-event opt-in for long tool-heavy turns (off by default).
 */

import type { EventFilter, EventSink } from './event-bus.js';
import type { SessionStore } from './session-store.js';
import type { Checkpoint } from './session-store-types.js';

/**
 * Callback-captured snapshot payload. The sink composes sequence + createdAt
 * + schemaVersion itself — callers populate the interesting fields.
 */
export type CheckpointCapture = Omit<Checkpoint, 'sequence' | 'createdAt' | 'schemaVersion'>;

export interface CheckpointSink extends EventSink {
  readonly name: 'session-checkpoint';

  /**
   * Subscribe to an additional per-event filter. Every event matching this
   * filter triggers an immediate checkpoint (bypasses the per-turn debouncer).
   * Use sparingly — each match is at least one store write.
   */
  checkpointOnEvent(filter: EventFilter): void;

  /**
   * Flush any debounced pending checkpoints. Call on shutdown and before
   * resume handoff.
   */
  flush(): Promise<void>;

  /** Pending debounce count (for tests / health). */
  readonly pendingCount: number;

  /** Release timers and in-flight state. */
  dispose(): void;
}

export interface CheckpointSinkOptions {
  readonly store: SessionStore;
  /** Resolves current worker identity for fencing tokens. */
  readonly workerId: () => string;
  /**
   * Returns the active fencing token for the given session, or null if the
   * worker does not currently hold a lease on that session. The sink never
   * acquires leases itself — it expects the runtime to have called
   * `store.resume()` ahead of any checkpoint-worthy event.
   */
  readonly fencingToken: (sessionId: string) => string | null;
  /**
   * Builds the snapshot payload from a session id at checkpoint time.
   * Kept as a callback so the sink does not know about the session pool,
   * the strategy executor, or the agent runtime internals.
   *
   * Return null to skip this checkpoint (e.g., session already terminated).
   */
  readonly captureSnapshot: (sessionId: string) => Promise<CheckpointCapture | null>;
  /** Debounce window (ms). Default 200. */
  readonly debounceMs?: number;
  /** Which event types cause a checkpoint. Default: SESSION_LIFECYCLE_TYPES. */
  readonly defaultEventTypes?: readonly string[];
  /**
   * Optional error hook — called when an individual checkpoint write fails.
   * The sink never blocks bus emit.
   */
  readonly onError?: (err: Error, sessionId: string) => void;
}
