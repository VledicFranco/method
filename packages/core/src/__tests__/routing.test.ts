import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve } from 'path';
import { getMethodologyRouting } from '../index.js';

const REGISTRY = resolve(import.meta.dirname, '..', '..', '..', '..', 'registry');

describe('getMethodologyRouting — P2-SD', () => {
  it('successfully extracts routing for P2-SD', () => {
    const result = getMethodologyRouting(REGISTRY, 'P2-SD');

    assert.equal(result.methodologyId, 'P2-SD');
    assert.equal(result.name, 'Software Delivery Methodology');
    assert.equal(result.arms.length, 9);
    assert.ok(result.predicates.length > 0, 'predicates should be non-empty');
    assert.ok(result.evaluationOrder.length > 0, 'evaluationOrder should be present');
  });

  it('arms have correct structure — first arm', () => {
    const result = getMethodologyRouting(REGISTRY, 'P2-SD');
    const first = result.arms[0];

    assert.equal(first.priority, 1);
    assert.equal(first.label, 'section');
    assert.equal(first.selects, 'M7-PRDS');
    assert.ok(typeof first.condition === 'string');
    assert.ok(typeof first.rationale === 'string');
  });

  it('predicates are merged — multi_task_scope has operationalization', () => {
    const result = getMethodologyRouting(REGISTRY, 'P2-SD');

    // multi_task_scope has an exact name match between domain_theory.predicates
    // and predicate_operationalization.predicates, so it gets merged.
    const multiTask = result.predicates.find(p => p.name === 'multi_task_scope');
    assert.ok(multiTask, 'multi_task_scope predicate should exist');
    assert.ok(multiTask!.description !== null, 'multi_task_scope should have a description from domain_theory');
    assert.ok(multiTask!.trueWhen !== null, 'multi_task_scope should have trueWhen from operationalization');
    assert.ok(multiTask!.falseWhen !== null, 'multi_task_scope should have falseWhen from operationalization');
  });

  it('predicates without operationalization have null trueWhen/falseWhen', () => {
    const result = getMethodologyRouting(REGISTRY, 'P2-SD');

    // "dispatched" is a structural predicate — no operationalization expected
    const dispatched = result.predicates.find(p => p.name === 'dispatched');
    assert.ok(dispatched, 'dispatched predicate should exist');
    assert.strictEqual(dispatched!.trueWhen, null);
    assert.strictEqual(dispatched!.falseWhen, null);
  });

  it('terminal arms have null selects', () => {
    const result = getMethodologyRouting(REGISTRY, 'P2-SD');

    const terminateArm = result.arms.find(a => a.label === 'terminate');
    assert.ok(terminateArm, 'terminate arm should exist');
    assert.strictEqual(terminateArm!.selects, null);

    const executingArm = result.arms.find(a => a.label === 'executing');
    assert.ok(executingArm, 'executing arm should exist');
    assert.strictEqual(executingArm!.selects, null);
  });
});

describe('getMethodologyRouting — error cases', () => {
  it('throws for non-existent methodology', () => {
    assert.throws(
      () => getMethodologyRouting(REGISTRY, 'DOES-NOT-EXIST'),
      { message: 'Methodology DOES-NOT-EXIST not found in registry' },
    );
  });

  it('throws for method YAML instead of methodology', () => {
    // Use registry/P2-SD as the "registry" path so that resolving
    // "M1-IMPL" finds registry/P2-SD/M1-IMPL/M1-IMPL.yaml — a real
    // method-level YAML (has `method:` root key, not `methodology:`).
    const methodAsRegistry = resolve(REGISTRY, 'P2-SD');
    assert.throws(
      () => getMethodologyRouting(methodAsRegistry, 'M1-IMPL'),
      /is a method, not a methodology/,
    );
  });
});
