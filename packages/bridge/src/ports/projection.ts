// SPDX-License-Identifier: Apache-2.0
/**
 * Projection<S> — domain contract for projecting event streams into in-memory state.
 *
 * A projection is a pure reducer over BridgeEvent streams. Domains implement this
 * interface to opt into projection-based persistence: the ProjectionStore loads
 * snapshots, replays events from the persistent log, and subscribes to live updates
 * on behalf of the projection.
 *
 * @see .method/sessions/fcd-design-persistence-projections/prd.md §Surfaces S1
 */

import type { BridgeEvent } from './event-bus.js';

export interface Projection<S> {
  /** Domain name — used as snapshot filename (e.g. 'build' → .method/projections/build.json). */
  readonly domain: string;

  /** Returns the empty initial state. Called when no snapshot exists. */
  initialState(): S;

  /**
   * Pure reducer: apply an event to current state, return new state.
   * Must be deterministic. Events that don't apply should return state unchanged.
   */
  reduce(state: S, event: BridgeEvent): S;

  /** Serialize state to JSON string for snapshot. Omit to disable snapshots (replay-only). */
  serialize?(state: S): string;

  /** Deserialize snapshot back to state. Required if `serialize` is defined. */
  deserialize?(raw: string): S;

  /** Snapshot every N events after the last snapshot. Default 100. */
  readonly snapshotEveryN?: number;
}
