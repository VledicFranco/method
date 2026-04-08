---
type: prd
id: "053"
title: "@method/fca-index — FCA-Indexed Context Library"
date: "2026-04-08"
status: complete
completed: "2026-04-08"
branch: feat/053-fca-index-c2-index-store
tests: 158/158
domains: [fca-index/scanner, fca-index/index-store, fca-index/query, fca-index/coverage, fca-index/cli]
surfaces: [ContextQueryPort, ManifestReaderPort, CoverageReportPort]
co-design-records:
  - .method/sessions/fcd-surface-fca-index-mcp/record.md
  - .method/sessions/fcd-surface-fca-index-project/record.md
  - .method/sessions/fcd-surface-fca-index-cli/record.md
debate: .method/sessions/fcd-debate-fca-index/decision.md
---

# PRD 053 — @method/fca-index: FCA-Indexed Context Library

## Problem

Agents executing methodts methodologies spend 30–60% of their token budget on context
search — grepping, reading files that turn out to be irrelevant, and iterating through
directory structures to find the right interface, port, or domain. The structural information
they need exists in the codebase but is not indexed for efficient retrieval.

FCA solves this structurally: co-located documentation is a first-class requirement, and the
8-part component model produces a predictable, machine-readable map of every codebase. If
documentation coverage is complete, the documentation IS the architectural map.

`@method/fca-index` exploits this property: it indexes FCA-compliant projects using a hybrid
SQLite + embedding store over co-located documentation. An agent that previously spent 8K
tokens searching for the right 4 files can retrieve them with a single typed query for
under 200 tokens.

## Constraints

- New L3 package — zero dependencies on `@method/methodts`, `@method/mcp`, or `@method/bridge`
- Universal: works for any FCA-compliant project, not just the method monorepo
- Two operating modes: discovery (partial coverage, safe) and production (threshold met, trusted)
- Coverage scores are library-computed — never self-certified by consuming projects
- Embedding model: Voyage-3-lite (512 dims) as default; configurable
- Index store: SQLite (component metadata) + Lance (vector embeddings)
- TypeScript strict, Node.js runtime
- Ships with testkit: RecordingContextQueryPort, InMemoryIndexStore, coverage fixture builder

## Success Criteria

| ID | Criterion | Measurement |
|----|-----------|-------------|
| SC-1 | **Token reduction** | Agent context-gathering token cost ≤ 20% of baseline (grep-based search) for a representative methodts step execution |
| SC-2 | **Query precision** | Top-5 results include all required files for a task in ≥ 80% of queries (evaluated on 20-query golden set) |
| SC-3 | **Coverage honesty** | coverageScore on returned ComponentContext correlates (r ≥ 0.85) with manual FCA compliance audit scores |
| SC-4 | **Mode safety** | In discovery mode, no query returns a result without a coverage warning when coverageScore < threshold |
| SC-5 | **Scan performance** | Full scan of method-2 monorepo (30+ domains) completes in ≤ 60 seconds |
| SC-6 | **Gate coverage** | All 3 architecture gates (G-PORT scanner, G-BOUNDARY mcp, G-BOUNDARY cli) passing in CI |

## Scope

**In:** Scanner (FCA component discovery), index store (SQLite + Lance), query engine
(`ContextQueryPort` implementation), coverage engine (`CoverageReportPort` implementation),
CLI commands (`scan`, `coverage`), testkit, architecture gates, `.fca-index.yaml` config schema.

**Out:** MCP tool wrappers (PRD 054), cross-project federation, real-time index updates
(file-watch triggered re-scan), integration with `@method/bridge` event bus, IDE plugins.

---

## Domain Map

