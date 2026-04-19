// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for cognitive scenario DSL (PRD 030, C-7).
 *
 * Three scenarios:
 * 1. Cognitive scenario executes with default recording modules
 * 2. Phase order assertion verifies correct cycle execution
 * 3. Monitor intervention detection works (threshold configured to always intervene)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cognitiveScenario,
  cyclePhaseOrder,
  monitorIntervened,
  moduleStepCount,
  RecordingModule,
} from './cognitive-scenario.js';
import type { MonitoringSignal } from '@methodts/pacta';

describe('cognitiveScenario', () => {
  it('executes with default recording modules', async () => {
    const result = await cognitiveScenario('default modules')
      .when('Hello world')
      .run();

    assert.equal(result.name, 'default modules');
    assert.ok(result.cycleResult, 'cycleResult should be defined');
    assert.ok(result.cycleResult.phasesExecuted.length > 0, 'should have executed phases');
    assert.ok(result.cycleResult.phasesExecuted.includes('OBSERVE'), 'should include OBSERVE');
    assert.ok(result.cycleResult.phasesExecuted.includes('REASON'), 'should include REASON');
    assert.ok(result.cycleResult.phasesExecuted.includes('ACT'), 'should include ACT');
    assert.ok(result.cycleResult.phasesExecuted.includes('LEARN'), 'should include LEARN');
    assert.equal(result.passed, true);
  });

  it('phase order assertion verifies correct cycle execution', async () => {
    // Default configuration (no meta-intervention): OBSERVE, ATTEND, REMEMBER, REASON, ACT, LEARN
    const result = await cognitiveScenario('phase order check')
      .when('Test prompt')
      .then(cyclePhaseOrder(['OBSERVE', 'ATTEND', 'REMEMBER', 'REASON', 'ACT', 'LEARN']))
      .run();

    assert.equal(result.passed, true, `Assertions failed: ${result.assertions.map(a => a.message).join('; ')}`);
    assert.equal(result.assertions.length, 1);
    assert.equal(result.assertions[0].passed, true);

    // Now test a failing assertion — expect 8 phases including MONITOR/CONTROL
    // which won't fire because the default threshold never intervenes
    const failResult = await cognitiveScenario('phase order mismatch')
      .when('Test prompt')
      .then(cyclePhaseOrder([
        'OBSERVE', 'ATTEND', 'REMEMBER', 'REASON',
        'MONITOR', 'CONTROL', 'ACT', 'LEARN',
      ]))
      .run();

    assert.equal(failResult.passed, false);
    assert.equal(failResult.assertions[0].passed, false);
    assert.ok(failResult.assertions[0].message.includes('mismatch'));
  });

  it('monitor intervention detection works with always-intervene threshold', async () => {
    // Configure threshold to always intervene so MONITOR + CONTROL phases fire
    const result = await cognitiveScenario('monitor intervention')
      .when('Complex analysis task')
      .withCycleConfig({
        thresholds: {
          type: 'predicate',
          shouldIntervene: () => true,
        },
      })
      .then(monitorIntervened())
      .then(cyclePhaseOrder([
        'OBSERVE', 'ATTEND', 'REMEMBER', 'REASON',
        'MONITOR', 'CONTROL', 'ACT', 'LEARN',
      ]))
      .then(moduleStepCount('monitor', 1))
      .run();

    assert.equal(result.passed, true, `Assertions failed: ${result.assertions.map(a => a.message).join('; ')}`);

    // The monitorIntervened() assertion passed
    assert.equal(result.assertions[0].passed, true);
    assert.ok(result.assertions[0].message.includes('intervention detected'));

    // Verify that without always-intervene, the assertion fails
    const noIntervention = await cognitiveScenario('no intervention')
      .when('Simple task')
      .then(monitorIntervened())
      .run();

    assert.equal(noIntervention.passed, false);
    assert.equal(noIntervention.assertions[0].passed, false);
    assert.ok(noIntervention.assertions[0].message.includes('No monitor intervention'));
  });
});
