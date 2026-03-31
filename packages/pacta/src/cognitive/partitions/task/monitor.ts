/**
 * Task Partition Monitor — goal staleness detection.
 *
 * PRD 044 C-2: Deterministic monitor co-located with the task partition.
 * Detects when the task partition has not been written to for many cycles,
 * suggesting goals are stale and may need re-evaluation.
 */

import type {
  PartitionMonitor,
  PartitionMonitorContext,
  PartitionSignal,
} from '../../algebra/partition-types.js';
import type { WorkspaceEntry } from '../../algebra/workspace-types.js';

// ── Configuration ─────────────────────────────────────────────────

/** Number of cycles without task writes before goal-stale signal. */
const GOAL_STALE_THRESHOLD = 5;

// ── Monitor Implementation ────────────────────────────────────────

export class TaskPartitionMonitor implements PartitionMonitor {
  check(
    _entries: ReadonlyArray<WorkspaceEntry>,
    context: PartitionMonitorContext,
  ): PartitionSignal[] {
    const signals: PartitionSignal[] = [];

    const lastWrite = context.lastWriteCycle.get('task');
    if (lastWrite !== undefined) {
      const cyclesSinceWrite = context.cycleNumber - lastWrite;
      if (cyclesSinceWrite >= GOAL_STALE_THRESHOLD) {
        signals.push({
          severity: 'medium',
          partition: 'task',
          type: 'goal-stale',
          detail: `No task partition writes for ${cyclesSinceWrite} cycles (threshold: ${GOAL_STALE_THRESHOLD}). Goals may be stale.`,
        });
      }
    }

    return signals;
  }
}
