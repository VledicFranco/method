// SPDX-License-Identifier: Apache-2.0
/**
 * ports/internal/ — Internal port interfaces (fca-index implementation-private).
 *
 * These ports are consumed inside the library and are NOT part of the public API.
 * They exist to enforce the dependency inversion principle within the library:
 * domain code (scanner, query, coverage, compliance) depends on these interfaces,
 * not on concrete implementations (NodeFileSystem, SqliteLanceIndexStore, etc.).
 *
 * FileSystemPort: filesystem abstraction — readFile, readDir, exists, glob, getModifiedTime.
 *   Implemented by NodeFileSystem (production) and InMemoryFileSystem (tests).
 *
 * IndexStorePort: hybrid metadata + vector store abstraction.
 *   Implemented by SqliteLanceIndexStore (production) and InMemoryStore (tests).
 *
 * EmbeddingClientPort: text → float32 vector abstraction.
 *   Implemented by VoyageEmbeddingClient (production) and stub doubles (tests).
 */

export type { FileSystemPort, DirEntry } from './file-system.js';
export { FileSystemError } from './file-system.js';
export type { IndexStorePort, IndexEntry, IndexQueryFilters, IndexCoverageStats } from './index-store.js';
export { IndexStoreError } from './index-store.js';
export type { EmbeddingClientPort } from './embedding-client.js';
export { EmbeddingClientError } from './embedding-client.js';