```
consuming project
  (.fca-index.yaml + FCA dirs)
        │ ManifestReaderPort
        ▼
  ┌─────────────┐
  │   scanner   │────────── FileSystemPort ──────▶ node:fs (via impl)
  │  (L2 domain)│────────── DocExtractorPort ──▶ doc extraction logic
  └─────┬───────┘
        │ indexed component descriptors
        ▼
  ┌─────────────────┐
  │   index-store   │────── IndexStorePort ──▶ SQLite + Lance (via impl)
  │   (L2 domain)   │────── EmbeddingClientPort ──▶ Voyage API (via impl)
  └──────┬──────────┘
         │
    ┌────┴─────────────────┐
    │                      │
    ▼                      ▼
┌────────┐          ┌──────────────┐
│ query  │          │   coverage   │
│(L2 dom)│          │  (L2 domain) │
└────┬───┘          └──────┬───────┘
     │ ContextQueryPort    │ CoverageReportPort
     │                     │
     ▼                     ▼
 @method/mcp           CLI / @method/mcp
 (PRD 054)             (coverage_check)
```

**Cross-domain interactions:**
- `scanner` → `index-store`: writes indexed components (internal, via IndexStorePort)
- `index-store` → `query`: reads components for retrieval (internal, via IndexStorePort)
- `index-store` → `coverage`: reads coverage scores (internal, via IndexStorePort)
- `fca-index` → `mcp`: ContextQueryPort (FROZEN — fcd-surface-fca-index-mcp)
- `fca-index` → `cli`: CoverageReportPort (FROZEN — fcd-surface-fca-index-cli)
- `filesystem` → `scanner`: ManifestReaderPort (FROZEN — fcd-surface-fca-index-project)

---

## Surfaces (Primary Deliverable)

All three external surfaces are co-designed and frozen. See records for full definitions.

### ContextQueryPort ← frozen

```typescript
export interface ContextQueryPort {
  query(request: ContextQueryRequest): Promise<ContextQueryResult>;
}
// Full definition: packages/fca-index/src/ports/context-query.ts
// Record: .method/sessions/fcd-surface-fca-index-mcp/record.md
```

Owner: `@method/fca-index` | Consumer: `@method/mcp` | Direction: fca-index → mcp

### ManifestReaderPort ← frozen

```typescript
export interface ManifestReaderPort {
  read(projectRoot: string): Promise<ProjectScanConfig>;
}
// Full definition: packages/fca-index/src/ports/manifest-reader.ts
// Record: .method/sessions/fcd-surface-fca-index-project/record.md
```

Owner: `@method/fca-index` | Consumer: fca-index scanner (internal) + consuming project (config file)

### CoverageReportPort ← frozen

```typescript
export interface CoverageReportPort {
  getReport(request: CoverageReportRequest): Promise<CoverageReport>;
}
// Full definition: packages/fca-index/src/ports/coverage-report.ts
// Record: .method/sessions/fcd-surface-fca-index-cli/record.md
```

Owner: `@method/fca-index` | Consumers: CLI, `@method/mcp` | Direction: fca-index → both

### Internal ports (no external co-design required)

```typescript
// FileSystemPort — isolates scanner from node:fs (G-PORT)
interface FileSystemPort {
  readFile(path: string, encoding: 'utf-8'): Promise<string>;
  readDir(path: string): Promise<Array<{ name: string; isDirectory: boolean }>>;
  exists(path: string): Promise<boolean>;
  glob(pattern: string, root: string): Promise<string[]>;
}

// EmbeddingClientPort — isolates query engine from Voyage HTTP calls (G-PORT)
interface EmbeddingClientPort {
  embed(texts: string[]): Promise<number[][]>;
}

// IndexStorePort — internal abstraction over SQLite+Lance (allows backend swap)
interface IndexStorePort {
  upsertComponent(entry: IndexEntry): Promise<void>;
  queryBySimilarity(embedding: number[], topK: number, filters: QueryFilters): Promise<IndexEntry[]>;
  queryByFilters(filters: QueryFilters): Promise<IndexEntry[]>;
  getCoverageStats(projectRoot: string): Promise<CoverageStats>;
  clear(projectRoot: string): Promise<void>;
}
```

### Entity types (canonical — shared via package exports)

