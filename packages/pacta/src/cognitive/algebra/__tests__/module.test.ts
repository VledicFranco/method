/**
 * Unit tests for cognitive algebra module types.
 *
 * Tests: CognitiveModule generic interface, StepResult structure,
 * MonitoringSignal discriminated union dispatch, ControlDirective + ControlPolicy
 * composition, CompositionError at runtime.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  moduleId,
  CompositionError,
} from '../module.js';
import type {
  ModuleId,
  CognitiveModule,
  StepResult,
  MonitoringSignal,
  ControlDirective,
  StepError,
  ReasonerMonitoring,
  ActorMonitoring,
  ObserverMonitoring,
  MemoryMonitoring,
  MonitorMonitoring,
  ModuleMonitoringSignal,
} from '../module.js';
import type { ControlPolicy } from '../control-policy.js';

// ── Helpers ──────────────────────────────────────────────────────

const TEST_MODULE_ID = moduleId('test-module');

function makeReasonerSignal(): ReasonerMonitoring {
  return {
    type: 'reasoner',
    source: TEST_MODULE_ID,
    timestamp: Date.now(),
    confidence: 0.85,
    conflictDetected: false,
    effortLevel: 'high',
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('CognitiveModule interface', () => {
  it('compiles with 5 generic parameters and implements step()', async () => {
    // Type-level test: define a concrete module with all 5 type parameters.
    // If this compiles, the CognitiveModule interface accepts the generics correctly.
    type TestInput = { text: string };
    type TestOutput = { result: string };
    type TestState = { history: string[] };
    type TestMu = ReasonerMonitoring;
    type TestKappa = ControlDirective & { strategy: string };

    const mod: CognitiveModule<TestInput, TestOutput, TestState, TestMu, TestKappa> = {
      id: TEST_MODULE_ID,

      async step(input: TestInput, state: TestState, control: TestKappa) {
        const newState = { history: [...state.history, input.text] };
        return {
          output: { result: `processed: ${input.text}` },
          state: newState,
          monitoring: {
            type: 'reasoner',
            source: this.id,
            timestamp: Date.now(),
            confidence: 0.9,
            conflictDetected: false,
            effortLevel: control.strategy,
          },
        };
      },

      initialState() {
        return { history: [] };
      },

      stateInvariant(state: TestState) {
        return state.history.length < 1000;
      },
    };

    // Verify the module works at runtime
    const state = mod.initialState();
    assert.deepStrictEqual(state, { history: [] });

    const control: TestKappa = {
      target: TEST_MODULE_ID,
      timestamp: Date.now(),
      strategy: 'cot',
    };

    const result = await mod.step({ text: 'hello' }, state, control);
    assert.equal(result.output.result, 'processed: hello');
    assert.deepStrictEqual(result.state.history, ['hello']);
    assert.equal(result.monitoring.type, 'reasoner');
    assert.equal(result.monitoring.confidence, 0.9);
    assert.ok(mod.stateInvariant!(result.state));
  });
});

describe('StepResult', () => {
  it('carries output, state, monitoring, and optional error', () => {
    const resultWithoutError: StepResult<string, number, ReasonerMonitoring> = {
      output: 'answer',
      state: 42,
      monitoring: makeReasonerSignal(),
    };

    assert.equal(resultWithoutError.output, 'answer');
    assert.equal(resultWithoutError.state, 42);
    assert.equal(resultWithoutError.monitoring.type, 'reasoner');
    assert.equal(resultWithoutError.error, undefined);
    assert.equal(resultWithoutError.trace, undefined);

    const error: StepError = {
      message: 'timeout',
      recoverable: true,
      moduleId: TEST_MODULE_ID,
      phase: 'REASON',
    };

    const resultWithError: StepResult<string, number, ReasonerMonitoring> = {
      output: 'partial',
      state: 41,
      monitoring: makeReasonerSignal(),
      error,
    };

    assert.equal(resultWithError.error!.message, 'timeout');
    assert.equal(resultWithError.error!.recoverable, true);
    assert.equal(resultWithError.error!.moduleId, TEST_MODULE_ID);
    assert.equal(resultWithError.error!.phase, 'REASON');
  });
});

describe('MonitoringSignal discriminated union', () => {
  it('dispatches correctly via type discriminant', () => {
    const signals: ModuleMonitoringSignal[] = [
      {
        type: 'reasoner',
        source: moduleId('reasoner-1'),
        timestamp: 1,
        confidence: 0.7,
        conflictDetected: true,
        effortLevel: 'medium',
      },
      {
        type: 'actor',
        source: moduleId('actor-1'),
        timestamp: 2,
        actionTaken: 'read_file',
        success: true,
        unexpectedResult: false,
      },
      {
        type: 'observer',
        source: moduleId('observer-1'),
        timestamp: 3,
        inputProcessed: true,
        noveltyScore: 0.45,
      },
      {
        type: 'memory',
        source: moduleId('memory-1'),
        timestamp: 4,
        retrievalCount: 3,
        relevanceScore: 0.8,
      },
      {
        type: 'monitor',
        source: moduleId('monitor-1'),
        timestamp: 5,
        anomalyDetected: true,
        escalation: 'low confidence detected',
      },
    ];

    const dispatched: string[] = [];

    for (const signal of signals) {
      switch (signal.type) {
        case 'reasoner':
          dispatched.push(`reasoner:${signal.confidence}`);
          break;
        case 'actor':
          dispatched.push(`actor:${signal.actionTaken}`);
          break;
        case 'observer':
          dispatched.push(`observer:${signal.noveltyScore}`);
          break;
        case 'memory':
          dispatched.push(`memory:${signal.retrievalCount}`);
          break;
        case 'monitor':
          dispatched.push(`monitor:${signal.anomalyDetected}`);
          break;
        case 'evaluator':
          dispatched.push(`evaluator:${signal.estimatedProgress}`);
          break;
        case 'planner':
          dispatched.push(`planner:${signal.subgoalCount}`);
          break;
        case 'reflector':
          dispatched.push(`reflector:${signal.lessonsExtracted}`);
          break;
      }
    }

    assert.deepStrictEqual(dispatched, [
      'reasoner:0.7',
      'actor:read_file',
      'observer:0.45',
      'memory:3',
      'monitor:true',
    ]);
  });
});

describe('ControlDirective + ControlPolicy', () => {
  it('composes: policy validates directives correctly', () => {
    const policy: ControlPolicy = {
      allowedDirectiveTypes: ['strategy_shift', 'effort_change'],
      maxSpawnDepth: 1,
      allowedActions: ['read_file', 'write_file'],
      validate(directive: ControlDirective) {
        // Check that the directive has a type we recognize
        const typed = directive as ControlDirective & { directiveType?: string };
        if (!typed.directiveType) return false;
        return this.allowedDirectiveTypes.includes(typed.directiveType);
      },
    };

    const validDirective: ControlDirective & { directiveType: string } = {
      target: moduleId('reasoner-1'),
      timestamp: Date.now(),
      directiveType: 'strategy_shift',
    };

    const invalidDirective: ControlDirective & { directiveType: string } = {
      target: moduleId('reasoner-1'),
      timestamp: Date.now(),
      directiveType: 'spawn_subagent',
    };

    const bareDirective: ControlDirective = {
      target: moduleId('actor-1'),
      timestamp: Date.now(),
    };

    assert.equal(policy.validate(validDirective), true);
    assert.equal(policy.validate(invalidDirective), false);
    assert.equal(policy.validate(bareDirective), false);
  });
});

describe('CompositionError', () => {
  it('thrown on invalid composition at runtime', () => {
    function composeModules(moduleIds: ModuleId[]): void {
      if (moduleIds.length < 2) {
        throw new CompositionError(
          `Composition requires at least 2 modules, got ${moduleIds.length}`,
        );
      }
      const uniqueIds = new Set(moduleIds);
      if (uniqueIds.size !== moduleIds.length) {
        throw new CompositionError('Duplicate module IDs in composition');
      }
    }

    // Valid composition — no error
    assert.doesNotThrow(() =>
      composeModules([moduleId('a'), moduleId('b')]),
    );

    // Invalid: too few modules
    assert.throws(
      () => composeModules([moduleId('a')]),
      (err: unknown) => {
        assert.ok(err instanceof CompositionError);
        assert.ok(err.message.includes('at least 2 modules'));
        assert.equal(err.name, 'CompositionError');
        return true;
      },
    );

    // Invalid: duplicate IDs
    assert.throws(
      () => composeModules([moduleId('a'), moduleId('a')]),
      (err: unknown) => {
        assert.ok(err instanceof CompositionError);
        assert.ok(err.message.includes('Duplicate module IDs'));
        return true;
      },
    );
  });
});
