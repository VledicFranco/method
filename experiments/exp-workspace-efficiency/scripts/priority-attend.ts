/**
 * PriorityAttend Salience Function — three-factor biased competition.
 *
 * Implements the salience model proposed in PRD 035, grounded in:
 *   - Desimone & Duncan (1995) — biased competition model of attention
 *   - Awh, Belopolsky & Theeuwes (2012) — three-factor model:
 *       1. Stimulus salience (bottom-up)
 *       2. Goal relevance (top-down)
 *       3. Selection history (learned bias)
 *
 * This is a standalone implementation for the experiment. If validated,
 * it will be integrated into the main workspace engine as part of PRD 035.
 */

import type {
  WorkspaceEntry,
  SalienceContext,
  SalienceFunction,
  SelectionOutcome,
} from '../../../packages/pacta/src/cognitive/algebra/workspace-types.js';
import type { ModuleId } from '../../../packages/pacta/src/cognitive/algebra/module.js';

// ── Configuration ─────────────────────────────────────────────────

export interface PriorityAttendConfig {
  /** Weight for recency-based stimulus salience (default: 0.4). */
  recencyWeight: number;
  /** Weight for goal relevance (default: 0.4). */
  goalRelevanceWeight: number;
  /** Weight for selection history bias (default: 0.2). */
  selectionHistoryWeight: number;
  /** Half-life for recency decay in milliseconds (default: 60000 = 1 min). */
  recencyHalfLifeMs: number;
  /** How far back to look in selection history (default: 20 entries). */
  historyWindowSize: number;
  /** Decay factor for older history entries (default: 0.9 per entry). */
  historyDecay: number;
}

export const DEFAULT_PRIORITY_ATTEND_CONFIG: PriorityAttendConfig = {
  recencyWeight: 0.4,
  goalRelevanceWeight: 0.4,
  selectionHistoryWeight: 0.2,
  recencyHalfLifeMs: 60_000,
  historyWindowSize: 20,
  historyDecay: 0.9,
};

// ── Factor 1: Stimulus Salience (Bottom-Up) ────────────────────────

/**
 * Exponential decay based on age. Configurable half-life.
 * Recent entries score higher. Identical to v1 recencyScore but parameterized.
 */
export function stimulusSalience(entry: WorkspaceEntry, now: number, halfLifeMs: number): number {
  const age = now - entry.timestamp;
  return Math.exp(-age * Math.LN2 / halfLifeMs);
}

// ── Factor 2: Goal Relevance (Top-Down) ────────────────────────────

/**
 * Goal relevance combines:
 *   (a) Word overlap with active goals (same as v1 goalOverlap)
 *   (b) Word overlap with active subgoals from the planner (PRD 035 extension)
 *
 * Subgoals are weighted at 0.6 of goal weight (they are more specific but
 * less stable than top-level goals).
 */
export function goalRelevance(
  entry: WorkspaceEntry,
  goals: string[],
  subgoals: string[],
): number {
  const contentStr = typeof entry.content === 'string'
    ? entry.content
    : JSON.stringify(entry.content);
  const contentWords = new Set(contentStr.toLowerCase().split(/\s+/));

  // Goal overlap
  const goalWords = new Set(goals.join(' ').toLowerCase().split(/\s+/));
  let goalOverlap = 0;
  if (goalWords.size > 0) {
    for (const word of goalWords) {
      if (contentWords.has(word)) goalOverlap++;
    }
    goalOverlap /= goalWords.size;
  }

  // Subgoal overlap (weighted 0.6x)
  const subgoalWords = new Set(subgoals.join(' ').toLowerCase().split(/\s+/));
  let subgoalOverlap = 0;
  if (subgoalWords.size > 0) {
    for (const word of subgoalWords) {
      if (contentWords.has(word)) subgoalOverlap++;
    }
    subgoalOverlap /= subgoalWords.size;
  }

  // Combine: goals dominate, subgoals augment
  return Math.min(1.0, goalOverlap + 0.6 * subgoalOverlap);
}

// ── Factor 3: Selection History (Learned Bias) ─────────────────────

