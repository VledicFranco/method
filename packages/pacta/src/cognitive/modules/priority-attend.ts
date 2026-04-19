// SPDX-License-Identifier: Apache-2.0
/**
 * PriorityAttend — three-factor biased competition salience function.
 *
 * Replaces the v1 defaultSalienceFunction with a three-factor model following:
 * - Desimone & Duncan (1995) — biased competition
 * - Awh, Belopolsky & Theeuwes (2012) — three-factor attention (stimulus, goal, history)
 * - Bisley & Goldberg (2010) — priority map
 *
 * Three independent factors:
 * 1. Stimulus salience (bottom-up) [0,1]: novelty, magnitude, surprise
 * 2. Goal relevance (top-down) [0,1]: match to goals and active subgoals
 * 3. Selection history (learned bias) [-1,1]: boost for successful, suppress for failed
 *
 * Composite: stimulusWeight * stimulus + goalWeight * goal + historyWeight * history
 *
 * See docs/prds/035-cognitive-monitoring-control-v2.md §2 PriorityAttend.
 */

import type { WorkspaceEntry, SalienceFunction, SalienceContext } from '../algebra/workspace-types.js';
import type { PriorityAttendConfig, PriorityScore } from '../algebra/enriched-signals.js';

// ── Defaults ──────────────────────────────────────────────────────

const DEFAULT_STIMULUS_WEIGHT = 0.3;
const DEFAULT_GOAL_WEIGHT = 0.4;
const DEFAULT_HISTORY_WEIGHT = 0.3;
const DEFAULT_SUPPRESSION_FACTOR = 0.2;
const DEFAULT_MAX_HISTORY_ENTRIES = 100;

/** Recency half-life in ms (1 minute — same as v1 for comparability). */
const RECENCY_HALF_LIFE_MS = 60_000;

// ── Config Factory ────────────────────────────────────────────────

/**
 * Create a PriorityAttendConfig with defaults filled in.
 * All fields are optional — omitted fields use the empirically-balanced defaults.
 */
export function createPriorityAttendConfig(
  overrides?: Partial<PriorityAttendConfig>,
): Required<PriorityAttendConfig> {
  return {
    stimulusWeight: overrides?.stimulusWeight ?? DEFAULT_STIMULUS_WEIGHT,
    goalWeight: overrides?.goalWeight ?? DEFAULT_GOAL_WEIGHT,
    historyWeight: overrides?.historyWeight ?? DEFAULT_HISTORY_WEIGHT,
    suppressionFactor: overrides?.suppressionFactor ?? DEFAULT_SUPPRESSION_FACTOR,
    maxHistoryEntries: overrides?.maxHistoryEntries ?? DEFAULT_MAX_HISTORY_ENTRIES,
  };
}

// ── Stimulus Salience (Bottom-Up) ─────────────────────────────────

/**
 * Compute stimulus salience for an entry.
 *
 * Combines three bottom-up features:
 * - Recency (novelty): exponential decay from entry age. Novel entries score high.
 * - Magnitude: content length relative to mean — larger-than-average entries stand out.
 * - Distinctiveness: placeholder factor (1.0) — in a full implementation this would
 *   measure content difference from recent entries.
 *
 * Result clamped to [0, 1].
 */
function computeStimulusSalience(entry: WorkspaceEntry, context: SalienceContext): number {
  // Recency: exponential decay with 1-minute half-life
  const age = Math.max(0, context.now - entry.timestamp);
  const recency = Math.exp(-age / RECENCY_HALF_LIFE_MS);

  // Magnitude: content length relative to a baseline (256 chars).
  // Entries with more content are more salient (bottom-up pop-out).
  const contentStr = typeof entry.content === 'string'
    ? entry.content
    : JSON.stringify(entry.content);
  const contentLength = contentStr.length;
  // Sigmoid-like normalization: 0 at length=0, ~0.5 at length=256, approaches 1 at large lengths
  const magnitude = contentLength / (contentLength + 256);

  // Combine: recency dominates (0.6), magnitude contributes (0.4)
  const raw = 0.6 * recency + 0.4 * magnitude;
  return Math.max(0, Math.min(1, raw));
}

// ── Goal Relevance (Top-Down) ─────────────────────────────────────

/**
 * Compute goal relevance for an entry.
 *
 * Combines:
 * - Keyword overlap with context.goals (same approach as v1 goalOverlap)
 * - Structural matching against context.activeSubgoals (if available)
 *
 * Result clamped to [0, 1].
 */
function computeGoalRelevance(entry: WorkspaceEntry, context: SalienceContext): number {
  const contentStr = typeof entry.content === 'string'
    ? entry.content
    : JSON.stringify(entry.content);
  const contentWords = new Set(contentStr.toLowerCase().split(/\s+/));

  // Goal overlap (same as v1)
  let goalScore = 0;
  if (context.goals.length > 0) {
    const goalWords = new Set(context.goals.join(' ').toLowerCase().split(/\s+/));
    if (goalWords.size > 0) {
      let overlap = 0;
      for (const word of goalWords) {
        if (contentWords.has(word)) overlap++;
      }
      goalScore = overlap / goalWords.size;
    }
  }

  // Subgoal matching (PRD 035 extension)
  let subgoalScore = 0;
  if (context.activeSubgoals && context.activeSubgoals.length > 0) {
    const subgoalWords = new Set(
      context.activeSubgoals.join(' ').toLowerCase().split(/\s+/),
    );
    if (subgoalWords.size > 0) {
      let overlap = 0;
      for (const word of subgoalWords) {
        if (contentWords.has(word)) overlap++;
      }
      subgoalScore = overlap / subgoalWords.size;
    }
  }

  // If subgoals are present, weight them equally with goals.
  // Otherwise, goals are the sole contributor.
  const raw = context.activeSubgoals && context.activeSubgoals.length > 0
    ? 0.5 * goalScore + 0.5 * subgoalScore
    : goalScore;

  return Math.max(0, Math.min(1, raw));
}

