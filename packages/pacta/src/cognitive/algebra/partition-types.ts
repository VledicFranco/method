// SPDX-License-Identifier: Apache-2.0
/**
 * Partition Types — typed workspace partitions with independent eviction.
 *
 * RFC 003 Phase 1: split the monolithic workspace into Constraint, Operational,
 * and Task partitions. Each partition has its own eviction policy, capacity, and
 * deterministic monitor. Modules declare typed context selectors — each LLM call
 * loads only relevant entries from relevant partitions.
 *
 * All 7 surface interfaces are frozen (PRD 044 fcd-design session).
 */

import type { ModuleId } from './module.js';
import type { EntryContentType, WorkspaceEntry } from './workspace-types.js';

// ── Partition Identity ──────────────────────────────────────────

/** The three core partitions. */
export type PartitionId = 'constraint' | 'operational' | 'task';

// ── S-1: Eviction Policy ────────────────────────────────────────

/**
 * Pluggable eviction strategy for a partition workspace.
 *
 * Implementations:
 *   NoEvictionPolicy       — constraints never evicted (safety valve at maxEntries)
 *   RecencyEvictionPolicy  — oldest-timestamp-first
 *   GoalSalienceEvictionPolicy — strategies evicted before goals
 */
export interface EvictionPolicy {
  /** Select index of entry to evict, or null if none should be evicted. */
  selectForEviction(entries: ReadonlyArray<WorkspaceEntry>): number | null;
}

// ── S-2: Partition Read Port ────────────────────────────────────

/** Strategy for selecting entries within a budget. */
export type SelectStrategy = 'all' | 'recency' | 'salience' | 'diversity';

/** Options for partition entry selection. */
export interface PartitionSelectOptions {
  /** Filter by entry content types. */
  types?: EntryContentType[];
  /** Token budget (estimated). */
  budget?: number;
  /** Selection strategy. */
  strategy?: SelectStrategy;
}

/**
 * Read-only access to a single partition.
 *
 * The cycle orchestrator reads from partitions exclusively through this port.
 * Modules never access partition internals directly.
 */
export interface PartitionReadPort {
  /** Which partition this port reads from. */
  readonly id: PartitionId;
  /** Select entries matching the given options. */
  select(options?: PartitionSelectOptions): WorkspaceEntry[];
  /** Current entry count. */
  count(): number;
  /** Full readonly snapshot of partition state. */
  snapshot(): ReadonlyArray<WorkspaceEntry>;
}

// ── S-3: Context Selector ───────────────────────────────────────

/**
 * Per-module declaration of what context it needs.
 *
 * Wired at composition time — each module receives only the entries
 * matching its selector, not a monolithic workspace dump.
 */
export interface ContextSelector {
  /** Which partitions to query. */
  sources: PartitionId[];
  /** Optional: filter by entry content types. */
  types?: EntryContentType[];
  /** Maximum token budget for this module's context. */
  budget: number;
  /** How to select within the budget. */
  strategy: SelectStrategy;
}

// ── S-4: Partition Signal ───────────────────────────────────────

/** Types of signals emitted by per-partition monitors. */
export type PartitionSignalType =
  | 'constraint-violation'
  | 'stagnation'
  | 'goal-stale'
  | 'capacity-warning';

/**
 * Typed signal from a per-partition deterministic monitor.
 *
 * Severity drives the cycle orchestrator's response:
 *   critical → RESTRICT + REPLAN (e.g., constraint violation)
 *   high     → REPLAN if persistent (e.g., repeated stagnation)
 *   medium   → flag for next cycle (e.g., goal staleness)
 *   low      → log only (e.g., capacity warning)
 */
export interface PartitionSignal {
  severity: 'critical' | 'high' | 'medium' | 'low';
  partition: PartitionId;
  type: PartitionSignalType;
  detail: string;
}

// ── S-5: Entry Router ───────────────────────────────────────────

/**
 * Classifies entries into the correct partition.
 *
 * The rule-based implementation wraps classifyEntry (PRD 043)
 * with the D3 rule: tool results always route to 'operational'.
 */
export interface EntryRouter {
  /** Route an entry to its target partition. */
  route(content: unknown, source: ModuleId): PartitionId;
}

// ── S-7: Partition Monitor ──────────────────────────────────────

