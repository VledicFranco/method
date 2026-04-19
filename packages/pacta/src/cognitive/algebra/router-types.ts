// SPDX-License-Identifier: Apache-2.0
/**
 * Router Types — PRD 050 Meta-Cognitive Router.
 *
 * Pre-execution task classification + architecture selection.
 * The Router runs once per task (cycle -1) to decide whether to engage
 * the full cognitive architecture or use the flat baseline.
 *
 * Empirical basis (R-28/R-29 N=5):
 * - Structural/multi-file tasks (T01 +20pp, T03 +20pp) benefit from cognitive
 * - Direct single-file tasks (T02 -80pp, T04 -80pp) are hurt by cognitive overhead
 * - The right architecture depends on task features, not a global default
 *
 * @see docs/prds/050-meta-cognitive-router.md
 */

// ── Architecture Selection ────────────────────────────────────

/** Architecture options the router can select. */
export type ArchitectureKind = 'flat' | 'unified-memory';

// ── Router SLM Port (PRD 052) ─────────────────────────────────

/**
 * Port for SLM-backed architecture classification.
 * When provided to the Router, replaces rule-based feature extraction
 * with trained model inference (100% accuracy on holdout, <100ms).
 */
export interface RouterSLMPort {
  /** Classify a task → architecture selection. */
  classify(taskDescription: string, objective: string): Promise<{
    architecture: ArchitectureKind;
    confidence: number;
  }>;
  /** Model identifier for telemetry. */
  readonly model: string;
}

// ── Task Features ─────────────────────────────────────────────

/**
 * Features extracted from task description for routing decisions.
 *
 * v1: coarse binary features that distinguish T01/T03 (structural) from
 * T02/T04 (simple). All features derivable from task description + goal
 * without running the task.
 */
export interface TaskFeatures {
  /** Multiple files must be coordinated (>= 3 file paths mentioned). */
  isMultiFile: boolean;
  /** Task requires understanding structural relationships (imports, class hierarchies, dependencies). */
  isStructural: boolean;
  /** Task has implicit constraints (must preserve X, avoid Y, no side effects). */
  hasImplicitConstraints: boolean;
  /** Task is primarily a single-file bug fix or edit. */
  isSingleFileEdit: boolean;
  /** Number of distinct goals/outcomes in the task description. */
  goalCount: number;
  /** Estimated difficulty — may be refined by LLM. */
  estimatedDifficulty: 'trivial' | 'simple' | 'moderate' | 'complex';
}

// ── Routing Decision ──────────────────────────────────────────

/**
 * Result of the routing decision — emitted by the Router at cycle -1.
 * The experiment runner / orchestrator dispatches to the selected architecture.
 */
export interface RoutingDecision {
  /** Selected architecture. */
  architecture: ArchitectureKind;
  /** Classification features that drove the decision. */
  features: TaskFeatures;
  /** Confidence in the decision [0, 1]. */
  confidence: number;
  /** Human-readable rationale (for logging/debugging). */
  rationale: string;
  /** Tokens consumed by routing decision. */
  tokensUsed: number;
}
