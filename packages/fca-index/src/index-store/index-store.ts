// SPDX-License-Identifier: Apache-2.0
/**
 * SqliteLanceIndexStore — production IndexStorePort implementation.
 *
 * Combines SqliteStore (metadata) and LanceStore (embedding vectors).
 * SQLite handles all metadata queries; Lance handles similarity search.
 * Embeddings are NOT re-hydrated on query — returned IndexEntry.embedding is [].
 */

import type {
  IndexStorePort,
  IndexEntry,
  IndexQueryFilters,
  IndexCoverageStats,
} from '../ports/internal/index-store.js';
import { SqliteStore } from './sqlite-store.js';
import { LanceStore } from './lance-store.js';

/** Minimum concatenated doc text length to warrant a vector embedding. */
const MIN_DOC_TEXT_LENGTH = 100;

export class SqliteLanceIndexStore implements IndexStorePort {
  constructor(
    private readonly sqlite: SqliteStore,
    private readonly lance: LanceStore,
  ) {}

  async upsertComponent(entry: IndexEntry): Promise<void> {
    const { embedding, ...metadata } = entry;
    // Always persist metadata — coverage tracking needs every component in SQLite.
    this.sqlite.upsert(metadata);
    // Only embed if the component has sufficient documentation to be useful in
    // similarity search. Undocumented components would pollute vector results.
    const docText = entry.parts.map((p) => p.excerpt ?? '').join(' ');
    if (docText.length >= MIN_DOC_TEXT_LENGTH) {
      await this.lance.upsert(entry.id, embedding);
    }
  }

  async queryBySimilarity(
    queryEmbedding: number[],
    topK: number,
    filters: IndexQueryFilters,
  ): Promise<IndexEntry[]> {
    // Oversample from lance to account for metadata filter removals
    const oversampled = topK * 2;
    const lanceResults = await this.lance.querySimilar(queryEmbedding, oversampled);

    // Build a map of id → lance score for ordering
    const scoreMap = new Map<string, number>(lanceResults.map((r) => [r.id, r.score]));
    const candidateIds = lanceResults.map((r) => r.id);

    if (candidateIds.length === 0) return [];

    // Fetch metadata from sqlite and apply filters
    const metaEntries = this.sqlite.getByProjectRoot(filters.projectRoot, {
      levels: filters.levels,
      parts: filters.parts,
      minCoverageScore: filters.minCoverageScore,
    });

    // Keep only entries that were in lance results
    const idSet = new Set(candidateIds);
    const filtered = metaEntries.filter((e) => idSet.has(e.id));

    // Sort by lance similarity score descending
    filtered.sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0));

    return filtered.slice(0, topK).map((e) => ({ ...e, embedding: [] }));
  }

  async queryByFilters(filters: IndexQueryFilters): Promise<IndexEntry[]> {
    const entries = this.sqlite.getByProjectRoot(filters.projectRoot, {
      levels: filters.levels,
      parts: filters.parts,
      minCoverageScore: filters.minCoverageScore,
    });
    // Already sorted by coverageScore desc by SqliteStore
    return entries.map((e) => ({ ...e, embedding: [] }));
  }

  async getCoverageStats(projectRoot: string): Promise<IndexCoverageStats> {
    return this.sqlite.getCoverageStats(projectRoot);
  }

  async clear(projectRoot: string): Promise<void> {
    const entries = this.sqlite.getByProjectRoot(projectRoot);
    const ids = entries.map((e) => e.id);
    await this.lance.deleteByIds(ids);
    this.sqlite.deleteByProjectRoot(projectRoot);
  }

  async getByPath(path: string, projectRoot: string): Promise<import('../ports/internal/index-store.js').IndexEntry | null> {
    const entry = this.sqlite.getByPath(path, projectRoot);
    if (!entry) return null;
    return { ...entry, embedding: [] };
  }
}
