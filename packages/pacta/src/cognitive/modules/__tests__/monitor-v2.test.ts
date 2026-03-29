/**
 * Unit tests for MonitorV2 meta-level cognitive module.
 *
 * Tests: prediction-error tracking (Friston 2009), precision weighting (Da Costa 2024),
 * metacognitive taxonomy (Nelson & Narens 1990), adaptive thresholds (Botvinick 2001),
 * conflict energy, v1-compatible MonitorReport output, CognitiveModule interface compliance.
 *
 * 15 test scenarios covering all acceptance criteria (AC-01 through AC-04).
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { moduleId } from '../../algebra/index.js';
import type {
  ModuleId,
  AggregatedSignals,
  MonitoringSignal,
  ReasonerMonitoring,
  ActorMonitoring,
  MemoryMonitoring,
  EvaluatorMonitoring,
  CognitiveModule,
  MonitorMonitoring,
} from '../../algebra/index.js';
import type { MonitorV2State, EnrichedMonitoringSignal } from '../../algebra/enriched-signals.js';
import { createMonitorV2 } from '../monitor-v2.js';
import type { MonitorReport, NoControl } from '../monitor.js';

// ── Helpers ──────────────────────────────────────────────────────────

const REASONER_ID = moduleId('reasoner-1');
const REASONER_B_ID = moduleId('reasoner-b');
const ACTOR_ID = moduleId('actor-1');
const MEMORY_ID = moduleId('memory-1');
const EVALUATOR_ID = moduleId('evaluator-1');

function makeNoControl(): NoControl {
  return {
    target: moduleId('monitor'),
    timestamp: Date.now(),
  } as unknown as NoControl;
}

function makeReasonerSignal(id: ModuleId, confidence: number, conflict = false): ReasonerMonitoring {
  return {
    type: 'reasoner',
    source: id,
    timestamp: Date.now(),
    confidence,
    conflictDetected: conflict,
    effortLevel: 'medium',
  };
}

function makeActorSignal(
  id: ModuleId,
  success: boolean,
  unexpected: boolean,
  action = 'test_action',
): ActorMonitoring {
  return {
    type: 'actor',
    source: id,
    timestamp: Date.now(),
    actionTaken: action,
    success,
    unexpectedResult: unexpected,
  };
}

function makeMemorySignal(id: ModuleId, relevanceScore: number, retrievalCount: number): MemoryMonitoring {
  return {
    type: 'memory',
    source: id,
    timestamp: Date.now(),
    relevanceScore,
    retrievalCount,
  };
}

function makeEvaluatorSignal(id: ModuleId, estimatedProgress: number, diminishing = false): EvaluatorMonitoring {
  return {
    type: 'evaluator',
    source: id,
    timestamp: Date.now(),
    estimatedProgress,
    diminishingReturns: diminishing,
  };
}

/**
 * Run multiple cycles feeding the same confidence value to build a stable expectation model.
 */
