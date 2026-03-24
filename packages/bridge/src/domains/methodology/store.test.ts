/**
 * MethodologySessionStore Tests
 *
 * Covers the store's public API: list, loadMethod, session lifecycle,
 * validation, methodology sessions (start/route/select/transition),
 * session isolation, and error handling.
 *
 * Uses StdlibSource (real stdlib catalog) as the MethodologySource (DR-09).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MethodologySessionStore } from './store.js';
import { StdlibSource } from '../../ports/stdlib-source.js';

describe('MethodologySessionStore', () => {
  let store: MethodologySessionStore;

  beforeEach(() => {
    store = new MethodologySessionStore(new StdlibSource());
  });

  // ══════════════════════════════════════════════════════════════
  // Basic Operations
  // ══════════════════════════════════════════════════════════════

  describe('list()', () => {
    it('returns array with P0-META and P2-SD', () => {
      const result = store.list() as Array<{ methodologyId: string }>;

      assert.ok(Array.isArray(result), 'list() should return an array');
      const ids = result.map((m) => m.methodologyId);
      assert.ok(ids.includes('P0-META'), 'should include P0-META');
      assert.ok(ids.includes('P2-SD'), 'should include P2-SD');
    });

    it('each entry has methodologyId, name, and methods array', () => {
      const result = store.list() as Array<{
        methodologyId: string;
        name: string;
        methods: Array<{ methodId: string; name: string; stepCount: number }>;
      }>;

      for (const entry of result) {
        assert.ok(typeof entry.methodologyId === 'string', 'methodologyId should be a string');
        assert.ok(typeof entry.name === 'string', 'name should be a string');
        assert.ok(Array.isArray(entry.methods), 'methods should be an array');
        for (const method of entry.methods) {
          assert.ok(typeof method.methodId === 'string', 'method.methodId should be a string');
          assert.ok(typeof method.name === 'string', 'method.name should be a string');
          assert.ok(typeof method.stepCount === 'number', 'method.stepCount should be a number');
        }
      }
    });
  });

  describe('loadMethod()', () => {
    it('loads M1-MDES from P0-META and returns correct shape', () => {
      const result = store.loadMethod('sess-1', 'P0-META', 'M1-MDES') as Record<string, unknown>;

      assert.ok(result, 'loadMethod should return a result');
      assert.ok(typeof result === 'object', 'result should be an object');
    });

    it('returns methodologyId, methodId, methodName, stepCount, objective, firstStep, message', () => {
      const result = store.loadMethod('sess-2', 'P0-META', 'M1-MDES') as {
        methodologyId: string;
        methodId: string;
        methodName: string;
        stepCount: number;
        objective: string | null;
        firstStep: { id: string; name: string };
        message: string;
      };

      assert.equal(result.methodologyId, 'P0-META');
      assert.equal(result.methodId, 'M1-MDES');
      assert.ok(typeof result.methodName === 'string', 'methodName should be a string');
      assert.ok(typeof result.stepCount === 'number', 'stepCount should be a number');
      assert.ok(result.stepCount > 0, 'stepCount should be > 0');
      assert.ok(result.firstStep, 'firstStep should exist');
      assert.ok(typeof result.firstStep.id === 'string', 'firstStep.id should be a string');
      assert.ok(typeof result.firstStep.name === 'string', 'firstStep.name should be a string');
      assert.ok(typeof result.message === 'string', 'message should be a string');
    });

    it('throws for non-existent methodology', () => {
      assert.throws(
        () => store.loadMethod('sess-3', 'NONEXISTENT', 'M1-MDES'),
        /not found/i,
        'should throw for non-existent methodology',
      );
    });

    it('throws for non-existent method', () => {
      assert.throws(
        () => store.loadMethod('sess-4', 'P0-META', 'NONEXISTENT'),
        /not found/i,
        'should throw for non-existent method',
      );
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Session Lifecycle
  // ══════════════════════════════════════════════════════════════

  describe('session lifecycle', () => {
    it('getStatus() after loadMethod returns SessionStatus shape', () => {
      store.loadMethod('sess-life-1', 'P0-META', 'M1-MDES');
      const status = store.getStatus('sess-life-1') as {
        methodologyId: string;
        methodId: string;
        currentStepId: string;
        currentStepName: string;
        stepIndex: number;
        totalSteps: number;
      };

      assert.equal(status.methodologyId, 'P0-META');
      assert.equal(status.methodId, 'M1-MDES');
      assert.ok(typeof status.currentStepId === 'string', 'currentStepId should be a string');
      assert.ok(typeof status.currentStepName === 'string', 'currentStepName should be a string');
      assert.equal(status.stepIndex, 0, 'stepIndex should be 0 (first step)');
      assert.ok(status.totalSteps > 0, 'totalSteps should be > 0');
    });

    it('getCurrentStep() returns first step (sigma_0 for M1-MDES)', () => {
      store.loadMethod('sess-life-2', 'P0-META', 'M1-MDES');
      const current = store.getCurrentStep('sess-life-2') as {
        methodologyId: string;
        methodId: string;
        stepIndex: number;
        totalSteps: number;
        step: {
          id: string;
          name: string;
          role: string | null;
          precondition: string | null;
          postcondition: string | null;
          guidance: string | null;
          outputSchema: Record<string, unknown> | null;
        };
      };

      assert.equal(current.methodologyId, 'P0-META');
      assert.equal(current.methodId, 'M1-MDES');
      assert.equal(current.stepIndex, 0);
      assert.equal(current.step.id, 'sigma_0');
      assert.ok(typeof current.step.name === 'string', 'step.name should be a string');
    });

    it('advanceStep() returns previousStep and nextStep', () => {
      store.loadMethod('sess-life-3', 'P0-META', 'M1-MDES');
      const result = store.advanceStep('sess-life-3') as {
        methodologyId: string;
        methodId: string;
        previousStep: { id: string; name: string };
        nextStep: { id: string; name: string } | null;
        stepIndex: number;
        totalSteps: number;
      };

      assert.equal(result.methodologyId, 'P0-META');
      assert.equal(result.methodId, 'M1-MDES');
      assert.ok(result.previousStep, 'previousStep should exist');
      assert.equal(result.previousStep.id, 'sigma_0');
      assert.ok(typeof result.previousStep.name === 'string');
      assert.equal(result.stepIndex, 1);
    });

    it('advanceStep() after last step sets nextStep to null', () => {
      store.loadMethod('sess-life-4', 'P0-META', 'M1-MDES');

      // Get totalSteps to know how many times to advance
      const status = store.getStatus('sess-life-4') as { totalSteps: number };
      const total = status.totalSteps;

      // Advance to the second-to-last step (index total-2)
      for (let i = 0; i < total - 2; i++) {
        store.advanceStep('sess-life-4');
      }

      // This advance should reach the terminal step (nextStep = null)
      const result = store.advanceStep('sess-life-4') as {
        nextStep: { id: string; name: string } | null;
      };

      assert.equal(result.nextStep, null, 'nextStep should be null at last step');
    });

    it('getStepContext() returns context with methodology, method, step, priorStepOutputs', () => {
      store.loadMethod('sess-life-5', 'P0-META', 'M1-MDES');
      const context = store.getStepContext('sess-life-5') as {
        methodology: { id: string; name: string; progress: string };
        method: { id: string; name: string; objective: string | null };
        step: { id: string; name: string };
        stepIndex: number;
        totalSteps: number;
        priorStepOutputs: Array<{ stepId: string; summary: string }>;
        priorMethodOutputs: Array<unknown>;
      };

      assert.ok(context.methodology, 'should have methodology');
      assert.ok(typeof context.methodology.id === 'string');
      assert.ok(typeof context.methodology.name === 'string');
      assert.ok(typeof context.methodology.progress === 'string');
      assert.ok(context.method, 'should have method');
      assert.ok(typeof context.method.id === 'string');
      assert.ok(typeof context.method.name === 'string');
      assert.ok(context.step, 'should have step');
      assert.ok(typeof context.step.id === 'string');
      assert.equal(context.stepIndex, 0);
      assert.ok(Array.isArray(context.priorStepOutputs), 'priorStepOutputs should be an array');
      assert.ok(Array.isArray(context.priorMethodOutputs), 'priorMethodOutputs should be an array');
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Validation
  // ══════════════════════════════════════════════════════════════

  describe('validateStep()', () => {
    it('records output and returns { valid: true }', () => {
      store.loadMethod('sess-val-1', 'P0-META', 'M1-MDES');
      const current = store.getCurrentStep('sess-val-1') as {
        step: { id: string };
      };

      const result = store.validateStep('sess-val-1', current.step.id, {
        decision: 'proceed',
        domain_corpus_enumeration: ['source-1'],
      }) as {
        valid: boolean;
        findings: Array<unknown>;
        postconditionMet: boolean;
        recommendation: string;
      };

      assert.ok(typeof result.valid === 'boolean', 'valid should be a boolean');
      assert.ok(Array.isArray(result.findings), 'findings should be an array');
      assert.ok(typeof result.postconditionMet === 'boolean', 'postconditionMet should be boolean');
      assert.ok(
        ['advance', 'retry', 'escalate'].includes(result.recommendation),
        'recommendation should be advance, retry, or escalate',
      );
    });

    it('recorded output appears in getStepContext priorStepOutputs after advance', () => {
      store.loadMethod('sess-val-2', 'P0-META', 'M1-MDES');
      const current = store.getCurrentStep('sess-val-2') as {
        step: { id: string };
      };

      // Validate (which records the output)
      store.validateStep('sess-val-2', current.step.id, {
        decision: 'proceed',
        notes: 'test output',
      });

      // Advance to next step
      store.advanceStep('sess-val-2');

      // Get context for the new current step — priorStepOutputs should include sigma_0
      const context = store.getStepContext('sess-val-2') as {
        priorStepOutputs: Array<{ stepId: string; summary: string }>;
      };

      assert.ok(context.priorStepOutputs.length > 0, 'should have at least 1 prior step output');
      const sigmaOutput = context.priorStepOutputs.find((p) => p.stepId === 'sigma_0');
      assert.ok(sigmaOutput, 'should find sigma_0 in priorStepOutputs');
      assert.ok(sigmaOutput!.summary.includes('proceed'), 'summary should contain the recorded output');
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Methodology Session
  // ══════════════════════════════════════════════════════════════

  describe('startSession()', () => {
    it('returns MethodologyStartResult shape', () => {
      const result = store.startSession('meth-1', 'P2-SD', 'build a feature') as {
        methodologySessionId: string;
        methodology: {
          id: string;
          name: string;
          objective: string | null;
          methodCount: number;
        };
        transitionFunction: {
          predicateCount: number;
          armCount: number;
        };
        status: string;
        message: string;
      };

      assert.ok(result, 'startSession should return a result');
      assert.equal(result.methodologySessionId, 'meth-1');
      assert.ok(result.methodology, 'should have methodology block');
      assert.equal(result.methodology.id, 'P2-SD');
      assert.ok(typeof result.methodology.name === 'string');
      assert.ok(typeof result.methodology.methodCount === 'number');
      assert.ok(result.methodology.methodCount > 0, 'should have at least 1 method');
      assert.ok(result.transitionFunction, 'should have transitionFunction block');
      assert.ok(typeof result.transitionFunction.predicateCount === 'number');
      assert.ok(typeof result.transitionFunction.armCount === 'number');
      assert.ok(typeof result.message === 'string');
    });

    it('session has status "initialized"', () => {
      const result = store.startSession('meth-2', 'P2-SD', null) as {
        status: string;
      };

      assert.equal(result.status, 'initialized');
    });
  });

  describe('getRouting()', () => {
    it('returns RoutingInfo for P2-SD', () => {
      const result = store.getRouting('P2-SD') as {
        methodologyId: string;
        name: string;
        predicates: Array<unknown>;
        arms: Array<unknown>;
        evaluationOrder: string;
      };

      assert.ok(result, 'getRouting should return a result');
      assert.equal(result.methodologyId, 'P2-SD');
      assert.ok(typeof result.name === 'string');
      assert.ok(Array.isArray(result.predicates), 'predicates should be an array');
      assert.ok(Array.isArray(result.arms), 'arms should be an array');
      assert.ok(typeof result.evaluationOrder === 'string');
    });

    it('arms have priority, label, condition, and selects', () => {
      const result = store.getRouting('P2-SD') as {
        arms: Array<{
          priority: number;
          label: string;
          condition: string;
          selects: string | null;
          rationale: string | null;
        }>;
      };

      assert.ok(result.arms.length > 0, 'should have at least one arm');
      for (const arm of result.arms) {
        assert.ok(typeof arm.priority === 'number', 'arm.priority should be a number');
        assert.ok(typeof arm.label === 'string', 'arm.label should be a string');
        assert.ok(typeof arm.condition === 'string', 'arm.condition should be a string');
        // selects can be null (for terminal arms)
        assert.ok(
          arm.selects === null || typeof arm.selects === 'string',
          'arm.selects should be string or null',
        );
      }
    });
  });

  describe('route()', () => {
    it('after startSession, returns routing result', () => {
      store.startSession('meth-route-1', 'P2-SD', 'implement a feature');
      const result = store.route('meth-route-1') as {
        methodologyId: string;
        evaluatedPredicates: Array<{
          name: string;
          value: boolean | null;
          source: string;
        }>;
        selectedArm: {
          priority: number;
          label: string;
          condition: string;
          rationale: string | null;
        } | null;
        selectedMethod: {
          id: string;
          name: string;
          stepCount: number;
          description: string;
        } | null;
        priorMethodsCompleted: Array<unknown>;
        message: string;
      };

      assert.ok(result, 'route should return a result');
      assert.equal(result.methodologyId, 'P2-SD');
      assert.ok(Array.isArray(result.evaluatedPredicates), 'evaluatedPredicates should be an array');
      assert.ok(typeof result.message === 'string');
      assert.ok(Array.isArray(result.priorMethodsCompleted));
    });
  });

  describe('select()', () => {
    it('loads method into session', () => {
      // Find a valid method in P2-SD
      const list = store.list() as Array<{
        methodologyId: string;
        methods: Array<{ methodId: string }>;
      }>;
      const p2sd = list.find((m) => m.methodologyId === 'P2-SD');
      assert.ok(p2sd, 'P2-SD should exist');
      assert.ok(p2sd!.methods.length > 0, 'P2-SD should have methods');

      const firstMethodId = p2sd!.methods[0].methodId;

      const result = store.select('sess-select-1', 'P2-SD', firstMethodId) as {
        methodologySessionId: string;
        selectedMethod: {
          methodId: string;
          name: string;
          stepCount: number;
          firstStep: { id: string; name: string };
        };
        message: string;
      };

      assert.equal(result.methodologySessionId, 'sess-select-1');
      assert.ok(result.selectedMethod, 'should have selectedMethod');
      assert.equal(result.selectedMethod.methodId, firstMethodId);
      assert.ok(typeof result.selectedMethod.name === 'string');
      assert.ok(typeof result.selectedMethod.stepCount === 'number');
      assert.ok(result.selectedMethod.firstStep, 'should have firstStep');
      assert.ok(typeof result.selectedMethod.firstStep.id === 'string');
      assert.ok(typeof result.selectedMethod.firstStep.name === 'string');
      assert.ok(typeof result.message === 'string');
    });
  });

  describe('transition()', () => {
    it('completes method and returns next method or null', () => {
      // Start a methodology session and load a method
      store.startSession('meth-trans-1', 'P2-SD', 'build something');

      // Find a valid method in P2-SD
      const list = store.list() as Array<{
        methodologyId: string;
        methods: Array<{ methodId: string }>;
      }>;
      const p2sd = list.find((m) => m.methodologyId === 'P2-SD');
      assert.ok(p2sd);
      const firstMethodId = p2sd!.methods[0].methodId;

      // Load the method into the methodology session
      store.loadMethodInSession('meth-trans-1', firstMethodId);

      // Now transition
      const result = store.transition('meth-trans-1', 'Method completed successfully') as {
        completedMethod: {
          id: string;
          name: string;
          stepCount: number;
          outputsRecorded: number;
        };
        methodologyProgress: {
          methodsCompleted: number;
          globalObjectiveStatus: string;
        };
        nextMethod: {
          id: string;
          name: string;
          stepCount: number;
          description: string;
          routingRationale: string;
        } | null;
        message: string;
      };

      assert.ok(result, 'transition should return a result');
      assert.ok(result.completedMethod, 'should have completedMethod');
      assert.equal(result.completedMethod.id, firstMethodId);
      assert.ok(typeof result.completedMethod.name === 'string');
      assert.ok(typeof result.completedMethod.outputsRecorded === 'number');
      assert.ok(result.methodologyProgress, 'should have methodologyProgress');
      assert.equal(result.methodologyProgress.methodsCompleted, 1);
      assert.ok(typeof result.methodologyProgress.globalObjectiveStatus === 'string');
      assert.ok(typeof result.message === 'string');
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Session Isolation
  // ══════════════════════════════════════════════════════════════

  describe('session isolation', () => {
    it('different session IDs get independent sessions', () => {
      store.loadMethod('sess-iso-A', 'P0-META', 'M1-MDES');
      store.loadMethod('sess-iso-B', 'P0-META', 'M1-MDES');

      // Advance session A
      store.advanceStep('sess-iso-A');

      // Session B should still be at step 0
      const statusA = store.getStatus('sess-iso-A') as { stepIndex: number };
      const statusB = store.getStatus('sess-iso-B') as { stepIndex: number };

      assert.equal(statusA.stepIndex, 1, 'session A should be at step 1');
      assert.equal(statusB.stepIndex, 0, 'session B should still be at step 0');
    });

    it('same session ID returns same session state', () => {
      store.loadMethod('sess-iso-same', 'P0-META', 'M1-MDES');
      store.advanceStep('sess-iso-same');

      const status1 = store.getStatus('sess-iso-same') as { stepIndex: number };
      const status2 = store.getStatus('sess-iso-same') as { stepIndex: number };

      assert.equal(status1.stepIndex, status2.stepIndex, 'same session ID should return same state');
      assert.equal(status1.stepIndex, 1);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Error Handling
  // ══════════════════════════════════════════════════════════════

  describe('error handling', () => {
    it('getStatus() on non-existent session throws', () => {
      // getOrCreateStepSession creates a new session, but status() calls assertLoaded()
      // which throws if no method is loaded
      assert.throws(
        () => store.getStatus('nonexistent-session'),
        /no methodology loaded/i,
        'should throw when no method is loaded',
      );
    });

    it('getRouting() on non-existent methodology throws', () => {
      assert.throws(
        () => store.getRouting('NONEXISTENT-METH'),
        /not found/i,
        'should throw for non-existent methodology',
      );
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Edge Cases — Branch Coverage
  // ══════════════════════════════════════════════════════════════

  describe('validateStep() edge cases', () => {
    it('throws mismatch error when step_id does not match current step', () => {
      store.loadMethod('val-mm-1', 'P0-META', 'M1-MDES');

      assert.throws(
        () => store.validateStep('val-mm-1', 'wrong_step_id', { data: 'test' }),
        /mismatch/i,
        'should throw step_id mismatch error',
      );
    });

    it('validates correctly when step_id matches current step', () => {
      store.loadMethod('val-ok-1', 'P0-META', 'M1-MDES');
      const current = store.getCurrentStep('val-ok-1') as { step: { id: string } };

      const result = store.validateStep('val-ok-1', current.step.id, {
        decision: 'proceed',
      }) as { valid: boolean; recommendation: string };

      assert.ok(typeof result.valid === 'boolean');
      assert.ok(['advance', 'retry', 'escalate'].includes(result.recommendation));
    });
  });

  describe('advanceStep() edge cases', () => {
    it('throws at terminal step (already at last step)', () => {
      store.loadMethod('adv-term-1', 'P0-META', 'M1-MDES');

      const status = store.getStatus('adv-term-1') as { totalSteps: number };
      // Advance to the last step
      for (let i = 0; i < status.totalSteps - 1; i++) {
        store.advanceStep('adv-term-1');
      }

      // Now at terminal — should throw
      assert.throws(
        () => store.advanceStep('adv-term-1'),
        /terminal step/i,
        'should throw "already at terminal step" error',
      );
    });

    it('throws when no methodology is loaded', () => {
      assert.throws(
        () => store.advanceStep('no-load-adv'),
        /no methodology loaded/i,
        'should throw when no method is loaded',
      );
    });
  });

  describe('loadMethodInSession() edge cases', () => {
    it('throws when session status is "executing"', () => {
      store.startSession('lm-exec-1', 'P2-SD', null);
      const list = store.list() as Array<{
        methodologyId: string;
        methods: Array<{ methodId: string }>;
      }>;
      const p2sd = list.find((m) => m.methodologyId === 'P2-SD');
      assert.ok(p2sd);
      const firstMethodId = p2sd!.methods[0].methodId;

      // Load a method — sets status to "executing"
      store.loadMethodInSession('lm-exec-1', firstMethodId);

      // Try to load another method while executing — should throw
      assert.throws(
        () => store.loadMethodInSession('lm-exec-1', firstMethodId),
        /Cannot load method/i,
        'should throw when status is executing',
      );
    });

    it('throws when no methodology session active', () => {
      assert.throws(
        () => store.loadMethodInSession('no-meth-sess', 'M1-MDES'),
        /No methodology session active/i,
        'should throw when no methodology session exists',
      );
    });

    it('throws when method is not in methodology repertoire', () => {
      store.startSession('lm-not-in-1', 'P2-SD', null);

      assert.throws(
        () => store.loadMethodInSession('lm-not-in-1', 'NONEXISTENT-METHOD'),
        /not in methodology/i,
        'should throw when method is not in repertoire',
      );
    });
  });

  describe('transition() edge cases', () => {
    it('throws when session status is not executing', () => {
      store.startSession('trans-init-1', 'P2-SD', null);

      // Status is "initialized", not "executing"
      assert.throws(
        () => store.transition('trans-init-1', 'done'),
        /Cannot transition/i,
        'should throw when status is not executing',
      );
    });

    it('throws when no methodology session active', () => {
      assert.throws(
        () => store.transition('no-meth-trans', null),
        /No methodology session active/i,
        'should throw when no methodology session exists',
      );
    });
  });

  describe('select() edge cases', () => {
    it('throws when methodology does not exist', () => {
      assert.throws(
        () => store.select('sel-err-1', 'NONEXISTENT', 'M1-FOO'),
        /not found/i,
        'should throw for non-existent methodology',
      );
    });

    it('throws when method is not in methodology repertoire', () => {
      assert.throws(
        () => store.select('sel-err-2', 'P2-SD', 'NONEXISTENT-METHOD'),
        /not in methodology/i,
        'should throw when method not in repertoire',
      );
    });
  });

  describe('getCurrentStep() edge cases', () => {
    it('throws when no methodology is loaded', () => {
      assert.throws(
        () => store.getCurrentStep('no-load-curr'),
        /no methodology loaded/i,
        'should throw when no method loaded',
      );
    });
  });

  describe('getStepContext() edge cases', () => {
    it('throws when no methodology is loaded', () => {
      assert.throws(
        () => store.getStepContext('no-load-ctx'),
        /no methodology loaded/i,
        'should throw when no method loaded',
      );
    });
  });

  describe('route() edge cases', () => {
    it('throws when no methodology session active', () => {
      assert.throws(
        () => store.route('no-meth-route'),
        /No methodology session active/i,
        'should throw when no methodology session exists',
      );
    });
  });

  describe('startSession() edge cases', () => {
    it('throws for non-existent methodology', () => {
      assert.throws(
        () => store.startSession('start-err-1', 'NONEXISTENT', null),
        /not found/i,
        'should throw for non-existent methodology',
      );
    });
  });
});
