// SPDX-License-Identifier: Apache-2.0
/**
 * Monitor — meta-level cognitive module for anomaly detection and escalation.
 *
 * Reads aggregated monitoring signals (mu) from all object-level modules,
 * maintains an abstracted model of object-level behavior (running averages,
 * conflict counts), and produces anomaly reports with escalation recommendations.
 *
 * ## Cognitive Science Grounding
 *
 * **Primary analog: Anterior Cingulate Cortex (dACC) — conflict monitoring
 * and error detection.**
 *
 * - **Botvinick et al. (2001, 2004) — Conflict Monitoring Theory:** The dACC
 *   detects co-activation of incompatible response representations. When conflict
 *   is high, dACC signals the dorsolateral PFC (DLPFC) to increase cognitive
 *   control. Our Monitor implements this: it reads confidence and action signals,
 *   detects anomalies (low confidence = response uncertainty = conflict), and
 *   escalates to the Planner/Control phase.
 *
 * - **Nelson & Narens (1990) — Metacognitive Monitoring:** The foundational
 *   two-level framework: an object level produces behavior, a meta level
 *   monitors it. Information flows upward as monitoring signals, downward as
 *   control directives. Our Monitor is the meta-level monitoring component.
 *   It reads μ (monitoring signals) from all object-level modules and reports
 *   upward — it does not directly intervene (that's the Planner's job).
 *
 * - **Gratton Effect (Gratton et al., 1992):** Post-conflict threshold
 *   adjustment — after a conflict trial, the next trial's conflict threshold
 *   is lower (more sensitive). MonitorV2 implements this as adaptive threshold
 *   dynamics: the confidence threshold shifts based on whether the previous
 *   cycle triggered an intervention.
 *
 * - **Friston (2009) — Prediction Error Minimization:** MonitorV2 maintains
 *   per-module expectation models and computes prediction errors (observed vs
 *   expected confidence). Large prediction errors trigger intervention. This
 *   maps to the free energy principle: the meta-level maintains a generative
 *   model of object-level behavior and intervenes when predictions fail.
 *
 * **What this module captures:**
 * - Conflict/anomaly detection (Botvinick): low confidence, stagnation, action failure
 * - Adaptive thresholds (Gratton): sensitivity adjusts based on intervention history
 * - Prediction error (Friston): unexpected module behavior triggers escalation
 * - Stagnation detection: repeated read-only actions flagged as impasse
 *
 * **What this module does NOT capture (known gaps):**
 * - Goal-state monitoring: the Monitor detects process anomalies (how the system
 *   is running), not outcome quality (whether the goal is being met). Conflict
 *   *absence* detection — the signal that says "everything is fine, the goal is
 *   satisfied" — is missing. See RFC 004 (Goal-State Monitoring).
 * - Error likelihood (Brown & Braver, 2005): predicting errors before they occur
 *   based on task context, rather than detecting them after they happen.
 * - Reward-based learning: ACC conflict signals should update through experience.
 *   Currently thresholds are heuristic, not learned.
 *
 * **References:**
 * - Botvinick, M. M., et al. (2001). Conflict monitoring and cognitive control.
 *   Psychological Review, 108(3), 624-652.
 * - Botvinick, M. M., et al. (2004). Conflict monitoring and anterior cingulate cortex:
 *   an update. Trends in Cognitive Sciences, 8(12), 539-546.
 * - Nelson, T. O., & Narens, L. (1990). Metamemory: A theoretical framework and new findings.
 *   In G. Bower (Ed.), The Psychology of Learning and Motivation (Vol. 26).
 * - Gratton, G., Coles, M. G. H., & Donchin, E. (1992). Optimizing the use of information:
 *   Strategic control of activation of responses. JEP: General, 121(4), 480-506.
 * - Friston, K. (2009). The free-energy principle: a rough guide to the brain?
 *   Trends in Cognitive Sciences, 13(7), 293-301.
 *
 * @see docs/rfcs/001-cognitive-composition.md — Part IV, Phase 5 (MONITOR)
 * @see docs/rfcs/004-goal-state-monitoring.md — the gap this module doesn't cover
 */

import type {
  CognitiveModule,
  AggregatedSignals,
  MonitorMonitoring,
  MonitoringSignal,
  ControlDirective,
  StepResult,
  StepError,
  ModuleId,
  ReasonerMonitoring,
  ActorMonitoring,
  ReasonerActorMonitoring,
} from '../algebra/index.js';
import { moduleId } from '../algebra/index.js';

// ── Types ──────────────────────────────────────────────────────────

