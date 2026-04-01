/**
 * Evaluator — meta-level cognitive module for progress estimation and value assessment.
 *
 * Reads workspace snapshots and monitoring signals to estimate task progress
 * and detect diminishing returns. Supports two evaluation horizons: 'immediate'
 * (current cycle only) and 'trajectory' (trend over time).
 *
 * Grounded in: Nelson & Narens metacognitive monitoring — evaluating whether
 * current cognitive strategy is making progress toward the goal.
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
    contextBinding: config?.contextBinding,

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
