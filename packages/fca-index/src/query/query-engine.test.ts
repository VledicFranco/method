// SPDX-License-Identifier: Apache-2.0
/**
 * query-engine.test.ts — Unit tests for QueryEngine.
 *
 * Uses InMemoryIndexStore for the store and a deterministic StubEmbeddingClient.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { QueryEngine } from './query-engine.js';
import { ContextQueryError } from '../ports/context-query.js';
import type { EmbeddingClientPort } from '../ports/internal/embedding-client.js';
import { InMemoryIndexStore } from '../index-store/in-memory-store.js';
import { InMemoryFileSystem } from '../scanner/test-helpers/in-memory-fs.js';

// ── Stub embedding client ────────────────────────────────────────────────────

class StubEmbeddingClient implements EmbeddingClientPort {
  readonly dimensions = 3;

  async embed(texts: string[]): Promise<number[][]> {
    // Deterministic embedding based on text length
    return texts.map((t) => [t.length / 100, 0.5, 0.5]);
  }
}

class FailingEmbeddingClient implements EmbeddingClientPort {
  readonly dimensions = 3;

  async embed(_texts: string[]): Promise<number[][]> {
    throw new Error('Network error');
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const PROJECT_ROOT = '/test-project';

/** Stub FileSystem that returns mtime=0 for all paths (nothing is ever stale). */
const stubFs = new InMemoryFileSystem({});

function makeStore(): InMemoryIndexStore {
  return new InMemoryIndexStore();
}

