// SPDX-License-Identifier: Apache-2.0
/**
 * Partition Write Adapter — routes module writes through PartitionSystem (PRD 045 S-8).
 *
 * Implements the PartitionWriteAdapter interface: modules call write(entry) as before,
 * but entries are routed through EntryRouter → PartitionSystem.write() instead of the
 * legacy monolithic workspace. Tracks which partitions received writes for
 * partitionLastWriteCycle monitoring.
 */

import type { ModuleId } from '../algebra/module.js';
import type { WorkspaceEntry } from '../algebra/workspace-types.js';
import type { PartitionId, PartitionSystem, PartitionWriteAdapter } from '../algebra/partition-types.js';

/**
 * Creates a PartitionWriteAdapter that routes writes through a PartitionSystem.
 *
 * @param partitionSystem - The partition system to route writes through.
 * @param source - The module ID that will be attributed as the write source.
 */
export function createPartitionWriteAdapter(
  partitionSystem: PartitionSystem,
  source: ModuleId,
): PartitionWriteAdapter {
  const writtenPartitions = new Map<PartitionId, number>();

  return {
    write(entry: WorkspaceEntry): void {
      const targetPartition = partitionSystem.write(entry, source);
      writtenPartitions.set(targetPartition, Date.now());
    },

    getWrittenPartitions(): Map<PartitionId, number> {
      return writtenPartitions;
    },

    resetCycleTracking(): void {
      writtenPartitions.clear();
    },
  };
}
