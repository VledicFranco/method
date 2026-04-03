/**
 * Evaluator — meta-level cognitive module for progress estimation and value assessment.
 *
 * Reads workspace snapshots and monitoring signals to estimate task progress
 * and detect diminishing returns. Supports two evaluation horizons: 'immediate'
 * (current cycle only) and 'trajectory' (trend over time).
 *
 * ## Cognitive Science Grounding
 *
 * **Primary analog: Orbitofrontal Cortex (OFC) — value computation and
 * outcome evaluation.**
 *
 * - **Orbitofrontal Value Computation (Rolls, 2000; Padoa-Schioppa, 2011):**
 *   The OFC computes the subjective value of outcomes and expected rewards,
 *   enabling comparison between current state and desired state. Our Evaluator
 *   estimates progress and detects diminishing returns — a coarse value signal
 *   that tracks whether the cognitive investment is paying off.
 *
 * - **Carver & Scheier (1998, 2000) — Cybernetic Control Theory:** Goal-directed
 *   behavior is governed by a negative feedback loop comparing current state
 *   to a reference value (the goal). A second-order loop — the metamonitor —
 *   tracks the *rate* of discrepancy reduction. The Evaluator's
 *   `diminishingReturns` is a coarse version of the metamonitor: it detects
 *   when the rate of progress has stalled. However, the current implementation
 *   estimates progress from *signal quality* (avg of confidence + action success),
 *   not from *goal-state comparison*. This is the critical gap addressed by
 *   RFC 004 (Goal-State Monitoring).
 *
 * - **Nelson & Narens (1990) — Judgment of Performance (JOP):** Post-action
 *   evaluation of outcome quality. JOP answers "how well did I just do?" and
 *   feeds the control decision to continue, terminate, or change strategy.
 *   The current Evaluator provides a form of JOP through `estimatedProgress`,
 *   but it's proxy-based (derived from module signals) rather than outcome-based
 *   (derived from comparing output to goal). True JOP requires goal-state access.
 *
 * - **Simon (1956) — Satisficing:** Agents maintain a dynamic aspiration level
 *   and terminate search when the first option meeting the threshold is found.
 *   The Evaluator does not currently implement satisficing — it has no concept
 *   of "good enough" or a termination threshold. RFC 004 proposes adding
 *   dynamic aspiration levels to the Evaluator.
 *
 * **What this module captures:**
 * - Signal-based progress estimation: avg(confidence + success)
 * - Diminishing returns detection: progress flat/declining over N cycles
 * - Two evaluation horizons: immediate (single cycle) and trajectory (trend)
 *
 * **What this module does NOT capture (known gaps — RFC 004):**
 * - Goal-state comparison: no access to goal representation, no discrepancy computation
 * - Judgment of Performance: estimates from process signals, not outcome quality
 * - Satisficing threshold: no concept of "good enough" or termination
 * - Termination control: produces signals but cannot issue TerminateDirective
 * - The Evaluator only runs when the Monitor flags an anomaly (default-interventionist
 *   gating), which means it cannot detect success during normal operation.
 *   RFC 004 proposes making evaluation unconditional.
 *
 * **References:**
 * - Rolls, E. T. (2000). The orbitofrontal cortex and reward. Cerebral Cortex, 10(3), 284-294.
 * - Padoa-Schioppa, C. (2011). Neurobiology of economic choice: a good-based model.
 *   Annual Review of Neuroscience, 34, 333-359.
 * - Carver, C. S., & Scheier, M. F. (1998). On the Self-Regulation of Behavior. Cambridge UP.
 * - Nelson, T. O., & Narens, L. (1990). Metamemory: A theoretical framework and new findings.
 * - Simon, H. A. (1956). Rational choice and the structure of the environment.
 *   Psychological Review, 63(2), 129-138.
 *
 * @see docs/rfcs/001-cognitive-composition.md — Part IV, Evaluator definition
 * @see docs/rfcs/004-goal-state-monitoring.md — redesign proposal for goal-state evaluation
 */

import type {
  CognitiveModule,
  EvaluatorMonitoring,
  MonitoringSignal,
  ControlDirective,
  StepResult,
  ModuleId,
  ReasonerMonitoring,
  ActorMonitoring,
  ReadonlyWorkspaceSnapshot,
} from '../algebra/index.js';
import { moduleId } from '../algebra/index.js';

// ── Types ──────────────────────────────────────────────────────────

/** Configuration for the Evaluator module. */
export interface EvaluatorConfig {
  /** Number of consecutive flat/declining cycles before flagging diminishing returns. Default: 3. */
  diminishingReturnsWindow?: number;
  /** Module ID override. Default: 'evaluator'. */
  id?: string;
  contextBinding?: import('../algebra/partition-types.js').ModuleContextBinding;
}

/** Combined input: workspace snapshot + monitoring signals. */
export interface EvaluatorInput {
  workspace: ReadonlyWorkspaceSnapshot;
  signals: Map<ModuleId, MonitoringSignal>;
}

