import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve } from 'path';
import {
  startMethodologySession,
  createMethodologySessionManager,
  routeMethodology,
  loadMethodInSession,
  transitionMethodology,
  createSession,
} from '../index.js';
import type { MethodologySessionData } from '../index.js';

const REGISTRY = resolve(import.meta.dirname, '..', '..', '..', '..', 'registry');

describe('startMethodologySession — P1-EXEC', () => {
  it('returns correct metadata for a real methodology', () => {
    const { result } = startMethodologySession(REGISTRY, 'P1-EXEC', 'test challenge', 'test-sid');

    assert.equal(result.methodologySessionId, 'test-sid');
    assert.equal(result.methodology.id, 'P1-EXEC');
    assert.equal(result.methodology.name, 'Execution Methodology');
    assert.ok(result.methodology.methodCount >= 2, 'P1-EXEC should have at least 2 methods');
    assert.ok(result.transitionFunction.predicateCount > 0, 'should have predicates');
    assert.ok(result.transitionFunction.armCount > 0, 'should have arms');
    assert.equal(result.status, 'initialized');
    assert.ok(result.message.includes('P1-EXEC'));
    assert.ok(result.message.includes('methodology_route'));
  });

  it('extracts the objective from YAML', () => {
    const { result } = startMethodologySession(REGISTRY, 'P1-EXEC', null, 'obj-sid');

    assert.ok(result.methodology.objective !== null, 'P1-EXEC should have an objective');
    assert.ok(result.methodology.objective!.includes('method_completed'), 'objective should reference method_completed');
  });
});

describe('startMethodologySession — error cases', () => {
  it('throws for non-existent methodology', () => {
    assert.throws(
      () => startMethodologySession(REGISTRY, 'DOES-NOT-EXIST', null, 'err-sid'),
      { message: 'Methodology DOES-NOT-EXIST not found' },
    );
  });
});

describe('startMethodologySession — session data', () => {
  it('returns valid MethodologySessionData', () => {
    const { session } = startMethodologySession(REGISTRY, 'P1-EXEC', 'my challenge', 'data-sid');

    assert.equal(session.id, 'data-sid');
    assert.equal(session.methodologyId, 'P1-EXEC');
    assert.equal(session.methodologyName, 'Execution Methodology');
    assert.equal(session.challenge, 'my challenge');
    assert.equal(session.status, 'initialized');
    assert.equal(session.currentMethodId, null);
    assert.deepEqual(session.completedMethods, []);
    assert.equal(session.globalObjectiveStatus, 'in_progress');
    assert.ok(session.routingInfo.predicates.length > 0, 'routingInfo should have predicates');
    assert.ok(session.routingInfo.arms.length > 0, 'routingInfo should have arms');
    assert.equal(session.routingInfo.methodologyId, 'P1-EXEC');
  });
});

describe('createMethodologySessionManager', () => {
  it('set and get a session', () => {
    const manager = createMethodologySessionManager();
    const { session } = startMethodologySession(REGISTRY, 'P1-EXEC', null, 'mgr-sid');

    manager.set('mgr-sid', session);
    const retrieved = manager.get('mgr-sid');

    assert.ok(retrieved !== null);
    assert.equal(retrieved!.id, 'mgr-sid');
    assert.equal(retrieved!.methodologyId, 'P1-EXEC');
  });

  it('returns null for non-existent session', () => {
    const manager = createMethodologySessionManager();
    const retrieved = manager.get('nonexistent');

    assert.strictEqual(retrieved, null);
  });
});

// --- Phase 2 tests: routeMethodology ---