/** Context provided to per-partition monitor functions. */
export interface PartitionMonitorContext {
  /** Current cycle number. */
  cycleNumber: number;
  /** Last cycle a write occurred in each partition. */
  lastWriteCycle: Map<PartitionId, number>;
  /** Actor output from the current cycle (for constraint violation checking). */
  actorOutput?: string;
}

/**
 * Deterministic monitor co-located with a partition.
 *
 * Not a CognitiveModule — a pure function that produces PartitionSignals.
 */
export interface PartitionMonitor {
  /** Check partition entries and produce signals. */
  check(
    entries: ReadonlyArray<WorkspaceEntry>,
    context: PartitionMonitorContext,
  ): PartitionSignal[];
}

// ── S-8: Partition Write Adapter (PRD 045) ─────────────────────

/**
 * Adapts WorkspaceWritePort to route writes through a PartitionSystem.
 *
 * Modules call write(entry) as before. The adapter:
 * 1. Calls partitionSystem.write(entry, source) — EntryRouter classifies and stores
 * 2. Tracks which partition received the write (for partitionLastWriteCycle)
 *
 * Created by the cycle orchestrator and injected into modules when partitions
 * are enabled. Satisfies the WorkspaceWritePort interface so modules are unaware
 * of the partition routing happening underneath.
 */
export interface PartitionWriteAdapter {
  /** Write an entry, routing through the partition system's EntryRouter. */
  write(entry: WorkspaceEntry): void;

  /** Returns which partitions received writes since last reset. Map<PartitionId, cycleNumber>. */
  getWrittenPartitions(): Map<PartitionId, number>;

  /** Reset per-cycle write tracking. Called at cycle start. */
  resetCycleTracking(): void;
}

// ── S-9: Type Resolver (PRD 045) ───────────────────────────────

/**
 * Resolves entry content types to the partitions that store them.
 *
 * Uses partition configs as the registry. The mapping is static — derived
 * from partition definitions at system creation time. Decouples modules
 * from partition identity (RFC 003 Q5).
 *
 * Resolution rules (current):
 *   'constraint'  → ['constraint']
 *   'goal'        → ['task']
 *   'operational'  → ['operational']
 */
export interface TypeResolver {
  /** Given entry content types, return the partitions that accept entries of those types. */
  resolve(types: EntryContentType[]): PartitionId[];
}

// ── S-10: Module Context Binding (PRD 045) ─────────────────────

/**
 * A module's declaration of what context it needs from the workspace.
 *
 * Expressed in entry content types — decoupled from partition identity.
 * The cycle orchestrator uses TypeResolver to map types → partitions,
 * then builds a ContextSelector to query the PartitionSystem.
 *
 * Replaces the hardcoded DEFAULT_MODULE_SELECTORS in the cycle with
 * per-module declarations co-located with each module factory.
 */
export interface ModuleContextBinding {
  /** What entry types this module needs to see. */
  types: EntryContentType[];

  /** Maximum token budget for this module's context window. */
  budget: number;

  /** Selection strategy within the budget. */
  strategy: SelectStrategy;
}

// ── S-6: Partition System ───────────────────────────────────────

/**
 * Aggregate of all partitions — the top-level interface the cycle
 * orchestrator uses to replace the monolithic workspace.
 *
 * write() routes entries via EntryRouter.
 * buildContext() assembles per-module context from selected partitions.
 * checkPartitions() runs all partition monitors and aggregates signals.
 */
export interface PartitionSystem {
  /** Get a read port for a specific partition. */
  getPartition(id: PartitionId): PartitionReadPort;

  /** Route and write an entry to the appropriate partition. Returns the partition it was written to. */
  write(entry: WorkspaceEntry, source: ModuleId): PartitionId;

  /** Build typed context for a module based on its selector. */
  buildContext(selector: ContextSelector): WorkspaceEntry[];

  /** Run all partition monitors and return aggregated signals. */
  checkPartitions(context: PartitionMonitorContext): PartitionSignal[];

  /** Readonly snapshot of all entries across all partitions (backward compat). */
  snapshot(): ReadonlyArray<WorkspaceEntry>;

  /** Reset per-cycle write quotas (called at cycle start). */
  resetCycleQuotas(): void;
}
