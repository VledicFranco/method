/**
 * Sleep API — standalone function for triggering offline consolidation
 * between sessions.
 *
 * Wraps the consolidateOffline engine function with a simpler API surface:
 * accepts a MemoryPortV3 store and a flat config object with sensible defaults.
 * The engine function requires a full ConsolidationConfig; the Sleep API
 * applies defaults so callers only need to specify what they want to override.
 *
 * Name rationale: "sleep" mirrors the CLS metaphor — offline consolidation
 * happens during biological sleep, transferring hippocampal (episodic) traces
 * to neocortical (semantic) patterns through interleaved replay.
 *
 * Grounded in: Complementary Learning Systems (McClelland et al. 1995),
 * Sleep-dependent memory consolidation (PRD 036).
 */

import type {
  MemoryPortV3,
  ConsolidationConfig,
  ConsolidationResult,
} from '../../ports/memory-port.js';
import { consolidateOffline } from '../engine/consolidation.js';

// ── Types ────────────────────────────────────────────────────────

/** Configuration for the Sleep API. All fields are optional with sensible defaults. */
export interface SleepConfig {
  /** Number of episodes to replay during offline consolidation. Default: 20. */
  replayCount?: number;
  /** Ratio of recent-to-old episodes in interleaved replay batch. Default: 0.6. */
  interleaveRatio?: number;
  /** Activation threshold below which semantic entries are pruned. Default: -1.0. */
  pruningThreshold?: number;
  /** Minimum Jaccard similarity for schema-consistent fast-tracking. Default: 0.8. */
  schemaConsistencyThreshold?: number;
}

// ── Sleep API ────────────────────────────────────────────────────

/**
 * Trigger offline consolidation on a MemoryPortV3 store (the "Sleep" phase).
 *
 * Interleaves recent and old episodic entries for replay, checks schema
 * consistency against the semantic store, compresses old episodes, and
 * prunes low-activation semantic entries.
 *
 * Call this between sessions, after N cycles, or on idle — whenever the
 * agent has accumulated enough episodic experience to consolidate.
 *
 * @param store - The MemoryPortV3 dual-store to consolidate.
 * @param config - Optional configuration overrides. Defaults are tuned for typical use.
 * @returns ConsolidationResult with stats (semantic updates, conflicts, compression, pruning).
 */
export async function triggerSleep(
  store: MemoryPortV3,
  config?: SleepConfig,
): Promise<ConsolidationResult> {
  // Apply defaults to build the full ConsolidationConfig
  const consolidationConfig: ConsolidationConfig = {
    onlineDepth: 'shallow',
    offlineReplayCount: config?.replayCount ?? 20,
    offlineInterleaveRatio: config?.interleaveRatio ?? 0.6,
    pruningThreshold: config?.pruningThreshold ?? -1.0,
  };

  // Delegate to the engine function with schema consistency threshold
  return consolidateOffline(store, consolidationConfig, {
    schemaConsistencyThreshold: config?.schemaConsistencyThreshold ?? 0.8,
  });
}