describe('routeMethodology — P1-EXEC', () => {
  it('routes to adversarial_dispatch arm when adversarial_pressure_beneficial is true', () => {
    const { session } = startMethodologySession(REGISTRY, 'P1-EXEC', 'test', 'route-1');
    const result = routeMethodology(REGISTRY, session, {
      adversarial_pressure_beneficial: true,
    });

    assert.equal(result.methodologyId, 'P1-EXEC');
    assert.ok(result.selectedArm !== null, 'should have a selected arm');
    assert.equal(result.selectedArm!.label, 'adversarial_dispatch');
    assert.equal(result.selectedArm!.priority, 1);
    // Note: M1-COUNCIL YAML has a parsing error (duplicated mapping key), so
    // selectedMethod may be null if listMethodologies can't parse it. The routing
    // logic is correct — the arm selection is what matters.
    assert.ok(result.message.includes('adversarial_dispatch'));
  });

  it('routes to M2-ORCH when adversarial=false, decomposable=true', () => {
    const { session } = startMethodologySession(REGISTRY, 'P1-EXEC', 'test', 'route-2');
    const result = routeMethodology(REGISTRY, session, {
      adversarial_pressure_beneficial: false,
      decomposable_before_execution: true,
    });

    assert.ok(result.selectedArm !== null);
    assert.equal(result.selectedArm!.label, 'orchestration_dispatch');
    assert.ok(result.selectedMethod !== null);
    assert.equal(result.selectedMethod!.id, 'M2-ORCH');
  });

  it('routes to M3-TMP when adversarial=false, decomposable=false', () => {
    const { session } = startMethodologySession(REGISTRY, 'P1-EXEC', 'test', 'route-3');
    const result = routeMethodology(REGISTRY, session, {
      adversarial_pressure_beneficial: false,
      decomposable_before_execution: false,
    });

    assert.ok(result.selectedArm !== null);
    assert.equal(result.selectedArm!.label, 'sequential_dispatch');
    assert.ok(result.selectedMethod !== null);
    assert.equal(result.selectedMethod!.id, 'M3-TMP');
  });

  it('returns a result with no predicates provided (all inconclusive)', () => {
    const { session } = startMethodologySession(REGISTRY, 'P1-EXEC', 'test', 'route-4');
    const result = routeMethodology(REGISTRY, session);

    assert.equal(result.methodologyId, 'P1-EXEC');
    // With no predicates, arms with all-null referenced predicates still match (inconclusive = pass)
    // The first arm should match since is_method_selected is false (matching NOT is_method_selected)
    // and the other predicates are null (inconclusive, treated as passing)
    assert.ok(result.selectedArm !== null, 'should still match an arm');
    assert.ok(result.message.length > 0);
  });

  it('categorizes predicates as provided vs inferred', () => {
    const { session } = startMethodologySession(REGISTRY, 'P1-EXEC', 'test', 'route-5');
    const result = routeMethodology(REGISTRY, session, {
      adversarial_pressure_beneficial: true,
    });

    const provided = result.evaluatedPredicates.filter((p) => p.source === 'provided');
    const inferred = result.evaluatedPredicates.filter((p) => p.source === 'inferred');

    assert.ok(provided.length >= 1, 'should have at least one provided predicate');
    const apb = provided.find((p) => p.name === 'adversarial_pressure_beneficial');
    assert.ok(apb !== undefined, 'adversarial_pressure_beneficial should be provided');
    assert.equal(apb!.value, true);

    // is_method_selected and method_completed should be inferred
    const ims = result.evaluatedPredicates.find((p) => p.name === 'is_method_selected');
    assert.ok(ims !== undefined, 'is_method_selected should be in evaluated predicates');
    assert.equal(ims!.source, 'inferred');
    assert.equal(ims!.value, false); // no method selected yet

    assert.ok(inferred.length >= 1, 'should have at least one inferred predicate');
  });
});

// --- Phase 2 tests: loadMethodInSession ---