`FcaLevel`, `FcaPart`, `IndexMode` — defined in `ports/context-query.ts`, exported from `index.ts`.
`ProjectScanConfig` — defined in `ports/manifest-reader.ts`, exported from `index.ts`.
`CoverageReport`, `CoverageSummary`, `ComponentCoverageEntry` — defined in `ports/coverage-report.ts`.

No duplication of these types in `@method/mcp` or CLI — they import from `@method/fca-index`.

---

## Per-Domain Architecture

### scanner domain

**Purpose:** Discover FCA components in a project and extract documentation chunks.

**FCA part detection heuristics:**

| FcaPart | File pattern | Extraction |
|---------|-------------|------------|
| documentation | `**/README.md` | First paragraph of README |
| interface | `**/index.ts` exported symbols | Type signatures of exported interfaces/functions |
| port | `**/ports/*.ts`, `**/providers/*.ts` | Full interface definitions |
| verification | `**/*.test.ts` | Test describe() block names |
| observability | `**/*.metrics.ts` | Exported metric names |
| domain | Directory itself | Directory name + README title |
| architecture | `src/` directory structure | Module names in directory |
| boundary | Implicit (directory = boundary) | N/A — presence is structural |

**Coverage score computation:**
```
coverageScore = (present required parts) / (total required parts)
```
Required parts configured in `ProjectScanConfig.requiredParts` (default: `['interface', 'documentation']`).

**Internal structure:**
```
scanner/
  project-scanner.ts     # entry: orchestrates discovery walk
  fca-detector.ts        # classifies files into FCA parts per heuristics table
  doc-extractor.ts       # extracts excerpts from README, index.ts, ports
  coverage-scorer.ts     # computes coverageScore per component
```

**Ports consumed:**
- `ManifestReaderPort` (injected) — reads `.fca-index.yaml` or defaults
- `FileSystemPort` (injected) — all filesystem access

**Verification strategy:**
- Unit tests: `fca-detector.test.ts` with fixture directories (fake FCA components)
- Gate: G-PORT — scanner/ may not import `node:fs` or `node:path` directly

---

### index-store domain

**Purpose:** Persist indexed components and embeddings; serve retrieval queries.

**Schema (SQLite):**
```sql
CREATE TABLE components (
  id          TEXT PRIMARY KEY,  -- hash of (projectRoot + path)
  project_root TEXT NOT NULL,
  path        TEXT NOT NULL,
  level       TEXT NOT NULL,     -- FcaLevel
  parts_json  TEXT NOT NULL,     -- JSON array of ComponentPart
  coverage_score REAL NOT NULL,
  indexed_at  TEXT NOT NULL      -- ISO timestamp
);
CREATE INDEX idx_components_project ON components(project_root);
CREATE INDEX idx_components_coverage ON components(project_root, coverage_score);
```

**Lance vector store:** One table per project. Row = component embedding (512 dims) + component_id foreign key.

**Hybrid query strategy:**
1. Embed the query string via `EmbeddingClientPort`
2. Retrieve top-K×3 candidates from Lance by cosine similarity
3. Apply filters (level, parts, minCoverageScore) in SQLite JOIN
4. Return top-K ranked results

**Internal structure:**
```
index-store/
  sqlite-store.ts        # SQLite operations (better-sqlite3)
  lance-store.ts         # Lance vector operations (@lancedb/lancedb)
  index-store.ts         # IndexStorePort implementation (combines both)
  embedding-client.ts    # EmbeddingClientPort implementation (Voyage API)
```

**Ports consumed:**
- `EmbeddingClientPort` (injected) — no direct HTTP calls in domain code
- `FileSystemPort` (injected) — for index directory creation

**Verification strategy:**
- Unit: `sqlite-store.test.ts`, `lance-store.test.ts` with in-memory instances
- Contract: `IndexStorePort` contract test runs against both real and in-memory implementations
- Gate: G-PORT — index-store/ may not import `node:fetch` or `axios` directly

---

### query domain

**Purpose:** Implement `ContextQueryPort` — translate natural-language queries into ranked `ComponentContext` results.