/** Configuration for the Monitor module. */
export interface MonitorConfig {
  /** Confidence threshold below which an anomaly is flagged. Default: 0.3. */
  confidenceThreshold?: number;
  /** Consecutive read-only cycles before flagging stagnation. Default: 3. */
  stagnationThreshold?: number;
  /** Module ID override. Default: 'monitor'. */
  id?: string;
  contextBinding?: import('../algebra/partition-types.js').ModuleContextBinding;
}

/** Anomaly detected by the monitor. */
export interface Anomaly {
  moduleId: ModuleId;
  type: 'low-confidence' | 'unexpected-result' | 'compound';
  detail: string;
}

/** Output of the Monitor module — anomaly reports and escalation recommendations. */
export interface MonitorReport {
  anomalies: Anomaly[];
  escalation: string | undefined;
  restrictedActions: string[];   // action types to block next cycle
  forceReplan: boolean;          // force strategy transition
}

/** Abstracted model of object-level behavior. No direct access to module state. */
export interface MonitorState {
  /** Running average of confidence across all observed reasoner signals. */
  confidenceAverage: number;
  /** Total number of confidence observations incorporated into the average. */
  confidenceObservations: number;
  /** Total conflict count across all cycles. */
  conflictCount: number;
  /** Cycle counter. */
  cycleCount: number;
  /** Cycles where actor only read, no writes. */
  consecutiveReadOnlyCycles: number;
  /** Recent action inputs for stagnation disambiguation (exploration vs repetition). */
  recentActionInputs: string[];
}

/**
 * No-op control type for Monitor — top-level monitor accepts no control directives.
 * Uses a discriminant that can never be constructed at runtime.
 */
export type NoControl = ControlDirective & { readonly __noControl: never };

// ── Constants ───────────────────────────────────────────────────────

const READ_ONLY_ACTIONS = new Set(['Read', 'Glob', 'Grep', 'none', 'error', 'escalate']);

// ── Factory ────────────────────────────────────────────────────────


/**
 * Create a Monitor cognitive module.
 *
 * The Monitor aggregates monitoring signals from object-level modules,
 * detects anomalies (low confidence, unexpected results), and escalates
 * compound anomalies.
 */