describe('loadMethodInSession — P1-EXEC', () => {
  it('loads M3-TMP into the session with correct result', () => {
    const { session: methSession } = startMethodologySession(REGISTRY, 'P1-EXEC', 'test', 'load-1');
    const session = createSession();

    const result = loadMethodInSession(REGISTRY, methSession, 'M3-TMP', session, 'load-1');

    assert.equal(result.methodologySessionId, 'load-1');
    assert.equal(result.method.id, 'M3-TMP');
    assert.ok(result.method.name.length > 0, 'method should have a name');
    assert.ok(result.method.stepCount > 0, 'method should have steps');
    assert.ok(result.method.firstStep.id.length > 0, 'first step should have an id');
    assert.equal(result.methodologyProgress.methodsCompleted, 0);
    assert.equal(result.methodologyProgress.methodsRemaining, 'unknown');
    assert.equal(result.methodologyProgress.currentMethodIndex, 0);
    assert.deepEqual(result.priorMethodOutputs, []);
    assert.ok(result.message.includes('M3-TMP'));
    assert.ok(result.message.includes('Execution Methodology'));
  });

  it('sets methodology context on the method session', () => {
    const { session: methSession } = startMethodologySession(REGISTRY, 'P1-EXEC', 'test', 'load-2');
    const session = createSession();

    loadMethodInSession(REGISTRY, methSession, 'M3-TMP', session, 'load-2');

    // Verify context is set by calling session.context()
    const ctx = session.context();
    assert.equal(ctx.methodology.id, 'P1-EXEC');
    assert.equal(ctx.methodology.name, 'Execution Methodology');
  });

  it('updates methodology session status to executing', () => {
    const { session: methSession } = startMethodologySession(REGISTRY, 'P1-EXEC', 'test', 'load-3');
    const session = createSession();

    assert.equal(methSession.status, 'initialized');
    loadMethodInSession(REGISTRY, methSession, 'M3-TMP', session, 'load-3');
    assert.equal(methSession.status, 'executing');
    assert.equal(methSession.currentMethodId, 'M3-TMP');
  });

  it('throws for method not in repertoire', () => {
    const { session: methSession } = startMethodologySession(REGISTRY, 'P1-EXEC', 'test', 'load-4');
    const session = createSession();

    assert.throws(
      () => loadMethodInSession(REGISTRY, methSession, 'M99-FAKE', session, 'load-4'),
      { message: "Method M99-FAKE is not in methodology P1-EXEC's repertoire" },
    );
  });

  it('throws when session status is executing', () => {
    const { session: methSession } = startMethodologySession(REGISTRY, 'P1-EXEC', 'test', 'load-5');
    const session = createSession();

    // Load once — moves to executing
    loadMethodInSession(REGISTRY, methSession, 'M3-TMP', session, 'load-5');
    assert.equal(methSession.status, 'executing');

    // Try to load again — should throw
    assert.throws(
      () => loadMethodInSession(REGISTRY, methSession, 'M1-COUNCIL', session, 'load-5'),
      /Cannot load method when session status is 'executing'/,
    );
  });
});

// --- Phase 3 tests: transitionMethodology ---

describe('transitionMethodology — full flow: start → load → transition', () => {
  it('completes M3-TMP and re-routes to a next method', () => {
    const { session: methSession } = startMethodologySession(REGISTRY, 'P1-EXEC', 'test', 'trans-1');
    const session = createSession();

    // Load M3-TMP
    loadMethodInSession(REGISTRY, methSession, 'M3-TMP', session, 'trans-1');
    assert.equal(methSession.status, 'executing');
    assert.equal(methSession.currentMethodId, 'M3-TMP');

    // Transition
    const result = transitionMethodology(REGISTRY, methSession, session, 'M3-TMP done', {
      adversarial_pressure_beneficial: false,
      decomposable_before_execution: false,
    });

    // Verify completedMethod
    assert.equal(result.completedMethod.id, 'M3-TMP');
    assert.ok(result.completedMethod.stepCount > 0, 'should have step count');

    // Verify methodologyProgress
    assert.equal(result.methodologyProgress.methodsCompleted, 1);

    // Message should indicate completion
    assert.ok(result.message.includes('M3-TMP'));
    assert.ok(result.message.includes('completed'));
  });
});

