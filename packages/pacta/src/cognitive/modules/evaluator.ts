// SPDX-License-Identifier: Apache-2.0
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
 * - PRD 045: Goal-state comparison via discrepancy function (rule-based or LLM)
 * - PRD 045: Satisficing dynamics (aspiration level, Selten adaptation)
 * - PRD 045: TerminateSignal emission (goal-satisfied, goal-unreachable)
 * - PRD 045: Unconditional evaluation (runs every cycle, not gated by Monitor)
 *
 * **What this module does NOT capture (known gaps — RFC 006):**
 *
 * R-20/R-21 empirically validated that goal-state comparison alone is insufficient.
 * The Evaluator can answer "how far from goal?" but not "are we on track?" — it lacks
 * a reference trajectory. Three missing cognitive functions (RFC 006):
 *
 * - **Phase-aware progress (Carver-Scheier multi-level control):** The Evaluator
 *   treats all cycles identically. Reading code in cycle 3 (expected exploration) and
 *   cycle 12 (alarming stagnation) produce the same discrepancy signal. The Evaluator
 *   needs phase expectations from a Planner module to evaluate progress relative to
 *   the current execution phase, not just the final goal.
 *
 * - **Solvability estimation (Metcalfe-Wiebe warmth signal):** P(solvable) is distinct
 *   from P(solved). An agent reading code with growing understanding has rate=0
 *   discrepancy but rising solvability. The current unreachable heuristic (rate<=0 past
 *   60% of cycles) conflates these, causing premature termination when the agent is
 *   building a mental model. Solvability should gate termination, not discrepancy rate.
 *
 * - **Pre-task difficulty assessment (Koriat's EOL judgment):** No difficulty estimate
 *   parameterizes monitoring. A complex multi-file refactoring and a trivial dead-code
 *   check use identical thresholds. The Planner module should produce a TaskAssessment
 *   at cycle 0 that sets phase budgets, expected trajectory, and initial solvability.
 *
 * - **Planner module dependency:** The Planner (RFC 001, never implemented) is the
 *   missing upstream module. It produces the TaskAssessment that parameterizes this
 *   Evaluator. Without it, the Evaluator operates as a comparator without a reference
 *   trajectory — which is why R-21's accurate LLM assessments still caused worse
 *   outcomes than no metacognitive monitoring at all.
 *
 * **References:**
 * - Rolls, E. T. (2000). The orbitofrontal cortex and reward. Cerebral Cortex, 10(3), 284-294.
 * - Padoa-Schioppa, C. (2011). Neurobiology of economic choice: a good-based model.
 *   Annual Review of Neuroscience, 34, 333-359.
 * - Carver, C. S., & Scheier, M. F. (1998). On the Self-Regulation of Behavior. Cambridge UP.
 * - Nelson, T. O., & Narens, L. (1990). Metamemory: A theoretical framework and new findings.
 * - Simon, H. A. (1956). Rational choice and the structure of the environment.
 * - Koriat, A. (2007). Metacognition and consciousness. Cambridge Handbook of Consciousness.
 * - Metcalfe, J., & Wiebe, D. (1987). Intuition in insight and noninsight problem solving.
 *   Psychological Review, 63(2), 129-138.
 *
 * @see docs/rfcs/001-cognitive-composition.md — Part IV, Evaluator definition
 * @see docs/rfcs/004-goal-state-monitoring.md — goal-state comparison (implemented PRD 045)
 * @see docs/rfcs/006-anticipatory-monitoring.md — phase awareness + solvability (next)
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
import {
  buildGoalDiscrepancy,
  updateAspiration,
  DEFAULT_ASPIRATION,
} from '../algebra/discrepancy-function.js';
import { buildLLMGoalDiscrepancy, buildPhaseAwareDiscrepancy } from '../algebra/llm-discrepancy.js';

// ── Types ──────────────────────────────────────────────────────────

/** Configuration for the Evaluator module. */
export interface EvaluatorConfig {
  /** Number of consecutive flat/declining cycles before flagging diminishing returns. Default: 3. */
  diminishingReturnsWindow?: number;
  /** Module ID override. Default: 'evaluator'. */
  id?: string;
  contextBinding?: import('../algebra/partition-types.js').ModuleContextBinding;
  /** PRD 045: Goal representation injected into initial state. When present, enables goal-state comparison. */
  goalRepresentation?: import('../algebra/goal-types.js').GoalRepresentation;
  /** PRD 045: Maximum cycles for budget-exhausted detection. */
  maxCycles?: number;
  /** PRD 045+: Optional LLM provider for frontier-model discrepancy assessment.
   *  When present, replaces rule-based heuristic with LLM-based goal-state comparison.
   *  Falls back to rule-based on LLM error. */
  provider?: import('../algebra/provider-adapter.js').ProviderAdapter;
  /** RFC 006: Pre-task assessment for phase-aware evaluation. When present with provider,
   *  uses phase-aware discrepancy with solvability-gated termination. */
  taskAssessment?: import('../algebra/goal-types.js').TaskAssessment;
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
  /** PRD 045: Goal-state discrepancy (present when goal is defined). */
  discrepancy?: import('../algebra/goal-types.js').GoalDiscrepancy;
  /** PRD 045: Termination signal (present when termination conditions met). */
  terminateSignal?: import('../algebra/goal-types.js').TerminateSignal;
  /** Tokens used by LLM evaluator this step (0 when using rule-based). */
  evaluatorTokens?: number;
  /** RFC 006: Solvability estimate (present when taskAssessment is provided). */
  solvability?: import('../algebra/goal-types.js').SolvabilityEstimate;
  /** RFC 006: Current execution phase (present when taskAssessment is provided). */
  currentPhase?: string;
}

/** State: progress history and diminishing returns detection. */
export interface EvaluatorState {
  /** History of progress estimates for trend detection. */
  progressHistory: number[];
  /** Current cycle count. */
  cycleCount: number;
  /** PRD 045: Persistent goal representation (immune to workspace eviction). */
  goal?: import('../algebra/goal-types.js').GoalRepresentation;
  /** PRD 045: History of discrepancy values for rate computation. */
  discrepancyHistory?: number[];
  /** PRD 045: Current satisficing aspiration level. */
  aspirationLevel?: number;
  /** RFC 006: Task assessment (persistent, set at cycle 0). */
  taskAssessment?: import('../algebra/goal-types.js').TaskAssessment;
  /** RFC 006: History of solvability estimates. */
  solvabilityHistory?: number[];
}

/** Control directive: evaluation horizon. */
export interface EvaluatorControl extends ControlDirective {
  evaluationHorizon: 'immediate' | 'trajectory';
}

// ── Factory ────────────────────────────────────────────────────────

/**
 * Create an Evaluator cognitive module.
 *
 * Two modes:
 * - **Legacy (no goal):** Estimates progress from monitoring signal quality.
 *   Backward-compatible with all existing tests and configurations.
 * - **Goal-state (PRD 045):** When goalRepresentation is provided, computes
 *   goal-state discrepancy via rule-based heuristics, tracks satisficing
 *   dynamics, and emits TerminateSignal when termination conditions are met.
 */
export function createEvaluator(
  config?: EvaluatorConfig,
): CognitiveModule<EvaluatorInput, EvaluatorOutput, EvaluatorState, EvaluatorMonitoring, EvaluatorControl> {
  const drWindow = config?.diminishingReturnsWindow ?? 3;
  const id = moduleId(config?.id ?? 'evaluator');
  const goalConfig = config?.goalRepresentation;
  const maxCycles = config?.maxCycles ?? 15;
  const provider = config?.provider;
  const taskAssessment = config?.taskAssessment;

  return {
    id,
    contextBinding: config?.contextBinding ?? { types: ['goal', 'operational'], budget: 2048, strategy: 'salience' as const },

    async step(
      input: EvaluatorInput,
      state: EvaluatorState,
      control: EvaluatorControl,
    ): Promise<StepResult<EvaluatorOutput, EvaluatorState, EvaluatorMonitoring>> {
      // Compute current-cycle progress from monitoring signals (always — legacy path)
      const currentProgress = computeProgressFromSignals(input.signals);
      const horizon = control.evaluationHorizon;

      let estimatedProgress: number;
      let diminishingReturns: boolean;

      if (horizon === 'immediate') {
        estimatedProgress = currentProgress;
        diminishingReturns = false;
      } else {
        const history = [...state.progressHistory, currentProgress];
        estimatedProgress = currentProgress;
        diminishingReturns = detectDiminishingReturns(history, drWindow);
      }

      // ── PRD 045 + RFC 006: Goal-state comparison path ─────────
      let discrepancyResult: import('../algebra/goal-types.js').GoalDiscrepancy | undefined;
      let terminateResult: import('../algebra/goal-types.js').TerminateSignal | undefined;
      let solvabilityResult: import('../algebra/goal-types.js').SolvabilityEstimate | undefined;
      let currentPhaseResult: string | undefined;
      let newAspirationLevel = state.aspirationLevel;
      let newDiscrepancyHistory = state.discrepancyHistory ?? [];
      let newSolvabilityHistory = state.solvabilityHistory ?? [];
      let evaluatorTokens = 0;

      if (state.goal) {
        const previousDiscrepancy = newDiscrepancyHistory.length > 0
          ? newDiscrepancyHistory[newDiscrepancyHistory.length - 1]
          : undefined;
        const previousSolvability = newSolvabilityHistory.length > 0
          ? newSolvabilityHistory[newSolvabilityHistory.length - 1]
          : undefined;
        const aspiration = state.aspirationLevel ?? DEFAULT_ASPIRATION;
        const cycleNum = state.cycleCount + 1;

        // RFC 006: Phase-aware path (provider + taskAssessment)
        if (provider && state.taskAssessment) {
          const paResult = await buildPhaseAwareDiscrepancy(
            provider,
            input.workspace,
            state.goal,
            cycleNum,
            maxCycles,
            state.taskAssessment,
            previousDiscrepancy,
            previousSolvability,
            id,
          );
          if (paResult) {
            discrepancyResult = paResult.discrepancy;
            solvabilityResult = paResult.solvability;
            currentPhaseResult = paResult.currentPhase;
            evaluatorTokens = paResult.tokensUsed;
          }
        }

        // Fallback: LLM without phase awareness
        if (!discrepancyResult && provider) {
          const llmResult = await buildLLMGoalDiscrepancy(
            provider, input.workspace, state.goal, cycleNum, maxCycles, previousDiscrepancy, id,
          );
          if (llmResult) {
            discrepancyResult = llmResult.discrepancy;
            evaluatorTokens = llmResult.tokensUsed;
          }
        }

        // Fallback: rule-based heuristic
        if (!discrepancyResult) {
          discrepancyResult = buildGoalDiscrepancy(
            input.workspace, state.goal, previousDiscrepancy, aspiration, id,
          );
        }

        // Update satisficing dynamics
        newAspirationLevel = updateAspiration(aspiration, discrepancyResult.rate);
        newDiscrepancyHistory = [...newDiscrepancyHistory, discrepancyResult.discrepancy];
        if (solvabilityResult) {
          newSolvabilityHistory = [...newSolvabilityHistory, solvabilityResult.probability];
        }

        // ── Termination logic ──────────────────────────────────
        const confidenceGate = newAspirationLevel < 0.80 ? 0.85 : 0.70;

        // Goal-satisfied: require sustained satisfaction (2+ consecutive satisfied cycles)
        // R-22 finding F3: single-cycle satisfied=true produced false positives.
        const prevSatisfied = newDiscrepancyHistory.length >= 2 &&
          newDiscrepancyHistory[newDiscrepancyHistory.length - 2] < (1.0 - aspiration);
        if (
          discrepancyResult.satisfied &&
          discrepancyResult.confidence > confidenceGate &&
          (prevSatisfied || cycleNum <= 2) // allow early termination for trivial tasks
        ) {
          terminateResult = {
            type: 'terminate',
            source: id,
            timestamp: Date.now(),
            reason: 'goal-satisfied',
            confidence: discrepancyResult.confidence,
            evidence: discrepancyResult,
          };
        }
        // Goal-unreachable: RFC 006 solvability-gated OR legacy rate-based
        else if (solvabilityResult) {
          // RFC 006 path: smoothed solvability over last 3 cycles
          // R-22 finding F2: raw single-cycle solvability is too volatile.
          const recentSolvability = newSolvabilityHistory.slice(-3);
          const smoothedSolvability = recentSolvability.length >= 2
            ? recentSolvability.reduce((a, b) => a + b, 0) / recentSolvability.length
            : solvabilityResult.probability;

          const estimatedCycles = state.taskAssessment?.estimatedCycles ?? maxCycles;
          if (
            smoothedSolvability < 0.3 &&
            recentSolvability.length >= 2 && // require at least 2 data points
            cycleNum > estimatedCycles * 0.5
          ) {
            terminateResult = {
              type: 'terminate',
              source: id,
              timestamp: Date.now(),
              reason: 'goal-unreachable',
              confidence: discrepancyResult.confidence,
              evidence: discrepancyResult,
            };
          }
        } else {
          // Legacy path (no solvability): rate-based termination
          if (
            cycleNum > maxCycles * 0.6 &&
            discrepancyResult.rate <= 0 &&
            diminishingReturns
          ) {
            terminateResult = {
              type: 'terminate',
              source: id,
              timestamp: Date.now(),
              reason: 'goal-unreachable',
              confidence: discrepancyResult.confidence,
              evidence: discrepancyResult,
            };
          }
        }
      }

      const newState: EvaluatorState = {
        progressHistory: [...state.progressHistory, currentProgress],
        cycleCount: state.cycleCount + 1,
        goal: state.goal,
        discrepancyHistory: newDiscrepancyHistory,
        aspirationLevel: newAspirationLevel,
        taskAssessment: state.taskAssessment,
        solvabilityHistory: newSolvabilityHistory,
      };

      const monitoring: EvaluatorMonitoring = {
        type: 'evaluator',
        source: id,
        timestamp: Date.now(),
        estimatedProgress,
        diminishingReturns,
      };

      return {
        output: {
          estimatedProgress,
          diminishingReturns,
          discrepancy: discrepancyResult,
          terminateSignal: terminateResult,
          evaluatorTokens,
          solvability: solvabilityResult,
          currentPhase: currentPhaseResult,
        },
        state: newState,
        monitoring,
      };
    },

    initialState(): EvaluatorState {
      return {
        progressHistory: [],
        cycleCount: 0,
        goal: goalConfig,
        discrepancyHistory: [],
        aspirationLevel: goalConfig ? DEFAULT_ASPIRATION : undefined,
        taskAssessment,
        solvabilityHistory: [],
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
