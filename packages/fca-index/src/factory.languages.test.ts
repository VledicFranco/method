// SPDX-License-Identifier: Apache-2.0
/**
 * createFcaIndex() — language profile wiring tests.
 *
 * Verifies that:
 *   - The factory passes `FcaIndexConfig.languages` (programmatic
 *     LanguageProfile[]) through to the scanner.
 *   - The factory resolves names from `ProjectScanConfig.languages` (YAML)
 *     via the built-in registry and APPENDS them to the programmatic list.
 *   - The default (no programmatic, no YAML) leaves the scanner on the
 *     `typescript` profile — preserving v0.3.x behavior.
 *
 * Uses InMemoryFileSystem + InMemoryIndexStore + StubEmbedder (no real I/O).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createFcaIndex } from './factory.js';
import { InMemoryIndexStore } from './index-store/in-memory-store.js';
import { InMemoryFileSystem } from './scanner/test-helpers/in-memory-fs.js';
import { scalaProfile, pythonProfile } from './scanner/profiles/index.js';
import type { ManifestReaderPort, ProjectScanConfig } from './ports/manifest-reader.js';
import type { EmbeddingClientPort } from './ports/internal/embedding-client.js';

class StaticManifestReader implements ManifestReaderPort {
  constructor(private readonly languages?: string[]) {}
  async read(projectRoot: string): Promise<ProjectScanConfig> {
    return {
      projectRoot,
      sourcePatterns: ['**'],
      requiredParts: ['interface', 'documentation'],
      languages: this.languages,
    };
  }
}

class StubEmbedder implements EmbeddingClientPort {
  readonly dimensions = 4;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => [1, 0, 0, 0]);
  }
}

const PROJECT_ROOT = '/proj';

function fixture(): InMemoryFileSystem {
  return new InMemoryFileSystem({
    [`${PROJECT_ROOT}/src/ts-pkg/package.json`]: '{"name":"ts"}',
    [`${PROJECT_ROOT}/src/ts-pkg/index.ts`]: 'export interface Ts {}',
    [`${PROJECT_ROOT}/src/scala-pkg/build.sbt`]: 'name := "scala"',
    [`${PROJECT_ROOT}/src/scala-pkg/package.scala`]: 'package object scala_pkg {}',
    [`${PROJECT_ROOT}/src/scala-pkg/Foo.scala`]: 'class Foo {}',
    [`${PROJECT_ROOT}/src/py-pkg/pyproject.toml`]: '[project]\nname="py"',
    [`${PROJECT_ROOT}/src/py-pkg/__init__.py`]: 'from .core import x',
    [`${PROJECT_ROOT}/src/py-pkg/core.py`]: 'x = 1',
  });
}

describe('createFcaIndex() — language profile wiring', () => {
  let store: InMemoryIndexStore;

  beforeEach(() => {
    store = new InMemoryIndexStore();
  });

  it('default (no languages config) only detects TypeScript components', async () => {
    const fca = createFcaIndex(
      { projectRoot: PROJECT_ROOT },
      {
        fileSystem: fixture(),
        embedder: new StubEmbedder(),
        store,
        manifestReader: new StaticManifestReader(undefined),
      },
    );
    await fca.scan();
    const stats = await store.getCoverageStats(PROJECT_ROOT);
    // Without Scala/Python profiles, only the TS package qualifies as a
    // component (Scala/Python dirs lack package.json AND index.ts AND lack
    // the TS profile's interface file → never qualify).
    expect(stats.totalComponents).toBe(1);
  });

  it('accepts programmatic LanguageProfile[] via FcaIndexConfig.languages', async () => {
    const fca = createFcaIndex(
      {
        projectRoot: PROJECT_ROOT,
        languages: [scalaProfile, pythonProfile],
      },
      {
        fileSystem: fixture(),
        embedder: new StubEmbedder(),
        store,
        manifestReader: new StaticManifestReader(undefined),
      },
    );
    await fca.scan();
    const stats = await store.getCoverageStats(PROJECT_ROOT);
    // With Scala+Python only (no TS profile), the Scala and Python packages
    // are detected; the TS package no longer qualifies as a component.
    expect(stats.totalComponents).toBe(2);
  });

  it('resolves YAML-supplied profile names via ProjectScanConfig.languages', async () => {
    const fca = createFcaIndex(
      { projectRoot: PROJECT_ROOT },
      {
        fileSystem: fixture(),
        embedder: new StubEmbedder(),
        store,
        manifestReader: new StaticManifestReader(['typescript', 'scala', 'python']),
      },
    );
    await fca.scan();
    const stats = await store.getCoverageStats(PROJECT_ROOT);
    // All three packages (TS + Scala + Python) qualify as components.
    expect(stats.totalComponents).toBe(3);
  });

  it('appends YAML-resolved profiles to programmatic list (programmatic first)', async () => {
    const fca = createFcaIndex(
      {
        projectRoot: PROJECT_ROOT,
        languages: [scalaProfile], // programmatic
      },
      {
        fileSystem: fixture(),
        embedder: new StubEmbedder(),
        store,
        manifestReader: new StaticManifestReader(['python']), // YAML
      },
    );
    await fca.scan();
    const stats = await store.getCoverageStats(PROJECT_ROOT);
    // Active profiles: scala + python (no TS). Detects scala-pkg + py-pkg.
    expect(stats.totalComponents).toBe(2);
  });

  it('throws LanguageProfileError when YAML names an unknown profile', async () => {
    const fca = createFcaIndex(
      { projectRoot: PROJECT_ROOT },
      {
        fileSystem: fixture(),
        embedder: new StubEmbedder(),
        store,
        manifestReader: new StaticManifestReader(['typescript', 'kotlin']),
      },
    );
    await expect(fca.scan()).rejects.toThrow(/Unknown language profile/);
  });
});
