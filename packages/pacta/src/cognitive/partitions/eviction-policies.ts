/**
 * Eviction Policies — pluggable eviction strategies for partition workspaces.
 *
 * PRD 044 Phase 1 (C-1): Three eviction policies covering the core partition needs:
 *   NoEvictionPolicy          — constraints partition (never evict, workspace handles safety valve)
 *   RecencyEvictionPolicy     — operational partition (oldest-timestamp-first)
 *   GoalSalienceEvictionPolicy — task partition (preserve goals, evict operational/strategies first)
 */

import type { EvictionPolicy } from '../algebra/partition-types.js';
import type { WorkspaceEntry } from '../algebra/workspace-types.js';

// ── NoEvictionPolicy ───────────────────────────────────────────

/**
 * Never selects an entry for eviction.
 *
 * Used for the constraint partition where entries are sacred.
 * The PartitionWorkspace handles safety-valve behavior when this
 * policy returns null at capacity.
 */
export class NoEvictionPolicy implements EvictionPolicy {
  selectForEviction(_entries: ReadonlyArray<WorkspaceEntry>): number | null {
    return null;
  }
}

// ── RecencyEvictionPolicy ──────────────────────────────────────

/**
 * Evicts the entry with the oldest timestamp.
 *
 * Straightforward FIFO-like eviction — the least recent entry is
 * assumed to be the least relevant. Used for operational partitions
 * where freshness is the primary signal.
 */
export class RecencyEvictionPolicy implements EvictionPolicy {
  selectForEviction(entries: ReadonlyArray<WorkspaceEntry>): number | null {
    if (entries.length === 0) return null;

    let oldestIndex = 0;
    let oldestTimestamp = entries[0].timestamp;

    for (let i = 1; i < entries.length; i++) {
      if (entries[i].timestamp < oldestTimestamp) {
        oldestTimestamp = entries[i].timestamp;
        oldestIndex = i;
      }
    }

    return oldestIndex;
  }
}

// ── GoalSalienceEvictionPolicy ─────────────────────────────────

/**
 * Preserves goal entries by evicting non-goal entries first.
 *
 * Selection order:
 *   1. Non-goal entries (contentType !== 'goal'), oldest first.
 *   2. If all entries are goals, evicts the oldest goal.
 *
 * Used for the task partition where goals are high-value and
 * strategies/operational context should be recycled first.
 */
export class GoalSalienceEvictionPolicy implements EvictionPolicy {
  selectForEviction(entries: ReadonlyArray<WorkspaceEntry>): number | null {
    if (entries.length === 0) return null;

    // First pass: find the oldest non-goal entry.
    let oldestNonGoalIndex: number | null = null;
    let oldestNonGoalTimestamp = Infinity;

    for (let i = 0; i < entries.length; i++) {
      if (entries[i].contentType !== 'goal') {
        if (entries[i].timestamp < oldestNonGoalTimestamp) {
          oldestNonGoalTimestamp = entries[i].timestamp;
          oldestNonGoalIndex = i;
        }
      }
    }

    if (oldestNonGoalIndex !== null) return oldestNonGoalIndex;

    // All entries are goals — evict the oldest goal.
    let oldestIndex = 0;
    let oldestTimestamp = entries[0].timestamp;

    for (let i = 1; i < entries.length; i++) {
      if (entries[i].timestamp < oldestTimestamp) {
        oldestTimestamp = entries[i].timestamp;
        oldestIndex = i;
      }
    }

    return oldestIndex;
  }
}
