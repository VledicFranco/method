/**
 * Monitor — meta-level cognitive module for anomaly detection and escalation.
 *
 * Reads aggregated monitoring signals (mu) from all object-level modules,
 * maintains an abstracted model of object-level behavior (running averages,
 * conflict counts), and produces anomaly reports with escalation recommendations.
 *
 * Grounded in: Nelson & Narens monitor/control metacognition — the Monitor
 * observes but does not directly intervene; it reports upward.
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

    async step(
      input: AggregatedSignals,
      state: MonitorState,
      _control: NoControl,
    ): Promise<StepResult<MonitorReport, MonitorState, MonitorMonitoring>> {
      const anomalies: Anomaly[] = [];
      let hasLowConfidence = false;
      let hasUnexpectedResult = false;
      let actorWasReadOnly: boolean | null = null; // null = no actor signal this cycle

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
        if (isActorMonitoring(signal) || isReasonerActorMonitoring(signal)) {
          // unexpectedResult check (only for ActorMonitoring)
          if (isActorMonitoring(signal) && signal.unexpectedResult) {
            hasUnexpectedResult = true;
            anomalies.push({
              moduleId: sourceId,
              type: 'unexpected-result',
              detail: `Unexpected result from action: ${signal.actionTaken}`,
            });
          }
          // stagnation tracking (for both actor and reasoner-actor)
          actorWasReadOnly = READ_ONLY_ACTIONS.has((signal as any).actionTaken);
        }
      }

      // Only update stagnation counter if we saw an actor signal
      const newConsecutiveReadOnly = actorWasReadOnly === null
        ? state.consecutiveReadOnlyCycles  // no actor signal, preserve counter
        : actorWasReadOnly
          ? state.consecutiveReadOnlyCycles + 1
          : 0;  // reset on write

      // Stagnation: too many cycles without a write
      if (newConsecutiveReadOnly >= stagnationThreshold) {
        anomalies.push({
          moduleId: id,
          type: 'low-confidence',
          detail: `Stagnation: ${newConsecutiveReadOnly} consecutive read-only cycles (threshold: ${stagnationThreshold})`,
        });
      }

      // Enforcement schedule (Mira's): constrain@2, force@3
      const restrictedActions: string[] = [];
      let forceReplan = false;

      if (newConsecutiveReadOnly >= 2) {
        // Find the stagnating action type from actor signal
        let stagnatingAction: string | null = null;
        for (const [, signal] of input) {
          if (isActorMonitoring(signal) || isReasonerActorMonitoring(signal)) {
            stagnatingAction = (signal as any).actionTaken;
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
  return 'type' in signal && (signal as ReasonerMonitoring).type === 'reasoner';
}

function isActorMonitoring(signal: MonitoringSignal): signal is ActorMonitoring {
  return 'type' in signal && (signal as ActorMonitoring).type === 'actor';
}

function isReasonerActorMonitoring(signal: MonitoringSignal): boolean {
  return 'type' in signal && (signal as any).type === 'reasoner-actor';
}
