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
import { ComponentDetailEngine } from './query/component-detail-engine.js';
import { ComplianceEngine } from './compliance/compliance-engine.js';
import { CoverageEngine } from './coverage/coverage-engine.js';
import type { FileSystemPort } from './ports/internal/file-system.js';
import type { EmbeddingClientPort } from './ports/internal/embedding-client.js';
import type { IndexStorePort } from './ports/internal/index-store.js';
import type { ManifestReaderPort } from './ports/manifest-reader.js';
import type { ContextQueryPort } from './ports/context-query.js';
import type { FcaPart } from './ports/context-query.js';
import type { CoverageReportPort } from './ports/coverage-report.js';
import type { ComponentDetailPort } from './ports/component-detail.js';
import type { ComplianceSuggestionPort } from './ports/compliance-suggestion.js';
import type { ObservabilityPort } from './ports/observability.js';
import { NullObservabilitySink } from './ports/observability.js';

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
  /**
   * Optional observability sink for structured events from query, embed, etc.
   * Defaults to NullObservabilitySink when omitted. Wire StderrObservabilitySink
   * for standalone/CLI use, or a bridge adapter when running inside the bridge.
   */
  observability?: ObservabilityPort;
}

// ── Facade ───────────────────────────────────────────────────────────────────

export interface FcaIndex {
  /** Scan the project and populate the index. Returns component count. */
  scan(): Promise<{ componentCount: number }>;

  /** Query the index for relevant components. */
  query: ContextQueryPort;

  /** Get coverage report. */
  coverage: CoverageReportPort;

  /** Get full detail for a single component by path. */
  detail: ComponentDetailPort;

  /** Generate compliance suggestions for a component (missing FCA parts + stubs). */
  compliance: ComplianceSuggestionPort;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createFcaIndex(config: FcaIndexConfig, ports: FcaIndexPorts): FcaIndex {
  const { fileSystem, embedder, store, manifestReader } = ports;
  const observability = ports.observability ?? new NullObservabilitySink();
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
  const queryEngine = new QueryEngine(store, embedder, fileSystem, { projectRoot, coverageThreshold }, observability);

  // Wire detail domain
  const detailEngine = new ComponentDetailEngine(store);

  // Wire compliance domain
  const complianceEngine = new ComplianceEngine(store);

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

  return { scan, query: queryEngine, coverage: coverageEngine, detail: detailEngine, compliance: complianceEngine };
}

// ── Default factory (production wiring) ──────────────────────────────────────

/**
 * createDefaultFcaIndex — convenience factory for production use.
 *
 * Constructs NodeFileSystem, DefaultManifestReader, VoyageEmbeddingClient,
 * and SqliteLanceIndexStore internally. Callers only need to provide
 * projectRoot and a Voyage API key.
 *
 * For testing, use createFcaIndex() with injected ports instead.
 */
export interface DefaultFcaIndexConfig {
  projectRoot: string;
  voyageApiKey: string;
  coverageThreshold?: number;
  requiredParts?: FcaPart[];
  indexDir?: string;        // default: '.fca-index'
  embeddingModel?: string;  // default: 'voyage-3-lite'
  embeddingDimensions?: number; // default: 512
  /**
   * Observability sink. Defaults to StderrObservabilitySink — structured JSON
   * lines to stderr (matches the pre-port `[fca-index.*]` log format).
   * Pass NullObservabilitySink for silence, or a custom sink (e.g. a bridge
   * adapter) to route events elsewhere.
   */
  observability?: ObservabilityPort;
}

export async function createDefaultFcaIndex(config: DefaultFcaIndexConfig): Promise<FcaIndex> {
  const {
    projectRoot,
    voyageApiKey,
    coverageThreshold,
    requiredParts,
    indexDir = '.fca-index',
    embeddingModel = 'voyage-3-lite',
    embeddingDimensions = 512,
  } = config;

  // Dynamic imports — these are optional infra deps, not part of core API
  const { NodeFileSystem } = await import('./cli/node-filesystem.js');
  const { DefaultManifestReader } = await import('./cli/manifest-reader.js');
  const { VoyageEmbeddingClient } = await import('./index-store/embedding-client.js');
  const { SqliteStore } = await import('./index-store/sqlite-store.js');
  const { LanceStore } = await import('./index-store/lance-store.js');
  const { SqliteLanceIndexStore } = await import('./index-store/index-store.js');
  const { StderrObservabilitySink } = await import('./cli/stderr-observability-sink.js');
  const Database = (await import('better-sqlite3')).default;

  const observability = config.observability ?? new StderrObservabilitySink();

  const dbPath = `${projectRoot}/${indexDir}`;
  const db = new Database(`${dbPath}/fca.db`);
  const sqliteStore = new SqliteStore(db);
  const lanceStore = new LanceStore({ dbPath: `${dbPath}/lance`, dimensions: embeddingDimensions });
  await lanceStore.initialize();

  const store = new SqliteLanceIndexStore(sqliteStore, lanceStore);
  const fs = new NodeFileSystem();
  const manifestReader = new DefaultManifestReader(fs);
  const embedder = new VoyageEmbeddingClient(
    {
      apiKey: voyageApiKey,
      model: embeddingModel,
      dimensions: embeddingDimensions,
    },
    observability,
  );

  // Ensure index directory exists
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dbPath, { recursive: true });

  return createFcaIndex(
    { projectRoot, coverageThreshold, requiredParts },
    { fileSystem: fs, embedder, store, manifestReader, observability },
  );
}
