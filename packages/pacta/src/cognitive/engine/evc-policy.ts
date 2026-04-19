// SPDX-License-Identifier: Apache-2.0
/**
 * EVC-Based Threshold Policy — Expected Value of Control gating.
 *
 * Replaces fixed threshold policies with a cost-benefit calculation
 * following Shenhav, Botvinick & Cohen (2013). The EVC equation:
 *
 *   intervene when E[payoff] - E[cost] + bias > 0
 *
 * - Payoff: prediction error magnitude x payoffWeight.
 *   Higher error = more room for improvement via control.
 * - Cost: remaining budget consumption estimate x costWeight.
 *   If budget nearly exhausted, cost is high.
 * - minPredictionError: below this, never intervene (routine cycle).
 * - bias: positive favors intervention, negative favors skipping.
 *
 * Compatibility:
 * - MonitorV2 + EVC: reads predictionError from EnrichedMonitoringSignal
 * - MonitorV1 + EVC: uses proxyPE = 1 - confidence as fallback
 *
 * Reference: Shenhav, A., Botvinick, M.M., & Cohen, J.D. (2013).
 * "The Expected Value of Control." Neuron, 79(2).
 */

import type { ThresholdPolicy } from '../engine/cycle.js';
import type { EVCConfig } from '../algebra/enriched-signals.js';
import type { AggregatedSignals, MonitoringSignal } from '../algebra/module.js';

// ── Enriched Signal Detection ───────────────────────────────────

/**
 * Check whether a signal carries enriched v2 fields (predictionError).
 * Uses structural typing — no instanceof check needed.
 */
function hasEnrichedFields(signal: MonitoringSignal): signal is MonitoringSignal & { predictionError: number } {
  return (
    typeof (signal as unknown as Record<string, unknown>).predictionError === 'number'
  );
}

/**
 * Check whether a signal carries a confidence field (v1 reasoner-style).
 */
function hasConfidenceField(signal: MonitoringSignal): signal is MonitoringSignal & { confidence: number } {
  return (
    typeof (signal as unknown as Record<string, unknown>).confidence === 'number'
  );
}

/**
 * Check whether a signal is an evaluator signal with estimatedProgress.
 */
function hasEstimatedProgress(signal: MonitoringSignal): signal is MonitoringSignal & { estimatedProgress: number } {
  return (
    typeof (signal as unknown as Record<string, unknown>).estimatedProgress === 'number'
  );
}

// ── Prediction Error Extraction ─────────────────────────────────

/**
 * Extract the best prediction error estimate from aggregated signals.
 *
 * Strategy:
 * 1. If any signal carries `predictionError` (enriched v2), use the maximum.
 * 2. Else, if any signal carries `confidence` (v1), use proxyPE = 1 - confidence
 *    from the signal with the lowest confidence (worst case).
 * 3. If neither is available, return 0 (no evidence for intervention).
 */
function extractPredictionError(signals: AggregatedSignals): number {
  let maxEnrichedPE = -1;
  let minConfidence = Infinity;
  let hasEnriched = false;
  let hasConfidence = false;

  for (const signal of signals.values()) {
    if (hasEnrichedFields(signal)) {
      hasEnriched = true;
      const pe = signal.predictionError;
      if (pe > maxEnrichedPE) {
        maxEnrichedPE = pe;
      }
    }

    if (hasConfidenceField(signal)) {
      hasConfidence = true;
      if (signal.confidence < minConfidence) {
        minConfidence = signal.confidence;
      }
    }
  }

  // Prefer enriched prediction error when available
  if (hasEnriched) {
    return Math.max(0, maxEnrichedPE);
  }

  // Fallback: proxy PE from v1 confidence
  if (hasConfidence && Number.isFinite(minConfidence)) {
    return Math.max(0, 1 - minConfidence);
  }

  // No usable signals
  return 0;
}

// ── Budget Consumption Estimation ───────────────────────────────

/**
 * Estimate how much of the cycle budget has been consumed, as a ratio in [0, 1].
 *
 * Strategy:
 * 1. If an evaluator signal with `estimatedProgress` is present, use it directly.
 *    Progress = 0.9 means 90% of the task is done, so 90% of budget consumed.
 * 2. Otherwise, estimate from signal count: each signal represents one module
 *    that has already executed. With 8 total phases, signal count / 8 estimates
 *    budget consumption. Clamped to [0, 1].
 */
function estimateBudgetConsumption(signals: AggregatedSignals): number {
  // Prefer evaluator's progress estimate
  for (const signal of signals.values()) {
    if (hasEstimatedProgress(signal)) {
      return Math.min(1, Math.max(0, signal.estimatedProgress));
    }
  }

  // Fallback: estimate from signal count (8 total phases in a full cycle)
  const signalCount = signals.size;
  return Math.min(1, signalCount / 8);
}

// ── EVC Policy Factory ──────────────────────────────────────────

/**
 * Create an EVC-based ThresholdPolicy.
 *
 * Returns a predicate-type ThresholdPolicy compatible with CycleConfig.thresholds.
 * The policy estimates expected value of control from prediction error magnitude
 * and remaining budget, intervening only when expected payoff exceeds expected cost.
 *
 * @param config - EVC configuration. All fields optional with sensible defaults.
 * @returns A ThresholdPolicy of type 'predicate'.
 *
 * Reference: Shenhav, Botvinick, Cohen (2013) — Expected Value of Control.
 */
export function evcThresholdPolicy(config?: EVCConfig): ThresholdPolicy {
  const payoffWeight = config?.payoffWeight ?? 1.0;
  const costWeight = config?.costWeight ?? 1.0;
  const minPredictionError = config?.minPredictionError ?? 0.1;
  const bias = config?.bias ?? 0.0;

  return {
    type: 'predicate' as const,
    shouldIntervene(signals: AggregatedSignals): boolean {
      // Extract prediction error (enriched or proxy)
      const pe = extractPredictionError(signals);

      // Below minimum PE threshold: never intervene (routine cycle)
      if (pe < minPredictionError) {
        return false;
      }

      // Expected payoff: prediction error magnitude x weight
      const expectedPayoff = pe * payoffWeight;

      // Expected cost: budget consumption ratio x weight
      // Higher consumption = higher cost of further intervention
      const budgetConsumed = estimateBudgetConsumption(signals);
      const expectedCost = budgetConsumed * costWeight;

      // EVC decision: intervene when payoff - cost + bias > 0
      return (expectedPayoff - expectedCost + bias) > 0;
    },
  };
}
