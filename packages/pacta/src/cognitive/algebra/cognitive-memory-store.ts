/**
 * CognitiveMemoryStore — unified memory architecture (RFC 006 Part III).
 *
 * Replaces bounded partitioned workspaces with an unbounded store where every
 * write is a memory store and every read is an activation-based retrieval query.
 * Nothing is ever destructively evicted — activation decays but entries remain
 * retrievable when spreading activation cues match.
 *
 * Grounded in Cowan's embedded-processes model (1999, 2001): working memory is
 * the activated subset of long-term memory, not a separate buffer. The "capacity
 * limit" is an attention bottleneck (retrieval budget), not a container size.
 *
 * @see docs/rfcs/006-anticipatory-monitoring.md — Part III
 */

import type { WorkspaceEntry, ReadonlyWorkspaceSnapshot } from './workspace-types.js';
import type { ModuleId } from './module.js';

// ── Types ─────────────────────────────────────────────────────

/** Partition role — retrieval filter tag, not a capacity-limited bin. */
export type PartitionRole = 'constraint' | 'operational' | 'task' | 'goal' | 'memory';

/** Entry in the unified store. */
export interface MemoryStoreEntry {
  /** Unique ID. */
  id: string;
  /** The workspace entry content. */
  entry: WorkspaceEntry;
  /** Role tag for retrieval filtering. */
  role: PartitionRole;
  /** Source module that stored this entry. */
  source: ModuleId;
  /** Timestamp of initial storage. */
  storedAt: number;
  /** Number of times retrieved. Feeds base-level activation. */
  accessCount: number;
  /** Last retrieval timestamp. */
  lastAccessed: number;
  /** Context tags for tag-based spreading activation. */
  tags: string[];
  /** Whether this entry has been marked expired (stale invalidation). */
  expired: boolean;
}

/** Per-module retrieval query. */
export interface RetrievalQuery {
  /** Requesting module. */
  module: ModuleId;
  /** Role filter (optional — retrieve from specific roles or all). */
  roles?: PartitionRole[];
  /** Token budget for the result. */
  budget: number;
  /** Spreading activation cues — content-based term matching. */
  cues: string[];
  /** Minimum activation threshold. Default: -1.0 */
  threshold?: number;
}

/** Configuration for the store. */
export interface CognitiveMemoryStoreConfig {
  /** Spreading activation weight for content-term matches. Default: 0.15 */
  contentSpreadingWeight?: number;
  /** Spreading activation weight for tag matches. Default: 0.3 */
  tagSpreadingWeight?: number;
  /** Base-level activation decay parameter. Default: 0.5 */
  decayRate?: number;
  /** Noise amplitude for retrieval variability. Default: 0.05 */
  noiseAmplitude?: number;
  /** Age gating: don't retrieve entries stored within this many ms. Default: 0 */
  ageGateMs?: number;
}

// ── Term Extraction ───────────────────────────────────────────

/** Extract meaningful terms from text for content-based spreading activation. */
function extractTerms(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z][a-z0-9_]{2,}/g) ?? [];
  const stops = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'your', 'you',
    'are', 'was', 'were', 'has', 'have', 'had', 'not', 'but', 'can',
    'will', 'should', 'must', 'may', 'use', 'using', 'used',
    'file', 'files', 'code', 'task', 'make', 'sure', 'any', 'been',
    'into', 'also', 'each', 'which', 'then', 'than', 'when', 'what',
  ]);
  return new Set(words.filter(w => !stops.has(w)));
}

// ── Activation Scoring ────────────────────────────────────────

function computeStoreActivation(
  entry: MemoryStoreEntry,
  cueTerms: Set<string>,
  now: number,
  config: Required<CognitiveMemoryStoreConfig>,
): number {
  // 1. Base-level activation: log(accessCount / sqrt(ageSec))
  const ageMs = now - entry.lastAccessed;
  const ageSec = Math.max(1, ageMs / 1000);
  const baseLevelActivation = Math.log(Math.max(1, entry.accessCount) / Math.pow(ageSec, config.decayRate));

  // 2. Content-based spreading activation: term overlap with entry content
  const entryContent = typeof entry.entry.content === 'string'
    ? entry.entry.content : JSON.stringify(entry.entry.content);
  const entryTerms = extractTerms(entryContent);
  let contentOverlap = 0;
  for (const cue of cueTerms) {
    if (entryTerms.has(cue)) contentOverlap++;
  }
  const contentSpread = cueTerms.size > 0
    ? (contentOverlap / cueTerms.size) * config.contentSpreadingWeight * 5 // scale up to be meaningful
    : 0;

  // 3. Tag-based spreading activation (classic ACT-R)
  let tagOverlap = 0;
  for (const cue of cueTerms) {
    if (entry.tags.some(t => t.includes(cue.toString()))) tagOverlap++;
  }
  const tagSpread = tagOverlap * config.tagSpreadingWeight;

  // 4. Noise
  const noise = (Math.random() - 0.5) * config.noiseAmplitude;

  return baseLevelActivation + contentSpread + tagSpread + noise;
}

