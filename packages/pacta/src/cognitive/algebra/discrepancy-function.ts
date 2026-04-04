/**
 * Discrepancy Function — rule-based goal-state comparison.
 *
 * Pure function that computes goal-state discrepancy from workspace state
 * and a GoalRepresentation. No LLM calls — heuristic keyword overlap,
 * constraint satisfaction, and write activity detection.
 *
 * **Empirical status (R-20):** This function produces constant output (0.300
 * discrepancy, 0.50 confidence) regardless of actual task progress. It cannot
 * distinguish an agent that has read 5 files from one that has written 3.
 * The keyword overlap approach fails because workspace entries contain tool
 * outputs, not goal-matching prose.
 *
 * **Current role:** Fallback when no LLM provider is available. The LLM-based
 * evaluator (llm-discrepancy.ts) is the primary path for frontier validation.
 * Both will be superseded when the Planner module (RFC 006) provides phase-aware
 * evaluation and solvability tracking.
 *
 * @see algebra/llm-discrepancy.ts — LLM-based replacement (R-21)
 * @see docs/rfcs/004-goal-state-monitoring.md — §Discrepancy Computation
 * @see docs/rfcs/006-anticipatory-monitoring.md — phase-aware evaluation (next)
 */

import type { ReadonlyWorkspaceSnapshot } from './workspace-types.js';
import type { GoalRepresentation, GoalDiscrepancy } from './goal-types.js';
import type { ModuleId } from './module.js';

// ── Key Term Extraction ────────────────────────────────────────

/** Extract meaningful terms from a string (3+ chars, lowercased, deduped). */
export function extractKeyTerms(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z][a-z0-9_]{2,}/g) ?? [];
  // Filter common stop words
  const stops = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'your', 'you',
    'are', 'was', 'were', 'has', 'have', 'had', 'not', 'but', 'can',
    'will', 'should', 'must', 'may', 'use', 'using', 'used',
    'file', 'files', 'code', 'task', 'make', 'sure', 'any',
  ]);
  return new Set(words.filter(w => !stops.has(w)));
}

// ── Constraint Satisfaction ────────────────────────────────────

/**
 * Check whether workspace write actions violate any goal constraints.
 * Returns fraction of constraints that appear satisfied (not violated).
 */
