/**
 * Offline Consolidation Engine — interleaved replay, schema consistency,
 * compression, and pruning for the CLS dual-store.
 *
 * Runs outside the cognitive loop (between sessions or on explicit trigger).
 * Transforms high-fidelity episodic traces into generalized semantic patterns
 * through a multi-phase process grounded in CLS theory (PRD 036).
 *
 * Algorithm phases:
 *   1. Interleaved sampling — mix recent + old episodes for replay
 *   2. Schema consistency checking — Jaccard similarity on tag sets
 *   3. Compression — truncate old episodic entries beyond capacity
 *   4. Pruning — remove low-activation semantic entries
 *
 * Grounded in: Complementary Learning Systems (McClelland et al. 1995),
 * ACT-R declarative memory consolidation (Anderson 1993), PRD 036.
 */

import type {
  MemoryPortV3,
  EpisodicEntry,
  SemanticEntry,
  ConsolidationConfig,
  ConsolidationResult,
} from '../../ports/memory-port.js';
import { computeActivation, defaultActivationConfig } from '../modules/activation.js';

// ── Configuration ───────────────────────────────────────────────

/** Extended options for the offline consolidation engine. */
export interface OfflineConsolidationOptions {
  /**
   * Minimum Jaccard similarity for schema-consistent fast-tracking.
   * Episodes with overlap >= this threshold against any semantic entry
   * are considered schema-consistent. Default: 0.8.
   */
  schemaConsistencyThreshold?: number;

