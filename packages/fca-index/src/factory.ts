/**
 * createFcaIndex() — Public factory for the FCA index library.
 *
 * Wires all internal domains (scanner, query, coverage) together and returns
 * a typed FcaIndex facade. Consumers (e.g. @method/mcp) call this instead
 * of constructing each class manually.
 *
 * The factory is store-agnostic — callers provide the store via ports.store.
 * InMemoryIndexStore is suitable for tests; SqliteLanceIndexStore for production.
 *
 * Added in C-6 (Wave 3).
 */

import { FcaDetector } from './scanner/fca-detector.js';
import { DocExtractor } from './scanner/doc-extractor.js';
import { CoverageScorer } from './scanner/coverage-scorer.js';
import { ProjectScanner } from './scanner/project-scanner.js';
import { QueryEngine } from './query/query-engine.js';
import { CoverageEngine } from './coverage/coverage-engine.js';
import type { FileSystemPort } from './ports/internal/file-system.js';
import type { EmbeddingClientPort } from './ports/internal/embedding-client.js';
import type { IndexStorePort } from './ports/internal/index-store.js';
import type { ManifestReaderPort } from './ports/manifest-reader.js';
import type { ContextQueryPort } from './ports/context-query.js';
import type { FcaPart } from './ports/context-query.js';
import type { CoverageReportPort } from './ports/coverage-report.js';

// ── Config & Ports ───────────────────────────────────────────────────────────

export interface FcaIndexConfig {
  /** Absolute path to the project root. */
  projectRoot: string;

  /**
   * Coverage threshold for production mode graduation.
   * @default 0.8
   */
  coverageThreshold?: number;

  /**
   * FCA parts required for full documentation coverage.
   * @default ['interface', 'documentation']
   */
  requiredParts?: FcaPart[];

  /**
   * Number of components to embed per batch.
   * @default 20
   */
  batchSize?: number;
}

export interface FcaIndexPorts {
  fileSystem: FileSystemPort;
  embedder: EmbeddingClientPort;
  store: IndexStorePort;
  manifestReader: ManifestReaderPort;
}

// ── Facade ───────────────────────────────────────────────────────────────────

export interface FcaIndex {
  /** Scan the project and populate the index. Returns component count. */
  scan(): Promise<{ componentCount: number }>;

  /** Query the index for relevant components. */
  query: ContextQueryPort;

  /** Get coverage report. */
  coverage: CoverageReportPort;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createFcaIndex(config: FcaIndexConfig, ports: FcaIndexPorts): FcaIndex {
  const { fileSystem, embedder, store, manifestReader } = ports;
  const {
    projectRoot,
    coverageThreshold = 0.8,
    requiredParts = ['interface', 'documentation'],
    batchSize = 20,
  } = config;

  // Wire scanner domain
  const detector = new FcaDetector(fileSystem);
  // DocExtractor is instantiated internally by FcaDetector, but ProjectScanner
  // needs it explicitly as well via the detector + scorer combo.
  const _extractor = new DocExtractor(fileSystem);
  const scorer = new CoverageScorer();
  const scanner = new ProjectScanner(fileSystem, detector, scorer);

  // Wire query domain
  const queryEngine = new QueryEngine(store, embedder, { projectRoot, coverageThreshold });

  // Wire coverage domain
  const coverageEngine = new CoverageEngine(store, {
    threshold: coverageThreshold,
    requiredParts,
  });

  async function scan(): Promise<{ componentCount: number }> {
    // Read project scan config via the manifest reader port
    const scanConfig = await manifestReader.read(projectRoot);

    // Clear existing entries for this project before re-indexing
    await store.clear(projectRoot);

    // Scan all components
    const components = await scanner.scan(scanConfig);

    // Embed components in batches and upsert into the store
    for (let i = 0; i < components.length; i += batchSize) {
      const batch = components.slice(i, i + batchSize);
      const texts = batch.map(c => c.docText || c.path);
      const embeddings = await embedder.embed(texts);

      for (let j = 0; j < batch.length; j++) {
        await store.upsertComponent({
          id: batch[j].id,
          projectRoot: batch[j].projectRoot,
          path: batch[j].path,
          level: batch[j].level,
          parts: batch[j].parts,
          coverageScore: batch[j].coverageScore,
          embedding: embeddings[j],
          indexedAt: batch[j].indexedAt,
        });
      }
    }

    return { componentCount: components.length };
  }

  return { scan, query: queryEngine, coverage: coverageEngine };
}
