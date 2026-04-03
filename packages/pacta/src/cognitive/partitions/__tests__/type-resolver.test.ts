import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTypeResolver } from '../type-resolver.js';
import type { EntryContentType } from '../../algebra/workspace-types.js';

describe('TypeResolver', () => {
  const resolver = createTypeResolver();

  it('resolves constraint → constraint partition', () => {
    assert.deepStrictEqual(resolver.resolve(['constraint']), ['constraint']);
  });

  it('resolves goal → task partition', () => {
    assert.deepStrictEqual(resolver.resolve(['goal']), ['task']);
  });

  it('resolves operational → operational partition', () => {
    assert.deepStrictEqual(resolver.resolve(['operational']), ['operational']);
  });

  it('resolves multiple types to multiple partitions (deduped)', () => {
    const result = resolver.resolve(['goal', 'constraint']);
    assert.strictEqual(result.length, 2);
    assert.ok(result.includes('task'));
    assert.ok(result.includes('constraint'));
  });

  it('resolves all three types to all three partitions', () => {
    const result = resolver.resolve(['constraint', 'goal', 'operational']);
    assert.strictEqual(result.length, 3);
    assert.ok(result.includes('constraint'));
    assert.ok(result.includes('task'));
    assert.ok(result.includes('operational'));
  });

  it('returns empty array for empty types', () => {
    assert.deepStrictEqual(resolver.resolve([]), []);
  });

  it('deduplicates when same type repeated', () => {
    const result = resolver.resolve(['goal', 'goal'] as EntryContentType[]);
    assert.deepStrictEqual(result, ['task']);
  });
});
