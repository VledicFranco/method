/**
 * Partition System — aggregate of all partitions with routing, context
 * building, and monitor execution.
 *
 * PRD 044 C-2: Top-level interface that the cycle orchestrator uses to
 * replace the monolithic workspace. Composes three PartitionWorkspace
 * instances with their respective eviction policies and monitors.
 */

import type {
  ContextSelector,
  EntryRouter,
  PartitionId,
  PartitionMonitor,
  PartitionMonitorContext,
  PartitionReadPort,
  PartitionSignal,
  PartitionSystem,
} from '../algebra/partition-types.js';
import type { WorkspaceEntry } from '../algebra/workspace-types.js';
import type { ModuleId } from '../algebra/module.js';

import { PartitionWorkspace } from './partition-workspace.js';
import {
  NoEvictionPolicy,
  RecencyEvictionPolicy,
  GoalSalienceEvictionPolicy,
} from './eviction-policies.js';
import { DefaultEntryRouter } from './entry-router.js';
import { ConstraintPartitionMonitor } from './constraint/monitor.js';
import { OperationalPartitionMonitor } from './operational/monitor.js';
import { TaskPartitionMonitor } from './task/monitor.js';
import { CONSTRAINT_PARTITION_CONFIG } from './constraint/config.js';
import { OPERATIONAL_PARTITION_CONFIG } from './operational/config.js';
import { TASK_PARTITION_CONFIG } from './task/config.js';

// ── Configuration ─────────────────────────────────────────────────

export interface PartitionSystemConfig {
  constraintCapacity?: number;
  operationalCapacity?: number;
  taskCapacity?: number;
  router?: EntryRouter;
}

// ── Factory ───────────────────────────────────────────────────────

export function createPartitionSystem(config?: PartitionSystemConfig): PartitionSystem {
  const constraintCapacity = config?.constraintCapacity ?? CONSTRAINT_PARTITION_CONFIG.capacity;
  const operationalCapacity = config?.operationalCapacity ?? OPERATIONAL_PARTITION_CONFIG.capacity;
  const taskCapacity = config?.taskCapacity ?? TASK_PARTITION_CONFIG.capacity;
  const router = config?.router ?? new DefaultEntryRouter();

  // Create partition workspaces with appropriate eviction policies.
  const constraintPartition = new PartitionWorkspace({
    id: 'constraint',
    capacity: constraintCapacity,
    policy: new NoEvictionPolicy(),
    safetyValve: true,
  });

  const operationalPartition = new PartitionWorkspace({
    id: 'operational',
    capacity: operationalCapacity,
    policy: new RecencyEvictionPolicy(),
  });

  const taskPartition = new PartitionWorkspace({
    id: 'task',
    capacity: taskCapacity,
    policy: new GoalSalienceEvictionPolicy(),
  });

  // Partition lookup.
  const partitions = new Map<PartitionId, PartitionWorkspace>([
    ['constraint', constraintPartition],
    ['operational', operationalPartition],
    ['task', taskPartition],
  ]);

  // Create per-partition monitors.
  const monitors = new Map<PartitionId, PartitionMonitor>([
    ['constraint', new ConstraintPartitionMonitor(constraintCapacity)],
    ['operational', new OperationalPartitionMonitor()],
    ['task', new TaskPartitionMonitor()],
  ]);

  // ── PartitionSystem Implementation ────────────────────────────

  return {
    getPartition(id: PartitionId): PartitionReadPort {
      const partition = partitions.get(id);
      if (!partition) {
        throw new Error(`Unknown partition: ${id}`);
      }
      return partition;
    },

    write(entry: WorkspaceEntry, source: ModuleId): PartitionId {
      const targetId = router.route(entry.content, source);
      const partition = partitions.get(targetId);
      if (partition) {
        partition.write(entry);
      }
      return targetId;
    },

    buildContext(selector: ContextSelector): WorkspaceEntry[] {
      const { sources, types, budget, strategy } = selector;
      if (sources.length === 0) return [];

      // Split budget equally among sources, remainder to last.
      const budgetPerSource = Math.floor(budget / sources.length);
      const remainder = budget - budgetPerSource * sources.length;

      const result: WorkspaceEntry[] = [];
      for (let i = 0; i < sources.length; i++) {
        const partition = partitions.get(sources[i]);
        if (!partition) continue;

        const sourceBudget = budgetPerSource + (i === sources.length - 1 ? remainder : 0);
        const entries = partition.select({
          types,
          budget: sourceBudget,
          strategy,
        });
        result.push(...entries);
      }

      // Truncate to total budget (token-estimated).
      if (budget > 0) {
        let used = 0;
        const truncated: WorkspaceEntry[] = [];
        for (const entry of result) {
          const cost =
            typeof entry.content === 'string'
              ? Math.ceil(entry.content.length / 4)
              : 50;
          if (used + cost > budget && truncated.length > 0) break;
          truncated.push(entry);
          used += cost;
        }
        return truncated;
      }

      return result;
    },

    checkPartitions(context: PartitionMonitorContext): PartitionSignal[] {
      const signals: PartitionSignal[] = [];
      for (const [id, monitor] of monitors) {
        const partition = partitions.get(id)!;
        const entries = partition.snapshot();
        signals.push(...monitor.check(entries, context));
      }
      return signals;
    },

    snapshot(): ReadonlyArray<WorkspaceEntry> {
      const all: WorkspaceEntry[] = [];
      for (const partition of partitions.values()) {
        all.push(...partition.snapshot());
      }
      return all;
    },

    resetCycleQuotas(): void {
      for (const partition of partitions.values()) {
        partition.resetCycleQuotas();
      }
    },
  };
}
