# index-store domain

Hybrid storage layer for FCA component entries. Implements `IndexStorePort` via two complementary stores: SQLite for metadata queries and LanceDB for vector similarity search.

## SQLite Schema

Table: `fca_components`

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PRIMARY KEY | 16-char hex component ID |
| `project_root` | TEXT NOT NULL | Absolute path to project root |
| `path` | TEXT NOT NULL | Component path relative to `project_root` |
| `level` | TEXT NOT NULL | FCA level: L0–L5 |
| `parts` | TEXT NOT NULL | JSON-serialized `ComponentPart[]` |
| `coverage_score` | REAL NOT NULL | Documentation completeness, 0–1 |
| `indexed_at` | TEXT NOT NULL | ISO 8601 timestamp |

Indices:
- `idx_project_root` on `(project_root)` — scopes all queries to a project
- `idx_coverage` on `(project_root, coverage_score)` — supports coverage-ordered queries

Note: the `embedding` vector is NOT stored in SQLite. Only metadata lives here.

## Lance Table Schema

Table name: configurable, default `fca_components`

| Field | Type | Description |
|---|---|---|
| `id` | String | Matches `IndexEntry.id` |
| `vector` | Float32[dimensions] | Embedding vector |

Lance uses cosine distance for similarity search. Returned `_distance` is `1 - similarity`, so scores are converted to `[0, 1]` similarity before returning.

## Embedding Strategy

`VoyageEmbeddingClient` calls the Voyage AI REST API:

- **Endpoint:** `POST {baseUrl}/embeddings`
- **Default model:** `voyage-3-lite`
- **Default dimensions:** 512
- **Input type:** `document`
- **Auth:** `Authorization: Bearer {apiKey}` header

Uses global `fetch` (Node 18+) — no HTTP library imports.

Rate-limit handling: on HTTP 429, retries with exponential backoff (`2^attempt * 500ms`), max 3 retries. After exhaustion, throws `EmbeddingClientError(..., 'RATE_LIMITED')`.

## SqliteLanceIndexStore Architecture

`SqliteLanceIndexStore` coordinates two internal stores:

```
SqliteLanceIndexStore
├── SqliteStore      — metadata (path, level, parts, coverage, indexedAt)
└── LanceStore       — embedding vectors (id → Float32[dims])
```

**Responsibility split:**
- **SQLite** handles all metadata queries: filter by level, parts, minCoverageScore; compute coverage stats; list all IDs for a project.
- **Lance** handles vector similarity: given a query embedding, returns top-K most similar IDs with cosine scores.

**On write (`upsertComponent`):** SQLite gets all fields except `embedding`; Lance gets `(id, embedding)`.

**On similarity query:** Lance returns top-`2*topK` candidates (oversample), then SQLite filters by metadata predicates, and results are re-sorted by Lance score. Returned `IndexEntry.embedding` is `[]` — embeddings are not re-hydrated to save memory.

**On filter-only query:** SQLite handles entirely. No Lance access needed.

**On clear:** SQLite lists all IDs for the project, Lance deletes them by ID, then SQLite deletes the rows.

## InMemoryIndexStore — Test Double

`InMemoryIndexStore` is a pure in-memory implementation of `IndexStorePort`. It stores entries in a `Map<string, IndexEntry>` and computes cosine similarity directly for `queryBySimilarity`.

Use it in tests wherever you would use `SqliteLanceIndexStore`. It is the primary test double for the index-store domain.

The contract test (`index-store.contract.test.ts`) runs the same test suite against both implementations to verify behavioral equivalence.