/**
 * Compute a history-based bias for an entry.
 *
 * Looks at past SelectionOutcome records. Entries that were attended and led
 * to positive outcomes get a boost; entries associated with negative outcomes
 * get suppressed. The bias decays with age (older outcomes matter less).
 *
 * Entry matching is by content hash (entryHash in SelectionOutcome).
 * For entries without a matching history, returns 0.5 (neutral).
 */
export function selectionHistoryBias(
  entry: WorkspaceEntry,
  outcomes: SelectionOutcome[],
  windowSize: number,
  decay: number,
): number {
  if (outcomes.length === 0) return 0.5;

  const entryHash = simpleEntryHash(entry);

  // Look at the most recent `windowSize` outcomes
  const relevant = outcomes
    .filter(o => o.entryHash === entryHash)
    .slice(-windowSize);

  if (relevant.length === 0) return 0.5; // neutral — no history for this entry

  // Compute weighted score: positive = 1.0, neutral = 0.5, negative = 0.0
  // More recent outcomes weighted higher via geometric decay
  let weightedSum = 0;
  let weightSum = 0;

  for (let i = 0; i < relevant.length; i++) {
    const age = relevant.length - 1 - i; // 0 for most recent
    const weight = Math.pow(decay, age);

    const score = relevant[i].outcome === 'positive' ? 1.0
      : relevant[i].outcome === 'negative' ? 0.0
      : 0.5;

    weightedSum += score * weight;
    weightSum += weight;
  }

  return weightSum > 0 ? weightedSum / weightSum : 0.5;
}

/**
 * Simple content-based hash for matching entries across cycles.
 * Not cryptographic — just stable enough for lookup.
 */
export function simpleEntryHash(entry: WorkspaceEntry): string {
  const str = typeof entry.content === 'string'
    ? entry.content
    : JSON.stringify(entry.content ?? '');
  let hash = 0;
  for (let i = 0; i < Math.min(str.length, 500); i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return `${entry.source}-${hash.toString(36)}`;
}

// ── Combined PriorityAttend Function ───────────────────────────────

/**
 * Create a PriorityAttend salience function with the given configuration.
 *
 * Returns a SalienceFunction compatible with the workspace engine.
 */
export function createPriorityAttendSalience(
  config: Partial<PriorityAttendConfig> = {},
): SalienceFunction {
  const cfg: PriorityAttendConfig = { ...DEFAULT_PRIORITY_ATTEND_CONFIG, ...config };

  return (entry: WorkspaceEntry, context: SalienceContext): number => {
    const stimulus = stimulusSalience(entry, context.now, cfg.recencyHalfLifeMs);
    const goal = goalRelevance(entry, context.goals, context.activeSubgoals ?? []);
    const history = selectionHistoryBias(
      entry,
      context.selectionOutcomes ?? [],
      cfg.historyWindowSize,
      cfg.historyDecay,
    );

    // Weighted combination — all factors in [0, 1], output in [0, 1]
    return (
      cfg.recencyWeight * stimulus +
      cfg.goalRelevanceWeight * goal +
      cfg.selectionHistoryWeight * history
    );
  };
}

// ── Source Priority Integration ─────────────────────────────────────

/**
 * Extended PriorityAttend that also incorporates source module priority.
 *
 * The v1 default function uses sourcePriority as a factor. PriorityAttend
 * replaces it with selection history, but for backward compatibility this
 * variant blends both. Used only if the config explicitly requests it.
 */
export function createPriorityAttendWithSourcePriority(
  config: Partial<PriorityAttendConfig> = {},
  sourcePriorityWeight: number = 0.1,
): SalienceFunction {
  const baseFn = createPriorityAttendSalience(config);

  return (entry: WorkspaceEntry, context: SalienceContext): number => {
    const baseSalience = baseFn(entry, context);
    const sourcePriority = context.sourcePriorities.get(entry.source as ModuleId) ?? 0.5;

    // Blend: reduce other weights proportionally to make room for source priority
    const scaleFactor = 1 - sourcePriorityWeight;
    return scaleFactor * baseSalience + sourcePriorityWeight * sourcePriority;
  };
}