export function createMonitor(
  config?: MonitorConfig,
): CognitiveModule<AggregatedSignals, MonitorReport, MonitorState, MonitorMonitoring, NoControl> {
  const threshold = config?.confidenceThreshold ?? 0.3;
  const stagnationThreshold = config?.stagnationThreshold ?? 3;
  const id = moduleId(config?.id ?? 'monitor');

  return {
    id,
    contextBinding: config?.contextBinding ?? { types: ['constraint', 'operational'], budget: 2048, strategy: 'all' as const },

    async step(
      input: AggregatedSignals,
      state: MonitorState,
      _control: NoControl,
    ): Promise<StepResult<MonitorReport, MonitorState, MonitorMonitoring>> {
      const anomalies: Anomaly[] = [];
      let hasLowConfidence = false;
      let hasUnexpectedResult = false;
      let actorWasReadOnly: boolean | null = null; // null = no actor signal this cycle
      let currentActionInput: string | null = null;

      // Accumulate running averages from new signals
      let newConfidenceSum = state.confidenceAverage * state.confidenceObservations;
      let newConfidenceCount = state.confidenceObservations;
      let newConflictCount = state.conflictCount;

      for (const [sourceId, signal] of input) {
        // Check reasoner signals for low confidence
        if (isReasonerMonitoring(signal)) {
          newConfidenceSum += signal.confidence;
          newConfidenceCount += 1;

          if (signal.confidence < threshold) {
            hasLowConfidence = true;
            anomalies.push({
              moduleId: sourceId,
              type: 'low-confidence',
              detail: `Confidence ${signal.confidence} below threshold ${threshold}`,
            });
          }

          if (signal.conflictDetected) {
            newConflictCount += 1;
          }
        }

        // Check actor signals for unexpected results and stagnation
        if (isActorMonitoring(signal)) {
          if (signal.unexpectedResult) {
            hasUnexpectedResult = true;
            anomalies.push({
              moduleId: sourceId,
              type: 'unexpected-result',
              detail: `Unexpected result from action: ${signal.actionTaken}`,
            });
          }
          actorWasReadOnly = READ_ONLY_ACTIONS.has(signal.actionTaken);
          currentActionInput = JSON.stringify(signal.actionTaken);
        } else if (isReasonerActorMonitoring(signal)) {
          if (signal.unexpectedResult) {
            hasUnexpectedResult = true;
            anomalies.push({
              moduleId: sourceId,
              type: 'unexpected-result',
              detail: `Unexpected result from action: ${signal.actionTaken}`,
            });
          }
          actorWasReadOnly = READ_ONLY_ACTIONS.has(signal.actionTaken);
          currentActionInput = JSON.stringify(signal.declaredPlanAction ?? signal.actionTaken);
        }
      }

      // Update recent action inputs window (last 6)
      const newRecentInputs = [...state.recentActionInputs];
      if (currentActionInput !== null) {
        newRecentInputs.push(currentActionInput);
        if (newRecentInputs.length > 6) newRecentInputs.shift();
      }

      // Smart stagnation: distinguish exploration (different targets) from repetition
      // Reading 3 different files = exploration. Reading the same file 3 times = stagnation.
      const isExploring = actorWasReadOnly && newRecentInputs.length >= 2
        ? new Set(newRecentInputs.slice(-3)).size >= 2  // at least 2 distinct recent inputs
        : false;

      // Only count as stagnation if read-only AND not exploring
      const newConsecutiveReadOnly = actorWasReadOnly === null
        ? state.consecutiveReadOnlyCycles
        : actorWasReadOnly && !isExploring
          ? state.consecutiveReadOnlyCycles + 1
          : actorWasReadOnly && isExploring
            ? Math.max(0, state.consecutiveReadOnlyCycles - 1)  // exploring reduces pressure
            : 0;  // write resets

      // Stagnation: too many cycles without a write
      if (newConsecutiveReadOnly >= stagnationThreshold) {
        anomalies.push({
          moduleId: id,
          type: 'low-confidence',
          detail: `Stagnation: ${newConsecutiveReadOnly} consecutive stagnant cycles (threshold: ${stagnationThreshold})`,
        });
      }

      // Enforcement schedule: constrain@2, force@3
      const restrictedActions: string[] = [];
      let forceReplan = false;

      if (newConsecutiveReadOnly >= 2) {
        let stagnatingAction: string | null = null;
        for (const [, signal] of input) {
          if (isActorMonitoring(signal)) {
            stagnatingAction = signal.actionTaken;
          } else if (isReasonerActorMonitoring(signal)) {
            stagnatingAction = signal.actionTaken;
          }
        }
        if (stagnatingAction) {
          restrictedActions.push(stagnatingAction);
        }
      }

      if (newConsecutiveReadOnly >= 3) {
        forceReplan = true;
      }

      // Compound anomaly: both low confidence AND unexpected result
      let escalation: string | undefined;
      if (hasLowConfidence && hasUnexpectedResult) {
        escalation = 'Compound anomaly: low confidence combined with unexpected result';
        // Replace individual anomalies with a compound one for the escalation
        anomalies.push({
          moduleId: id,
          type: 'compound',
          detail: escalation,
        });
      }

      const newState: MonitorState = {
        confidenceAverage: newConfidenceCount > 0
          ? newConfidenceSum / newConfidenceCount
          : state.confidenceAverage,
        confidenceObservations: newConfidenceCount,
        conflictCount: newConflictCount,
        cycleCount: state.cycleCount + 1,
        consecutiveReadOnlyCycles: newConsecutiveReadOnly,
        recentActionInputs: newRecentInputs,
      };

      const monitoring: MonitorMonitoring = {
        type: 'monitor',
        source: id,
        timestamp: Date.now(),
        anomalyDetected: anomalies.length > 0,
        escalation,
      };

      return {
        output: { anomalies, escalation, restrictedActions, forceReplan },
        state: newState,
        monitoring,
      };
    },

    initialState(): MonitorState {
      return {
        confidenceAverage: 0,
        confidenceObservations: 0,
        conflictCount: 0,
        cycleCount: 0,
        consecutiveReadOnlyCycles: 0,
        recentActionInputs: [],
      };
    },

    stateInvariant(state: MonitorState): boolean {
      return (
        state.confidenceObservations >= 0 &&
        state.conflictCount >= 0 &&
        state.cycleCount >= 0 &&
        state.confidenceAverage >= 0 &&
        state.confidenceAverage <= 1 &&
        state.consecutiveReadOnlyCycles >= 0
      );
    },
  };
}

// ── Type Guards ────────────────────────────────────────────────────

function isReasonerMonitoring(signal: MonitoringSignal): signal is ReasonerMonitoring {
  return 'type' in signal && (signal as { type?: string }).type === 'reasoner';
}

function isActorMonitoring(signal: MonitoringSignal): signal is ActorMonitoring {
  return 'type' in signal && (signal as { type?: string }).type === 'actor';
}

function isReasonerActorMonitoring(signal: MonitoringSignal): signal is ReasonerActorMonitoring {
  return 'type' in signal && (signal as { type?: string }).type === 'reasoner-actor';
}
