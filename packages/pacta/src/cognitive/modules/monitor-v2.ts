/**
 * MonitorV2 — meta-level cognitive module with prediction-error tracking,
 * metacognitive taxonomy, precision weighting, and adaptive thresholds.
 *
 * Drop-in replacement for the v1 Monitor. Implements the same CognitiveModule
 * interface and produces v1-compatible MonitorReport output, while enriching
 * the monitoring signal with prediction errors and metacognitive judgments.
 *
 * Grounded in:
 * - Friston (2009, 2010) — prediction-error tracking
 * - Da Costa et al. (2024) — precision weighting (inverse variance)
 * - Nelson & Narens (1990) — metacognitive judgment taxonomy (EOL, JOL, FOK, RC)
 * - Botvinick et al. (2001, 2004) — conflict monitoring, Gratton effect
 *
 * See docs/prds/035-cognitive-monitoring-control-v2.md for full design.
 */

import type {
  CognitiveModule,
  AggregatedSignals,
  MonitorMonitoring,
  MonitoringSignal,
  ControlDirective,
  StepResult,
  ModuleId,
  ReasonerMonitoring,
  ActorMonitoring,
  ReasonerActorMonitoring,
  MemoryMonitoring,
  EvaluatorMonitoring,
} from '../algebra/index.js';
import { moduleId } from '../algebra/index.js';

import type {
  EnrichedMonitoringSignal,
  MonitorV2State,
  MonitorV2Config,
  ModuleExpectation,
} from '../algebra/enriched-signals.js';

import type { Anomaly, MonitorReport, NoControl } from './monitor.js';

// ── Constants ───────────────────────────────────────────────────────

const READ_ONLY_ACTIONS = new Set(['Read', 'Glob', 'Grep', 'none', 'error', 'escalate']);

/** Minimum variance floor to avoid division by zero in precision computation. */
const MIN_VARIANCE = 1e-6;

// ── Factory ─────────────────────────────────────────────────────────

/**
 * Create a MonitorV2 cognitive module.
 *
 * MonitorV2 extends v1 Monitor with:
 * 1. Prediction-error tracking (Friston 2009) — per-module expectation models
 * 2. Precision weighting (Da Costa 2024) — inverse-variance reliability weights
 * 3. Metacognitive taxonomy (Nelson & Narens 1990) — EOL, JOL, FOK, RC
 * 4. Adaptive thresholds (Botvinick 2001) — Gratton effect on confidence threshold
 *
 * Produces v1-compatible MonitorReport (anomalies, escalation, restrictedActions, forceReplan).
 */
