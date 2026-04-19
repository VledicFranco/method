// SPDX-License-Identifier: Apache-2.0
/**
 * Operational Partition Monitor — stagnation detection.
 *
 * PRD 044 C-2: Deterministic monitor co-located with the operational partition.
 * Detects stagnation — consecutive cycles with no new operational writes,
 * suggesting the agent is stuck in read-only loops.
 */

import type {
  PartitionMonitor,
  PartitionMonitorContext,
  PartitionSignal,
} from '../../algebra/partition-types.js';
import type { WorkspaceEntry } from '../../algebra/workspace-types.js';

// ── Configuration ─────────────────────────────────────────────────

/** Number of cycles without operational writes before stagnation signal. */
const STAGNATION_THRESHOLD = 3;

// ── Monitor Implementation ────────────────────────────────────────

export class OperationalPartitionMonitor implements PartitionMonitor {
  check(
    _entries: ReadonlyArray<WorkspaceEntry>,
    context: PartitionMonitorContext,
  ): PartitionSignal[] {
    const signals: PartitionSignal[] = [];

    const lastWrite = context.lastWriteCycle.get('operational');
    if (lastWrite !== undefined) {
      const cyclesSinceWrite = context.cycleNumber - lastWrite;
      if (cyclesSinceWrite >= STAGNATION_THRESHOLD) {
        signals.push({
          severity: 'high',
          partition: 'operational',
          type: 'stagnation',
          detail: `No operational writes for ${cyclesSinceWrite} cycles (threshold: ${STAGNATION_THRESHOLD}). Agent may be stuck in read-only loop.`,
        });
      }
    }

    return signals;
  }
}
