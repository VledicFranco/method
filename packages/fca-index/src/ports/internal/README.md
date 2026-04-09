# ports/internal/ — Internal Port Interfaces

Three internal port interfaces that isolate implementation details within `@method/fca-index`. These ports are not exported from the package public API — they exist purely to enable testing and decouple internal domains.

## Ports

| Port | File | Implementations |
|------|------|----------------|
| `FileSystemPort` | `file-system.ts` | `NodeFileSystem` (production), `InMemoryFileSystem` (tests) |
| `EmbeddingClientPort` | `embedding-client.ts` | `VoyageEmbeddingClient` (production), stub (tests) |
| `IndexStorePort` | `index-store.ts` | `SqliteLanceIndexStore` (production), `InMemoryIndexStore` (tests) |

## FileSystemPort

Isolates the scanner from `node:fs`. The scanner calls `glob()`, `readFile()`, `exists()`, and `getModifiedTime()` through this interface. Tests pass an `InMemoryFileSystem` with pre-populated files instead of touching the real filesystem.

## EmbeddingClientPort

Isolates the vector store from the Voyage AI HTTP API. The index store calls `embed(texts)` to get float32 vectors. In tests, a stub returns zero vectors without making network calls.

## IndexStorePort

Abstracts over the hybrid SQLite + LanceDB storage. Query and coverage domains call `upsertComponent`, `queryBySimilarity`, `queryByFilters`, `getCoverageStats`, and `getByPath` through this interface — neither domain knows whether storage is on-disk or in-memory.