/** Output: progress estimate and value assessment. */
export interface EvaluatorOutput {
  /** Estimated progress toward goal (0-1). */
  estimatedProgress: number;
  /** Whether diminishing returns have been detected. */
  diminishingReturns: boolean;
}

/** State: progress history and diminishing returns detection. */
export interface EvaluatorState {
  /** History of progress estimates for trend detection. */
  progressHistory: number[];
  /** Current cycle count. */
  cycleCount: number;
}

/** Control directive: evaluation horizon. */
export interface EvaluatorControl extends ControlDirective {
  evaluationHorizon: 'immediate' | 'trajectory';
}

// ── Factory ────────────────────────────────────────────────────────

/**
 * Create an Evaluator cognitive module.
 *
 * Estimates progress from monitoring signal quality (high confidence + successful
 * actions = progress). Detects diminishing returns when progress plateaus.
 */
export function createEvaluator(
  config?: EvaluatorConfig,
): CognitiveModule<EvaluatorInput, EvaluatorOutput, EvaluatorState, EvaluatorMonitoring, EvaluatorControl> {
  const drWindow = config?.diminishingReturnsWindow ?? 3;
  const id = moduleId(config?.id ?? 'evaluator');

  return {
    id,
    contextBinding: config?.contextBinding ?? { types: ['goal', 'operational'], budget: 2048, strategy: 'salience' as const },

    async step(
      input: EvaluatorInput,
      state: EvaluatorState,
      control: EvaluatorControl,
    ): Promise<StepResult<EvaluatorOutput, EvaluatorState, EvaluatorMonitoring>> {
      // Compute current-cycle progress from monitoring signals
      const currentProgress = computeProgressFromSignals(input.signals);

      // Decide whether to use immediate or trajectory evaluation
      const horizon = control.evaluationHorizon;

      let estimatedProgress: number;
      let diminishingReturns: boolean;

      if (horizon === 'immediate') {
        // Immediate: only look at current cycle
        estimatedProgress = currentProgress;
        diminishingReturns = false;
      } else {
        // Trajectory: look at trend over progressHistory
        const history = [...state.progressHistory, currentProgress];
        estimatedProgress = currentProgress;

        // Check for diminishing returns: progress flat or declining for drWindow cycles
        diminishingReturns = detectDiminishingReturns(history, drWindow);
      }

      const newState: EvaluatorState = {
        progressHistory: [...state.progressHistory, currentProgress],
        cycleCount: state.cycleCount + 1,
      };

      const monitoring: EvaluatorMonitoring = {
        type: 'evaluator',
        source: id,
        timestamp: Date.now(),
        estimatedProgress,
        diminishingReturns,
      };

      return {
        output: { estimatedProgress, diminishingReturns },
        state: newState,
        monitoring,
      };
    },

    initialState(): EvaluatorState {
      return {
        progressHistory: [],
        cycleCount: 0,
      };
    },

    stateInvariant(state: EvaluatorState): boolean {
      return (
        state.cycleCount >= 0 &&
        state.progressHistory.every(p => p >= 0 && p <= 1)
      );
    },
  };
}

// ── Internals ──────────────────────────────────────────────────────

/**
 * Estimate progress from monitoring signals.
 * High confidence + successful actions = high progress.
 * Returns a value in [0, 1].
 */
function computeProgressFromSignals(signals: Map<ModuleId, MonitoringSignal>): number {
  let totalScore = 0;
  let totalWeight = 0;

  for (const signal of signals.values()) {
    if (isReasonerMonitoring(signal)) {
      // Confidence directly maps to progress contribution
      totalScore += signal.confidence;
      totalWeight += 1;
    }

    if (isActorMonitoring(signal)) {
      // Successful action = 1.0, failed = 0.0
      totalScore += signal.success ? 1.0 : 0.0;
      totalWeight += 1;
    }
  }

  if (totalWeight === 0) return 0;
  return Math.min(1, Math.max(0, totalScore / totalWeight));
}

/**
 * Detect diminishing returns: progress flat or declining for `window` consecutive cycles.
 */
function detectDiminishingReturns(history: number[], window: number): boolean {
  if (history.length < window) return false;

  const recent = history.slice(-window);
  // Check if each element is <= the previous (flat or declining)
  for (let i = 1; i < recent.length; i++) {
    if (recent[i] > recent[i - 1]) {
      return false;
    }
  }
  return true;
}

// ── Type Guards ────────────────────────────────────────────────────

function isReasonerMonitoring(signal: MonitoringSignal): signal is ReasonerMonitoring {
  return 'type' in signal && (signal as ReasonerMonitoring).type === 'reasoner';
}

function isActorMonitoring(signal: MonitoringSignal): signal is ActorMonitoring {
  return 'type' in signal && (signal as ActorMonitoring).type === 'actor';
}
