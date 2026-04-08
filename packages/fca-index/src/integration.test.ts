/**
 * Integration test — createFcaIndex() end-to-end.
 *
 * Uses real domain classes wired together via createFcaIndex(), backed entirely
 * by in-memory ports (no filesystem, no HTTP, no SQLite).
 *
 * Added in C-6 (Wave 3).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createFcaIndex } from './factory.js';
import { InMemoryIndexStore } from './index-store/in-memory-store.js';
import { InMemoryFileSystem } from './scanner/test-helpers/in-memory-fs.js';
import type { ManifestReaderPort, ProjectScanConfig } from './ports/manifest-reader.js';
import type { EmbeddingClientPort } from './ports/internal/embedding-client.js';

// ── Stubs ─────────────────────────────────────────────────────────────────────

class StubManifestReader implements ManifestReaderPort {
  async read(projectRoot: string): Promise<ProjectScanConfig> {
    return {
      projectRoot,
      sourcePatterns: ['src/**'],
      requiredParts: ['interface', 'documentation'],
    };
  }
}

/** Deterministic stub embedder — produces a 4-dim vector based on text length. */
class StubEmbedder implements EmbeddingClientPort {
  readonly dimensions = 4;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const h = t.length % 4;
      const v: number[] = [0, 0, 0, 0];
      v[h] = 1;
      return v;
    });
  }
}

// ── Fixture filesystem ────────────────────────────────────────────────────────
//
// Three components:
//   /test/src/auth/    — has README.md + index.ts (documentation + interface)
//   /test/src/billing/ — has README.md + index.ts (documentation + interface)
//   /test/src/gateway/ — has README.md only (documentation)

const PROJECT_ROOT = '/test';

function buildFileSystem(): InMemoryFileSystem {
  return new InMemoryFileSystem({
    // auth component
    [`${PROJECT_ROOT}/src/auth/README.md`]:
      'Auth Module\n\nHandles authentication and session management.',
    [`${PROJECT_ROOT}/src/auth/index.ts`]:
      'export interface AuthService { login(user: string): Promise<void>; }',

    // billing component
    [`${PROJECT_ROOT}/src/billing/README.md`]:
      'Billing Module\n\nManages subscriptions and payment processing.',
    [`${PROJECT_ROOT}/src/billing/index.ts`]:
      'export interface BillingService { charge(amount: number): Promise<void>; }',

    // gateway component (documentation only — no interface)
    [`${PROJECT_ROOT}/src/gateway/README.md`]:
      'API Gateway\n\nRoutes incoming requests to downstream services.',
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createFcaIndex() — integration', () => {
  let store: InMemoryIndexStore;

  beforeEach(() => {
    store = new InMemoryIndexStore();
  });

  it('scan populates the store (componentCount >= 2)', async () => {
    const fca = createFcaIndex(
      { projectRoot: PROJECT_ROOT },
      {
        fileSystem: buildFileSystem(),
        embedder: new StubEmbedder(),
        store,
        manifestReader: new StubManifestReader(),
      },
    );

    const result = await fca.scan();
    expect(result.componentCount).toBeGreaterThanOrEqual(2);

    // Verify the store has entries
    const stats = await store.getCoverageStats(PROJECT_ROOT);
    expect(stats.totalComponents).toBeGreaterThanOrEqual(2);
  });

  it('query returns results after scan', async () => {
    const fca = createFcaIndex(
      { projectRoot: PROJECT_ROOT },
      {
        fileSystem: buildFileSystem(),
        embedder: new StubEmbedder(),
        store,
        manifestReader: new StubManifestReader(),
      },
    );

    await fca.scan();

    const result = await fca.query.query({ query: 'authentication', topK: 3 });

    expect(result.results.length).toBeGreaterThanOrEqual(1);
    expect(['discovery', 'production']).toContain(result.mode);
  });

  it('coverage report reflects indexed data', async () => {
    const fca = createFcaIndex(
      { projectRoot: PROJECT_ROOT },
      {
        fileSystem: buildFileSystem(),
        embedder: new StubEmbedder(),
        store,
        manifestReader: new StubManifestReader(),
      },
    );

    await fca.scan();

    const report = await fca.coverage.getReport({ projectRoot: PROJECT_ROOT });

    expect(report.summary.totalComponents).toBeGreaterThanOrEqual(2);
    expect(report.projectRoot).toBe(PROJECT_ROOT);
    expect(['discovery', 'production']).toContain(report.mode);
  });

  it('scan is idempotent — re-scanning yields the same component count', async () => {
    const fca = createFcaIndex(
      { projectRoot: PROJECT_ROOT },
      {
        fileSystem: buildFileSystem(),
        embedder: new StubEmbedder(),
        store,
        manifestReader: new StubManifestReader(),
      },
    );

    const first = await fca.scan();
    const second = await fca.scan();

    // Component count must be stable across re-scans
    expect(second.componentCount).toBe(first.componentCount);

    // Store should not accumulate duplicates
    const stats = await store.getCoverageStats(PROJECT_ROOT);
    expect(stats.totalComponents).toBe(first.componentCount);
  });
});
