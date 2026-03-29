/**
 * InMemoryDualStore — in-memory implementation of MemoryPortV3.
 *
 * Provides episodic (fast, FIFO) and semantic (slow, activation-eviction)
 * stores with ACT-R activation-based retrieval. The consolidation method
 * is a passthrough stub — actual consolidation logic lives in the
 * Consolidation module (C-4).
 *
 * Grounded in: Complementary Learning Systems (CLS) theory,
 * ACT-R declarative memory (PRD 036).
 */

import type {
  MemoryPortV3,
  MemoryEntry,
  EpisodicEntry,
  SemanticEntry,
  DualStoreConfig,
  ActivationConfig,
  ConsolidationConfig,
  ConsolidationResult,
} from '../../ports/memory-port.js';
import { computeActivation } from './activation.js';

// ── Factory ─────────────────────────────────────────────────────

/**
 * Create an in-memory dual-store implementing MemoryPortV3.
 *
 * @param config - Dual-store capacity and encoding configuration.
 * @param activationConfig - ACT-R activation parameters.
 * @returns A MemoryPortV3 implementation backed by in-memory arrays.
 */
export function createInMemoryDualStore(
  config: DualStoreConfig,
  activationConfig: ActivationConfig,
): MemoryPortV3 {
  // Internal stores
  const episodicStore: EpisodicEntry[] = [];
  const semanticStore: SemanticEntry[] = [];

  // Legacy key-value map for backward compatibility
  const kvStore = new Map<string, string>();

  return {
    // ── Legacy MemoryPort methods (backward compat) ───────────

    async store(key: string, value: string): Promise<void> {
      kvStore.set(key, value);
    },

    async retrieve(key: string): Promise<string | null> {
      return kvStore.get(key) ?? null;
    },

    async search(query: string, limit?: number): Promise<MemoryEntry[]> {
      const results: MemoryEntry[] = [];
      const max = limit ?? 10;
      for (const [key, value] of kvStore) {
        if (value.includes(query) || key.includes(query)) {
          results.push({ key, value });
          if (results.length >= max) break;
        }
      }
      return results;
    },

    // ── Episodic Store ────────────────────────────────────────

    async storeEpisodic(episode: EpisodicEntry): Promise<void> {
      // FIFO eviction: remove oldest if at capacity
      if (episodicStore.length >= config.episodic.capacity) {
        episodicStore.shift();
      }
      episodicStore.push(episode);
    },

    async retrieveEpisodic(id: string): Promise<EpisodicEntry | null> {
      const entry = episodicStore.find((e) => e.id === id);
      if (!entry) return null;
      // Increment access count and update lastAccessed on retrieval
      entry.accessCount++;
      entry.lastAccessed = Date.now();
      return entry;
    },

    async allEpisodic(): Promise<EpisodicEntry[]> {
      return [...episodicStore];
    },

    async expireEpisodic(id: string): Promise<void> {
      const idx = episodicStore.findIndex((e) => e.id === id);
      if (idx !== -1) {
        episodicStore.splice(idx, 1);
      }
    },

    // ── Semantic Store ────────────────────────────────────────

    async storeSemantic(pattern: SemanticEntry): Promise<void> {
      // Evict lowest-activation entry if at capacity
      if (semanticStore.length >= config.semantic.capacity) {
        const now = Date.now();
        let lowestIdx = 0;
        let lowestActivation = Infinity;
        for (let i = 0; i < semanticStore.length; i++) {
          const act = computeActivation(semanticStore[i], [], now, activationConfig);
          if (act < lowestActivation) {
            lowestActivation = act;
            lowestIdx = i;
          }
        }
        semanticStore.splice(lowestIdx, 1);
      }
      semanticStore.push(pattern);
    },

    async retrieveSemantic(id: string): Promise<SemanticEntry | null> {
      const entry = semanticStore.find((e) => e.id === id);
      return entry ?? null;
    },

    async allSemantic(): Promise<SemanticEntry[]> {
      return [...semanticStore];
    },

    async updateSemantic(
      id: string,
      updates: Partial<Pick<SemanticEntry, 'confidence' | 'activationBase' | 'tags' | 'pattern'>>,
    ): Promise<void> {
      const entry = semanticStore.find((e) => e.id === id);
      if (!entry) return;
      if (updates.confidence !== undefined) entry.confidence = updates.confidence;
      if (updates.activationBase !== undefined) entry.activationBase = updates.activationBase;
      if (updates.tags !== undefined) entry.tags = updates.tags;
      if (updates.pattern !== undefined) entry.pattern = updates.pattern;
      entry.updated = Date.now();
    },

    async expireSemantic(id: string): Promise<void> {
      const idx = semanticStore.findIndex((e) => e.id === id);
      if (idx !== -1) {
        semanticStore.splice(idx, 1);
      }
    },

    // ── Activation-Based Retrieval ────────────────────────────

    async searchByActivation(
      context: string[],
      limit: number,
    ): Promise<(EpisodicEntry | SemanticEntry)[]> {
      const now = Date.now();
      const scored: Array<{ entry: EpisodicEntry | SemanticEntry; activation: number }> = [];

      // Score all episodic entries
      for (const entry of episodicStore) {
        const activation = computeActivation(entry, context, now, activationConfig);
        if (activation >= activationConfig.retrievalThreshold) {
          scored.push({ entry, activation });
        }
      }

      // Score all semantic entries
      for (const entry of semanticStore) {
        const activation = computeActivation(entry, context, now, activationConfig);
        if (activation >= activationConfig.retrievalThreshold) {
          scored.push({ entry, activation });
        }
      }

      // Sort by activation descending
      scored.sort((a, b) => b.activation - a.activation);

      // Take top `limit` entries
      const results = scored.slice(0, limit).map((s) => s.entry);

      // Increment accessCount and update lastAccessed for returned episodic entries
      for (const entry of results) {
        if ('accessCount' in entry && 'lastAccessed' in entry) {
          (entry as EpisodicEntry).accessCount++;
          (entry as EpisodicEntry).lastAccessed = now;
        }
      }

      return results;
    },

    // ── Consolidation Stub ────────────────────────────────────

    async consolidate(_config: ConsolidationConfig): Promise<ConsolidationResult> {
      // Passthrough stub — actual consolidation logic lives in C-4
      return {
        semanticUpdates: 0,
        conflictsDetected: 0,
        compressionRatio: 0,
        entriesPruned: 0,
        episodesReplayed: 0,
        durationMs: 0,
      };
    },
  };
}