**Internal structure:**
```
query/
  query-engine.ts        # ContextQueryPort implementation
  result-formatter.ts    # maps IndexEntry → ComponentContext (adds IndexMode, scores)
```

**Mode determination:**
```typescript
const mode: IndexMode = summary.overallScore >= config.coverageThreshold
  ? 'production'
  : 'discovery';
```

**Ports consumed:** `IndexStorePort` (injected)

**Verification strategy:**
- Unit: `query-engine.test.ts` with recording IndexStorePort
- Golden: 20-query golden test set against method-2 monorepo (SC-2 validation)

---

### coverage domain

**Purpose:** Implement `CoverageReportPort` — compute and return coverage reports from the index.

**Internal structure:**
```
coverage/
  coverage-engine.ts     # CoverageReportPort implementation
  mode-detector.ts       # determines IndexMode from summary stats
```

**Ports consumed:** `IndexStorePort` (injected)

**Verification strategy:**
- Unit: `coverage-engine.test.ts` with known index state
- Contract: `CoverageReportPort` contract test validates summary arithmetic

---

### cli domain (composition layer)

**Purpose:** CLI entry point — wires domains, handles `scan` and `coverage` commands.

**Commands:**
```bash
fca-index scan [--project <root>]           # scan project, build/update index
fca-index coverage [--project <root>] [--verbose]  # print coverage report
fca-index query "<natural language query>"  # debug: run a query, print results
```

**Internal structure:**
```
cli/
  index.ts               # CLI entry point (commander.js or similar)
  scan-command.ts        # wires ProjectScanner + IndexStore, runs scan
  coverage-command.ts    # wires CoverageEngine, renders table output
  query-command.ts       # wires QueryEngine, renders component list output
```

**Composition root (cli/index.ts):**
- Instantiates `FileSystemManifestReader` (default ManifestReaderPort impl)
- Instantiates `NodeFileSystem` (default FileSystemPort impl)
- Instantiates `VoyageEmbeddingClient` (default EmbeddingClientPort impl)
- Instantiates `SqliteLanceIndexStore` (default IndexStorePort impl)
- Wires them into scanner, query engine, coverage engine

---

## Architecture Gates

### Gate tests to add to `packages/fca-index` (new `src/architecture.test.ts`)

```typescript
// G-PORT: scanner does not import node:fs directly
it('scanner uses FileSystemPort, not node:fs', () => {
  const violations = scanImports('src/scanner/**', {
    forbidden: [/^(node:)?fs/, /^(node:)?path/]
  });
  expect(violations).toEqual([]);
});

// G-PORT: query engine does not call Voyage API directly
it('query engine uses EmbeddingClientPort, not fetch/axios', () => {
  const violations = scanImports('src/query/**', {
    forbidden: ['node:http', 'node:https', /^axios/, /^node-fetch/]
  });
  expect(violations).toEqual([]);
});

// G-BOUNDARY: cli imports from ports/, not from domain internals
it('cli does not import domain internals', () => {
  const violations = scanImports('src/cli/**', {
    forbidden: ['src/scanner', 'src/index-store', 'src/query', 'src/coverage'],
    allowed: ['src/ports'],
  });
  expect(violations).toEqual([]);
});

// G-LAYER: fca-index does not import @method/mcp or @method/bridge
it('fca-index is layer-independent', () => {
  const violations = scanImports('src/**', {
    forbidden: ['@method/mcp', '@method/bridge', '@method/methodts']
  });
  expect(violations).toEqual([]);
});
```

---

## Testkit

`packages/fca-index/src/testkit/` (exported at `@method/fca-index/testkit`):

```typescript
// Test doubles
export class RecordingContextQueryPort implements ContextQueryPort { ... }
export class RecordingCoverageReportPort implements CoverageReportPort { ... }
export class InMemoryIndexStore implements IndexStorePort { ... }
export class StubManifestReader implements ManifestReaderPort { ... }

// Fixture builders
export function componentContextBuilder(): ComponentContextBuilder { ... }
export function coverageReportBuilder(): CoverageReportBuilder { ... }
export function projectScanConfigBuilder(): ProjectScanConfigBuilder { ... }
```

