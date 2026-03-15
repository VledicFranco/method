import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve } from 'path';
import { startMethodologySession, createMethodologySessionManager } from '../index.js';
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
