/**
 * ACT-R Activation Computation — foundation for activation-based retrieval.
 *
 * Implements the four components of ACT-R chunk activation:
 *   1. Base-level activation: log(accessCount / sqrt(age))
 *   2. Spreading activation: context/tag overlap * spreadingWeight
 *   3. Partial match penalty: applied when confidence < 0.5
 *   4. Noise: stochastic perturbation for retrieval variability
 *
 * Grounded in: Anderson (1993) ACT-R rational analysis of memory,
 * adapted for the CLS dual-store architecture (PRD 036).
 */

import type {
  EpisodicEntry,
  SemanticEntry,
  ActivationConfig,
} from '../../ports/memory-port.js';

// ── Type Guards ─────────────────────────────────────────────────

function isEpisodic(chunk: EpisodicEntry | SemanticEntry): chunk is EpisodicEntry {
  return 'lastAccessed' in chunk && 'accessCount' in chunk && 'context' in chunk;
}

// ── Accessors ───────────────────────────────────────────────────

/**
 * Get the last accessed timestamp for a chunk.
 * EpisodicEntry: lastAccessed. SemanticEntry: updated.
 */
export function getLastAccessed(chunk: EpisodicEntry | SemanticEntry): number {
  if (isEpisodic(chunk)) {
    return chunk.lastAccessed;
  }
  return chunk.updated;
}

/**
 * Get the access count for a chunk.
 * EpisodicEntry: accessCount. SemanticEntry: max(1, sourceEpisodes.length).
 */
export function getAccessCount(chunk: EpisodicEntry | SemanticEntry): number {
  if (isEpisodic(chunk)) {
    return chunk.accessCount;
  }
  return Math.max(1, chunk.sourceEpisodes.length);
}

/**
 * Get the tags/context for a chunk.
 * EpisodicEntry: context. SemanticEntry: tags.
 */
export function getTags(chunk: EpisodicEntry | SemanticEntry): string[] {
  if (isEpisodic(chunk)) {
    return chunk.context;
  }
  return chunk.tags;
}

/**
 * Get the confidence for a chunk.
 * EpisodicEntry: 1.0 (always fully confident). SemanticEntry: confidence.
 */
export function getConfidence(chunk: EpisodicEntry | SemanticEntry): number {
  if (isEpisodic(chunk)) {
    return 1.0;
  }
  return chunk.confidence;
}

// ── Default Config ──────────────────────────────────────────────

/** Return a default ActivationConfig with standard ACT-R parameters. */
export function defaultActivationConfig(): ActivationConfig {
  return {
    retrievalThreshold: -0.5,
    spreadingWeight: 0.3,
    partialMatchPenalty: -0.2,
    noiseAmplitude: 0.1,
    maxRetrievals: 5,
  };
}

// ── Activation Computation ──────────────────────────────────────

/**
 * Compute ACT-R activation for a memory chunk.
 *
 * Total = baseLevelActivation + spreadingActivation + partialMatchPenalty + noise
 *
 * @param chunk - Episodic or semantic entry to compute activation for.
 * @param context - Current context tags for spreading activation.
 * @param now - Current timestamp in ms (for age computation).
 * @param config - Activation configuration parameters.
 * @returns Activation score (higher = more likely to be retrieved).
 */
export function computeActivation(
  chunk: EpisodicEntry | SemanticEntry,
  context: string[],
  now: number,
  config: ActivationConfig,
): number {
  // 1. Base-level activation: log(accessCount / sqrt(age))
  //    age = seconds since last access, floored at 1 to avoid log(0) or negative
  const ageMs = now - getLastAccessed(chunk);
  const ageSec = Math.max(1, ageMs / 1000);
  const accessCount = getAccessCount(chunk);
  const baseLevelActivation = Math.log(accessCount / Math.sqrt(ageSec));

  // 2. Spreading activation: count context/tag overlap * spreadingWeight
  const chunkTags = getTags(chunk);
  let overlap = 0;
  for (const ctx of context) {
    if (chunkTags.includes(ctx)) {
      overlap++;
    }
  }
  const spreadingActivation = overlap * config.spreadingWeight;

  // 3. Partial match penalty: applied when confidence < 0.5
  const confidence = getConfidence(chunk);
  const partialMatch = confidence < 0.5 ? config.partialMatchPenalty : 0;

  // 4. Noise: stochastic perturbation
  const noise = (Math.random() - 0.5) * config.noiseAmplitude;

  return baseLevelActivation + spreadingActivation + partialMatch + noise;
}