// ── Store Implementation ──────────────────────────────────────

export interface CognitiveMemoryStore {
  /** Store an entry. */
  store(entry: WorkspaceEntry, role: PartitionRole, source: ModuleId, tags?: string[]): void;

  /** Retrieve entries relevant to a query. Returns as workspace snapshot. */
  retrieve(query: RetrievalQuery): ReadonlyWorkspaceSnapshot;

  /** Expire entries matching a predicate (stale invalidation). */
  expire(predicate: (entry: MemoryStoreEntry) => boolean): number;

  /** Total entries in store. */
  size(): number;

  /** All entries (for debugging). */
  allEntries(): MemoryStoreEntry[];
}

/**
 * Create a CognitiveMemoryStore — the unified memory that replaces partitions.
 */
export function createCognitiveMemoryStore(
  config?: CognitiveMemoryStoreConfig,
): CognitiveMemoryStore {
  const cfg: Required<CognitiveMemoryStoreConfig> = {
    contentSpreadingWeight: config?.contentSpreadingWeight ?? 0.15,
    tagSpreadingWeight: config?.tagSpreadingWeight ?? 0.3,
    decayRate: config?.decayRate ?? 0.5,
    noiseAmplitude: config?.noiseAmplitude ?? 0.05,
    ageGateMs: config?.ageGateMs ?? 0,
  };

  const entries: MemoryStoreEntry[] = [];
  let idCounter = 0;

  return {
    store(entry: WorkspaceEntry, role: PartitionRole, source: ModuleId, tags?: string[]): void {
      const content = typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content);
      // Auto-extract tags from content (file paths, identifiers)
      const autoTags = tags ?? [];
      const pathMatch = content.match(/[\w/.-]+\.\w{1,4}/g);
      if (pathMatch) autoTags.push(...pathMatch.slice(0, 5));

      const now = Date.now();
      entries.push({
        id: `cms-${idCounter++}`,
        entry,
        role,
        source,
        storedAt: now,
        accessCount: 1,
        lastAccessed: now,
        tags: autoTags,
        expired: false,
      });
    },

    retrieve(query: RetrievalQuery): ReadonlyWorkspaceSnapshot {
      const now = Date.now();
      const cueTerms = new Set<string>();
      for (const cue of query.cues) {
        for (const term of extractTerms(cue)) {
          cueTerms.add(term);
        }
      }

      const threshold = query.threshold ?? -1.0;

      // Score all non-expired entries
      const scored: Array<{ entry: MemoryStoreEntry; activation: number }> = [];
      for (const e of entries) {
        if (e.expired) continue;
        if (query.roles && !query.roles.includes(e.role)) continue;
        if (cfg.ageGateMs > 0 && (now - e.storedAt) < cfg.ageGateMs) continue;

        const activation = computeStoreActivation(e, cueTerms, now, cfg);
        if (activation >= threshold) {
          scored.push({ entry: e, activation });
        }
      }

      // Sort by activation descending
      scored.sort((a, b) => b.activation - a.activation);

      // Select entries within token budget
      const result: WorkspaceEntry[] = [];
      let tokensUsed = 0;
      for (const { entry: se } of scored) {
        const content = typeof se.entry.content === 'string'
          ? se.entry.content : JSON.stringify(se.entry.content);
        const entryTokens = Math.ceil(content.length / 4);

        if (tokensUsed + entryTokens > query.budget) {
          // Try to fit — if we haven't added anything yet, add at least one
          if (result.length === 0) {
            result.push(se.entry);
            se.accessCount++;
            se.lastAccessed = now;
          }
          break;
        }

        result.push(se.entry);
        tokensUsed += entryTokens;
        se.accessCount++;
        se.lastAccessed = now;
      }

      return result;
    },

    expire(predicate: (entry: MemoryStoreEntry) => boolean): number {
      let count = 0;
      for (const e of entries) {
        if (!e.expired && predicate(e)) {
          e.expired = true;
          count++;
        }
      }
      return count;
    },

    size(): number {
      return entries.filter(e => !e.expired).length;
    },

    allEntries(): MemoryStoreEntry[] {
      return [...entries];
    },
  };
}
