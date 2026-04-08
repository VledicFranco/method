# cli domain

The `cli` domain provides the infrastructure adapter layer and the command surface for `fca-index`. It is the only layer in the library that touches the real filesystem, network, or process environment.

## Exports

### `NodeFileSystem`

Real `FileSystemPort` adapter backed by `node:fs/promises` and `fast-glob`.

- `readFile(path, 'utf-8')` — reads a file as a UTF-8 string
- `readDir(path)` — lists directory entries as `DirEntry[]`
- `exists(path)` — checks whether a path exists (file or directory)
- `glob(pattern, root)` — resolves a glob pattern relative to `root`, returns absolute paths

This is the only place in the library that imports `node:fs` directly. All domain code consumes `FileSystemPort` and receives `NodeFileSystem` (or `InMemoryFileSystem` in tests) via dependency injection.

### `DefaultManifestReader`

`ManifestReaderPort` implementation that reads `.fca-index.yaml` from the project root.

Supported config keys (all optional):

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `coverageThreshold` | float | `0.8` | Minimum coverage score for production mode |
| `embeddingModel` | string | `voyage-3-lite` | Voyage AI model name |
| `embeddingDimensions` | int | `512` | Embedding vector size |
| `indexDir` | string | `.fca-index` | Index storage directory (relative to project root) |

If `.fca-index.yaml` is absent or unparseable, all fields default to `{ projectRoot }`. Errors are silently swallowed — a missing config is never a fatal condition.

### `Indexer`

The scan→embed→upsert pipeline. Bridges `ProjectScanner` (produces `ScannedComponent[]`) and `IndexStore` (needs `IndexEntry[]` with embeddings).

```typescript
const indexer = new Indexer(scanner, embedder, store, manifestReader, { batchSize: 20 });
const { componentCount } = await indexer.index(projectRoot);
```

**Batching strategy:** Components are embedded in batches (default: 20 per call) to respect API rate limits. Each batch is embedded in a single `EmbeddingClientPort.embed()` call, then immediately upserted to the store before the next batch begins. This limits peak memory use and makes partial progress persistent on crash.

**Clear before scan:** `Indexer.index()` always calls `store.clear(projectRoot)` before scanning. The resulting index reflects the current filesystem state exactly.

## CLI commands

### `fca-index scan <projectRoot> [--verbose]`

Runs a full project scan and writes the index to `.fca-index/` (or `indexDir` from config).

Requires `VOYAGE_API_KEY`.

### `fca-index query <projectRoot> <queryString> [--topK=5] [--parts=port,interface]`

Semantic context retrieval. Embeds the query string and returns the top-K most relevant components as JSON.

Requires `VOYAGE_API_KEY`.

### `fca-index coverage <projectRoot> [--verbose]`

Computes and prints a coverage report for the indexed project as JSON.

Does not require `VOYAGE_API_KEY` — reads only the SQLite metadata store.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VOYAGE_API_KEY` | For `scan` and `query` | Voyage AI API key for embedding generation |
