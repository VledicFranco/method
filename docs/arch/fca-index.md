# fca-index — Architecture

## Layer placement

`@method/fca-index` is an L3 library. It has zero dependencies on `@method/mcp` or `@method/bridge`. The dependency flows upward: `@method/mcp` depends on `@method/fca-index`, not the reverse.

```
L4  @method/bridge
L3  @method/mcp ──────────────────────────▶ @method/fca-index
    @method/pacta                             (this package)
    @method/methodts
```

The library is self-contained. It can be used independently of the rest of the method system.

## Domain map

Five internal domains plus the composition root:

| Domain | Responsibility | Input ports | Output ports |
|--------|---------------|-------------|--------------|
| `scanner/` | Detect FCA components, extract docs, score coverage | `FileSystemPort`, `ManifestReaderPort` | `IndexEntry[]` to factory |
| `index-store/` | SQLite + Lance storage, embedding client | `EmbeddingClientPort` (external service) | `IndexStorePort` (consumed by query + coverage) |
| `query/` | Semantic search — `ContextQueryPort` implementation | `IndexStorePort`, `EmbeddingClientPort` | `ContextQueryPort` |
| `coverage/` | Coverage analysis — `CoverageReportPort` implementation | `IndexStorePort` | `CoverageReportPort` |
| `cli/` | `NodeFileSystem`, `DefaultManifestReader`, `Indexer`, CLI commands | `node:fs`, `better-sqlite3`, Voyage HTTP | wires factory for CLI use |
| `factory.ts` | Composition root — wires all domains into `FcaIndex` facade | all port interfaces | `FcaIndex` facade |

No domain imports another domain's implementation. Cross-domain dependencies flow only through port interfaces.

## Port topology

Six ports, split by visibility:

**External (frozen 2026-04-08) — cross package boundaries:**

| Port | Direction | Consumer |
|------|-----------|----------|
| `ContextQueryPort` | fca-index → mcp | `@method/mcp` `context_query` tool |
| `CoverageReportPort` | fca-index → mcp, fca-index → CLI | `@method/mcp` `coverage_check`, `fca-index` binary |
| `ManifestReaderPort` | filesystem → scanner | `@method/fca-index` scanner domain (via factory) |

**Internal (frozen 2026-04-08) — within the library:**

| Port | Direction | Consumer |
|------|-----------|----------|
| `FileSystemPort` | filesystem → scanner | `scanner/` domain |
| `EmbeddingClientPort` | Voyage AI → index-store | `index-store/` domain, `factory.ts` |
| `IndexStorePort` | index-store → query, coverage | `query/` and `coverage/` domains |

External ports are co-designed with their consumers and may not change without a co-design session. Internal ports are frozen to stabilize intra-library contracts but carry no cross-package obligation.

## Hybrid index

The index uses two stores with different strengths:

| Store | Technology | Purpose |
|-------|-----------|---------|
| SQLite | `better-sqlite3` | Metadata, filters, coverage stats. Fast exact-match queries by level, parts, coverage score. |
| Lance | `vectordb` (LanceDB) | Embedding vectors. Cosine similarity search. |

A query executes as follows:

1. Embed the query string via `EmbeddingClientPort` (Voyage AI HTTP call).
2. `queryBySimilarity` — Lance ANN search returns top-N candidate IDs by cosine similarity.
3. SQLite join applies metadata filters (`parts`, `levels`, `minCoverageScore`) and fetches `IndexEntry` fields.
4. Results sorted by relevance score and returned as `ComponentContext[]`.

Coverage queries (`getCoverageStats`, `queryByFilters`) use SQLite exclusively — no embedding needed.

The two stores are coordinated by `SqliteLanceIndexStore`. `InMemoryIndexStore` implements the same `IndexStorePort` interface without either dependency, used in tests.

## Index modes

The mode is computed at query time, not stored:

```
overallScore = weighted average of all component coverageScores
mode = overallScore >= coverageThreshold ? 'production' : 'discovery'
```

In `discovery` mode, `ContextQueryResult.mode` and `CoverageReport.mode` both return `'discovery'`. The underlying data is identical — mode is a consumer signal, not a data partition.

The threshold defaults to `0.8`. Configurable via `FcaIndexConfig.coverageThreshold` or `.fca-index.yaml`.

## Composition root

Two factory functions with different tradeoffs:

| Factory | When to use | What it does |
|---------|-------------|-------------|
| `createDefaultFcaIndex(config)` | Production, CLI, agent sessions | Constructs all implementations internally. Caller provides only `projectRoot` and `voyageApiKey`. Returns `Promise<FcaIndex>` because it initializes async resources (LanceDB table). |
| `createFcaIndex(config, ports)` | Tests, custom wiring, alternative stores | Caller provides all four ports. Returns `FcaIndex` synchronously. No infrastructure dependencies at construction time. |

`createDefaultFcaIndex` uses dynamic imports (`await import(...)`) for the infrastructure dependencies (`NodeFileSystem`, `VoyageEmbeddingClient`, `SqliteLanceIndexStore`, `better-sqlite3`). This keeps the package importable in environments that don't have these native modules installed, as long as `createDefaultFcaIndex` is never called.

## Architecture gates

| Gate | Rule | Enforced by |
|------|------|-------------|
| `G-PORT-SCANNER` | `scanner/` must not import from `query/`, `coverage/`, or `index-store/` directly | architecture test (`src/architecture.test.ts`) |
| `G-PORT-QUERY` | `query/` and `coverage/` must not import from `scanner/` or `cli/` | architecture test |
| `G-BOUNDARY-CLI` | `cli/` must not be imported by `query/`, `coverage/`, or `scanner/` (infra deps stay at the edge) | architecture test |
| `G-LAYER` | `@method/fca-index` must not import from `@method/mcp` or `@method/bridge` | package.json + architecture test |
