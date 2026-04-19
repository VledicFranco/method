// SPDX-License-Identifier: Apache-2.0
/**
 * Indexer — unit tests.
 *
 * Uses InMemoryIndexStore (no disk I/O) and stub doubles for the embedder
 * and manifest reader so tests are hermetic and fast.
 */

import { describe, it, expect } from 'vitest';
import { Indexer } from './indexer.js';
import { InMemoryIndexStore } from '../index-store/in-memory-store.js';
import { InMemoryFileSystem } from '../scanner/test-helpers/in-memory-fs.js';
import { ProjectScanner } from '../scanner/project-scanner.js';
import { FcaDetector } from '../scanner/fca-detector.js';
import { CoverageScorer } from '../scanner/coverage-scorer.js';
import type { EmbeddingClientPort } from '../ports/internal/embedding-client.js';
import type { ManifestReaderPort, ProjectScanConfig } from '../ports/manifest-reader.js';

// ── Test doubles ─────────────────────────────────────────────────────────────

/** Stub embedder — returns deterministic unit vectors. */
class StubEmbedder implements EmbeddingClientPort {
  readonly dimensions = 4;
  private callCount = 0;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((_, i) => {
      const seed = this.callCount * 100 + i;
      return [seed / 1000, 0.5, 0.5, 0.5];
    });
  }

  /** Reset between tests if needed. */
  reset(): void {
    this.callCount = 0;
  }
}

/** Stub manifest reader — always returns a fixed config. */
function stubManifestReader(config: Partial<ProjectScanConfig> = {}): ManifestReaderPort {
  return {
    async read(projectRoot: string): Promise<ProjectScanConfig> {
      return {
        projectRoot,
        sourcePatterns: ['src/**'],
        requiredParts: ['interface', 'documentation'],
        ...config,
      };
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeIndexer(
  tree: Record<string, string>,
  store: InMemoryIndexStore,
  embedder: EmbeddingClientPort,
  manifestOverrides: Partial<ProjectScanConfig> = {},
  batchSize?: number,
): Indexer {
  const fs = new InMemoryFileSystem(tree);
  const scanner = new ProjectScanner(fs, new FcaDetector(fs), new CoverageScorer());
  const manifestReader = stubManifestReader(manifestOverrides);
  return new Indexer(scanner, embedder, store, manifestReader, { batchSize });
}

const projectRoot = '/project';

const sampleTree: Record<string, string> = {
  '/project/src/index.ts': 'export interface Foo { bar(): void; }',
  '/project/src/README.md': '# Foo\n\nThe Foo component.',
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Indexer', () => {
  it('indexes components and upserts them to the store', async () => {
    const store = new InMemoryIndexStore();
    const embedder = new StubEmbedder();
    const indexer = makeIndexer(sampleTree, store, embedder);

    const { componentCount } = await indexer.index(projectRoot);

    expect(componentCount).toBeGreaterThan(0);

    const stats = await store.getCoverageStats(projectRoot);
    expect(stats.totalComponents).toBe(componentCount);
  });

  it('after indexing, getCoverageStats returns non-zero totalComponents', async () => {
    const store = new InMemoryIndexStore();
    const embedder = new StubEmbedder();
    const indexer = makeIndexer(sampleTree, store, embedder);

    await indexer.index(projectRoot);

    const stats = await store.getCoverageStats(projectRoot);
    expect(stats.totalComponents).toBeGreaterThan(0);
  });

  it('clears existing entries before rescanning', async () => {
    const store = new InMemoryIndexStore();
    const embedder = new StubEmbedder();
    const indexer = makeIndexer(sampleTree, store, embedder);

    // First index run
    await indexer.index(projectRoot);
    const statsAfterFirst = await store.getCoverageStats(projectRoot);

    // Second index run — should produce the same count, not doubled
    await indexer.index(projectRoot);
    const statsAfterSecond = await store.getCoverageStats(projectRoot);

    expect(statsAfterSecond.totalComponents).toBe(statsAfterFirst.totalComponents);
  });

  it('handles batching correctly when batchSize is smaller than component count', async () => {
    // Build a tree with 3 separate components
    const tree: Record<string, string> = {
      '/project/src/a/index.ts': 'export interface A {}',
      '/project/src/a/README.md': '# A component',
      '/project/src/b/index.ts': 'export interface B {}',
      '/project/src/b/README.md': '# B component',
      '/project/src/c/index.ts': 'export interface C {}',
      '/project/src/c/README.md': '# C component',
    };

    const store = new InMemoryIndexStore();
    const embedder = new StubEmbedder();
    // batchSize=2 forces batching for 3 components
    const indexer = makeIndexer(tree, store, embedder, {}, 2);

    const { componentCount } = await indexer.index(projectRoot);

    expect(componentCount).toBeGreaterThan(0);

    // All components should be in the store
    const stats = await store.getCoverageStats(projectRoot);
    expect(stats.totalComponents).toBe(componentCount);
  });

  it('indexes components with correct path and projectRoot', async () => {
    const store = new InMemoryIndexStore();
    const embedder = new StubEmbedder();
    const indexer = makeIndexer(sampleTree, store, embedder);

    await indexer.index(projectRoot);

    // Query all entries for the project
    const entries = await store.queryByFilters({ projectRoot });
    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      expect(entry.projectRoot).toBe(projectRoot);
      expect(typeof entry.path).toBe('string');
      expect(typeof entry.id).toBe('string');
      expect(entry.id).toHaveLength(16);
      expect(Array.isArray(entry.embedding)).toBe(true);
    }
  });
});