export function checkConstraintSatisfaction(
  workspace: ReadonlyWorkspaceSnapshot,
  constraints: string[],
): number {
  if (constraints.length === 0) return 1.0;

  // Collect all workspace content as a single string for pattern matching
  const allContent = workspace
    .map(e => typeof e.content === 'string' ? e.content : '')
    .join('\n');

  let satisfied = 0;
  for (const constraint of constraints) {
    // Extract prohibition patterns from constraint
    const prohibitionMatch = constraint.match(
      /(?:must\s+not|do\s+not|never|avoid|don'?t)\s+(.{5,60})/i,
    );
    if (prohibitionMatch) {
      // Check that the prohibited pattern does NOT appear in write actions
      const prohibited = prohibitionMatch[1].toLowerCase().trim();
      const prohibitedTerms = extractKeyTerms(prohibited);
      // Count how many prohibited terms appear in workspace writes
      let violationCount = 0;
      for (const term of prohibitedTerms) {
        if (allContent.toLowerCase().includes(term)) violationCount++;
      }
      // If less than half of prohibited terms appear, consider it satisfied
      if (violationCount < prohibitedTerms.size * 0.5) satisfied++;
    } else {
      // Non-prohibition constraint — assume satisfied if we can't check
      satisfied++;
    }
  }
  return satisfied / constraints.length;
}

// ── Write Activity Detection ───────────────────────────────────

/**
 * Detect whether the agent has performed write actions (Write, Edit).
 * Returns 1.0 if writes detected, 0.0 if only reads.
 */
export function detectWriteActivity(workspace: ReadonlyWorkspaceSnapshot): number {
  for (const entry of workspace) {
    const content = typeof entry.content === 'string' ? entry.content : '';
    if (/\b(?:wrote|written|created|edited|modified|Write|Edit)\b/i.test(content)) {
      return 1.0;
    }
  }
  return 0.0;
}

// ── Term Overlap ───────────────────────────────────────────────

/**
 * Compute overlap between goal terms and workspace content.
 * Returns [0, 1] — fraction of goal terms that appear in workspace.
 */
export function computeTermOverlap(
  goalTerms: Set<string>,
  workspace: ReadonlyWorkspaceSnapshot,
): number {
  if (goalTerms.size === 0) return 0;

  const allContent = workspace
    .map(e => typeof e.content === 'string' ? e.content : '')
    .join('\n')
    .toLowerCase();

  let hits = 0;
  for (const term of goalTerms) {
    if (allContent.includes(term)) hits++;
  }
  return hits / goalTerms.size;
}

// ── Subgoal Score ──────────────────────────────────────────────

/**
 * Compute fraction of subgoals satisfied. Returns 0 if no subgoals.
 */
export function computeSubgoalScore(goal: GoalRepresentation): number {
  if (goal.subgoals.length === 0) return 0;
  const satisfied = goal.subgoals.filter(s => s.satisfied).length;
  return satisfied / goal.subgoals.length;
}

// ── Main Discrepancy Function ──────────────────────────────────

/**
 * Compute goal-state discrepancy.
 *
 * Returns a value in [0, 1] where 0 = goal satisfied, 1 = no progress.
 * Uses weighted combination of term overlap, constraint satisfaction,
 * write activity, and subgoal completion.
 *
 * When subgoals are defined, they dominate the score (60% weight).
 * When no subgoals, falls back to term overlap + constraints + writes.
 */
export function computeDiscrepancy(
  workspace: ReadonlyWorkspaceSnapshot,
  goal: GoalRepresentation,
): number {
  const goalTerms = extractKeyTerms(goal.objective);
  const termOverlap = computeTermOverlap(goalTerms, workspace);
  const constraintMet = checkConstraintSatisfaction(workspace, goal.constraints);
  const writeActivity = detectWriteActivity(workspace);
  const subgoalScore = computeSubgoalScore(goal);

  if (goal.subgoals.length > 0) {
    // Subgoals dominate when decomposed
    return 1.0 - (0.6 * subgoalScore + 0.2 * termOverlap + 0.2 * constraintMet);
  }
  // Fallback: term overlap + constraints + write activity
  return 1.0 - (0.4 * termOverlap + 0.3 * constraintMet + 0.3 * writeActivity);
}

// ── Confidence Estimation ──────────────────────────────────────

/**
 * Estimate confidence in the discrepancy assessment.
 *
 * Higher confidence when: more goal terms to compare against, constraint
 * patterns are detectable, and subgoals are defined. Lower confidence
 * when the goal is vague or has no extractable terms.
 */
export function estimateConfidence(goal: GoalRepresentation): number {
  const termCount = extractKeyTerms(goal.objective).size;
  const hasConstraints = goal.constraints.length > 0;
  const hasSubgoals = goal.subgoals.length > 0;

  let confidence = 0.3; // base
  if (termCount >= 5) confidence += 0.2;
  else if (termCount >= 3) confidence += 0.1;
  if (hasConstraints) confidence += 0.2;
  if (hasSubgoals) confidence += 0.3;

  return Math.min(confidence, 1.0);
}

// ── Full GoalDiscrepancy Builder ───────────────────────────────

/**
 * Build a complete GoalDiscrepancy signal from workspace and goal state.
 *
 * @param workspace - Current workspace snapshot
 * @param goal - Persistent goal representation
 * @param previousDiscrepancy - Previous cycle's discrepancy (for rate computation)
 * @param aspirationLevel - Current satisficing threshold
 * @param source - Module ID of the evaluator emitting this signal
 */
export function buildGoalDiscrepancy(
  workspace: ReadonlyWorkspaceSnapshot,
  goal: GoalRepresentation,
  previousDiscrepancy: number | undefined,
  aspirationLevel: number,
  source: ModuleId,
): GoalDiscrepancy {
  const discrepancy = computeDiscrepancy(workspace, goal);
  const confidence = estimateConfidence(goal);
  const rate = previousDiscrepancy !== undefined
    ? previousDiscrepancy - discrepancy  // positive = improving (discrepancy decreasing)
    : 0;
  const satisfied = discrepancy < (1.0 - aspirationLevel); // aspiration 0.80 → satisfied when discrepancy < 0.20

  return {
    type: 'goal-discrepancy',
    source,
    timestamp: Date.now(),
    discrepancy,
    rate,
    confidence,
    satisfied,
    basis: `termOverlap + constraintSatisfaction + writeActivity (${goal.subgoals.length} subgoals)`,
  };
}

// ── Satisficing Dynamics ───────────────────────────────────────

/** Default initial aspiration level. */
export const DEFAULT_ASPIRATION = 0.80;

/** Minimum aspiration level (floor). */
export const ASPIRATION_FLOOR = 0.60;

/** Maximum aspiration level (ceiling). */
export const ASPIRATION_CEILING = 0.95;

/**
 * Update aspiration level based on discrepancy rate (Selten's adaptation model).
 *
 * - Positive rate (improving): raise aspiration slightly
 * - Zero rate (stuck): lower aspiration cautiously
 * - Negative rate (regressing): lower aspiration faster
 */
export function updateAspiration(currentAspiration: number, rate: number): number {
  if (rate > 0) {
    return Math.min(currentAspiration + 0.05, ASPIRATION_CEILING);
  } else if (rate === 0) {
    return Math.max(currentAspiration - 0.05, ASPIRATION_FLOOR);
  } else {
    return Math.max(currentAspiration - 0.10, ASPIRATION_FLOOR);
  }
}
