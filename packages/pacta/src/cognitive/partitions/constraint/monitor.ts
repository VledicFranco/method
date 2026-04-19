// SPDX-License-Identifier: Apache-2.0
/**
 * Constraint Partition Monitor — violation detection and capacity warnings.
 *
 * PRD 044 C-2: Deterministic monitor co-located with the constraint partition.
 * Checks actor output against pinned constraint entries for prohibition
 * violations. Also emits capacity warnings when the partition is near full.
 */

import type {
  PartitionMonitor,
  PartitionMonitorContext,
  PartitionSignal,
} from '../../algebra/partition-types.js';
import type { WorkspaceEntry } from '../../algebra/workspace-types.js';
import { checkConstraintViolations } from '../../algebra/constraint-utils.js';
import { CONSTRAINT_PARTITION_CONFIG } from './config.js';

// ── Monitor Implementation ────────────────────────────────────────

export class ConstraintPartitionMonitor implements PartitionMonitor {
  private readonly capacity: number;

  constructor(capacity?: number) {
    this.capacity = capacity ?? CONSTRAINT_PARTITION_CONFIG.capacity;
  }

  check(
    entries: ReadonlyArray<WorkspaceEntry>,
    context: PartitionMonitorContext,
  ): PartitionSignal[] {
    const signals: PartitionSignal[] = [];

    // 1. Check actor output against constraint entries for violations.
    if (context.actorOutput) {
      const pinnedEntries = entries.filter((e) => e.pinned);
      const violations = checkConstraintViolations(pinnedEntries, context.actorOutput);

      for (const v of violations) {
        signals.push({
          severity: 'critical',
          partition: 'constraint',
          type: 'constraint-violation',
          detail: `Constraint violated: "${v.constraint}" — matched "${v.violation}" (pattern: ${v.pattern})`,
        });
      }
    }

    // 2. Capacity warning when at >= 80%.
    if (entries.length >= this.capacity * 0.8) {
      signals.push({
        severity: 'low',
        partition: 'constraint',
        type: 'capacity-warning',
        detail: `Constraint partition at ${entries.length}/${this.capacity} entries (${Math.round((entries.length / this.capacity) * 100)}% full)`,
      });
    }

    return signals;
  }
}
