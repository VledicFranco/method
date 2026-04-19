// SPDX-License-Identifier: Apache-2.0
/**
 * Workspace Types — port-mediated access to the shared cognitive workspace.
 *
 * Modules interact with the workspace through typed, per-module port interfaces.
 * The workspace engine enforces access contracts: per-module write quotas,
 * salience normalization, capacity bounds, and TTL-based expiry.
 *
 * Grounded in: GWT competitive workspace access, ACT-R buffer-mediated parallelism.
 */

import type { ModuleId } from './module.js';

// ── Entry Content Classification ────────────────────────────────

/** Closed union for content classification — prevents classifier drift (PRD 043 D7). */
export type EntryContentType = 'constraint' | 'goal' | 'operational';

// ── Workspace Entry ──────────────────────────────────────────────

/** A single entry in the cognitive workspace. */
export interface WorkspaceEntry {
  /** Which module wrote this entry. */
  source: ModuleId;

  /** The entry payload — opaque to the workspace engine. */
  content: unknown;

  /** Salience score (0-1). Computed by SalienceFunction, not trusted from modules. */
  salience: number;

  /** When this entry was written. */
  timestamp: number;

  /** Time-to-live in milliseconds. Entry expires after timestamp + ttl. */
  ttl?: number;

  /** Pinned entries are exempt from capacity eviction. */
  pinned?: boolean;

  /** Content classification for typed workspace entries (PRD 043). */
  contentType?: EntryContentType;
}

// ── Workspace Filter ─────────────────────────────────────────────

/** Filter criteria for workspace reads. */
export interface WorkspaceFilter {
  /** Filter by source module. */
  source?: ModuleId;

  /** Minimum salience threshold. */
  minSalience?: number;

  /** Filter by content type (application-defined). */
  contentType?: string;
}

// ── Readonly Snapshot ────────────────────────────────────────────

/** Readonly snapshot of workspace state — safe to pass across module boundaries. */
export type ReadonlyWorkspaceSnapshot = ReadonlyArray<Readonly<WorkspaceEntry>>;

// ── Workspace Ports ──────────────────────────────────────────────

/** Read access to the workspace — scoped per module at composition time. */
export interface WorkspaceReadPort<T extends WorkspaceEntry = WorkspaceEntry> {
  /** Read entries matching the optional filter. */
  read(filter?: WorkspaceFilter): T[];

  /** Attention-budget read: return top entries by salience within the budget. */
  attend(budget: number): T[];

  /** Produce a readonly snapshot of the current workspace state. */
  snapshot(): ReadonlyWorkspaceSnapshot;
}

/** Write access to the workspace — scoped per module at composition time. */
export interface WorkspaceWritePort<T extends WorkspaceEntry = WorkspaceEntry> {
  /** Write an entry to the workspace. Subject to per-module quotas. */
  write(entry: T): void;
}

// ── Selection History (PRD 035 — PriorityAttend) ────────────────

/** Outcome of attending to a workspace entry — used for history-based biasing. */
export interface SelectionOutcome {
  /** Hash or ID of the workspace entry that was attended. */
  entryHash: string;
  /** Whether attending this entry led to a successful action. */
  outcome: 'positive' | 'negative' | 'neutral';
  /** When the outcome was recorded. */
  timestamp: number;
}

// ── Salience ─────────────────────────────────────────────────────

/** Context provided to the salience function for computing entry salience. */
export interface SalienceContext {
  /** Current timestamp. */
  now: number;

  /** Active goals (from the agent's task). */
  goals: string[];

  /** Priority weights per source module. */
  sourcePriorities: Map<ModuleId, number>;

  /** Selection outcomes for history-based biasing (PRD 035 — PriorityAttend). */
  selectionOutcomes?: SelectionOutcome[];

  /** Active subgoals from the planner (PRD 035 — PriorityAttend). */
  activeSubgoals?: string[];
}

/** Pluggable salience computation function. */
export type SalienceFunction = (entry: WorkspaceEntry, context: SalienceContext) => number;

// ── Workspace Config ─────────────────────────────────────────────

/** Configuration for workspace initialization. */
export interface WorkspaceConfig {
  /** Maximum number of entries the workspace can hold. */
  capacity: number;

  /** Custom salience function. Falls back to default formula if not provided. */
  salience?: SalienceFunction;

  /** Maximum entries a single module may write per cycle. */
  writeQuotaPerModule?: number;

  /** Default TTL in milliseconds for entries without explicit TTL. */
  defaultTtl?: number;

  /** Maximum number of pinned entries before safety-valve eviction (default: 10). */
  maxPinnedEntries?: number;
}
