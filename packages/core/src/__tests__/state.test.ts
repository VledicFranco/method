import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve } from 'path';
import { loadMethodology, createSession, createSessionManager } from '../index.js';
import type { AdvanceResult, CurrentStepResult } from '../index.js';

const REGISTRY = resolve(import.meta.dirname, '..', '..', '..', '..', 'registry');

// ---------- P1 — Enriched return types ----------

describe('P1 — AdvanceResult', () => {
  it('advance() returns AdvanceResult with all fields', () => {
    const method = loadMethodology(REGISTRY, 'P0-META', 'M1-MDES');
    const session = createSession();
    session.load(method);

    const result: AdvanceResult = session.advance();

    // Structural fields
    assert.equal(result.methodologyId, 'P0-META');
    assert.equal(result.methodId, 'M1-MDES');
    assert.equal(result.stepIndex, 1);
    assert.equal(result.totalSteps, 7);

    // previousStep — was step 0 before advancing
    assert.deepStrictEqual(result.previousStep, {
      id: 'sigma_0',
      name: 'Orientation',
    });

    // nextStep — after advancing to step 1, there are still more steps
    assert.ok(result.nextStep !== null, 'nextStep should not be null when not at terminal');
    assert.equal(result.nextStep!.id, 'sigma_1');
    assert.equal(result.nextStep!.name, 'Domain Theory Crystallization');
  });
});

describe('P1 — CurrentStepResult', () => {
  it('current() returns CurrentStepResult envelope', () => {
    const method = loadMethodology(REGISTRY, 'P0-META', 'M1-MDES');
    const session = createSession();
    session.load(method);

    const result: CurrentStepResult = session.current();

    assert.equal(result.methodologyId, 'P0-META');
    assert.equal(result.methodId, 'M1-MDES');
    assert.equal(result.stepIndex, 0);
    assert.equal(result.totalSteps, 7);

    // step is the full Step object
    assert.equal(result.step.id, 'sigma_0');
    assert.equal(result.step.name, 'Orientation');
    assert.ok('role' in result.step);
    assert.ok('precondition' in result.step);
    assert.ok('postcondition' in result.step);
    assert.ok('guidance' in result.step);
    assert.ok('outputSchema' in result.step);
  });
});

describe('P1 — Terminal step', () => {
  it('advance() returns nextStep: null when reaching the last step', () => {
    const method = loadMethodology(REGISTRY, 'P0-META', 'M1-MDES');
    const session = createSession();
    session.load(method);

    // M1-MDES has 7 steps (indices 0-6). Advance 5 times to reach step 5.
    // The 6th advance (step 5 -> step 6) should set nextStep = null
    // because step 6 is the terminal step.
    for (let i = 0; i < 5; i++) {
      session.advance();
    }

    // Now at step 5 (sigma_5). Advancing should move to step 6 (terminal).
    const result = session.advance();
    assert.equal(result.stepIndex, 6);
    assert.equal(result.totalSteps, 7);
    assert.strictEqual(result.nextStep, null);
    assert.deepStrictEqual(result.previousStep, {
      id: 'sigma_5',
      name: 'Guidance Adequacy Audit',
    });

    // Advancing again from terminal should throw
    assert.throws(
      () => session.advance(),
      { message: 'Already at terminal step — method is complete' },
    );
  });
});

// ---------- P3 — Session isolation ----------

describe('P3 — SessionManager.getOrCreate identity', () => {
  it('getOrCreate("a") returns the same session on repeated calls', () => {
    const mgr = createSessionManager();
    const s1 = mgr.getOrCreate('a');
    const s2 = mgr.getOrCreate('a');
    assert.strictEqual(s1, s2);
  });

  it('getOrCreate("a") and getOrCreate("b") return different sessions', () => {
    const mgr = createSessionManager();
    const sA = mgr.getOrCreate('a');
    const sB = mgr.getOrCreate('b');
    assert.notStrictEqual(sA, sB);
  });
});

describe('P3 — Session isolation between different methods', () => {
  it('loading different methods — each session sees its own method via status()', () => {
    const mgr = createSessionManager();
    const methodA = loadMethodology(REGISTRY, 'P0-META', 'M1-MDES');
    const methodB = loadMethodology(REGISTRY, 'P2-SD', 'M1-IMPL');

    const sA = mgr.getOrCreate('a');
    const sB = mgr.getOrCreate('b');

    sA.load(methodA);
    sB.load(methodB);

    const statusA = sA.status();
    const statusB = sB.status();

    assert.equal(statusA.methodologyId, 'P0-META');
    assert.equal(statusA.methodId, 'M1-MDES');
    assert.equal(statusA.totalSteps, 7);

    assert.equal(statusB.methodologyId, 'P2-SD');
    assert.equal(statusB.methodId, 'M1-IMPL');
    assert.equal(statusB.totalSteps, 9);
  });
});

describe('P3 — Advancing in one session does not affect another', () => {
  it('advancing session "a" does not change session "b" step position', () => {
    const mgr = createSessionManager();
    const methodA = loadMethodology(REGISTRY, 'P0-META', 'M1-MDES');
    const methodB = loadMethodology(REGISTRY, 'P2-SD', 'M1-IMPL');

    const sA = mgr.getOrCreate('a');
    const sB = mgr.getOrCreate('b');

    sA.load(methodA);
    sB.load(methodB);

    // Advance session A three times
    sA.advance();
    sA.advance();
    sA.advance();

    // Session A should be at step 3
    assert.equal(sA.status().stepIndex, 3);
    assert.equal(sA.status().currentStepId, 'sigma_3');

    // Session B should still be at step 0
    assert.equal(sB.status().stepIndex, 0);
    assert.equal(sB.status().currentStepId, 'sigma_A1');
  });
});

describe('P3 — Default session', () => {
  it('default session "__default__" works correctly', () => {
    const mgr = createSessionManager();
    const method = loadMethodology(REGISTRY, 'P0-META', 'M1-MDES');

    const defaultSession = mgr.getOrCreate('__default__');
    defaultSession.load(method);

    assert.equal(defaultSession.isLoaded(), true);
    const status = defaultSession.status();
    assert.equal(status.methodologyId, 'P0-META');
    assert.equal(status.methodId, 'M1-MDES');
    assert.equal(status.stepIndex, 0);

    // Verify it's the same session on repeated access
    const again = mgr.getOrCreate('__default__');
    assert.strictEqual(defaultSession, again);

    // Verify it's different from a named session
    const namedSession = mgr.getOrCreate('named');
    assert.notStrictEqual(defaultSession, namedSession);
  });
});
