// SPDX-License-Identifier: Apache-2.0
/**
 * index-store/ — Hybrid SQLite + LanceDB storage layer.
 *
 * SqliteLanceIndexStore: implements IndexStorePort by splitting concerns:
 *   - SqliteStore: component metadata (path, level, parts, coverageScore, indexedAt)
 *     Supports filter queries, coverage aggregation, getByPath lookups.
 *   - LanceStore: float32 embedding vectors, cosine similarity search.
 *     Components with docText < MIN_DOC_TEXT_LENGTH are stored in SQLite only (no vector).
 *
 * InMemoryStore: in-memory IndexStorePort implementation for unit tests.
 * VoyageEmbeddingClient: implements EmbeddingClientPort via Voyage AI REST API.
 *   Model: voyage-3-lite (512 dims). Batch size 20. Exponential backoff on 429.
 */

export { SqliteLanceIndexStore } from './index-store.js';
export { SqliteStore } from './sqlite-store.js';
export { LanceStore } from './lance-store.js';
export { InMemoryIndexStore } from './in-memory-store.js';
export { VoyageEmbeddingClient } from './embedding-client.js';