export function createMonitorV2(
  config?: MonitorV2Config,
): CognitiveModule<AggregatedSignals, MonitorReport, MonitorV2State, MonitorMonitoring, NoControl> {
  const baseThreshold = config?.baseConfidenceThreshold ?? 0.3;
  const grattonDelta = config?.grattonDelta ?? 0.05;
  const thresholdFloor = config?.thresholdFloor ?? 0.1;
  const thresholdCeiling = config?.thresholdCeiling ?? 0.6;
  const predictionErrorThreshold = config?.predictionErrorThreshold ?? 1.5;
  const alpha = config?.expectationAlpha ?? 0.2;
  const stagnationThreshold = config?.stagnationThreshold ?? 3;
  const id = moduleId(config?.id ?? 'monitor');

  return {
    id,

    async step(
      input: AggregatedSignals,
      state: MonitorV2State,
      _control: NoControl,
    ): Promise<StepResult<MonitorReport, MonitorV2State, MonitorMonitoring>> {
      const anomalies: Anomaly[] = [];
      let hasLowConfidence = false;
      let hasUnexpectedResult = false;
      let actorWasReadOnly: boolean | null = null;
      let currentActionInput: string | null = null;

      // Deep-copy per-module expectations and precision weights
      const newExpectations = new Map<ModuleId, ModuleExpectation>(state.expectations);
      const newPrecisionWeights = new Map<ModuleId, number>(state.precisionWeights);

      // Backward-compat v1 counters
      let newConfidenceSum = state.confidenceAverage * state.confidenceObservations;
      let newConfidenceCount = state.confidenceObservations;
      let newConflictCount = state.conflictCount;

      // Collect enriched signal data for the monitoring output
      let maxPredictionError = 0;

      // Metacognitive signals — computed from observable inputs
      let eol: number | undefined;
      let jol: number | undefined;
      let fok: boolean | undefined;
      let rc: number | undefined;
      let conflictEnergy: number | undefined;

      // Track action success for RC computation
      let actionSuccessCount = 0;
      let actionTotalCount = 0;

      // ── Phase 1: Update expectation models and compute prediction errors ──

      for (const [sourceId, signal] of input) {
        // Handle reasoner signals (confidence tracking)
        if (isReasonerMonitoring(signal)) {
          const observed = signal.confidence;
          newConfidenceSum += observed;
          newConfidenceCount += 1;

          // Update expectation model and compute prediction error
          const predError = updateExpectationAndComputeError(
            newExpectations, sourceId, observed, alpha,
          );

          if (predError > maxPredictionError) {
            maxPredictionError = predError;
          }

          // Anomaly: confidence below adaptive threshold
          if (observed < state.adaptiveThreshold) {
            hasLowConfidence = true;
            anomalies.push({
              moduleId: sourceId,
              type: 'low-confidence',
              detail: `Confidence ${observed} below adaptive threshold ${state.adaptiveThreshold.toFixed(3)}`,
            });
          }

          // Anomaly: large prediction error
          if (predError > predictionErrorThreshold) {
            anomalies.push({
              moduleId: sourceId,
              type: 'unexpected-result',
              detail: `Prediction error ${predError.toFixed(3)} exceeds threshold ${predictionErrorThreshold}`,
            });
            hasUnexpectedResult = true;
          }

          if (signal.conflictDetected) {
            newConflictCount += 1;
          }
        }

        // Handle actor signals (action outcome tracking)
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
          actionTotalCount += 1;
          if (signal.success) actionSuccessCount += 1;
        } else if (isReasonerActorMonitoring(signal)) {
          // Combined reasoner-actor signal
          const observed = signal.confidence;
          newConfidenceSum += observed;
          newConfidenceCount += 1;

          const predError = updateExpectationAndComputeError(
            newExpectations, sourceId, observed, alpha,
          );

          if (predError > maxPredictionError) {
            maxPredictionError = predError;
          }

          if (observed < state.adaptiveThreshold) {
            hasLowConfidence = true;
            anomalies.push({
              moduleId: sourceId,
              type: 'low-confidence',
              detail: `Confidence ${observed} below adaptive threshold ${state.adaptiveThreshold.toFixed(3)}`,
            });
          }

          if (predError > predictionErrorThreshold) {
            anomalies.push({
              moduleId: sourceId,
              type: 'unexpected-result',
              detail: `Prediction error ${predError.toFixed(3)} exceeds threshold ${predictionErrorThreshold}`,
            });
            hasUnexpectedResult = true;
          }

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
          actionTotalCount += 1;
          if (signal.success) actionSuccessCount += 1;
        }

        // Handle memory signals (FOK computation)
        if (isMemoryMonitoring(signal)) {
          if (signal.relevanceScore > 0 && signal.retrievalCount === 0) {
            fok = true;
          }
        }

        // Handle evaluator signals (JOL computation)
        if (isEvaluatorMonitoring(signal)) {
          jol = signal.estimatedProgress;
        }
      }

      // ── Phase 2: Update precision weights (inverse variance) ──

      for (const [modId, expectation] of newExpectations) {
        const variance = Math.max(expectation.varianceConfidence, MIN_VARIANCE);
        newPrecisionWeights.set(modId, 1.0 / variance);
      }

      // ── Phase 3: Compute metacognitive judgments ──

      // EOL: workspace complexity — use entry count from aggregated signals size
      // Higher signal count = higher complexity
      const signalCount = input.size;
      if (signalCount > 0) {
        // Compute diversity of signal types
        const signalTypes = new Set<string>();
        for (const [, signal] of input) {
          if ('type' in signal) {
            signalTypes.add((signal as { type?: string }).type ?? 'unknown');
          }
        }
        // EOL = normalized complexity: entry count * type diversity factor
        const diversityFactor = signalTypes.size / Math.max(signalCount, 1);
        eol = Math.min(1.0, (signalCount / 10) * (0.5 + 0.5 * diversityFactor));
      }

      // JOL: already set from evaluator signals above (if any)

      // FOK: already set from memory signals above (if any)

      // RC: action success rate adjusted by prediction error magnitude
      if (actionTotalCount > 0) {
        const successRate = actionSuccessCount / actionTotalCount;
        // RC penalized by high prediction error: error dampens confidence
        const errorPenalty = Math.min(1.0, maxPredictionError / (predictionErrorThreshold * 2));
        rc = Math.max(0, successRate - errorPenalty);
      }

      // Conflict energy: co-activated incompatible responses
      // Computed from reasoner signals that detect conflict
      let conflictSignalCount = 0;
      let totalReasonerSignals = 0;
      for (const [, signal] of input) {
        if (isReasonerMonitoring(signal)) {
          totalReasonerSignals += 1;
          if (signal.conflictDetected) conflictSignalCount += 1;
        }
        if (isReasonerActorMonitoring(signal)) {
          totalReasonerSignals += 1;
        }
      }
      if (totalReasonerSignals > 0 && conflictSignalCount > 0) {
        conflictEnergy = conflictSignalCount / totalReasonerSignals;
      }

      // ── Phase 4: Stagnation tracking (carried from v1) ──

      const newRecentInputs = [...state.recentActionInputs];
      if (currentActionInput !== null) {
        newRecentInputs.push(currentActionInput);
        if (newRecentInputs.length > 6) newRecentInputs.shift();
      }

      const isExploring = actorWasReadOnly && newRecentInputs.length >= 2
        ? new Set(newRecentInputs.slice(-3)).size >= 2
        : false;

      const newConsecutiveReadOnly = actorWasReadOnly === null
        ? state.consecutiveReadOnlyCycles
        : actorWasReadOnly && !isExploring
          ? state.consecutiveReadOnlyCycles + 1
          : actorWasReadOnly && isExploring
            ? Math.max(0, state.consecutiveReadOnlyCycles - 1)
            : 0;

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

      // ── Phase 5: Compound anomaly escalation ──

      let escalation: string | undefined;
      if (hasLowConfidence && hasUnexpectedResult) {
        escalation = 'Compound anomaly: low confidence combined with unexpected result';
        anomalies.push({
          moduleId: id,
          type: 'compound',
          detail: escalation,
        });
      }

      // ── Phase 6: Adaptive threshold — Gratton effect ──

      const intervened = anomalies.length > 0;
      let newThreshold: number;

      if (state.previousCycleIntervened) {
        // Previous cycle intervened → lower threshold (expect more conflict, be vigilant)
        newThreshold = state.adaptiveThreshold - grattonDelta;
      } else {
        // Previous cycle was clean → raise threshold (expect routine, conserve resources)
        newThreshold = state.adaptiveThreshold + grattonDelta;
      }

      // Clamp to [thresholdFloor, thresholdCeiling]
      newThreshold = Math.max(thresholdFloor, Math.min(thresholdCeiling, newThreshold));

      // ── Phase 7: Assemble new state ──

      const newState: MonitorV2State = {
        expectations: newExpectations,
        precisionWeights: newPrecisionWeights,
        adaptiveThreshold: newThreshold,
        previousCycleIntervened: intervened,
        consecutiveInterventions: intervened
          ? state.consecutiveInterventions + 1
          : 0,
        cycleCount: state.cycleCount + 1,
        conflictCount: newConflictCount,
        confidenceAverage: newConfidenceCount > 0
          ? newConfidenceSum / newConfidenceCount
          : state.confidenceAverage,
        confidenceObservations: newConfidenceCount,
        consecutiveReadOnlyCycles: newConsecutiveReadOnly,
        recentActionInputs: newRecentInputs,
      };

      // ── Phase 8: Produce enriched monitoring signal ──

      // Build the enriched signal — extends MonitorMonitoring with v2 fields
      const monitoring: MonitorMonitoring & EnrichedMonitoringSignal = {
        type: 'monitor',
        source: id,
        timestamp: Date.now(),
        anomalyDetected: anomalies.length > 0,
        escalation,
        // Enriched fields
        predictionError: maxPredictionError,
        precision: computeAveragePrecision(newPrecisionWeights),
        eol,
        jol,
        fok,
        rc,
        conflictEnergy,
      };

      return {
        output: { anomalies, escalation, restrictedActions, forceReplan },
        state: newState,
        monitoring,
      };
    },

    initialState(): MonitorV2State {
      return {
        expectations: new Map(),
        precisionWeights: new Map(),
        adaptiveThreshold: baseThreshold,
        previousCycleIntervened: false,
        consecutiveInterventions: 0,
        cycleCount: 0,
        conflictCount: 0,
        confidenceAverage: 0,
        confidenceObservations: 0,
        consecutiveReadOnlyCycles: 0,
        recentActionInputs: [],
      };
    },

    stateInvariant(state: MonitorV2State): boolean {
      return (
        state.cycleCount >= 0 &&
        state.conflictCount >= 0 &&
        state.confidenceObservations >= 0 &&
        state.confidenceAverage >= 0 &&
        state.confidenceAverage <= 1 &&
        state.consecutiveReadOnlyCycles >= 0 &&
        state.adaptiveThreshold >= thresholdFloor &&
        state.adaptiveThreshold <= thresholdCeiling &&
        state.consecutiveInterventions >= 0
      );
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Update a module's expectation model with a new confidence observation
 * and return the computed prediction error.
 *
 * Uses exponential moving average for mean and variance updates.
 * Prediction error: |observed - mean| / sqrt(variance)
 */
function updateExpectationAndComputeError(
  expectations: Map<ModuleId, ModuleExpectation>,
  sourceId: ModuleId,
  observed: number,
  alpha: number,
): number {
  const existing = expectations.get(sourceId);

  if (!existing || existing.observations === 0) {
    // First observation: initialize expectation model
    expectations.set(sourceId, {
      confidenceRange: [observed, observed],
      expectedDurationMs: 0,
      meanConfidence: observed,
      varianceConfidence: MIN_VARIANCE, // small initial variance
      observations: 1,
      alpha,
    });
    return 0; // No prediction error on first observation
  }

  // Compute prediction error BEFORE updating the model
  const variance = Math.max(existing.varianceConfidence, MIN_VARIANCE);
  const predictionError = Math.abs(observed - existing.meanConfidence) / Math.sqrt(variance);

  // Update mean via EMA
  const newMean = existing.meanConfidence + alpha * (observed - existing.meanConfidence);

  // Update variance via EMA of squared deviation
  const deviation = observed - existing.meanConfidence;
  const newVariance = (1 - alpha) * existing.varianceConfidence + alpha * deviation * deviation;

  // Update confidence range
  const newMin = Math.min(existing.confidenceRange[0], observed);
  const newMax = Math.max(existing.confidenceRange[1], observed);

  expectations.set(sourceId, {
    confidenceRange: [newMin, newMax],
    expectedDurationMs: existing.expectedDurationMs,
    meanConfidence: newMean,
    varianceConfidence: Math.max(newVariance, MIN_VARIANCE),
    observations: existing.observations + 1,
    alpha,
  });

  return predictionError;
}

/**
 * Compute the average precision across all tracked modules.
 */
function computeAveragePrecision(precisionWeights: Map<ModuleId, number>): number {
  if (precisionWeights.size === 0) return 0;
  let sum = 0;
  for (const [, weight] of precisionWeights) {
    sum += weight;
  }
  return sum / precisionWeights.size;
}

// ── Type Guards ─────────────────────────────────────────────────────

function isReasonerMonitoring(signal: MonitoringSignal): signal is ReasonerMonitoring {
  return 'type' in signal && (signal as { type?: string }).type === 'reasoner';
}

function isActorMonitoring(signal: MonitoringSignal): signal is ActorMonitoring {
  return 'type' in signal && (signal as { type?: string }).type === 'actor';
}

function isReasonerActorMonitoring(signal: MonitoringSignal): signal is ReasonerActorMonitoring {
  return 'type' in signal && (signal as { type?: string }).type === 'reasoner-actor';
}

function isMemoryMonitoring(signal: MonitoringSignal): signal is MemoryMonitoring {
  return 'type' in signal && (signal as { type?: string }).type === 'memory';
}

function isEvaluatorMonitoring(signal: MonitoringSignal): signal is EvaluatorMonitoring {
  return 'type' in signal && (signal as { type?: string }).type === 'evaluator';
}
