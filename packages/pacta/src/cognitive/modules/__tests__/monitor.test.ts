// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for Monitor meta-level cognitive module.
 *
 * Tests: anomaly detection from aggregated signals, escalation on compound
 * anomalies, abstracted model maintenance (running averages), step error handling.
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
} from '../../algebra/index.js';
import { createMonitor } from '../monitor.js';
import type { NoControl } from '../monitor.js';

// ── Helpers ──────────────────────────────────────────────────────────

const REASONER_ID = moduleId('reasoner-1');
const ACTOR_ID = moduleId('actor-1');
const OBSERVER_ID = moduleId('observer-1');

function makeNoControl(): NoControl {
  // NoControl has `never` for __noControl, so we cast through unknown
  // In practice, the Monitor ignores control entirely
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

function makeActorSignal(id: ModuleId, success: boolean, unexpected: boolean): ActorMonitoring {
  return {
    type: 'actor',
    source: id,
    timestamp: Date.now(),
    actionTaken: 'test_action',
    success,
    unexpectedResult: unexpected,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Monitor module', () => {
  it('aggregates mu from multiple modules and detects conflict (low confidence + unexpected result)', async () => {
    const monitor = createMonitor({ confidenceThreshold: 0.3 });
    const state = monitor.initialState();

    // Signals with low confidence AND unexpected result
    const signals: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
      [REASONER_ID, makeReasonerSignal(REASONER_ID, 0.2)],
      [ACTOR_ID, makeActorSignal(ACTOR_ID, false, true)],
    ]);

    const result = await monitor.step(signals, state, makeNoControl());

    // Should detect anomalies from both modules
    assert.ok(result.output.anomalies.length >= 2);
    const types = result.output.anomalies.map(a => a.type);
    assert.ok(types.includes('low-confidence'));
    assert.ok(types.includes('unexpected-result'));
    assert.ok(types.includes('compound'));
    assert.ok(result.monitoring.anomalyDetected);
  });

  it('emits escalation when compound anomaly detected', async () => {
    const monitor = createMonitor({ confidenceThreshold: 0.3 });
    const state = monitor.initialState();

    // Both low confidence AND unexpected result = compound → escalation
    const signals: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
      [REASONER_ID, makeReasonerSignal(REASONER_ID, 0.1)],
      [ACTOR_ID, makeActorSignal(ACTOR_ID, false, true)],
    ]);

    const result = await monitor.step(signals, state, makeNoControl());

    assert.ok(result.output.escalation !== undefined);
    assert.ok(result.output.escalation!.includes('Compound anomaly'));
    assert.equal(result.monitoring.escalation, result.output.escalation);
    assert.equal(result.monitoring.type, 'monitor');
  });

  it('maintains abstracted model — running average updates correctly', async () => {
    const monitor = createMonitor();
    let state = monitor.initialState();

    assert.equal(state.confidenceAverage, 0);
    assert.equal(state.confidenceObservations, 0);

    // First cycle: confidence 0.8
    const signals1: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
      [REASONER_ID, makeReasonerSignal(REASONER_ID, 0.8)],
    ]);

    const result1 = await monitor.step(signals1, state, makeNoControl());
    state = result1.state;

    assert.equal(state.confidenceAverage, 0.8);
    assert.equal(state.confidenceObservations, 1);
    assert.equal(state.cycleCount, 1);

    // Second cycle: confidence 0.4
    const signals2: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
      [REASONER_ID, makeReasonerSignal(REASONER_ID, 0.4)],
    ]);

    const result2 = await monitor.step(signals2, state, makeNoControl());
    state = result2.state;

    // Running average: (0.8 + 0.4) / 2 = 0.6
    assert.ok(Math.abs(state.confidenceAverage - 0.6) < 1e-10);
    assert.equal(state.confidenceObservations, 2);
    assert.equal(state.cycleCount, 2);

    // Verify state invariant holds
    assert.ok(monitor.stateInvariant!(state));
  });

  it('no anomaly when all signals are healthy', async () => {
    const monitor = createMonitor({ confidenceThreshold: 0.3 });
    const state = monitor.initialState();

    const signals: AggregatedSignals = new Map<ModuleId, MonitoringSignal>([
      [REASONER_ID, makeReasonerSignal(REASONER_ID, 0.9)],
      [ACTOR_ID, makeActorSignal(ACTOR_ID, true, false)],
    ]);

    const result = await monitor.step(signals, state, makeNoControl());

    assert.equal(result.output.anomalies.length, 0);
    assert.equal(result.output.escalation, undefined);
    assert.equal(result.monitoring.anomalyDetected, false);
    assert.equal(result.monitoring.escalation, undefined);
  });
});
