import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve } from 'path';
import { createSession, loadMethodology, selectMethodology } from '../index.js';
import type { MethodologySelectResult } from '../index.js';

const REGISTRY = resolve(import.meta.dirname, '..', '..', '..', '..', 'registry');

describe('selectMethodology — success', () => {
  it('selects M1-IMPL from P2-SD methodology', () => {
    const session = createSession();
    const result: MethodologySelectResult = selectMethodology(
      REGISTRY,
      'P2-SD',
      'M1-IMPL',
      session,
      'test-session',
    );

    assert.equal(result.methodologySessionId, 'test-session');
    assert.equal(result.selectedMethod.methodId, 'M1-IMPL');
    assert.ok(result.selectedMethod.name.length > 0);
    assert.equal(result.selectedMethod.stepCount, 9);
    assert.equal(result.selectedMethod.firstStep.id, 'sigma_A1');
    assert.equal(result.selectedMethod.firstStep.name, 'Inventory');
    assert.ok(result.message.includes('M1-IMPL'));
    assert.ok(result.message.includes('Software Delivery Methodology'));
  });

  it('returns correct MethodologySelectResult structure', () => {
    const session = createSession();
    const result = selectMethodology(REGISTRY, 'P2-SD', 'M1-IMPL', session, 'sid');

    // All required fields present
    assert.ok('methodologySessionId' in result);
    assert.ok('selectedMethod' in result);
    assert.ok('message' in result);

    // selectedMethod sub-fields
    assert.ok('methodId' in result.selectedMethod);
    assert.ok('name' in result.selectedMethod);
    assert.ok('stepCount' in result.selectedMethod);
    assert.ok('firstStep' in result.selectedMethod);
    assert.ok('id' in result.selectedMethod.firstStep);
    assert.ok('name' in result.selectedMethod.firstStep);
  });

  it('sets methodology context — context() returns methodology name', () => {
    const session = createSession();
    selectMethodology(REGISTRY, 'P2-SD', 'M1-IMPL', session, 'ctx-test');

    const ctx = session.context();
    assert.equal(ctx.methodology.id, 'P2-SD');
    assert.equal(ctx.methodology.name, 'Software Delivery Methodology');
    // method name should be the actual method name, not the methodology name
    assert.ok(ctx.method.name.includes('Implementing'));
  });
});

describe('selectMethodology — error cases', () => {
  it('throws for non-existent methodology', () => {
    const session = createSession();
    assert.throws(
      () => selectMethodology(REGISTRY, 'DOES-NOT-EXIST', 'M1-IMPL', session, 's'),
      { message: 'Methodology DOES-NOT-EXIST not found' },
    );
  });

  it('throws for method not in methodology repertoire', () => {
    const session = createSession();
    assert.throws(
      () => selectMethodology(REGISTRY, 'P2-SD', 'NONEXISTENT-METHOD', session, 's'),
      /is not in methodology P2-SD's repertoire/,
    );
  });
});