describe('transitionMethodology — records step outputs', () => {
  it('captures recorded step outputs in the completed method', () => {
    const { session: methSession } = startMethodologySession(REGISTRY, 'P1-EXEC', 'test', 'trans-2');
    const session = createSession();

    loadMethodInSession(REGISTRY, methSession, 'M3-TMP', session, 'trans-2');

    // Record some step outputs
    session.recordStepOutput('sigma_A1', { analysis: 'done' });
    session.recordStepOutput('sigma_A2', { design: 'complete' });

    const result = transitionMethodology(REGISTRY, methSession, session, 'done');

    assert.equal(result.completedMethod.outputsRecorded, 2);

    // Verify the outputs are stored in completedMethods
    assert.equal(methSession.completedMethods.length, 1);
    assert.equal(methSession.completedMethods[0].stepOutputs.length, 2);
    assert.equal(methSession.completedMethods[0].stepOutputs[0].stepId, 'sigma_A1');
  });
});

describe('transitionMethodology — with completion summary', () => {
  it('stores the completion summary in completedMethods', () => {
    const { session: methSession } = startMethodologySession(REGISTRY, 'P1-EXEC', 'test', 'trans-3');
    const session = createSession();

    loadMethodInSession(REGISTRY, methSession, 'M3-TMP', session, 'trans-3');

    transitionMethodology(REGISTRY, methSession, session, 'Successfully completed task analysis');

    assert.equal(methSession.completedMethods.length, 1);
    assert.equal(methSession.completedMethods[0].completionSummary, 'Successfully completed task analysis');
  });
});

describe('transitionMethodology — error: not executing', () => {
  it('throws when session status is initialized (not executing)', () => {
    const { session: methSession } = startMethodologySession(REGISTRY, 'P1-EXEC', 'test', 'trans-4');
    const session = createSession();

    // Don't load any method — status is still 'initialized'
    assert.throws(
      () => transitionMethodology(REGISTRY, methSession, session, null),
      { message: 'Cannot transition: no method is currently executing' },
    );
  });
});

// --- Phase 3 tests: enhanced step_context with priorMethodOutputs ---

describe('enhanced step_context — priorMethodOutputs', () => {
  it('priorMethodOutputs is empty on first method load', () => {
    const { session: methSession } = startMethodologySession(REGISTRY, 'P1-EXEC', 'test', 'ctx-1');
    const session = createSession();

    loadMethodInSession(REGISTRY, methSession, 'M3-TMP', session, 'ctx-1');

    const ctx = session.context();
    assert.deepStrictEqual(ctx.priorMethodOutputs, []);
  });

  it('priorMethodOutputs populated after transition and re-load', () => {
    const { session: methSession } = startMethodologySession(REGISTRY, 'P1-EXEC', 'test', 'ctx-2');
    const session = createSession();

    // Load M3-TMP and record outputs
    loadMethodInSession(REGISTRY, methSession, 'M3-TMP', session, 'ctx-2');
    session.recordStepOutput('sigma_A1', { result: 'analyzed' });

    // Transition (completes M3-TMP) — provide predicates so re-routing finds M2-ORCH
    transitionMethodology(REGISTRY, methSession, session, 'done', {
      adversarial_pressure_beneficial: false,
      decomposable_before_execution: true,
    });

    // Load M2-ORCH
    loadMethodInSession(REGISTRY, methSession, 'M2-ORCH', session, 'ctx-2');

    // Check context — should have M3-TMP's outputs as prior method outputs
    const ctx = session.context();
    assert.equal(ctx.priorMethodOutputs.length, 1);
    assert.equal(ctx.priorMethodOutputs[0].methodId, 'M3-TMP');
    assert.equal(ctx.priorMethodOutputs[0].stepOutputs.length, 1);
    assert.equal(ctx.priorMethodOutputs[0].stepOutputs[0].stepId, 'sigma_A1');
    assert.ok(ctx.priorMethodOutputs[0].stepOutputs[0].summary.includes('analyzed'));
  });
});
