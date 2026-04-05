/**
 * EventReader — cursor-based historical event replay port.
 *
 * Exposes historical event reading from the persistent event log for projection
 * replay on startup. Implemented by PersistenceSink. Distinct from live event
 * subscription (provided by EventBus) — this port is for catching up from disk.
 *
 * @see .method/sessions/fcd-design-persistence-projections/prd.md §Surfaces S3
 */

import type { BridgeEvent } from './event-bus.js';

export interface EventReader {
  /**
   * Read events from the persistent log where sequence > sinceSeq.
   * Returns events in append order. Corrupt JSONL lines are skipped gracefully.
   *
   * @param sinceSeq — exclusive lower bound (returns events with sequence > sinceSeq)
   * @returns events in append order
   */
  readEventsSince(sinceSeq: number): Promise<BridgeEvent[]>;
}