async function buildStableExpectation(
  monitor: CognitiveModule<AggregatedSignals, MonitorReport, MonitorV2State, MonitorMonitoring, NoControl>,
  state: MonitorV2State,
  confidence: number,
  cycles: number,
  sourceId: ModuleId = REASONER_ID,
): Promise<MonitorV2State> {
  let s = state;
  for (let i = 0; i < cycles; i++) {
    const signals: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
      [sourceId, makeReasonerSignal(sourceId, confidence)],
    ]);
    const result = await monitor.step(signals, s, makeNoControl());
    s = result.state;
  }
  return s;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('MonitorV2 module', () => {

  // Test 1: EnrichedMonitoringSignal with prediction error field
  it('produces EnrichedMonitoringSignal with prediction error field', async () => {
    const monitor = createMonitorV2();
    let state = monitor.initialState();

    // First cycle: establish expectation
    const signals1: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
      [REASONER_ID, makeReasonerSignal(REASONER_ID, 0.8)],
    ]);
    const result1 = await monitor.step(signals1, state, makeNoControl());
    state = result1.state;

    // Second cycle: observe deviation
    const signals2: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
      [REASONER_ID, makeReasonerSignal(REASONER_ID, 0.5)],
    ]);
    const result2 = await monitor.step(signals2, state, makeNoControl());

    const enriched = result2.monitoring as MonitorMonitoring & EnrichedMonitoringSignal;
    assert.ok('predictionError' in enriched, 'monitoring should have predictionError field');
    assert.equal(typeof enriched.predictionError, 'number');
    assert.ok(enriched.predictionError! >= 0, 'prediction error should be non-negative');
  });

  // Test 2: Prediction error computed as normalized deviation from expectation model
  it('computes prediction error as normalized deviation from expectation model', async () => {
    const monitor = createMonitorV2({ expectationAlpha: 0.2 });
    let state = monitor.initialState();

    // Build stable expectation at 0.8 over 5 cycles
    state = await buildStableExpectation(monitor, state, 0.8, 5);

    // Now send confidence 0.2 — large deviation
    const signals: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
      [REASONER_ID, makeReasonerSignal(REASONER_ID, 0.2)],
    ]);
    const result = await monitor.step(signals, state, makeNoControl());

    const enriched = result.monitoring as MonitorMonitoring & EnrichedMonitoringSignal;

    // predictionError = |0.2 - mean| / sqrt(variance)
    // After 5 cycles of 0.8, mean ~= 0.8, variance is small
    // So |0.2 - 0.8| / sqrt(small) should be large
    assert.ok(enriched.predictionError! > 0, 'should detect positive prediction error');

    // AC-01: 3+ std devs away should produce significant anomaly
    // The expectation model has very low variance after 5 stable cycles, so 0.2 is far away
    const anomalyTypes = result.output.anomalies.map(a => a.detail);
    const hasPredictionErrorAnomaly = anomalyTypes.some(d => d.includes('Prediction error'));
    assert.ok(hasPredictionErrorAnomaly, 'should flag prediction-error anomaly for large deviation');
  });

  // Test 3: Expectation model updates incrementally via exponential moving average
  it('updates expectation model incrementally via exponential moving average', async () => {
    const monitor = createMonitorV2({ expectationAlpha: 0.3 });
    let state = monitor.initialState();

    // Cycle 1: confidence 0.6 — initializes the model
    const signals1: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
      [REASONER_ID, makeReasonerSignal(REASONER_ID, 0.6)],
    ]);
    const result1 = await monitor.step(signals1, state, makeNoControl());
    state = result1.state;

    const exp1 = state.expectations.get(REASONER_ID)!;
    assert.ok(exp1, 'expectation should exist after first cycle');
    assert.equal(exp1.meanConfidence, 0.6);
    assert.equal(exp1.observations, 1);

    // Cycle 2: confidence 0.9 — EMA update: mean = 0.6 + 0.3 * (0.9 - 0.6) = 0.69
    const signals2: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
      [REASONER_ID, makeReasonerSignal(REASONER_ID, 0.9)],
    ]);
    const result2 = await monitor.step(signals2, state, makeNoControl());
    state = result2.state;

    const exp2 = state.expectations.get(REASONER_ID)!;
    assert.equal(exp2.observations, 2);
    assert.ok(Math.abs(exp2.meanConfidence - 0.69) < 1e-10, `expected mean ~0.69, got ${exp2.meanConfidence}`);

    // Variance should have increased from the deviation
    assert.ok(exp2.varianceConfidence > 0, 'variance should be positive after deviation');
  });

  // Test 4: Precision weights amplify signals from reliable modules
  it('amplifies precision weights for reliable modules (low variance)', async () => {
    const monitor = createMonitorV2({ expectationAlpha: 0.2 });
    let state = monitor.initialState();

    // Module A: very stable — 5 cycles at exactly 0.8
    for (let i = 0; i < 5; i++) {
      const signals: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
        [REASONER_ID, makeReasonerSignal(REASONER_ID, 0.8)],
        [REASONER_B_ID, makeReasonerSignal(REASONER_B_ID, 0.5 + (i % 2 === 0 ? 0.3 : -0.3))],
      ]);
      const result = await monitor.step(signals, state, makeNoControl());
      state = result.state;
    }

    // Module A: stable → low variance → high precision
    const precisionA = state.precisionWeights.get(REASONER_ID)!;
    // Module B: noisy (alternates 0.8 / 0.2) → high variance → low precision
    const precisionB = state.precisionWeights.get(REASONER_B_ID)!;

    assert.ok(precisionA > 0, 'Module A precision should be positive');
    assert.ok(precisionB > 0, 'Module B precision should be positive');
    // AC-03: ModuleA (low variance) gets higher precision than ModuleB (high variance)
    assert.ok(
      precisionA > precisionB,
      `ModuleA precision (${precisionA}) should be higher than ModuleB (${precisionB})`,
    );
  });

  // Test 5: Precision weights damp signals from noisy modules (high variance)
  it('damps precision weights for noisy modules (high variance)', async () => {
    const monitor = createMonitorV2({ expectationAlpha: 0.3 });
    let state = monitor.initialState();

    // Build noisy module: alternating high and low confidence
    const noisyId = moduleId('noisy-module');
    for (let i = 0; i < 6; i++) {
      const confidence = i % 2 === 0 ? 0.9 : 0.1;
      const signals: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
        [noisyId, makeReasonerSignal(noisyId, confidence)],
      ]);
      const result = await monitor.step(signals, state, makeNoControl());
      state = result.state;
    }

    const exp = state.expectations.get(noisyId)!;
    // With alternating 0.9 and 0.1, variance should be large
    assert.ok(exp.varianceConfidence > 0.01, `variance should be high for noisy module, got ${exp.varianceConfidence}`);

    // Precision = 1/variance → should be low for noisy module
    const precision = state.precisionWeights.get(noisyId)!;
    assert.ok(precision < 100, `precision should be relatively low for noisy module, got ${precision}`);
  });

  // Test 6: Adaptive threshold lowers after intervention cycle (Gratton effect)
  it('lowers adaptive threshold after intervention cycle (Gratton effect)', async () => {
    const monitor = createMonitorV2({
      baseConfidenceThreshold: 0.3,
      grattonDelta: 0.05,
      thresholdFloor: 0.1,
      thresholdCeiling: 0.6,
    });
    let state = monitor.initialState();

    const initialThreshold = state.adaptiveThreshold;
    assert.equal(initialThreshold, 0.3);

    // Cycle 1: trigger anomaly (low confidence below threshold)
    const signals1: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
      [REASONER_ID, makeReasonerSignal(REASONER_ID, 0.1)],
    ]);
    const result1 = await monitor.step(signals1, state, makeNoControl());
    state = result1.state;

    // Previous cycle intervened (had anomalies), so state.previousCycleIntervened = true
    assert.equal(state.previousCycleIntervened, true);

    // Cycle 2: the Gratton effect applies based on previous cycle
    // Since previous cycle intervened, threshold should lower
    const signals2: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
      [REASONER_ID, makeReasonerSignal(REASONER_ID, 0.5)],
    ]);
    const result2 = await monitor.step(signals2, state, makeNoControl());
    state = result2.state;

    // AC-04: After intervention, threshold lowers by grattonDelta
    // Previous threshold was 0.3 (initial) → first Gratton adjustment happened in cycle 1
    // Since cycle 0 had no intervention (previousCycleIntervened starts false), cycle 1 raised to 0.35
    // Then cycle 2 sees previous cycle intervened, so it lowers: 0.35 - 0.05 = 0.30
    // Let me re-check: the threshold is computed at the END of each cycle.
    // Cycle 1: previousCycleIntervened=false → threshold raises from 0.3 to 0.35
    //          BUT this cycle generated anomalies, so newState.previousCycleIntervened=true
    // Cycle 2: previousCycleIntervened=true → threshold lowers: 0.35 - 0.05 = 0.30
    //          This cycle had no anomalies (0.5 > 0.35), so previousCycleIntervened=false
    assert.ok(
      state.adaptiveThreshold < 0.35 + 1e-10,
      `threshold should have lowered after intervention, got ${state.adaptiveThreshold}`,
    );
  });

  // Test 7: Adaptive threshold raises after clean cycle (Gratton effect)
  it('raises adaptive threshold after clean cycle (Gratton effect)', async () => {
    const monitor = createMonitorV2({
      baseConfidenceThreshold: 0.3,
      grattonDelta: 0.05,
      thresholdFloor: 0.1,
      thresholdCeiling: 0.6,
    });
    let state = monitor.initialState();

    // Cycle 1: clean — high confidence, no anomalies
    const signals1: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
      [REASONER_ID, makeReasonerSignal(REASONER_ID, 0.9)],
    ]);
    const result1 = await monitor.step(signals1, state, makeNoControl());
    state = result1.state;

    // Previous cycle did NOT intervene (initial state: previousCycleIntervened=false)
    // So Gratton raises: 0.3 + 0.05 = 0.35
    assert.ok(
      Math.abs(state.adaptiveThreshold - 0.35) < 1e-10,
      `threshold should have raised to 0.35 after clean cycle, got ${state.adaptiveThreshold}`,
    );

    // Cycle 2: also clean
    const signals2: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
      [REASONER_ID, makeReasonerSignal(REASONER_ID, 0.9)],
    ]);
    const result2 = await monitor.step(signals2, state, makeNoControl());
    state = result2.state;

    // Previous cycle was also clean → raise again: 0.35 + 0.05 = 0.40
    assert.ok(
      Math.abs(state.adaptiveThreshold - 0.40) < 1e-10,
      `threshold should have raised to 0.40 after second clean cycle, got ${state.adaptiveThreshold}`,
    );
  });

  // Test 8: Threshold clamped to [thresholdFloor, thresholdCeiling]
  it('clamps threshold to [thresholdFloor, thresholdCeiling]', async () => {
    const monitor = createMonitorV2({
      baseConfidenceThreshold: 0.55,
      grattonDelta: 0.1,
      thresholdFloor: 0.1,
      thresholdCeiling: 0.6,
    });
    let state = monitor.initialState();

    // Multiple clean cycles to push threshold up
    for (let i = 0; i < 10; i++) {
      const signals: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
        [REASONER_ID, makeReasonerSignal(REASONER_ID, 0.95)],
      ]);
      const result = await monitor.step(signals, state, makeNoControl());
      state = result.state;
    }

    // Threshold should be clamped at ceiling
    assert.ok(
      state.adaptiveThreshold <= 0.6,
      `threshold should be clamped to ceiling 0.6, got ${state.adaptiveThreshold}`,
    );
    assert.ok(
      Math.abs(state.adaptiveThreshold - 0.6) < 1e-10,
      `threshold should be at ceiling 0.6, got ${state.adaptiveThreshold}`,
    );

    // Now push threshold down with many intervention cycles
    const monitorLow = createMonitorV2({
      baseConfidenceThreshold: 0.15,
      grattonDelta: 0.1,
      thresholdFloor: 0.1,
      thresholdCeiling: 0.6,
    });
    let stateLow = monitorLow.initialState();

    // Force interventions by sending very low confidence
    for (let i = 0; i < 10; i++) {
      const signals: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
        [REASONER_ID, makeReasonerSignal(REASONER_ID, 0.01)],
      ]);
      const result = await monitorLow.step(signals, stateLow, makeNoControl());
      stateLow = result.state;
    }

    // Threshold should be clamped at floor
    assert.ok(
      stateLow.adaptiveThreshold >= 0.1,
      `threshold should be clamped to floor 0.1, got ${stateLow.adaptiveThreshold}`,
    );
  });

  // Test 9: EOL signal populated when workspace complexity is high
  it('populates EOL signal when workspace complexity is high', async () => {
    const monitor = createMonitorV2();
    const state = monitor.initialState();

    // Many diverse signals → high complexity
    const signals: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
      [REASONER_ID, makeReasonerSignal(REASONER_ID, 0.7)],
      [ACTOR_ID, makeActorSignal(ACTOR_ID, true, false)],
      [MEMORY_ID, makeMemorySignal(MEMORY_ID, 0.5, 3)],
      [EVALUATOR_ID, makeEvaluatorSignal(EVALUATOR_ID, 0.6)],
    ]);

    const result = await monitor.step(signals, state, makeNoControl());
    const enriched = result.monitoring as MonitorMonitoring & EnrichedMonitoringSignal;

    assert.ok(enriched.eol !== undefined, 'EOL should be populated');
    assert.equal(typeof enriched.eol, 'number');
    assert.ok(enriched.eol! >= 0 && enriched.eol! <= 1, `EOL should be in [0,1], got ${enriched.eol}`);
    // With 4 diverse signal types, EOL should be non-trivial
    assert.ok(enriched.eol! > 0, 'EOL should be > 0 with multiple diverse signals');
  });

  // Test 10: JOL signal derived from evaluator progress
  it('derives JOL signal from evaluator progress', async () => {
    const monitor = createMonitorV2();
    const state = monitor.initialState();

    const signals: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
      [EVALUATOR_ID, makeEvaluatorSignal(EVALUATOR_ID, 0.75)],
    ]);

    const result = await monitor.step(signals, state, makeNoControl());
    const enriched = result.monitoring as MonitorMonitoring & EnrichedMonitoringSignal;

    assert.ok(enriched.jol !== undefined, 'JOL should be populated when evaluator signal present');
    assert.equal(enriched.jol, 0.75, 'JOL should equal evaluator progress');
  });

  // Test 11: FOK signal set on partial memory retrieval
  it('sets FOK signal on partial memory retrieval', async () => {
    const monitor = createMonitorV2();
    const state = monitor.initialState();

    // Memory has relevance > 0 but retrievalCount = 0 → partial match, can't retrieve
    const signals: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
      [MEMORY_ID, makeMemorySignal(MEMORY_ID, 0.7, 0)],
    ]);

    const result = await monitor.step(signals, state, makeNoControl());
    const enriched = result.monitoring as MonitorMonitoring & EnrichedMonitoringSignal;

    // AC-02: fok = true when memory retrieval is partial
    assert.ok(enriched.fok === true, 'FOK should be true when relevanceScore > 0 and retrievalCount = 0');
  });

  // Test 12: RC signal computed from action success rate + prediction error
  it('computes RC signal from action success rate and prediction error', async () => {
    const monitor = createMonitorV2();
    let state = monitor.initialState();

    // Build some expectation first
    state = await buildStableExpectation(monitor, state, 0.8, 3);

    // Now send reasoner + successful actor signals
    const signals: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
      [REASONER_ID, makeReasonerSignal(REASONER_ID, 0.8)],
      [ACTOR_ID, makeActorSignal(ACTOR_ID, true, false)],
    ]);

    const result = await monitor.step(signals, state, makeNoControl());
    const enriched = result.monitoring as MonitorMonitoring & EnrichedMonitoringSignal;

    assert.ok(enriched.rc !== undefined, 'RC should be populated when action signal present');
    assert.equal(typeof enriched.rc, 'number');
    assert.ok(enriched.rc! >= 0 && enriched.rc! <= 1, `RC should be in [0,1], got ${enriched.rc}`);
    // With 100% success and low prediction error, RC should be high
    assert.ok(enriched.rc! > 0.5, `RC should be high with successful action and low pred error, got ${enriched.rc}`);
  });

  // Test 13: Conflict energy computed from co-activated incompatible responses
  it('computes conflict energy from co-activated incompatible responses', async () => {
    const monitor = createMonitorV2();
    const state = monitor.initialState();

    // Two reasoner signals, one with conflict detected
    const conflictReasonerId = moduleId('reasoner-conflict');
    const signals: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
      [REASONER_ID, makeReasonerSignal(REASONER_ID, 0.7, false)],
      [conflictReasonerId, makeReasonerSignal(conflictReasonerId, 0.4, true)],
    ]);

    const result = await monitor.step(signals, state, makeNoControl());
    const enriched = result.monitoring as MonitorMonitoring & EnrichedMonitoringSignal;

    assert.ok(enriched.conflictEnergy !== undefined, 'conflictEnergy should be populated when conflict detected');
    assert.ok(enriched.conflictEnergy! > 0, 'conflictEnergy should be > 0 with conflict signal');
    // 1 out of 2 reasoner signals has conflict → conflictEnergy = 0.5
    assert.ok(
      Math.abs(enriched.conflictEnergy! - 0.5) < 1e-10,
      `conflictEnergy should be 0.5, got ${enriched.conflictEnergy}`,
    );
  });

  // Test 14: Produces v1-compatible MonitorReport (anomalies, escalation)
  it('produces v1-compatible MonitorReport with anomalies and escalation', async () => {
    const monitor = createMonitorV2({ baseConfidenceThreshold: 0.3 });
    const state = monitor.initialState();

    // Trigger compound anomaly: low confidence + unexpected result
    const signals: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
      [REASONER_ID, makeReasonerSignal(REASONER_ID, 0.1)],
      [ACTOR_ID, makeActorSignal(ACTOR_ID, false, true)],
    ]);

    const result = await monitor.step(signals, state, makeNoControl());
    const report: MonitorReport = result.output;

    // v1-compatible fields
    assert.ok(Array.isArray(report.anomalies), 'anomalies should be an array');
    assert.ok(report.anomalies.length >= 2, 'should have at least 2 anomalies');

    const anomalyTypes = report.anomalies.map(a => a.type);
    assert.ok(anomalyTypes.includes('low-confidence'), 'should include low-confidence anomaly');
    assert.ok(anomalyTypes.includes('unexpected-result'), 'should include unexpected-result anomaly');
    assert.ok(anomalyTypes.includes('compound'), 'should include compound anomaly');

    assert.ok(report.escalation !== undefined, 'escalation should be set for compound anomaly');
    assert.ok(report.escalation!.includes('Compound anomaly'), 'escalation should mention compound');
    assert.ok(Array.isArray(report.restrictedActions), 'restrictedActions should be an array');
    assert.equal(typeof report.forceReplan, 'boolean', 'forceReplan should be a boolean');

    // Monitoring signal also has v1 fields
    assert.equal(result.monitoring.type, 'monitor');
    assert.equal(result.monitoring.anomalyDetected, true);
    assert.equal(result.monitoring.escalation, report.escalation);
  });

  // Test 15: Implements CognitiveModule interface — assignable to v1 Monitor slot
  it('implements CognitiveModule interface assignable to v1 Monitor slot', async () => {
    const monitor = createMonitorV2();

    // Verify it has all CognitiveModule methods
    assert.ok('id' in monitor, 'should have id');
    assert.ok('step' in monitor, 'should have step method');
    assert.ok('initialState' in monitor, 'should have initialState method');
    assert.ok('stateInvariant' in monitor, 'should have stateInvariant method');

    assert.equal(typeof monitor.step, 'function');
    assert.equal(typeof monitor.initialState, 'function');
    assert.equal(typeof monitor.stateInvariant, 'function');

    // Default ID is 'monitor' — same as v1
    assert.equal(monitor.id, 'monitor');

    // initialState returns a valid state
    const state = monitor.initialState();
    assert.ok(monitor.stateInvariant!(state), 'initial state should satisfy invariant');

    // Step accepts AggregatedSignals and returns StepResult
    const signals: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
      [REASONER_ID, makeReasonerSignal(REASONER_ID, 0.8)],
    ]);

    const result = await monitor.step(signals, state, makeNoControl());

    // Output is MonitorReport — same type as v1
    assert.ok('anomalies' in result.output);
    assert.ok('escalation' in result.output);
    assert.ok('restrictedActions' in result.output);
    assert.ok('forceReplan' in result.output);

    // State is updated
    assert.equal(result.state.cycleCount, 1);

    // Monitoring signal is produced
    assert.equal(result.monitoring.type, 'monitor');
    assert.ok('source' in result.monitoring);
    assert.ok('timestamp' in result.monitoring);

    // Type assignment check: the factory signature matches v1 Monitor's slot
    const _assignable: CognitiveModule<AggregatedSignals, MonitorReport, MonitorV2State, MonitorMonitoring, NoControl> = monitor;
    assert.ok(_assignable !== null, 'monitor should be assignable to CognitiveModule type');
  });
});
