/**
 * Unit tests for EVC-based threshold policy (PRD 035, C-3).
 *
 * 6 scenarios validating cost-benefit control gating:
 * 1. shouldIntervene = true when prediction error exceeds cost
 * 2. shouldIntervene = false when cost exceeds payoff (AC-10)
 * 3. shouldIntervene = false when prediction error below minPredictionError
 * 4. Respects bias term (positive bias favors intervention)
 * 5. Reads enriched signals (uses predictionError directly)
 * 6. Falls back to v1 signal fields (uses 1 - confidence as proxy)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evcThresholdPolicy } from '../evc-policy.js';
import type { ThresholdPolicy } from '../cycle.js';
import type { AggregatedSignals, MonitoringSignal } from '../../algebra/module.js';
import { moduleId } from '../../algebra/module.js';
import type { EnrichedMonitoringSignal } from '../../algebra/enriched-signals.js';

// ── Test Helpers ────────────────────────────────────────────────

/**
 * Narrow a ThresholdPolicy to predicate type and return the shouldIntervene function.
 * Asserts the policy is a predicate type — fails the test if not.
 */
function assertPredicate(policy: ThresholdPolicy): (signals: AggregatedSignals) => boolean {
  assert.equal(policy.type, 'predicate', 'EVC policy must be predicate type');
  if (policy.type !== 'predicate') throw new Error('unreachable');
  return policy.shouldIntervene;
}

/** Create a basic v1 monitoring signal with confidence. */
function v1Signal(source: string, confidence: number): MonitoringSignal & { type: string; confidence: number } {
  return {
    source: moduleId(source),
    timestamp: Date.now(),
    type: 'reasoner',
    confidence,
  };
}

/** Create an enriched v2 monitoring signal with predictionError. */
function enrichedSignal(source: string, predictionError: number): EnrichedMonitoringSignal {
  return {
    source: moduleId(source),
    timestamp: Date.now(),
    predictionError,
  };
}

/** Create an evaluator monitoring signal with estimatedProgress. */
function evaluatorSignal(estimatedProgress: number): MonitoringSignal & { type: string; estimatedProgress: number; diminishingReturns: boolean } {
  return {
    source: moduleId('evaluator'),
    timestamp: Date.now(),
    type: 'evaluator',
    estimatedProgress,
    diminishingReturns: false,
  };
}

/** Build AggregatedSignals from an array of [key, signal] pairs. */
function buildSignals(...entries: Array<[string, MonitoringSignal]>): AggregatedSignals {
  const map: AggregatedSignals = new Map();
  for (const [key, signal] of entries) {
    map.set(moduleId(key), signal);
  }
  return map;
}

// ── Tests ───────────────────────────────────────────────────────

