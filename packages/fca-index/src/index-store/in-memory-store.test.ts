/**
 * InMemoryIndexStore — unit tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryIndexStore } from './in-memory-store.js';
import type { IndexEntry } from '../ports/internal/index-store.js';

function makeEntry(overrides: Partial<IndexEntry> = {}): IndexEntry {
  return {
    id: 'abcdef0123456789',
    projectRoot: '/proj',
    path: 'src/domain',
    level: 'L2',
    parts: [
      { part: 'interface', filePath: 'src/domain/index.ts', excerpt: 'export interface Foo {}' },
      { part: 'documentation', filePath: 'src/domain/README.md', excerpt: 'Docs here' },
    ],
    coverageScore: 0.8,
    embedding: [1, 0, 0, 0],
    indexedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('InMemoryIndexStore', () => {
  let store: InMemoryIndexStore;

  beforeEach(() => {
    store = new InMemoryIndexStore();
  });

  describe('upsertComponent + queryBySimilarity', () => {
    it('upserted entry appears in similarity results', async () => {
      const entry = makeEntry({ embedding: [1, 0, 0, 0] });
      await store.upsertComponent(entry);

      const results = await store.queryBySimilarity([1, 0, 0, 0], 5, {
        projectRoot: '/proj',
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(entry.id);
    });

    it('returns top K by cosine similarity', async () => {
      await store.upsertComponent(makeEntry({ id: 'aaa0000000000001', embedding: [1, 0, 0, 0], path: 'a' }));
      await store.upsertComponent(makeEntry({ id: 'bbb0000000000001', embedding: [0, 1, 0, 0], path: 'b' }));
      await store.upsertComponent(makeEntry({ id: 'ccc0000000000001', embedding: [0, 0, 1, 0], path: 'c' }));

      const results = await store.queryBySimilarity([1, 0, 0, 0], 1, {
        projectRoot: '/proj',
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('aaa0000000000001');
    });

    it('replaces existing entry on upsert (same id)', async () => {
      const entry = makeEntry({ coverageScore: 0.5 });
      await store.upsertComponent(entry);
      await store.upsertComponent({ ...entry, coverageScore: 0.9 });

      const results = await store.queryBySimilarity([1, 0, 0, 0], 10, {
        projectRoot: '/proj',
      });
      expect(results).toHaveLength(1);
      expect(results[0].coverageScore).toBe(0.9);
    });

    it('does not return entries from different project', async () => {
      await store.upsertComponent(makeEntry({ projectRoot: '/other' }));
      const results = await store.queryBySimilarity([1, 0, 0, 0], 5, {
        projectRoot: '/proj',
      });
      expect(results).toHaveLength(0);
    });
  });

  describe('queryByFilters', () => {
    beforeEach(async () => {
      await store.upsertComponent(
        makeEntry({
          id: 'lll2000000000001',
          level: 'L2',
          parts: [{ part: 'interface', filePath: 'a.ts', excerpt: '' }],
          coverageScore: 0.9,
          path: 'l2',
        }),
      );
      await store.upsertComponent(
        makeEntry({
          id: 'lll3000000000001',
          level: 'L3',
          parts: [{ part: 'documentation', filePath: 'b.ts', excerpt: '' }],
          coverageScore: 0.4,
          path: 'l3',
        }),
      );
    });

    it('filters by level', async () => {
      const results = await store.queryByFilters({ projectRoot: '/proj', levels: ['L2'] });
      expect(results).toHaveLength(1);
      expect(results[0].level).toBe('L2');
    });

    it('filters by parts', async () => {
      const results = await store.queryByFilters({
        projectRoot: '/proj',
        parts: ['documentation'],
      });
      expect(results).toHaveLength(1);
      expect(results[0].parts[0].part).toBe('documentation');
    });

    it('filters by minCoverageScore', async () => {
      const results = await store.queryByFilters({
        projectRoot: '/proj',
        minCoverageScore: 0.5,
      });
      expect(results).toHaveLength(1);
      expect(results[0].coverageScore).toBeGreaterThanOrEqual(0.5);
    });

    it('returns entries sorted by coverageScore descending', async () => {
      const results = await store.queryByFilters({ projectRoot: '/proj' });
      expect(results[0].coverageScore).toBeGreaterThanOrEqual(results[1].coverageScore);
    });
  });

  describe('getCoverageStats', () => {
    it('returns correct weightedAverage', async () => {
      await store.upsertComponent(makeEntry({ id: 'a000000000000001', coverageScore: 0.6, path: 'a' }));
      await store.upsertComponent(makeEntry({ id: 'b000000000000001', coverageScore: 0.4, path: 'b' }));

      const stats = await store.getCoverageStats('/proj');
      expect(stats.totalComponents).toBe(2);
      expect(stats.weightedAverage).toBeCloseTo(0.5, 5);
    });

    it('returns correct byPart fractions', async () => {
      await store.upsertComponent(
        makeEntry({
          id: 'x000000000000001',
          path: 'x',
          parts: [{ part: 'interface', filePath: 'x.ts', excerpt: '' }],
        }),
      );
      await store.upsertComponent(
        makeEntry({
          id: 'y000000000000001',
          path: 'y',
          parts: [
            { part: 'interface', filePath: 'y.ts', excerpt: '' },
            { part: 'documentation', filePath: 'y.md', excerpt: '' },
          ],
        }),
      );

      const stats = await store.getCoverageStats('/proj');
      expect(stats.totalComponents).toBe(2);
      expect(stats.byPart['interface']).toBeCloseTo(1.0, 5); // both have interface
      expect(stats.byPart['documentation']).toBeCloseTo(0.5, 5); // only one has docs
      expect(stats.byPart['port']).toBeCloseTo(0.0, 5); // none have port
    });

    it('returns zeros for empty project', async () => {
      const stats = await store.getCoverageStats('/empty');
      expect(stats.totalComponents).toBe(0);
      expect(stats.weightedAverage).toBe(0);
    });
  });

  describe('clear', () => {
    it('removes all entries for a project', async () => {
      await store.upsertComponent(makeEntry({ id: 'aaa0000000000002', path: 'a' }));
      await store.upsertComponent(makeEntry({ id: 'bbb0000000000002', path: 'b' }));

      await store.clear('/proj');

      const results = await store.queryByFilters({ projectRoot: '/proj' });
      expect(results).toHaveLength(0);
    });

    it('does not affect entries from other projects', async () => {
      await store.upsertComponent(makeEntry({ id: 'aaa0000000000003', projectRoot: '/proj' }));
      await store.upsertComponent(makeEntry({ id: 'bbb0000000000003', projectRoot: '/other' }));

      await store.clear('/proj');

      const otherResults = await store.queryByFilters({ projectRoot: '/other' });
      expect(otherResults).toHaveLength(1);
    });
  });
});
