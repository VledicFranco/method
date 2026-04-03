import { describe, it, expect } from 'vitest';
import { createTypeResolver } from '../type-resolver.js';
import type { EntryContentType } from '../../algebra/workspace-types.js';

describe('TypeResolver', () => {
  const resolver = createTypeResolver();

  it('resolves constraint → constraint partition', () => {
    expect(resolver.resolve(['constraint'])).toEqual(['constraint']);
  });

  it('resolves goal → task partition', () => {
    expect(resolver.resolve(['goal'])).toEqual(['task']);
  });

  it('resolves operational → operational partition', () => {
    expect(resolver.resolve(['operational'])).toEqual(['operational']);
  });

  it('resolves multiple types to multiple partitions (deduped)', () => {
    const result = resolver.resolve(['goal', 'constraint']);
    expect(result).toHaveLength(2);
    expect(result).toContain('task');
    expect(result).toContain('constraint');
  });

  it('resolves all three types to all three partitions', () => {
    const result = resolver.resolve(['constraint', 'goal', 'operational']);
    expect(result).toHaveLength(3);
    expect(result).toContain('constraint');
    expect(result).toContain('task');
    expect(result).toContain('operational');
  });

  it('returns empty array for empty types', () => {
    expect(resolver.resolve([])).toEqual([]);
  });

  it('deduplicates when same type repeated', () => {
    const result = resolver.resolve(['goal', 'goal'] as EntryContentType[]);
    expect(result).toEqual(['task']);
  });
});