// ── Selection History (Learned Bias) ──────────────────────────────

/**
 * Compute selection history bias for an entry.
 *
 * Looks up the entry's hash in context.selectionOutcomes:
 * - positive outcomes → boost (toward +1)
 * - negative outcomes → suppress (toward -1)
 * - neutral outcomes → no effect (0)
 *
 * Multiple outcomes for the same entry are aggregated: each positive adds +1,
 * each negative adds -1, then normalized to [-1, 1].
 *
 * Result clamped to [-1, 1].
 */
function computeSelectionHistory(entry: WorkspaceEntry, context: SalienceContext): number {
  if (!context.selectionOutcomes || context.selectionOutcomes.length === 0) {
    return 0;
  }

  // Hash the entry for matching. Use a simple content-based hash.
  const entryHash = hashEntry(entry);

  const matchingOutcomes = context.selectionOutcomes.filter(
    (o) => o.entryHash === entryHash,
  );

  if (matchingOutcomes.length === 0) return 0;

  let score = 0;
  for (const outcome of matchingOutcomes) {
    if (outcome.outcome === 'positive') score += 1;
    else if (outcome.outcome === 'negative') score -= 1;
    // neutral contributes 0
  }

  // Normalize by number of matching outcomes to stay in [-1, 1]
  const normalized = score / matchingOutcomes.length;
  return Math.max(-1, Math.min(1, normalized));
}

/**
 * Simple hash for a workspace entry — based on source + content stringification.
 * Used to match entries against SelectionOutcome records.
 */
function hashEntry(entry: WorkspaceEntry): string {
  const contentStr = typeof entry.content === 'string'
    ? entry.content
    : JSON.stringify(entry.content);
  return `${entry.source}:${contentStr}`;
}

// ── Composite Priority Score ──────────────────────────────────────

/**
 * Compute the full three-factor priority score for a workspace entry.
 *
 * Exposed for testing and external consumers that need per-factor breakdowns.
 */
export function computePriorityScore(
  entry: WorkspaceEntry,
  context: SalienceContext,
  config?: PriorityAttendConfig,
): PriorityScore {
  const resolved = createPriorityAttendConfig(config);

  const stimulusSalience = computeStimulusSalience(entry, context);
  const goalRelevance = computeGoalRelevance(entry, context);
  const selectionHistory = computeSelectionHistory(entry, context);

  const composite =
    resolved.stimulusWeight * stimulusSalience +
    resolved.goalWeight * goalRelevance +
    resolved.historyWeight * selectionHistory;

  return {
    stimulusSalience,
    goalRelevance,
    selectionHistory,
    composite,
  };
}

// ── Salience Function ─────────────────────────────────────────────

/**
 * Three-factor biased competition salience function.
 *
 * Drop-in replacement for defaultSalienceFunction. Plug into createWorkspace():
 *
 * ```typescript
 * const workspace = createWorkspace(
 *   { capacity: 20, salience: prioritySalienceFunction },
 *   salienceContext,
 * );
 * ```
 *
 * Uses default weights (0.3 stimulus, 0.4 goal, 0.3 history).
 * For custom weights, use `createPrioritySalienceFunction(config)`.
 */
export const prioritySalienceFunction: SalienceFunction = (
  entry: WorkspaceEntry,
  context: SalienceContext,
): number => {
  const score = computePriorityScore(entry, context);
  return score.composite;
};

/**
 * Create a salience function with custom PriorityAttend configuration.
 *
 * Returns a SalienceFunction that uses the specified weights and parameters.
 */
export function createPrioritySalienceFunction(
  config: PriorityAttendConfig,
): SalienceFunction {
  return (entry: WorkspaceEntry, context: SalienceContext): number => {
    const score = computePriorityScore(entry, context, config);
    return score.composite;
  };
}

// ── Winner Suppression (Lateral Inhibition) ───────────────────────

/**
 * Apply winner suppression to workspace entries after attention selection.
 *
 * Non-selected entries have their salience reduced by the suppression factor.
 * This implements lateral inhibition — preventing low-priority entries from
 * oscillating back into competition cycle after cycle.
 *
 * Returns a new array of entries with suppressed salience values.
 * Selected entries are returned unchanged.
 *
 * @param entries - All workspace entries
 * @param selectedIndices - Indices of entries that won the attention competition
 * @param suppressionFactor - Factor to reduce non-selected entries' salience (default 0.2)
 */
export function applySuppression(
  entries: WorkspaceEntry[],
  selectedIndices: number[],
  suppressionFactor: number = DEFAULT_SUPPRESSION_FACTOR,
): WorkspaceEntry[] {
  const selectedSet = new Set(selectedIndices);

  return entries.map((entry, index) => {
    if (selectedSet.has(index)) {
      return entry; // winners keep their salience
    }
    return {
      ...entry,
      salience: entry.salience * (1 - suppressionFactor),
    };
  });
}