  /**
   * Maximum episodic store capacity. When the store exceeds this
   * after replay, oldest entries beyond capacity are compressed.
   * Default: 50 (matches DualStoreConfig default).
   */
  episodicCapacity?: number;
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Compute Jaccard similarity between two tag sets.
 * Tags are lowercased and deduplicated before comparison.
 *
 * J(A, B) = |A ∩ B| / |A ∪ B|
 * Returns 0 when both sets are empty.
 */
export function jaccardSimilarity(tagsA: string[], tagsB: string[]): number {
  const setA = new Set(tagsA.map((t) => t.toLowerCase()));
  const setB = new Set(tagsB.map((t) => t.toLowerCase()));

  if (setA.size === 0 && setB.size === 0) return 0;

  let intersection = 0;
  for (const tag of setA) {
    if (setB.has(tag)) intersection++;
  }

  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

/**
 * Sample an interleaved batch of episodes: a mix of recent and older entries.
 *
 * @param episodes - All episodic entries (will be sorted internally).
 * @param count - Total number of episodes to sample.
 * @param interleaveRatio - Fraction that should be recent (0-1).
 * @returns Sampled episodes (recent first, then older).
 */
export function sampleInterleavedBatch(
  episodes: EpisodicEntry[],
  count: number,
  interleaveRatio: number,
): EpisodicEntry[] {
  if (episodes.length === 0) return [];
  if (episodes.length <= count) return [...episodes];

  // Sort by timestamp descending (most recent first)
  const sorted = [...episodes].sort((a, b) => b.timestamp - a.timestamp);

  const recentCount = Math.ceil(count * interleaveRatio);
  const olderCount = Math.floor(count * (1 - interleaveRatio));

  const recent = sorted.slice(0, recentCount);

  // Older episodes: skip the recent ones, take from the remaining pool
  const olderPool = sorted.slice(recentCount);
  const older = olderPool.slice(0, olderCount);

  return [...recent, ...older];
}

// ── Offline Consolidation ───────────────────────────────────────

/**
 * Run offline consolidation over the dual-store.
 *
 * This is the core CLS consolidation algorithm: replay episodic entries,
 * check schema consistency against the semantic store, compress old entries,
 * and prune low-activation semantic patterns.
 *
 * @param store - The MemoryPortV3 dual-store to consolidate.
 * @param config - Consolidation parameters (from ConsolidationConfig).
 * @param options - Extended options (thresholds, capacity).
 * @returns ConsolidationResult with accurate stats.
 */
export async function consolidateOffline(
  store: MemoryPortV3,
  config: ConsolidationConfig,
  options?: OfflineConsolidationOptions,
): Promise<ConsolidationResult> {
  const startTime = Date.now();
  const threshold = options?.schemaConsistencyThreshold ?? 0.8;
  const episodicCapacity = options?.episodicCapacity ?? 50;

  let semanticUpdates = 0;
  let conflictsDetected = 0;
  let entriesPruned = 0;

  // ── Phase 1: Sample interleaved batch ──────────────────────
  const allEpisodes = await store.allEpisodic();
  const batch = sampleInterleavedBatch(
    allEpisodes,
    config.offlineReplayCount,
    config.offlineInterleaveRatio,
  );
  const episodesReplayed = batch.length;

  // ── Phase 2: Schema consistency check ──────────────────────
  // Load semantic entries once; we'll mutate confidence in-memory as we go
  const semanticEntries = await store.allSemantic();

  // Track schema-inconsistent episodes for recurring-pattern detection
  const inconsistentContexts: Array<{ episodeId: string; context: string[] }> = [];

  for (const episode of batch) {
    let isConsistent = false;

    for (const semantic of semanticEntries) {
      const overlap = jaccardSimilarity(episode.context, semantic.tags);

      if (overlap >= threshold) {
        isConsistent = true;

        // Increase confidence (by 0.1, capped at 1.0)
        const newConfidence = Math.min(1.0, semantic.confidence + 0.1);
        await store.updateSemantic(semantic.id, { confidence: newConfidence });
        semantic.confidence = newConfidence; // Keep local copy in sync

        // Add episode ID to sourceEpisodes (in-memory store mutates by reference)
        const existing = await store.retrieveSemantic(semantic.id);
        if (existing && !existing.sourceEpisodes.includes(episode.id)) {
          existing.sourceEpisodes.push(episode.id);
        }

        semanticUpdates++;
        break; // One match is sufficient
      }
    }

    if (!isConsistent) {
      conflictsDetected++;
      inconsistentContexts.push({ episodeId: episode.id, context: episode.context });
    }
  }

  // Detect recurring inconsistent patterns (3+ similar episodes → new semantic entry)
  const contextGroups = new Map<string, string[]>();
  for (const item of inconsistentContexts) {
    const signature = item.context.map((t) => t.toLowerCase()).sort().join('|');
    const group = contextGroups.get(signature) ?? [];
    group.push(item.episodeId);
    contextGroups.set(signature, group);
  }

  // Also count similar episodes from the full store (not just the batch)
  for (const [signature, episodeIds] of contextGroups) {
    let totalSimilar = episodeIds.length;
    const signatureTags = signature.split('|').filter(Boolean);

    for (const ep of allEpisodes) {
      if (episodeIds.includes(ep.id)) continue;
      const similarity = jaccardSimilarity(signatureTags, ep.context);
      if (similarity >= 0.6) {
        totalSimilar++;
      }
    }

    if (totalSimilar >= 3) {
      const now = Date.now();
      const newSemantic: SemanticEntry = {
        id: `sem-consolidated-${now}-${Math.random().toString(36).slice(2, 8)}`,
        pattern: `Recurring pattern from ${totalSimilar} episodes with context: ${signatureTags.join(', ')}`,
        sourceEpisodes: episodeIds,
        confidence: 0.3,
        activationBase: 0,
        tags: signatureTags,
        created: now,
        updated: now,
      };
      await store.storeSemantic(newSemantic);
      semanticUpdates++;
    }
  }

  // ── Phase 3: Compression ───────────────────────────────────
  // Compress oldest episodic entries when store exceeds capacity
  const postReplayEpisodes = await store.allEpisodic();
  let compressedCount = 0;

  if (postReplayEpisodes.length > episodicCapacity) {
    // Sort by timestamp ascending (oldest first)
    const sortedByAge = [...postReplayEpisodes].sort((a, b) => a.timestamp - b.timestamp);
    const excessCount = sortedByAge.length - episodicCapacity;

    for (let i = 0; i < excessCount; i++) {
      const entry = sortedByAge[i];
      if (entry.content.length > 200 && !entry.content.endsWith(' [compressed]')) {
        const compressed = entry.content.slice(0, 200) + ' [compressed]';
        await store.expireEpisodic(entry.id);
        await store.storeEpisodic({ ...entry, content: compressed });
        compressedCount++;
      }
    }
  }

  const totalEpisodicCount = postReplayEpisodes.length;
  const compressionRatio = totalEpisodicCount > 0
    ? compressedCount / totalEpisodicCount
    : 0;

  // ── Phase 4: Pruning ───────────────────────────────────────
  // Remove semantic entries whose activation falls below pruningThreshold
  const postConsolidationSemantic = await store.allSemantic();
  const now = Date.now();
  const actConfig = defaultActivationConfig();

  for (const entry of postConsolidationSemantic) {
    const activation = computeActivation(entry, [], now, actConfig);
    if (activation < config.pruningThreshold) {
      await store.expireSemantic(entry.id);
      entriesPruned++;
    }
  }

  // ── Build result ───────────────────────────────────────────
  const durationMs = Date.now() - startTime;

  return {
    semanticUpdates,
    conflictsDetected,
    compressionRatio,
    entriesPruned,
    episodesReplayed,
    durationMs,
  };
}
