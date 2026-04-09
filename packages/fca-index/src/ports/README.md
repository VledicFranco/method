# Port Interfaces — @method/fca-index

Six port interfaces govern all I/O in `@method/fca-index`. Three are external (frozen, co-designed with consumers). Three are internal (implementation isolation within the library).

## External ports

External ports cross package boundaries. They are frozen: changes require a new co-design session with the consuming package.

### ContextQueryPort

```
src/ports/context-query.ts
```

| Attribute | Value |
|-----------|-------|
| Owner | `@method/fca-index` |
| Consumer | `@method/mcp` (`context_query` tool handler) |
| Direction | fca-index → mcp (unidirectional) |
| Status | Frozen 2026-04-08 |

Semantic search interface. The consumer sends a natural-language query and receives a ranked list of `ComponentContext` descriptors — paths, part file locations, and brief excerpts. The consumer decides which files to read.

Key types:

| Type | Description |
|------|-------------|
| `ContextQueryRequest` | `query`, `topK?`, `parts?`, `levels?`, `minCoverageScore?` |
| `ContextQueryResult` | `mode: IndexMode`, `results: ComponentContext[]` |
| `ComponentContext` | `path`, `level`, `parts: ComponentPart[]`, `relevanceScore`, `coverageScore` |
| `ComponentPart` | `part: FcaPart`, `filePath`, `excerpt?` |
| `ContextQueryError` | Codes: `INDEX_NOT_FOUND`, `INDEX_STALE`, `QUERY_FAILED` |

---

### CoverageReportPort

```
src/ports/coverage-report.ts
```

| Attribute | Value |
|-----------|-------|
| Owner | `@method/fca-index` |
| Consumers | CLI (`fca-index coverage`), `@method/mcp` (`coverage_check` tool) |
| Direction | fca-index → CLI, fca-index → mcp (unidirectional to both) |
| Status | Frozen 2026-04-08 |

Coverage analysis interface. Both consumers receive the same `CoverageReport`. Presentation (table vs. JSON vs. bar chart) is a consumer-side concern. The port reads the index state; it does not re-scan the filesystem.

Key types:

| Type | Description |
|------|-------------|
| `CoverageReportRequest` | `projectRoot`, `verbose?` (per-component breakdown) |
| `CoverageReport` | `projectRoot`, `mode`, `generatedAt`, `summary`, `components?` |
| `CoverageSummary` | `totalComponents`, `overallScore`, `threshold`, `meetsThreshold`, `byPart` |
| `ComponentCoverageEntry` | Per-component: `path`, `level`, `coverageScore`, `presentParts`, `missingParts` |
| `CoverageReportError` | Codes: `INDEX_NOT_FOUND`, `REPORT_FAILED` |

---

### ManifestReaderPort

```
src/ports/manifest-reader.ts
```

| Attribute | Value |
|-----------|-------|
| Owner | `@method/fca-index` |
| Consumer | `@method/fca-index` scanner domain (internal use, but the port itself is external — consuming projects can supply `.fca-index.yaml`) |
| Direction | filesystem → fca-index scanner (unidirectional) |
| Status | Frozen 2026-04-08 |

Configuration reader. Reads `.fca-index.yaml` from the project root if present; falls back to auto-detected FCA conventions when absent. Never throws for a missing config file — always returns a valid `ProjectScanConfig`.

Key types:

| Type | Description |
|------|-------------|
| `ProjectScanConfig` | Full scan config: `projectRoot`, `sourcePatterns?`, `excludePatterns?`, `requiredParts?`, `coverageThreshold?`, `embeddingModel?`, `embeddingDimensions?`, `indexDir?` |
| `ManifestReaderError` | Codes: `READ_FAILED`, `INVALID_CONFIG` |

---

## Internal ports

Internal ports isolate implementation details within the library. They are not exported from `@method/fca-index` and are not part of the public API. They are frozen to stabilize the internal contracts, not because external consumers depend on them.

### FileSystemPort

```
src/ports/internal/file-system.ts
```

| Attribute | Value |
|-----------|-------|
| Owner | `@method/fca-index` |
| Consumer | `scanner/` domain (internal) |
| Implementation | `NodeFileSystem` in `cli/node-filesystem.ts` |
| Status | Frozen 2026-04-08 |

Isolates the scanner from `node:fs`. Enables scanner tests to run without touching the real filesystem (use `InMemoryFileSystem` or a mock in tests).

Operations: `readFile`, `readDir`, `exists`, `glob`.

---

### EmbeddingClientPort

```
src/ports/internal/embedding-client.ts
```

| Attribute | Value |
|-----------|-------|
| Owner | `@method/fca-index` |
| Consumer | `index-store/` domain (internal), `factory.ts` |
| Implementation | `VoyageEmbeddingClient` in `index-store/embedding-client.ts` |
| Status | Frozen 2026-04-08 |

Isolates the embedding pipeline from HTTP. Accepts a batch of strings, returns one float32 vector per input. The `dimensions` property must match the Lance table schema.

Operations: `embed(texts: string[]): Promise<number[][]>`.

---

### IndexStorePort

```
src/ports/internal/index-store.ts
```

| Attribute | Value |
|-----------|-------|
| Owner | `@method/fca-index` |
| Consumers | `query/` domain, `coverage/` domain (both internal) |
| Implementations | `SqliteLanceIndexStore` (production), `InMemoryIndexStore` (tests) |
| Status | Frozen 2026-04-08 |

Abstraction over the hybrid SQLite + Lance storage layer. Query and coverage domains depend only on this interface — they have no knowledge of SQLite or Lance.

Operations: `upsertComponent`, `queryBySimilarity`, `queryByFilters`, `getCoverageStats`, `clear`.

---

## Dependency diagram

```
scanner ──(FileSystemPort)────────────────▶ [filesystem]
scanner ──(ManifestReaderPort)────────────▶ [project .fca-index.yaml / auto-detect]
factory ──(EmbeddingClientPort)───────────▶ [Voyage AI HTTP]
factory ──(IndexStorePort impl)───────────▶ [SQLite + Lance on disk]
query   ──(ContextQueryPort impl)─────────▶ @method/mcp context_query, CLI
coverage──(CoverageReportPort impl)───────▶ @method/mcp coverage_check, CLI
```

The composition root (`factory.ts`) wires all ports. No domain imports another domain's implementation directly — only through port interfaces.
