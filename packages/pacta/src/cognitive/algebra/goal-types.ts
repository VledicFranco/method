/**
 * Goal-State Types — persistent goal representation and discrepancy signals.
 *
 * PRD 045 / RFC 004: Goal-State Monitoring. These types enable the Evaluator
 * to compare workspace state against the task goal, detect satisfaction, and
 * emit termination signals.
 *
 * Grounded in:
 * - Carver & Scheier (1998) — cybernetic discrepancy monitoring
 * - Koriat (2007) — monitoring for control (JOP)
 * - Selten (1998) — aspiration adaptation theory
 *
 * @see docs/rfcs/004-goal-state-monitoring.md
 * @see docs/prds/045-goal-state-monitoring.md
 */

import type { MonitoringSignal } from './module.js';

// ── Goal Representation ────────────────────────────────────────

/**
 * Persistent goal state stored in Evaluator internal state (S).
 *
 * Extracted from task input at cycle 0 by the Observer/constraint classifier.
 * Immune to workspace eviction pressure. The Evaluator compares workspace
 * state against this representation to compute goal-state discrepancy.
 */
export interface GoalRepresentation {
  /** Natural language goal statement. */
  objective: string;
  /** Extracted prohibitions and requirements (e.g., "must not import X"). */
  constraints: string[];
  /** Decomposed sub-objectives. Populated by Planner or manually. */
  subgoals: SubGoal[];
  /** Satisficing threshold [0, 1]. Default 0.80. Agent accepts "good enough" below this. */
  aspiration: number;
}

/** A decomposed sub-objective within a goal. */
export interface SubGoal {
  /** What needs to be achieved. */
  description: string;
  /** Whether this subgoal has been satisfied. */
  satisfied: boolean;
  /** Evidence for satisfaction (e.g., "file created", "test passes"). */
  evidence?: string;
}

// ── Goal Discrepancy Signal ────────────────────────────────────

/**
 * Goal-state discrepancy signal — the Evaluator's monitoring output.
 *
 * Implements the Carver-Scheier cybernetic comparator: measures distance
 * between current workspace state and the goal representation. The `rate`
 * field is the metamonitor — tracks whether discrepancy is decreasing
 * (progress), stable (stuck), or increasing (regressing).
 *
 * Joins the ModuleMonitoringSignal union via `type: 'goal-discrepancy'`.
 */
export interface GoalDiscrepancy extends MonitoringSignal {
  type: 'goal-discrepancy';
  /** Distance from goal state [0, 1]. 0 = goal satisfied, 1 = no progress. */
  discrepancy: number;
  /** Rate of discrepancy change per cycle. Positive = improving, 0 = stuck, negative = regressing. */
  rate: number;
  /** Reliability of this estimate [0, 1]. Low confidence should not trigger termination. */
  confidence: number;
  /** Whether discrepancy is below the current aspiration level. */
  satisfied: boolean;
  /** Human-readable description of what was compared. */
  basis: string;
}

// ── Terminate Signal ───────────────────────────────────────────

/**
 * Termination signal emitted by the Evaluator in the monitoring channel (μ).
 *
 * This is NOT a ControlDirective (which flows meta → object). Termination
 * targets the cycle orchestrator *above* the meta-level, so it flows upward
 * as a monitoring signal. The orchestrator reads it from CycleResult and
 * decides whether to halt the cycle loop.
 *
 * Three termination modes:
 * - goal-satisfied: discrepancy below aspiration with sufficient confidence
 * - goal-unreachable: stuck or regressing with diminishing returns
 * - budget-exhausted: external cycle limit reached (not a cognitive decision)
 */
export interface TerminateSignal extends MonitoringSignal {
  type: 'terminate';
  reason: 'goal-satisfied' | 'goal-unreachable' | 'budget-exhausted';
  confidence: number;
  evidence: GoalDiscrepancy;
}