async function seedStore(store: InMemoryIndexStore): Promise<void> {
  await store.upsertComponent({
    id: 'auth0000000000001',
    projectRoot: PROJECT_ROOT,
    path: 'src/domains/auth',
    level: 'L2',
    parts: [
      {
        part: 'documentation',
        filePath: 'src/domains/auth/README.md',
        excerpt: 'Auth domain handles authentication and login',
      },
      {
        part: 'port',
        filePath: 'src/domains/auth/ports/auth-port.ts',
      },
    ],
    coverageScore: 0.9,
    embedding: [0.8, 0.5, 0.5],
    indexedAt: new Date().toISOString(),
  });

  await store.upsertComponent({
    id: 'bill0000000000002',
    projectRoot: PROJECT_ROOT,
    path: 'src/domains/billing',
    level: 'L2',
    parts: [
      {
        part: 'documentation',
        filePath: 'src/domains/billing/README.md',
        excerpt: 'Billing domain manages subscriptions',
      },
    ],
    coverageScore: 0.7,
    embedding: [0.1, 0.9, 0.2],
    indexedAt: new Date().toISOString(),
  });

  await store.upsertComponent({
    id: 'sess0000000000003',
    projectRoot: PROJECT_ROOT,
    path: 'src/domains/sessions',
    level: 'L3',
    parts: [
      {
        part: 'domain',
        filePath: 'src/domains/sessions/session-manager.ts',
      },
      {
        part: 'interface',
        filePath: 'src/domains/sessions/index.ts',
      },
    ],
    coverageScore: 0.6,
    embedding: [0.5, 0.5, 0.8],
    indexedAt: new Date().toISOString(),
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('QueryEngine', () => {
  let store: InMemoryIndexStore;
  let embedder: StubEmbeddingClient;

  beforeEach(async () => {
    store = makeStore();
    embedder = new StubEmbeddingClient();
    await seedStore(store);
  });

  describe('result ordering', () => {
    it('returns results sorted by relevanceScore descending', async () => {
      const engine = new QueryEngine(store, embedder, stubFs, { projectRoot: PROJECT_ROOT });
      const result = await engine.query({ query: 'authentication', topK: 3 });

      expect(result.results.length).toBeGreaterThan(0);
      for (let i = 1; i < result.results.length; i++) {
        expect(result.results[i - 1].relevanceScore).toBeGreaterThanOrEqual(
          result.results[i].relevanceScore,
        );
      }
    });
  });

  describe('topK', () => {
    it('limits result count to topK', async () => {
      const engine = new QueryEngine(store, embedder, stubFs, { projectRoot: PROJECT_ROOT });
      const result = await engine.query({ query: 'anything', topK: 2 });

      expect(result.results.length).toBeLessThanOrEqual(2);
    });

    it('defaults topK to 5 when not specified', async () => {
      // Seed extra entries so we could exceed 5
      for (let i = 4; i <= 8; i++) {
        await store.upsertComponent({
          id: `extra000000000${i.toString().padStart(3, '0')}`,
          projectRoot: PROJECT_ROOT,
          path: `src/extra/${i}`,
          level: 'L1',
          parts: [{ part: 'documentation', filePath: `src/extra/${i}/README.md` }],
          coverageScore: 0.5,
          embedding: [Math.random(), Math.random(), Math.random()],
          indexedAt: new Date().toISOString(),
        });
      }

      const engine = new QueryEngine(store, embedder, stubFs, { projectRoot: PROJECT_ROOT });
      const result = await engine.query({ query: 'something' });

      expect(result.results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('filters', () => {
    it('propagates parts filter — only returns port-bearing components', async () => {
      const engine = new QueryEngine(store, embedder, stubFs, { projectRoot: PROJECT_ROOT });
      const result = await engine.query({ query: 'any', parts: ['port'] });

      for (const ctx of result.results) {
        const hasPart = ctx.parts.some((p) => p.part === 'port');
        expect(hasPart).toBe(true);
      }
    });

    it('propagates levels filter — only returns L2 components', async () => {
      const engine = new QueryEngine(store, embedder, stubFs, { projectRoot: PROJECT_ROOT });
      const result = await engine.query({ query: 'any', levels: ['L2'] });

      for (const ctx of result.results) {
        expect(ctx.level).toBe('L2');
      }
    });

    it('propagates minCoverageScore filter', async () => {
      const engine = new QueryEngine(store, embedder, stubFs, { projectRoot: PROJECT_ROOT });
      const result = await engine.query({ query: 'any', minCoverageScore: 0.8 });

      for (const ctx of result.results) {
        expect(ctx.coverageScore).toBeGreaterThanOrEqual(0.8);
      }
    });
  });

  describe('mode determination', () => {
    it('returns production mode when weighted average >= threshold', async () => {
      // All seeded entries have high enough coverage: auth=0.9, billing=0.7, sessions=0.6
      // avg = (0.9+0.7+0.6)/3 = 0.733 < 0.8 (default) — need high-coverage store
      const highStore = new InMemoryIndexStore();
      await highStore.upsertComponent({
        id: 'hi00000000000001',
        projectRoot: PROJECT_ROOT,
        path: 'src/a',
        level: 'L2',
        parts: [{ part: 'documentation', filePath: 'src/a/README.md' }],
        coverageScore: 1.0,
        embedding: [1, 0, 0],
        indexedAt: new Date().toISOString(),
      });
      await highStore.upsertComponent({
        id: 'hi00000000000002',
        projectRoot: PROJECT_ROOT,
        path: 'src/b',
        level: 'L2',
        parts: [{ part: 'documentation', filePath: 'src/b/README.md' }],
        coverageScore: 0.9,
        embedding: [0.9, 0.1, 0],
        indexedAt: new Date().toISOString(),
      });

      const engine = new QueryEngine(highStore, embedder, stubFs, {
        projectRoot: PROJECT_ROOT,
        coverageThreshold: 0.8,
      });
      const result = await engine.query({ query: 'test' });

      expect(result.mode).toBe('production');
    });

    it('returns discovery mode when weighted average < threshold', async () => {
      const engine = new QueryEngine(store, embedder, stubFs, {
        projectRoot: PROJECT_ROOT,
        coverageThreshold: 0.8,
      });
      // avg = (0.9+0.7+0.6)/3 ≈ 0.733 < 0.8
      const result = await engine.query({ query: 'test' });

      expect(result.mode).toBe('discovery');
    });
  });

  describe('error handling', () => {
    it('throws ContextQueryError INDEX_NOT_FOUND when index is empty for projectRoot', async () => {
      const emptyStore = new InMemoryIndexStore();
      const engine = new QueryEngine(emptyStore, embedder, stubFs, { projectRoot: PROJECT_ROOT });

      await expect(engine.query({ query: 'anything' })).rejects.toMatchObject({
        message: 'No index found for project',
        code: 'INDEX_NOT_FOUND',
      });
    });

    it('does not throw INDEX_NOT_FOUND when results are empty due to filters but index exists', async () => {
      // Index has entries but none match the filter
      const engine = new QueryEngine(store, embedder, stubFs, { projectRoot: PROJECT_ROOT });
      // minCoverageScore=1.0 will filter out all entries (max is 0.9)
      const result = await engine.query({ query: 'any', minCoverageScore: 1.0 });

      // Should not throw — index exists, just no matches
      expect(result.results).toHaveLength(0);
    });

    it('re-throws embedding failure as ContextQueryError with QUERY_FAILED code', async () => {
      const failingEmbedder = new FailingEmbeddingClient();
      const engine = new QueryEngine(store, failingEmbedder, stubFs, { projectRoot: PROJECT_ROOT });

      await expect(engine.query({ query: 'test' })).rejects.toMatchObject({
        message: 'Query embedding failed',
        code: 'QUERY_FAILED',
      });
    });

    it('thrown errors are instances of ContextQueryError', async () => {
      const emptyStore = new InMemoryIndexStore();
      const engine = new QueryEngine(emptyStore, embedder, stubFs, { projectRoot: PROJECT_ROOT });

      try {
        await engine.query({ query: 'anything' });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ContextQueryError);
      }
    });
  });

  describe('result shape', () => {
    it('returns ComponentContext with correct fields', async () => {
      const engine = new QueryEngine(store, embedder, stubFs, { projectRoot: PROJECT_ROOT });
      const result = await engine.query({ query: 'auth', topK: 1 });

      expect(result.results.length).toBeGreaterThan(0);
      const ctx = result.results[0];
      expect(ctx).toHaveProperty('path');
      expect(ctx).toHaveProperty('level');
      expect(ctx).toHaveProperty('parts');
      expect(ctx).toHaveProperty('relevanceScore');
      expect(ctx).toHaveProperty('coverageScore');
      expect(ctx.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(ctx.relevanceScore).toBeLessThanOrEqual(1);
    });
  });
});
