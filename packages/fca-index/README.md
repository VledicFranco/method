# @methodts/fca-index

Indexes FCA-compliant projects using a hybrid SQLite + Lance embedding store over co-located documentation. Agents retrieve relevant code context with a single typed query at less than 20% of grep-based token cost.

## The problem

Agents navigating a codebase spend 30–60% of their token budget on file-search heuristics: recursive greps, directory listings, manifest reads, and dead-end reads. In a 50-component FCA project, finding the three components relevant to a task can take 30+ file reads.

`@methodts/fca-index` replaces that with a semantic index. After a one-time scan, a typed query returns a ranked list of component descriptors — paths, part locations, and excerpts — without reading any source files. The agent reads only the files it selects from the results.

## Operating modes

| Mode | Condition | Effect |
|------|-----------|--------|
| `discovery` | `overallCoverageScore < threshold` | Results include coverage warnings; index is best-effort |
| `production` | `overallCoverageScore >= threshold` | Results are trusted; index covers the full codebase |

The threshold defaults to `0.8`. Check the mode before trusting query results — a discovery-mode index may miss undocumented components.

## Quick start

### CLI

```bash
# Install
npm install @methodts/fca-index

# Set your Voyage API key
export VOYAGE_API_KEY=your_key

# Scan a project (builds the index)
fca-index scan /path/to/project

# Query for relevant components
fca-index query /path/to/project "session lifecycle"

# Check coverage
fca-index coverage /path/to/project
```

### Programmatic API

```typescript
import { createDefaultFcaIndex } from '@methodts/fca-index';

const fca = await createDefaultFcaIndex({
  projectRoot: '/path/to/project',
  voyageApiKey: process.env.VOYAGE_API_KEY!,
});

// Scan and index the project
const { componentCount } = await fca.scan();
console.log(`Indexed ${componentCount} components`);

// Query for context
const result = await fca.query.query({
  query: 'session lifecycle management',
  topK: 5,
  parts: ['port', 'interface'],
});

console.log(`Mode: ${result.mode}`);
for (const component of result.results) {
  console.log(`${component.path} — relevance: ${component.relevanceScore.toFixed(2)}`);
}
```

## Public API

### Factory functions

| Function | Returns | Use case |
|----------|---------|----------|
| `createDefaultFcaIndex(config)` | `Promise<FcaIndex>` | Production use — wires all dependencies internally |
| `createFcaIndex(config, ports)` | `FcaIndex` | Testing or custom wiring — caller provides ports |

### FcaIndex facade

```typescript
interface FcaIndex {
  scan(): Promise<{ componentCount: number }>;
  query: ContextQueryPort;
  coverage: CoverageReportPort;
}
```

### Port interfaces

| Port | Method | Input | Output |
|------|--------|-------|--------|
| `ContextQueryPort` | `query(req)` | `ContextQueryRequest` | `Promise<ContextQueryResult>` |
| `CoverageReportPort` | `getReport(req)` | `CoverageReportRequest` | `Promise<CoverageReport>` |
| `ManifestReaderPort` | `read(projectRoot)` | `string` | `Promise<ProjectScanConfig>` |

### Key types

| Type | Description |
|------|-------------|
| `FcaLevel` | `'L0' \| 'L1' \| 'L2' \| 'L3' \| 'L4' \| 'L5'` |
| `FcaPart` | `'interface' \| 'boundary' \| 'port' \| 'domain' \| 'architecture' \| 'verification' \| 'observability' \| 'documentation'` |
| `IndexMode` | `'discovery' \| 'production'` |
| `ComponentContext` | Ranked result: path, level, parts, relevanceScore, coverageScore |
| `ComponentPart` | One FCA part: which part, file path, optional excerpt |
| `CoverageReport` | Full coverage analysis: summary, mode, per-component breakdown |

### Configuration (`DefaultFcaIndexConfig`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `projectRoot` | `string` | required | Absolute path to the project root |
| `voyageApiKey` | `string` | required | Voyage AI API key |
| `coverageThreshold` | `number` | `0.8` | Score required for production mode |
| `requiredParts` | `FcaPart[]` | `['interface', 'documentation']` | Parts that must be present for full coverage |
| `indexDir` | `string` | `'.fca-index'` | Directory for SQLite + Lance files (relative to projectRoot) |
| `embeddingModel` | `string` | `'voyage-3-lite'` | Voyage embedding model |
| `embeddingDimensions` | `number` | `512` | Embedding vector dimensions |

## Testkit

For testing code that consumes the external ports, import from the testkit subpackage:

```typescript
import { RecordingContextQueryPort } from '@methodts/fca-index/testkit';

const port = new RecordingContextQueryPort({
  results: [/* stub ComponentContext objects */],
  mode: 'production',
});

// Pass to the handler under test
await myHandler({ contextQuery: port });

port.assertCallCount(1);
port.assertLastQuery('session lifecycle');
```

See `src/testkit/README.md` for full testkit documentation.

## FCA compliance

| Attribute | Value |
|-----------|-------|
| Layer | L3 — library |
| Dependencies | `@methodts/fca-index` has zero dependencies on `@methodts/mcp` or `@methodts/bridge` |
| External ports | `ContextQueryPort`, `CoverageReportPort`, `ManifestReaderPort` — frozen 2026-04-08 |
| Internal ports | `FileSystemPort`, `EmbeddingClientPort`, `IndexStorePort` |

Port interfaces are in `src/ports/`. Internal ports are in `src/ports/internal/`. The CLI and infrastructure implementations (`NodeFileSystem`, `VoyageEmbeddingClient`, `SqliteLanceIndexStore`) are in their respective domains and are not part of the public API.

## Internal domain map

| Domain | Responsibility | Depends on |
|--------|---------------|------------|
| `scanner/` | FCA detection, doc extraction, coverage scoring, project scan | `FileSystemPort`, `ManifestReaderPort` |
| `index-store/` | SQLite + Lance storage, embedding client, in-memory store | `EmbeddingClientPort`, `IndexStorePort` |
| `query/` | `ContextQueryPort` implementation — semantic search | `IndexStorePort`, `EmbeddingClientPort` |
| `coverage/` | `CoverageReportPort` implementation — coverage analysis | `IndexStorePort` |
| `cli/` | `NodeFileSystem`, `DefaultManifestReader`, `Indexer`, CLI commands | node:fs, better-sqlite3, Voyage HTTP |
| `factory.ts` | Composition root — wires all domains into `FcaIndex` facade | all domains |
