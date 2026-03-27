/**
 * Unit tests for Evaluator meta-level cognitive module.
 *
 * Tests: progress estimation from monitoring signals, diminishing returns
 * detection, evaluation horizon directive handling.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { moduleId } from '../../algebra/index.js';
import type {
  ModuleId,
  MonitoringSignal,
  ReasonerMonitoring,
  ActorMonitoring,
} from '../../algebra/index.js';
import { createEvaluator } from '../evaluator.js';
import type { EvaluatorControl, EvaluatorInput } from '../evaluator.js';

// ── Helpers ──────────────────────────────────────────────────────────

const REASONER_ID = moduleId('reasoner-1');
const ACTOR_ID = moduleId('actor-1');

function makeControl(horizon: 'immediate' | 'trajectory'): EvaluatorControl {
  return {
    target: moduleId('evaluator'),
    timestamp: Date.now(),
    evaluationHorizon: horizon,
  };
}

function makeInput(signals: Map<ModuleId, MonitoringSignal>): EvaluatorInput {
  return {
    workspace: [],
    signals,
  };
}

function makeReasonerSignal(confidence: number): ReasonerMonitoring {
  return {
    type: 'reasoner',
    source: REASONER_ID,
    timestamp: Date.now(),
    confidence,
    conflictDetected: false,
    effortLevel: 'medium',
  };
}

function makeActorSignal(success: boolean): ActorMonitoring {
  return {
    type: 'actor',
    source: ACTOR_ID,
    timestamp: Date.now(),
    actionTaken: 'test_action',
    success,
    unexpectedResult: false,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Evaluator module', () => {
  it('estimates progress from monitoring signals (high confidence = high progress)', async () => {
    const evaluator = createEvaluator();
    const state = evaluator.initialState();

    // High confidence reasoner + successful actor = high progress
    const signals = new Map<ModuleId, MonitoringSignal>([
      [REASONER_ID, makeReasonerSignal(0.9)],
      [ACTOR_ID, makeActorSignal(true)],
    ]);

    const result = await evaluator.step(
      makeInput(signals),
      state,
      makeControl('immediate'),
    );

    // Average of 0.9 (reasoner) and 1.0 (successful actor) = 0.95
    assert.equal(result.output.estimatedProgress, 0.95);
    assert.equal(result.monitoring.estimatedProgress, 0.95);
    assert.equal(result.monitoring.type, 'evaluator');
    assert.equal(result.output.diminishingReturns, false);

    // Low confidence + failed actor = low progress
    const lowSignals = new Map<ModuleId, MonitoringSignal>([
      [REASONER_ID, makeReasonerSignal(0.2)],
      [ACTOR_ID, makeActorSignal(false)],
    ]);

    const result2 = await evaluator.step(
      makeInput(lowSignals),
      state,
      makeControl('immediate'),
    );

    // Average of 0.2 and 0.0 = 0.1
    assert.equal(result2.output.estimatedProgress, 0.1);
  });

  it('detects diminishing returns (flat progress over 3 cycles)', async () => {
    const evaluator = createEvaluator({ diminishingReturnsWindow: 3 });
    let state = evaluator.initialState();

    // Run 3 cycles with flat/declining progress using trajectory mode
    const flatSignals = new Map<ModuleId, MonitoringSignal>([
      [REASONER_ID, makeReasonerSignal(0.5)],
      [ACTOR_ID, makeActorSignal(true)],
    ]);

    // Cycle 1: progress = 0.75
    const r1 = await evaluator.step(makeInput(flatSignals), state, makeControl('trajectory'));
    state = r1.state;
    assert.equal(r1.output.diminishingReturns, false); // Not enough history

    // Cycle 2: same signals, same progress → flat
    const r2 = await evaluator.step(makeInput(flatSignals), state, makeControl('trajectory'));
    state = r2.state;
    assert.equal(r2.output.diminishingReturns, false); // Only 2 cycles

    // Cycle 3: same signals again → 3 flat cycles → diminishing returns
    const r3 = await evaluator.step(makeInput(flatSignals), state, makeControl('trajectory'));
    state = r3.state;
    assert.equal(r3.output.diminishingReturns, true);
    assert.equal(r3.monitoring.diminishingReturns, true);
  });

  it('respects evaluationHorizon directive (immediate vs trajectory)', async () => {
    const evaluator = createEvaluator({ diminishingReturnsWindow: 2 });

    // Pre-populate state with declining history
    const state = {
      progressHistory: [0.8, 0.5],
      cycleCount: 2,
    };

    const signals = new Map<ModuleId, MonitoringSignal>([
      [REASONER_ID, makeReasonerSignal(0.3)],
    ]);

    // With trajectory: should detect diminishing returns (0.8, 0.5, 0.3 = declining)
    const trajectoryResult = await evaluator.step(
      makeInput(signals),
      state,
      makeControl('trajectory'),
    );
    assert.equal(trajectoryResult.output.diminishingReturns, true);

    // With immediate: ignores history, no diminishing returns
    const immediateResult = await evaluator.step(
      makeInput(signals),
      state,
      makeControl('immediate'),
    );
    assert.equal(immediateResult.output.diminishingReturns, false);

    // Both should report the same estimated progress for the current cycle
    assert.equal(trajectoryResult.output.estimatedProgress, immediateResult.output.estimatedProgress);
  });
});