Testkit is a sub-export — doesn't leak into the production bundle.

---

## Phase Plan

### Wave 0 — Surfaces (COMPLETE)

Already done as part of this design session.

- [x] `packages/fca-index/src/ports/context-query.ts` — ContextQueryPort, frozen
- [x] `packages/fca-index/src/ports/manifest-reader.ts` — ManifestReaderPort, frozen
- [x] `packages/fca-index/src/ports/coverage-report.ts` — CoverageReportPort, frozen
- [ ] Internal ports: `FileSystemPort`, `EmbeddingClientPort`, `IndexStorePort` (define in `ports/internal/`)

**Acceptance gate:** All port files written. TypeScript compiles. No business logic.

### Wave 1 — scanner domain

**Deliverables:**
- `src/scanner/fca-detector.ts` — FCA part classification heuristics
- `src/scanner/doc-extractor.ts` — README, index.ts, port excerpt extraction
- `src/scanner/coverage-scorer.ts` — coverageScore computation
- `src/scanner/project-scanner.ts` — orchestrates walk over project filesystem
- `src/scanner/*.test.ts` — unit tests with fixture directories
- Fixture: `tests/fixtures/sample-fca-project/` — minimal FCA project for scanner tests

**Acceptance gate:** Scanner unit tests passing. No G-PORT violations. Coverage scorer produces
correct scores against known fixture components.

### Wave 2 — index-store domain

**Deliverables:**
- `src/index-store/sqlite-store.ts` — SQLite schema + CRUD
- `src/index-store/lance-store.ts` — Lance vector table creation + upsert + similarity search
- `src/index-store/embedding-client.ts` — `VoyageEmbeddingClient` (EmbeddingClientPort impl)
- `src/index-store/index-store.ts` — `SqliteLanceIndexStore` (IndexStorePort impl)
- `src/index-store/*.test.ts` — unit tests with in-memory SQLite + mock embeddings
- `IndexStorePort` contract test suite

**Acceptance gate:** Contract tests pass against both real and in-memory implementations.
G-PORT gate: no direct HTTP/fetch in index-store domain.

### Wave 3 — query + coverage domains

**Deliverables:**
- `src/query/query-engine.ts` — ContextQueryPort implementation
- `src/query/result-formatter.ts` — IndexEntry → ComponentContext mapping
- `src/coverage/coverage-engine.ts` — CoverageReportPort implementation
- `src/coverage/mode-detector.ts` — IndexMode determination
- Unit tests for both domains with RecordingIndexStore

**Acceptance gate:** ContextQueryPort implementation passes 20-query golden test set (SC-2).
CoverageReportPort passes contract test. Mode detection is correct at threshold boundaries.

### Wave 4 — CLI + wiring + testkit + gates

**Deliverables:**
- `src/cli/` — scan, coverage, query commands
- `src/testkit/` — RecordingContextQueryPort, RecordingCoverageReportPort, InMemoryIndexStore, builders
- `src/architecture.test.ts` — all 4 gate tests
- `package.json` — `@method/fca-index` package config, bin: `fca-index`
- Integration test: scan method-2 monorepo, query, verify results (SC-1, SC-5)

**Acceptance gate:** All 4 architecture gates passing. Integration scan completes ≤ 60s.
Token reduction validation (SC-1) against baseline measurement.

---

## Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Voyage API quota/latency during scan | Medium | High | Cache embeddings by content hash; skip re-embedding unchanged docs |
| Lance + SQLite schema friction | Low | Medium | IndexStorePort abstraction isolates both; contract test catches divergence |
| FCA heuristics miss novel project layouts | Medium | Medium | `sourcePatterns` and `excludePatterns` in ProjectScanConfig allow per-project tuning |
| Coverage score doesn't correlate with usefulness | Low | High | Golden query set (SC-2) catches this before ship |
| Excerpt quality too low for agent preview decisions | Medium | High | Wave 3 golden tests validate excerpt quality; tune extraction if SC-2 fails |
