// SPDX-License-Identifier: Apache-2.0
/**
 * Partition Workspace — generic workspace backing a single partition.
 *
 * PRD 044 Phase 1 (C-1): Implements PartitionReadPort with pluggable eviction,
 * budget-aware selection, and safety-valve overflow handling.
 *
 * The PartitionSystem (C-2) composes multiple PartitionWorkspace instances,
 * one per partition. This class is not used directly by modules.
 */

import type {
  EvictionPolicy,
  PartitionId,
  PartitionReadPort,
  PartitionSelectOptions,
  SelectStrategy,
} from '../algebra/partition-types.js';
import type { WorkspaceEntry } from '../algebra/workspace-types.js';

// ── Configuration ──────────────────────────────────────────────

export interface PartitionWorkspaceConfig {
  id: PartitionId;
  capacity: number;
  policy: EvictionPolicy;
  /** Safety valve: if policy returns null at capacity, evict oldest entry. Default true. */
  safetyValve?: boolean;
}

// ── Token Estimation ───────────────────────────────────────────

/**
 * Rough token estimate for budget-aware selection.
 * String content: ~4 chars per token. Non-string: flat 50 tokens.
 */
function estimateTokens(entry: WorkspaceEntry): number {
  return typeof entry.content === 'string'
    ? Math.ceil(entry.content.length / 4)
    : 50;
}

// ── Partition Workspace ────────────────────────────────────────

export class PartitionWorkspace implements PartitionReadPort {
  readonly id: PartitionId;

  private readonly capacity: number;
  private readonly policy: EvictionPolicy;
  private readonly safetyValve: boolean;
  private entries: WorkspaceEntry[] = [];

  constructor(config: PartitionWorkspaceConfig) {
    this.id = config.id;
    this.capacity = config.capacity;
    this.policy = config.policy;
    this.safetyValve = config.safetyValve ?? true;
  }

  // ── PartitionReadPort ──────────────────────────────────────

  select(options?: PartitionSelectOptions): WorkspaceEntry[] {
    const strategy: SelectStrategy = options?.strategy ?? 'all';
    const types = options?.types;
    const budget = options?.budget;

    // 1. Filter by content types if specified.
    let filtered = types
      ? this.entries.filter((e) => e.contentType !== undefined && types.includes(e.contentType))
      : [...this.entries];

    // 2. Apply strategy sort.
    switch (strategy) {
      case 'recency':
        filtered.sort((a, b) => b.timestamp - a.timestamp);
        break;
      case 'salience':
        filtered.sort((a, b) => b.salience - a.salience);
        break;
      case 'diversity':
        // Placeholder: same as salience for now.
        // TODO(PRD 044 Phase 2): implement diversity-weighted selection.
        filtered.sort((a, b) => b.salience - a.salience);
        break;
      case 'all':
      default:
        // No sort — return in insertion order.
        break;
    }

    // 3. Apply budget truncation.
    if (budget !== undefined && budget > 0) {
      const result: WorkspaceEntry[] = [];
      let used = 0;
      for (const entry of filtered) {
        const cost = estimateTokens(entry);
        if (used + cost > budget && result.length > 0) break;
        result.push(entry);
        used += cost;
      }
      return result;
    }

    return filtered;
  }

  count(): number {
    return this.entries.length;
  }

  snapshot(): ReadonlyArray<WorkspaceEntry> {
    return [...this.entries];
  }

  // ── Write (called by PartitionSystem, not part of read port) ──

  /**
   * Write an entry to this partition.
   *
   * At capacity:
   *   1. Ask policy for an eviction candidate.
   *   2. If policy returns an index → evict that entry, then add.
   *   3. If policy returns null AND safetyValve → evict oldest entry, then add.
   *   4. If policy returns null AND !safetyValve → reject write (no-op).
   */
  write(entry: WorkspaceEntry): void {
    if (this.entries.length >= this.capacity) {
      const evictIndex = this.policy.selectForEviction(this.entries);

      if (evictIndex !== null) {
        this.entries.splice(evictIndex, 1);
      } else if (this.safetyValve) {
        // Safety valve: evict oldest entry.
        let oldestIndex = 0;
        let oldestTimestamp = this.entries[0].timestamp;
        for (let i = 1; i < this.entries.length; i++) {
          if (this.entries[i].timestamp < oldestTimestamp) {
            oldestTimestamp = this.entries[i].timestamp;
            oldestIndex = i;
          }
        }
        this.entries.splice(oldestIndex, 1);
      } else {
        // No safety valve, policy says no eviction → reject write.
        return;
      }
    }

    this.entries.push(entry);
  }

  // ── Cycle Management ───────────────────────────────────────

  /** Reset per-cycle state. Reserved for future per-cycle write quotas. */
  resetCycleQuotas(): void {
    // No per-cycle quotas yet — placeholder for PartitionSystem integration.
  }
}
