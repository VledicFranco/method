/**
 * ProjectionStore — composition-root port for projection-based state persistence.
 *
 * Manages the lifecycle of registered projections: snapshot loading, event replay
 * from the persistent log, live event subscription via EventBus, and in-memory
 * state access for consumers.
 *
 * Lifecycle:
 *   1. register() — called at composition root for each projection, before start()
 *   2. start() — loads snapshots, replays events, subscribes to live stream
 *   3. get<S>(domain) — consumers read current in-memory state
 *
 * @see .method/sessions/fcd-design-persistence-projections/prd.md §Surfaces S2
 */

import type { Projection } from './projection.js';

export interface ProjectionStore {
  /**
   * Register a projection. Must be called before start().
   * Throws if the projection's domain is already registered.
   */
  register<S>(projection: Projection<S>): void;

  /**
   * Load snapshots → replay events from snapshot cursor → subscribe to live events.
   * Called once at composition root after EventBus is ready.
   * Safe to call multiple times — only the first invocation has effect.
   */
  start(): Promise<StartResult>;

  /**
   * Read current in-memory state for a domain.
   * Returns null if the domain is not registered or start() has not completed.
   */
  get<S>(domain: string): S | null;

  /**
   * Lowest cursor across all projection snapshots. Used by EventRotator as a
   * safety guard — events at or below this sequence are safe to archive.
   * Returns null if no projections are registered or no snapshots have been taken.
   */
  maxSafeCutoff(): number | null;
}

export interface StartResult {
  readonly projectionsLoaded: number;
  readonly snapshotsRestored: number;
  readonly eventsReplayed: number;
  /** Events that failed the reducer during replay (logged, skipped, not thrown). */
  readonly skippedEvents: number;
  readonly durationMs: number;
}
