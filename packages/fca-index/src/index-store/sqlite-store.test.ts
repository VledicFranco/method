// SPDX-License-Identifier: Apache-2.0
/**
 * SqliteStore — unit tests.
 *
 * Uses in-memory SQLite (Database(':memory:')) — no real files.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteStore } from './sqlite-store.js';
import type { IndexEntry } from '../ports/internal/index-store.js';

type EntryWithoutEmbedding = Omit<IndexEntry, 'embedding'>;

function makeEntry(overrides: Partial<EntryWithoutEmbedding> = {}): EntryWithoutEmbedding {
  return {
    id: 'abcdef0123456789',
    projectRoot: '/proj',
    path: 'src/domain',
    level: 'L2',
    parts: [
      { part: 'interface', filePath: 'src/domain/index.ts', excerpt: 'export interface Foo {}' },
    ],
    coverageScore: 0.8,
    indexedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('SqliteStore', () => {
  let store: SqliteStore;

  beforeEach(() => {
    const db = new Database(':memory:');
    store = new SqliteStore(db);
  });

  describe('upsert + getById', () => {
    it('stores and retrieves an entry by id', () => {
      const entry = makeEntry();
      store.upsert(entry);

      const result = store.getById(entry.id);
      expect(result).toBeDefined();
      expect(result!.id).toBe(entry.id);
      expect(result!.projectRoot).toBe(entry.projectRoot);
      expect(result!.path).toBe(entry.path);
      expect(result!.level).toBe(entry.level);
      expect(result!.coverageScore).toBe(entry.coverageScore);
      expect(result!.indexedAt).toBe(entry.indexedAt);
      expect(result!.parts).toEqual(entry.parts);
    });

    it('returns undefined for non-existent id', () => {
      const result = store.getById('nonexistent0000000');
      expect(result).toBeUndefined();
    });

    it('overwrites an existing entry on upsert', () => {
      const entry = makeEntry({ coverageScore: 0.5 });
      store.upsert(entry);
      store.upsert({ ...entry, coverageScore: 0.95, path: 'new/path' });

      const result = store.getById(entry.id);
      expect(result!.coverageScore).toBe(0.95);
      expect(result!.path).toBe('new/path');
    });

    it('serializes and deserializes parts correctly', () => {
      const entry = makeEntry({
        parts: [
          { part: 'interface', filePath: 'a.ts', excerpt: 'interfaces here' },
          { part: 'documentation', filePath: 'README.md', excerpt: 'docs' },
        ],
      });
      store.upsert(entry);

      const result = store.getById(entry.id);
      expect(result!.parts).toHaveLength(2);
      expect(result!.parts[0].part).toBe('interface');
      expect(result!.parts[1].part).toBe('documentation');
    });
  });

  describe('getByProjectRoot', () => {
    beforeEach(() => {
      store.upsert(makeEntry({ id: 'aaaa000000000001', path: 'a', level: 'L2', coverageScore: 0.9, parts: [{ part: 'interface', filePath: 'a.ts', excerpt: '' }] }));
      store.upsert(makeEntry({ id: 'bbbb000000000001', path: 'b', level: 'L3', coverageScore: 0.4, parts: [{ part: 'documentation', filePath: 'b.md', excerpt: '' }] }));
      store.upsert(makeEntry({ id: 'cccc000000000001', path: 'c', projectRoot: '/other', level: 'L1', coverageScore: 0.7, parts: [] }));
    });

    it('returns entries for the given project only', () => {
      const results = store.getByProjectRoot('/proj');
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.projectRoot === '/proj')).toBe(true);
    });

    it('filters by level', () => {
      const results = store.getByProjectRoot('/proj', { levels: ['L2'] });
      expect(results).toHaveLength(1);
      expect(results[0].level).toBe('L2');
    });

    it('filters by parts', () => {
      const results = store.getByProjectRoot('/proj', { parts: ['documentation'] });
      expect(results).toHaveLength(1);
      expect(results[0].parts[0].part).toBe('documentation');
    });

    it('filters by minCoverageScore', () => {
      const results = store.getByProjectRoot('/proj', { minCoverageScore: 0.5 });
      expect(results).toHaveLength(1);
      expect(results[0].coverageScore).toBeGreaterThanOrEqual(0.5);
    });

    it('returns results sorted by coverageScore descending', () => {
      const results = store.getByProjectRoot('/proj');
      expect(results[0].coverageScore).toBeGreaterThanOrEqual(results[1].coverageScore);
    });
  });

  describe('getCoverageStats', () => {
    it('returns correct totalComponents and weightedAverage', () => {
      store.upsert(makeEntry({ id: 'dddd000000000001', path: 'a', coverageScore: 0.8 }));
      store.upsert(makeEntry({ id: 'eeee000000000001', path: 'b', coverageScore: 0.4 }));

      const stats = store.getCoverageStats('/proj');
      expect(stats.totalComponents).toBe(2);
      expect(stats.weightedAverage).toBeCloseTo(0.6, 5);
    });

    it('returns correct byPart fractions', () => {
      store.upsert(makeEntry({
        id: 'ffff000000000001', path: 'x',
        parts: [{ part: 'interface', filePath: 'x.ts', excerpt: '' }],
      }));
      store.upsert(makeEntry({
        id: 'gggg000000000001', path: 'y',
        parts: [
          { part: 'interface', filePath: 'y.ts', excerpt: '' },
          { part: 'documentation', filePath: 'y.md', excerpt: '' },
        ],
      }));

      const stats = store.getCoverageStats('/proj');
      expect(stats.byPart['interface']).toBeCloseTo(1.0, 5);
      expect(stats.byPart['documentation']).toBeCloseTo(0.5, 5);
      expect(stats.byPart['port']).toBeCloseTo(0.0, 5);
    });

    it('returns zeros when project has no entries', () => {
      const stats = store.getCoverageStats('/empty');
      expect(stats.totalComponents).toBe(0);
      expect(stats.weightedAverage).toBe(0);
    });
  });

  describe('deleteByProjectRoot', () => {
    it('removes all entries for a project', () => {
      store.upsert(makeEntry({ id: 'hhhh000000000001', path: 'a' }));
      store.upsert(makeEntry({ id: 'iiii000000000001', path: 'b' }));

      store.deleteByProjectRoot('/proj');

      const results = store.getByProjectRoot('/proj');
      expect(results).toHaveLength(0);
    });

    it('does not affect entries for other projects', () => {
      store.upsert(makeEntry({ id: 'jjjj000000000001', projectRoot: '/other', path: 'a', parts: [] }));
      store.upsert(makeEntry({ id: 'kkkk000000000001', projectRoot: '/proj', path: 'b' }));

      store.deleteByProjectRoot('/proj');

      const otherResults = store.getByProjectRoot('/other');
      expect(otherResults).toHaveLength(1);
    });
  });
});
