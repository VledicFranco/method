/**
 * Workspace Engine — port-mediated access to the shared cognitive workspace.
 *
 * `createWorkspace(config)` returns a WorkspaceManager that provides typed,
 * per-module read/write ports. The engine enforces:
 *   - Salience computation (pluggable SalienceFunction, default formula)
 *   - Capacity bounds with lowest-salience eviction (FIFO tie-breaking)
 *   - Per-module write quotas
 *   - TTL-based expiry
 *   - Write logging for observability
 *
 * Grounded in: GWT competitive workspace access, ACT-R buffer-mediated parallelism.
 */

import type { ModuleId } from './module.js';
import type {
  WorkspaceEntry,
  WorkspaceFilter,
  WorkspaceReadPort,
  WorkspaceWritePort,
  WorkspaceConfig,
  SalienceFunction,
  SalienceContext,
  ReadonlyWorkspaceSnapshot,
} from './workspace-types.js';

// ── Eviction Info ──────────────────────────────────────────────

/** Information about an entry that was evicted from the workspace. */
export interface EvictionInfo {
  /** The entry that was evicted. */
  entry: WorkspaceEntry;
  /** Reason for eviction. */
  reason: 'capacity' | 'ttl';
  /** Salience of the evicted entry at eviction time. */
  salience: number;
  /** Salience difference between the evicted entry and the surviving entry (for capacity evictions). */
  salienceDelta?: number;
  /** When the eviction occurred. */
  timestamp: number;
}

// ── Write Log Entry ────────────────────────────────────────────

/** Record of a single write operation. */
export interface WriteLogEntry {
  /** Which module performed the write. */
  moduleId: ModuleId;
  /** The entry that was written. */
  entry: WorkspaceEntry;
  /** When the write occurred. */
  timestamp: number;
  /** Whether an eviction was triggered. */
  eviction?: EvictionInfo;
}

// ── Workspace Manager ──────────────────────────────────────────

/** The workspace manager — returned by createWorkspace. */
export interface WorkspaceManager {
  /** Get a read port scoped to a module. */
  getReadPort(moduleId: ModuleId): WorkspaceReadPort;
  /** Get a write port scoped to a module. */
  getWritePort(moduleId: ModuleId): WorkspaceWritePort;
  /** Reset per-module write quotas (called between cycles). */
  resetCycleQuotas(): void;
  /** Get all eviction events since last reset/creation. */
  getEvictions(): readonly EvictionInfo[];
  /** Get the full write log. */
  getWriteLog(): readonly WriteLogEntry[];
  /** Get a snapshot of the current workspace state. */
  snapshot(): ReadonlyWorkspaceSnapshot;
  /** Attend: return top-N entries by salience within the budget. */
  attend(budget: number): WorkspaceEntry[];
}

// ── Default Salience Components ────────────────────────────────

/** Exponential decay based on age. 1-minute half-life. */
export function recencyScore(entry: WorkspaceEntry, now: number): number {
  const age = now - entry.timestamp;
  return Math.exp(-age / 60000);
}

/** Lookup source priority from the priority map. Default 0.5. */
export function sourcePriority(entry: WorkspaceEntry, priorities: Map<ModuleId, number>): number {
  return priorities.get(entry.source) ?? 0.5;
}

/** Simple word overlap ratio between entry content (stringified) and goals. */
export function goalOverlap(entry: WorkspaceEntry, goals: string[]): number {
  if (goals.length === 0) return 0;

  const contentStr = typeof entry.content === 'string'
    ? entry.content
    : JSON.stringify(entry.content);

  const contentWords = new Set(contentStr.toLowerCase().split(/\s+/));
  const goalWords = new Set(goals.join(' ').toLowerCase().split(/\s+/));

  if (goalWords.size === 0) return 0;

  let overlap = 0;
  for (const word of goalWords) {
    if (contentWords.has(word)) overlap++;
  }

  return overlap / goalWords.size;
}

/** Default salience function: 0.4 * recency + 0.3 * source + 0.3 * goal. */
export function defaultSalienceFunction(entry: WorkspaceEntry, context: SalienceContext): number {
  const recency = recencyScore(entry, context.now);
  const source = sourcePriority(entry, context.sourcePriorities);
  const goal = goalOverlap(entry, context.goals);
  return 0.4 * recency + 0.3 * source + 0.3 * goal;
}

// ── Epsilon for Salience Comparison ────────────────────────────

const SALIENCE_EPSILON = 0.001;

// ── Factory ────────────────────────────────────────────────────

/**
 * Create a workspace engine with the given configuration.
 *
 * @param config - Workspace configuration (capacity, salience function, quotas, TTL).
 * @param salienceContext - Context for salience computation (goals, priorities, time).
 *                          The `now` field is updated on each operation.
 */