describe('evcThresholdPolicy', () => {

  it('1. returns shouldIntervene = true when prediction error exceeds cost', () => {
    const policy = evcThresholdPolicy();
    const shouldIntervene = assertPredicate(policy);

    // High prediction error (0.8), low budget consumption (10% progress)
    // Payoff: 0.8 * 1.0 = 0.8
    // Cost:   0.1 * 1.0 = 0.1
    // EVC: 0.8 - 0.1 = 0.7 > 0 → intervene
    const signals = buildSignals(
      ['reasoner', enrichedSignal('reasoner', 0.8)],
      ['evaluator', evaluatorSignal(0.1)],
    );

    const result = shouldIntervene(signals);
    assert.equal(result, true, 'Should intervene when payoff (0.8) > cost (0.1)');
  });

  it('2. returns shouldIntervene = false when cost exceeds payoff (AC-10: 90% exhausted + moderate PE 0.3)', () => {
    const shouldIntervene = assertPredicate(evcThresholdPolicy());

    // Moderate prediction error (0.3), 90% budget exhausted
    // Payoff: 0.3 * 1.0 = 0.3
    // Cost:   0.9 * 1.0 = 0.9
    // EVC: 0.3 - 0.9 = -0.6 < 0 → don't intervene
    const signals = buildSignals(
      ['reasoner', enrichedSignal('reasoner', 0.3)],
      ['evaluator', evaluatorSignal(0.9)],
    );

    const result = shouldIntervene(signals);
    assert.equal(result, false, 'Should NOT intervene when cost (0.9) > payoff (0.3)');
  });

  it('3. returns shouldIntervene = false when prediction error below minPredictionError', () => {
    const shouldIntervene = assertPredicate(evcThresholdPolicy({ minPredictionError: 0.1 }));

    // Very small prediction error (0.05) — below threshold
    // Even with low budget consumption, should not intervene
    const signals = buildSignals(
      ['reasoner', enrichedSignal('reasoner', 0.05)],
      ['evaluator', evaluatorSignal(0.1)],
    );

    const result = shouldIntervene(signals);
    assert.equal(result, false, 'Should NOT intervene when PE (0.05) < minPredictionError (0.1)');
  });

  it('4. respects bias term — positive bias favors intervention', () => {
    // Without bias: PE 0.3, budget 0.5 → payoff 0.3, cost 0.5 → EVC = -0.2 → no
    const shouldIntervenNoBias = assertPredicate(evcThresholdPolicy());
    const signals = buildSignals(
      ['reasoner', enrichedSignal('reasoner', 0.3)],
      ['evaluator', evaluatorSignal(0.5)],
    );
    assert.equal(
      shouldIntervenNoBias(signals), false,
      'Without bias: should NOT intervene (EVC = -0.2)',
    );

    // With positive bias of 0.3: EVC = -0.2 + 0.3 = 0.1 > 0 → yes
    const shouldInterveneWithBias = assertPredicate(evcThresholdPolicy({ bias: 0.3 }));
    assert.equal(
      shouldInterveneWithBias(signals), true,
      'With positive bias (0.3): should intervene (EVC = 0.1)',
    );

    // With negative bias of -1.0: even high PE becomes suppressed
    // PE 0.8, budget 0.1 → payoff 0.8, cost 0.1 → EVC without bias = 0.7
    // EVC with -1.0 bias = 0.7 - 1.0 = -0.3 < 0 → no intervention
    const shouldInterveneNegBias = assertPredicate(evcThresholdPolicy({ bias: -1.0 }));
    const highPeSignals = buildSignals(
      ['reasoner', enrichedSignal('reasoner', 0.8)],
      ['evaluator', evaluatorSignal(0.1)],
    );
    assert.equal(
      shouldInterveneNegBias(highPeSignals), false,
      'With large negative bias (-1.0): EVC = 0.8 - 0.1 - 1.0 = -0.3 → no intervention',
    );
  });

  it('5. reads enriched signals when available — uses predictionError directly', () => {
    const shouldIntervene = assertPredicate(evcThresholdPolicy());

    // Enriched signal with explicit predictionError = 0.6
    // No evaluator → budget estimated from signal count (1 signal / 8 phases = 0.125)
    // Payoff: 0.6 * 1.0 = 0.6
    // Cost:   0.125 * 1.0 = 0.125
    // EVC: 0.6 - 0.125 = 0.475 > 0 → intervene
    const signals = buildSignals(
      ['monitor', enrichedSignal('monitor', 0.6)],
    );

    const result = shouldIntervene(signals);
    assert.equal(result, true, 'Should use enriched predictionError directly');

    // Verify it uses the enriched PE, not the confidence fallback
    // If it were using confidence fallback, a signal without confidence
    // would produce PE = 0, and no intervention would happen.
    // The fact that it intervenes proves it read predictionError.
  });

  it('6. falls back to v1 signal fields when enriched signals absent — uses 1 - confidence as proxy', () => {
    const shouldIntervene = assertPredicate(evcThresholdPolicy());

    // v1 signal with confidence = 0.3 → proxyPE = 1 - 0.3 = 0.7
    // With evaluator at 10% progress → cost = 0.1
    // Payoff: 0.7 * 1.0 = 0.7
    // Cost:   0.1 * 1.0 = 0.1
    // EVC: 0.7 - 0.1 = 0.6 > 0 → intervene
    const signalsLowConf = buildSignals(
      ['reasoner', v1Signal('reasoner', 0.3)],
      ['evaluator', evaluatorSignal(0.1)],
    );
    assert.equal(
      shouldIntervene(signalsLowConf), true,
      'Low confidence (0.3) → proxy PE (0.7) → should intervene',
    );

    // v1 signal with confidence = 0.95 → proxyPE = 0.05 < minPredictionError (0.1)
    // Should NOT intervene — routine cycle
    const signalsHighConf = buildSignals(
      ['reasoner', v1Signal('reasoner', 0.95)],
      ['evaluator', evaluatorSignal(0.1)],
    );
    assert.equal(
      shouldIntervene(signalsHighConf), false,
      'High confidence (0.95) → proxy PE (0.05) < min (0.1) → no intervention',
    );
  });

});
