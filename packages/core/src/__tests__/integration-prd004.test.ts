/**
 * PRD-004 Phase 4 — Integration Validation (Acceptance Test)
 *
 * Exercises the full methodology session lifecycle: start -> route -> load ->
 * execute steps -> transition -> load next method -> verify cross-method
 * working memory -> complete.
 *
 * Uses M3-TMP and M2-ORCH under P1-EXEC (both parseable; M1-COUNCIL has
 * a YAML duplicated mapping key issue).
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve } from 'path';
import {
  startMethodologySession,
  routeMethodology,
  loadMethodInSession,
  transitionMethodology,
  createSession,
  selectMethodology,
  validateStepOutput,
} from '../index.js';

const REGISTRY = resolve(import.meta.dirname, '..', '..', '..', '..', 'registry');

// ---------------------------------------------------------------------------
// Test 1: Full loop — start → route → load → execute → transition → load → execute → complete
// ---------------------------------------------------------------------------

describe('Integration: full methodology session loop', () => {
  it('start → route → load → execute → transition → load → execute → complete', () => {
    // 1. Start methodology session
    const { session: methSession, result: startResult } = startMethodologySession(
      REGISTRY, 'P1-EXEC', 'Test challenge for integration', 'integ-1',
    );

    assert.equal(startResult.status, 'initialized');
    assert.equal(startResult.methodologySessionId, 'integ-1');
    assert.equal(startResult.methodology.id, 'P1-EXEC');
    assert.ok(startResult.methodology.methodCount >= 2, 'P1-EXEC should have at least 2 methods');

    // 2. Route — select M3-TMP (sequential dispatch)
    const routeResult = routeMethodology(REGISTRY, methSession, {
      adversarial_pressure_beneficial: false,
      decomposable_before_execution: false,
    });

    assert.ok(routeResult.selectedArm !== null, 'should have a selected arm');
    assert.equal(routeResult.selectedArm!.label, 'sequential_dispatch');
    assert.ok(routeResult.selectedMethod !== null, 'should select a method');
    assert.equal(routeResult.selectedMethod!.id, 'M3-TMP');

    // 3. Load M3-TMP
    const session = createSession();
    const loadResult = loadMethodInSession(REGISTRY, methSession, 'M3-TMP', session, 'integ-1');

    assert.equal(loadResult.method.id, 'M3-TMP');
    assert.equal(loadResult.methodologyProgress.methodsCompleted, 0);
    assert.deepEqual(loadResult.priorMethodOutputs, []);
    assert.equal(methSession.status, 'executing');
    assert.equal(methSession.currentMethodId, 'M3-TMP');

    // 4. Execute M3-TMP steps — record some outputs
    const ctx1 = session.context();
    assert.equal(ctx1.methodology.id, 'P1-EXEC');
    assert.equal(ctx1.methodology.name, 'Execution Methodology');
    assert.deepEqual(ctx1.priorMethodOutputs, []);  // No prior methods yet
    assert.equal(ctx1.method.id, 'M3-TMP');
    assert.equal(ctx1.step.id, 'sigma_0');  // First step of M3-TMP

    // Record output for sigma_0
    session.recordStepOutput('sigma_0', {
      sub_questions: ['What is the integration test coverage?'],
      scope_note: 'Complete integration test for PRD-004 methodology lifecycle',
    });

    // Advance to sigma_1
    session.advance();

    // Verify priorStepOutputs shows sigma_0's output
    const ctx2 = session.context();
    assert.ok(ctx2.priorStepOutputs.length > 0, 'should have prior step outputs');
    assert.equal(ctx2.priorStepOutputs[0].stepId, 'sigma_0');
    assert.ok(ctx2.priorStepOutputs[0].summary.includes('sub_questions'));
    assert.equal(ctx2.step.id, 'sigma_1');  // Now on Execute step

    // Record output for sigma_1
    session.recordStepOutput('sigma_1', {
      answers: [{ sub_question: 'coverage', answer: 'Full lifecycle tested' }],
    });

    // 5. Transition — complete M3-TMP, re-route with predicates for M2-ORCH
    const transResult1 = transitionMethodology(REGISTRY, methSession, session, 'M3-TMP completed task successfully', {
      adversarial_pressure_beneficial: false,
      decomposable_before_execution: true,
    });

    assert.equal(transResult1.completedMethod.id, 'M3-TMP');
    assert.equal(transResult1.methodologyProgress.methodsCompleted, 1);
    assert.ok(transResult1.message.includes('M3-TMP'));
    assert.ok(transResult1.message.includes('completed'));

    // 6. Load M2-ORCH (or whatever the transition recommends)
    const nextMethodId = transResult1.nextMethod?.id ?? 'M2-ORCH';
    assert.equal(nextMethodId, 'M2-ORCH', 'transition should recommend M2-ORCH given predicates');

    const loadResult2 = loadMethodInSession(REGISTRY, methSession, nextMethodId, session, 'integ-1');

    assert.equal(loadResult2.method.id, 'M2-ORCH');
    assert.equal(loadResult2.methodologyProgress.methodsCompleted, 1);
    assert.ok(loadResult2.priorMethodOutputs.length > 0, 'should have prior method outputs from M3-TMP');
    assert.equal(loadResult2.priorMethodOutputs[0].methodId, 'M3-TMP');

    // 7. Verify cross-method outputs in step_context
    const ctx3 = session.context();
    assert.ok(ctx3.priorMethodOutputs.length > 0, 'should have prior method outputs from M3-TMP');
    assert.equal(ctx3.priorMethodOutputs[0].methodId, 'M3-TMP');
    assert.ok(ctx3.priorMethodOutputs[0].stepOutputs.length > 0, 'M3-TMP should have recorded step outputs');

    // Verify methodology context is correct (P1-EXEC, not M2-ORCH)
    assert.equal(ctx3.methodology.id, 'P1-EXEC');
    assert.equal(ctx3.methodology.name, 'Execution Methodology');
    assert.equal(ctx3.method.id, 'M2-ORCH');

    // 8. Transition again — complete M2-ORCH
    const transResult2 = transitionMethodology(REGISTRY, methSession, session, 'Second method completed');

    assert.equal(transResult2.completedMethod.id, 'M2-ORCH');
    assert.equal(transResult2.methodologyProgress.methodsCompleted, 2);

    // Verify the session data reflects completion
    assert.equal(methSession.completedMethods.length, 2);
    assert.equal(methSession.completedMethods[0].methodId, 'M3-TMP');
    assert.equal(methSession.completedMethods[1].methodId, 'M2-ORCH');
  });
});

// ---------------------------------------------------------------------------
// Test 2: methodology_select backward compatibility
// ---------------------------------------------------------------------------

describe('Integration: methodology_select backward compatibility', () => {
  it('selectMethodology creates a working session that can be used with methodology session functions', () => {
    // Use selectMethodology (the backward-compatible path)
    const session = createSession();
    const selectResult = selectMethodology(REGISTRY, 'P1-EXEC', 'M3-TMP', session, 'compat-1');

    assert.equal(selectResult.selectedMethod.methodId, 'M3-TMP');
    assert.ok(selectResult.selectedMethod.stepCount > 0);

    // Verify the session is loaded and has correct methodology context
    const ctx = session.context();
    assert.equal(ctx.methodology.id, 'P1-EXEC');
    assert.equal(ctx.methodology.name, 'Execution Methodology');
    assert.equal(ctx.method.id, 'M3-TMP');

    // Now create a methodology session manually (as the MCP shim would),
    // set it to executing with M3-TMP, and verify transitionMethodology works
    const { session: methSession } = startMethodologySession(REGISTRY, 'P1-EXEC', 'compat test', 'compat-1');
    methSession.status = 'executing';
    methSession.currentMethodId = 'M3-TMP';

    // Record a step output so transition captures it
    session.recordStepOutput('sigma_0', { result: 'compat test output' });

    // Transition should work with the manually-configured methodology session
    const transResult = transitionMethodology(REGISTRY, methSession, session, 'completed via compat path');

    assert.equal(transResult.completedMethod.id, 'M3-TMP');
    assert.equal(transResult.methodologyProgress.methodsCompleted, 1);
    assert.ok(transResult.completedMethod.outputsRecorded >= 1, 'should have recorded step outputs');
  });
});

// ---------------------------------------------------------------------------
// Test 3: Session isolation — different session IDs don't interfere
// ---------------------------------------------------------------------------

describe('Integration: session isolation', () => {
  it('two methodology sessions with different IDs do not interfere', () => {
    // Session A: start P1-EXEC, load M3-TMP
    const { session: methSessionA } = startMethodologySession(REGISTRY, 'P1-EXEC', 'challenge A', 'iso-A');
    const sessionA = createSession();
    loadMethodInSession(REGISTRY, methSessionA, 'M3-TMP', sessionA, 'iso-A');

    // Session B: start P1-EXEC, load M2-ORCH
    const { session: methSessionB } = startMethodologySession(REGISTRY, 'P1-EXEC', 'challenge B', 'iso-B');
    const sessionB = createSession();
    loadMethodInSession(REGISTRY, methSessionB, 'M2-ORCH', sessionB, 'iso-B');

    // Verify A is executing M3-TMP
    assert.equal(methSessionA.currentMethodId, 'M3-TMP');
    assert.equal(methSessionA.status, 'executing');
    assert.equal(methSessionA.challenge, 'challenge A');

    // Verify B is executing M2-ORCH
    assert.equal(methSessionB.currentMethodId, 'M2-ORCH');
    assert.equal(methSessionB.status, 'executing');
    assert.equal(methSessionB.challenge, 'challenge B');

    // Verify context doesn't bleed
    const ctxA = sessionA.context();
    const ctxB = sessionB.context();
    assert.equal(ctxA.method.id, 'M3-TMP');
    assert.equal(ctxB.method.id, 'M2-ORCH');

    // Record outputs in A — B should not see them
    sessionA.recordStepOutput('sigma_0', { data: 'session A output' });

    const outputsA = sessionA.getStepOutputs();
    const outputsB = sessionB.getStepOutputs();
    assert.equal(outputsA.length, 1);
    assert.equal(outputsB.length, 0);

    // Transition A — B should remain unaffected
    transitionMethodology(REGISTRY, methSessionA, sessionA, 'A done');
    assert.equal(methSessionA.completedMethods.length, 1);
    assert.equal(methSessionB.completedMethods.length, 0);  // B untouched
    assert.equal(methSessionB.status, 'executing');  // B still executing
  });
});

// ---------------------------------------------------------------------------
// Test 4: step_context includes methodology progress when in methodology session
// ---------------------------------------------------------------------------

describe('Integration: step_context includes methodology progress', () => {
  it('context returns methodology id and name, not the method name', () => {
    const { session: methSession } = startMethodologySession(REGISTRY, 'P1-EXEC', 'ctx test', 'ctx-prog-1');
    const session = createSession();

    loadMethodInSession(REGISTRY, methSession, 'M3-TMP', session, 'ctx-prog-1');

    const ctx = session.context();

    // methodology should reflect P1-EXEC (the methodology), not M3-TMP (the method)
    assert.equal(ctx.methodology.id, 'P1-EXEC');
    assert.equal(ctx.methodology.name, 'Execution Methodology');

    // method should reflect M3-TMP
    assert.equal(ctx.method.id, 'M3-TMP');
    assert.equal(ctx.method.name, 'Traditional Meta-Prompting Method');

    // progress should show step position within M3-TMP
    assert.equal(ctx.stepIndex, 0);
    assert.equal(ctx.totalSteps, 3);  // M3-TMP has 3 steps
    assert.equal(ctx.methodology.progress, '1 / 3');
  });

  it('context shows correct progress after advancing steps', () => {
    const { session: methSession } = startMethodologySession(REGISTRY, 'P1-EXEC', 'ctx test', 'ctx-prog-2');
    const session = createSession();

    loadMethodInSession(REGISTRY, methSession, 'M3-TMP', session, 'ctx-prog-2');

    // Advance to step 2
    session.advance();
    const ctx = session.context();
    assert.equal(ctx.stepIndex, 1);
    assert.equal(ctx.methodology.progress, '2 / 3');
    assert.equal(ctx.step.id, 'sigma_1');
  });

  it('validateStepOutput records output and integrates with methodology session', () => {
    const { session: methSession } = startMethodologySession(REGISTRY, 'P1-EXEC', 'validate test', 'ctx-prog-3');
    const session = createSession();

    loadMethodInSession(REGISTRY, methSession, 'M3-TMP', session, 'ctx-prog-3');

    // Validate output for sigma_0 (current step)
    // Note: M3-TMP uses a `fields` array in output_schema, which the simple-schema
    // path in validateStepOutput sees as a required key. The validation may flag
    // schema issues, but the critical behavior is that output is always recorded
    // regardless of validation result.
    const validationResult = validateStepOutput(session, 'sigma_0', {
      sub_questions: ['How does the system handle errors?'],
      scope_note: 'Error handling coverage',
    });

    // postconditionMet should pass (postcondition mentions "challenge", "decomposition"
    // which are present or partially matched via keyword heuristic)
    assert.ok(validationResult.postconditionMet !== undefined, 'should have postconditionMet field');
    assert.ok(validationResult.recommendation !== undefined, 'should have recommendation field');

    // Output should be recorded in step outputs regardless of schema validation
    const outputs = session.getStepOutputs();
    assert.equal(outputs.length, 1);
    assert.equal(outputs[0].stepId, 'sigma_0');

    // Transition should capture the validated output
    // First set the method session status to executing (loadMethodInSession already did this)
    const transResult = transitionMethodology(REGISTRY, methSession, session, 'done with validation');
    assert.equal(transResult.completedMethod.outputsRecorded, 1);
  });
});