export function createWorkspace(
  config: WorkspaceConfig,
  salienceContext: SalienceContext,
): WorkspaceManager {
  const salienceFn: SalienceFunction = config.salience ?? defaultSalienceFunction;
  const entries: WorkspaceEntry[] = [];
  const writeLog: WriteLogEntry[] = [];
  const evictions: EvictionInfo[] = [];
  const writeCounts = new Map<ModuleId, number>();

  // ── Internal Helpers ─────────────────────────────────────────

  /** Expire entries whose TTL has elapsed. Returns eviction infos. */
  function expireTtl(now: number): void {
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      const ttl = entry.ttl ?? config.defaultTtl;
      if (ttl !== undefined && (entry.timestamp + ttl) <= now) {
        entries.splice(i, 1);
        evictions.push({
          entry,
          reason: 'ttl',
          salience: entry.salience,
          timestamp: now,
        });
      }
    }
  }

  /** Recompute salience for all entries. */
  function recomputeSalience(now: number): void {
    const ctx: SalienceContext = { ...salienceContext, now };
    for (const entry of entries) {
      entry.salience = salienceFn(entry, ctx);
    }
  }

  /** Evict the lowest-salience entry. FIFO tie-breaking (oldest first). */
  function evictLowest(now: number, triggeringSalience?: number): EvictionInfo | undefined {
    if (entries.length === 0) return undefined;

    let lowestIdx = 0;
    let lowestSalience = entries[0].salience;
    let lowestTimestamp = entries[0].timestamp;

    for (let i = 1; i < entries.length; i++) {
      const entry = entries[i];
      const diff = entry.salience - lowestSalience;

      if (diff < -SALIENCE_EPSILON) {
        // Strictly lower salience
        lowestIdx = i;
        lowestSalience = entry.salience;
        lowestTimestamp = entry.timestamp;
      } else if (Math.abs(diff) <= SALIENCE_EPSILON && entry.timestamp < lowestTimestamp) {
        // Equal salience within epsilon — FIFO: evict oldest
        lowestIdx = i;
        lowestSalience = entry.salience;
        lowestTimestamp = entry.timestamp;
      }
    }

    const evicted = entries.splice(lowestIdx, 1)[0];
    const info: EvictionInfo = {
      entry: evicted,
      reason: 'capacity',
      salience: evicted.salience,
      salienceDelta: triggeringSalience !== undefined
        ? triggeringSalience - evicted.salience
        : undefined,
      timestamp: now,
    };
    evictions.push(info);
    return info;
  }

  // ── Port Factories ───────────────────────────────────────────

  function getReadPort(_moduleId: ModuleId): WorkspaceReadPort {
    return {
      read(filter?: WorkspaceFilter): WorkspaceEntry[] {
        const now = Date.now();
        expireTtl(now);
        recomputeSalience(now);

        return entries.filter((entry) => {
          if (filter?.source && entry.source !== filter.source) return false;
          if (filter?.minSalience !== undefined && entry.salience < filter.minSalience) return false;
          return true;
        });
      },

      attend(budget: number): WorkspaceEntry[] {
        const now = Date.now();
        expireTtl(now);
        recomputeSalience(now);

        // Sort by salience descending, FIFO tie-breaking (newest first for attend)
        const sorted = [...entries].sort((a, b) => {
          const diff = b.salience - a.salience;
          if (Math.abs(diff) > SALIENCE_EPSILON) return diff;
          return b.timestamp - a.timestamp; // newer first
        });

        return sorted.slice(0, budget);
      },

      snapshot(): ReadonlyWorkspaceSnapshot {
        const now = Date.now();
        expireTtl(now);
        recomputeSalience(now);

        return entries.map((e) => ({ ...e }));
      },
    };
  }

  function getWritePort(moduleId: ModuleId): WorkspaceWritePort {
    return {
      write(entry: WorkspaceEntry): void {
        const now = Date.now();

        // Expire TTL entries first
        expireTtl(now);

        // Check per-module write quota
        if (config.writeQuotaPerModule !== undefined) {
          const count = writeCounts.get(moduleId) ?? 0;
          if (count >= config.writeQuotaPerModule) {
            throw new Error(
              `Module ${moduleId} exceeded write quota: ${count}/${config.writeQuotaPerModule}`,
            );
          }
        }

        // Compute salience for the new entry
        const ctx: SalienceContext = { ...salienceContext, now };
        const newEntry: WorkspaceEntry = {
          ...entry,
          source: moduleId,
          salience: salienceFn(entry, ctx),
          timestamp: entry.timestamp || now,
        };

        // Recompute salience for existing entries
        recomputeSalience(now);

        // Capacity enforcement — evict lowest if at capacity
        let evictionInfo: EvictionInfo | undefined;
        if (entries.length >= config.capacity) {
          evictionInfo = evictLowest(now, newEntry.salience);
        }

        // Add the new entry
        entries.push(newEntry);

        // Record write
        const count = writeCounts.get(moduleId) ?? 0;
        writeCounts.set(moduleId, count + 1);

        writeLog.push({
          moduleId,
          entry: newEntry,
          timestamp: now,
          eviction: evictionInfo,
        });
      },
    };
  }

  // ── Manager Interface ────────────────────────────────────────

  return {
    getReadPort,
    getWritePort,

    resetCycleQuotas(): void {
      writeCounts.clear();
    },

    getEvictions(): readonly EvictionInfo[] {
      return [...evictions];
    },

    getWriteLog(): readonly WriteLogEntry[] {
      return [...writeLog];
    },

    snapshot(): ReadonlyWorkspaceSnapshot {
      const now = Date.now();
      expireTtl(now);
      recomputeSalience(now);
      return entries.map((e) => ({ ...e }));
    },

    attend(budget: number): WorkspaceEntry[] {
      const now = Date.now();
      expireTtl(now);
      recomputeSalience(now);

      const sorted = [...entries].sort((a, b) => {
        const diff = b.salience - a.salience;
        if (Math.abs(diff) > SALIENCE_EPSILON) return diff;
        return b.timestamp - a.timestamp;
      });

      return sorted.slice(0, budget);
    },
  };
}
