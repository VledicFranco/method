/**
 * IndexStorePort contract test.
 *
 * Runs the same suite against both InMemoryIndexStore and SqliteLanceIndexStore.
 *
 * For SqliteLanceIndexStore:
 *   - Uses in-memory SQLite (Database(':memory:'))
 *   - Uses MockLanceStore (delegates to InMemoryIndexStore-style logic)
 *
 * SqliteLanceIndexStore tests are skipped if @lancedb/lancedb is not available.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { IndexStorePort, IndexEntry } from '../ports/internal/index-store.js';
import { InMemoryIndexStore } from './in-memory-store.js';
import { SqliteStore } from './sqlite-store.js';
import { SqliteLanceIndexStore } from './index-store.js';

// ── Mock LanceStore ───────────────────────────────────────────────────────────

type SimilarityResult = { id: string; score: number };

class MockLanceStore {
  private vectors: Map<string, number[]> = new Map();

  async initialize(): Promise<void> {}

  async upsert(id: string, embedding: number[]): Promise<void> {
    this.vectors.set(id, [...embedding]);
  }

  async querySimilar(
    queryEmbedding: number[],
    topK: number,
    ids?: string[],
  ): Promise<SimilarityResult[]> {
    const candidates = ids
      ? Array.from(this.vectors.entries()).filter(([id]) => ids.includes(id))
      : Array.from(this.vectors.entries());

    const scored: SimilarityResult[] = candidates.map(([id, vec]) => ({
      id,
      score: cosineSimilarity(queryEmbedding, vec),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  async deleteByIds(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.vectors.delete(id);
    }
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<IndexEntry> = {}): IndexEntry {
  return {
    id: 'contract00000001',
    projectRoot: '/proj',
    path: 'src/domain',
    level: 'L2',
    parts: [
      { part: 'interface', filePath: 'src/domain/index.ts', excerpt: 'export interface X {}' },
    ],
    coverageScore: 0.8,
    embedding: [1, 0, 0, 0],
    indexedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── Contract suite ────────────────────────────────────────────────────────────

function runContractSuite(name: string, factory: () => IndexStorePort): void {
  describe(name, () => {
    let store: IndexStorePort;

    beforeEach(() => {
      store = factory();
    });

    it('upsertComponent + queryBySimilarity roundtrip', async () => {
      const entry = makeEntry({ embedding: [1, 0, 0, 0] });
      await store.upsertComponent(entry);

      const results = await store.queryBySimilarity([1, 0, 0, 0], 5, {
        projectRoot: '/proj',
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe(entry.id);
    });

    it('queryByFilters: level filter', async () => {
      await store.upsertComponent(makeEntry({ id: 'cl2000000000001', level: 'L2', path: 'l2' }));
      await store.upsertComponent(makeEntry({ id: 'cl3000000000001', level: 'L3', path: 'l3' }));

      const results = await store.queryByFilters({ projectRoot: '/proj', levels: ['L2'] });
      expect(results.every((e) => e.level === 'L2')).toBe(true);
    });

    it('queryByFilters: parts filter', async () => {
      await store.upsertComponent(
        makeEntry({
          id: 'cp1000000000001',
          path: 'has-interface',
          parts: [{ part: 'interface', filePath: 'a.ts', excerpt: '' }],
        }),
      );
      await store.upsertComponent(
        makeEntry({
          id: 'cp2000000000001',
          path: 'has-docs',
          parts: [{ part: 'documentation', filePath: 'b.md', excerpt: '' }],
        }),
      );

      const results = await store.queryByFilters({
        projectRoot: '/proj',
        parts: ['documentation'],
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('cp2000000000001');
    });

    it('queryByFilters: minCoverageScore filter', async () => {
      await store.upsertComponent(
        makeEntry({ id: 'cs1000000000001', path: 'high', coverageScore: 0.9 }),
      );
      await store.upsertComponent(
        makeEntry({ id: 'cs2000000000001', path: 'low', coverageScore: 0.3 }),
      );

      const results = await store.queryByFilters({
        projectRoot: '/proj',
        minCoverageScore: 0.5,
      });
      expect(results.every((e) => e.coverageScore >= 0.5)).toBe(true);
      expect(results.some((e) => e.id === 'cs1000000000001')).toBe(true);
      expect(results.some((e) => e.id === 'cs2000000000001')).toBe(false);
    });

    it('getCoverageStats: correct weightedAverage', async () => {
      await store.upsertComponent(makeEntry({ id: 'cw1000000000001', path: 'a', coverageScore: 0.8 }));
      await store.upsertComponent(makeEntry({ id: 'cw2000000000001', path: 'b', coverageScore: 0.4 }));

      const stats = await store.getCoverageStats('/proj');
      expect(stats.totalComponents).toBe(2);
      expect(stats.weightedAverage).toBeCloseTo(0.6, 5);
    });

    it('getCoverageStats: correct byPart fractions', async () => {
      await store.upsertComponent(
        makeEntry({
          id: 'cb1000000000001',
          path: 'x',
          parts: [{ part: 'interface', filePath: 'x.ts', excerpt: '' }],
        }),
      );
      await store.upsertComponent(
        makeEntry({
          id: 'cb2000000000001',
          path: 'y',
          parts: [
            { part: 'interface', filePath: 'y.ts', excerpt: '' },
            { part: 'documentation', filePath: 'y.md', excerpt: '' },
          ],
        }),
      );

      const stats = await store.getCoverageStats('/proj');
      expect(stats.byPart['interface']).toBeCloseTo(1.0, 5);
      expect(stats.byPart['documentation']).toBeCloseTo(0.5, 5);
      expect(stats.byPart['port']).toBeCloseTo(0.0, 5);
    });

    it('clear: removes entries for project', async () => {
      await store.upsertComponent(makeEntry({ id: 'cc1000000000001', path: 'a' }));
      await store.upsertComponent(makeEntry({ id: 'cc2000000000001', path: 'b' }));

      await store.clear('/proj');

      const results = await store.queryByFilters({ projectRoot: '/proj' });
      expect(results).toHaveLength(0);
    });
  });
}

// ── Run contract against InMemoryIndexStore ───────────────────────────────────

runContractSuite('Contract: InMemoryIndexStore', () => new InMemoryIndexStore());

// ── Run contract against SqliteLanceIndexStore ────────────────────────────────

// Check if @lancedb/lancedb is available (optional dependency)
let lancedbAvailable = false;
try {
  // Synchronous availability check via import.meta — use dynamic import flag
  // We check by attempting to find the module in node_modules
  const fs = await import('node:fs');
  const path = await import('node:path');
  const pkgDir = path.resolve(
    new URL(import.meta.url).pathname,
    '../../../../../node_modules/@lancedb/lancedb',
  );
  lancedbAvailable = fs.existsSync(pkgDir);
} catch {
  lancedbAvailable = false;
}

runContractSuite(
  'Contract: SqliteLanceIndexStore (with MockLanceStore)',
  () => {
    const db = new Database(':memory:');
    const sqlite = new SqliteStore(db);
    const lance = new MockLanceStore();
    // SqliteLanceIndexStore expects LanceStore but MockLanceStore has compatible interface
    return new SqliteLanceIndexStore(sqlite, lance as never);
  },
);
