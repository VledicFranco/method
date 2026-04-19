// SPDX-License-Identifier: Apache-2.0
/**
 * IndexStorePort — Internal port over the hybrid SQLite + Lance storage layer.
 *
 * Produced by: index-store domain (SqliteLanceIndexStore, InMemoryIndexStore)
 * Consumed by: query domain (ContextQueryPort impl), coverage domain (CoverageReportPort impl)
 * Direction: index-store → query, index-store → coverage (unidirectional to both)
 * Status: frozen 2026-04-10 (extended from 2026-04-08; see fcd-surface-fca-index-internal-ports-ext)
 */

import type { FcaLevel, FcaPart, ComponentPart } from '../context-query.js';

export interface IndexStorePort {
  /**
   * Insert or update a component entry in the index.
   * If an entry with the same id exists, replaces it.
   */
  upsertComponent(entry: IndexEntry): Promise<void>;

  /**
   * Retrieve entries ranked by cosine similarity to the query embedding,
   * filtered by the given criteria.
   * Returns up to topK entries, most similar first.
   */
  queryBySimilarity(
    queryEmbedding: number[],
    topK: number,
    filters: IndexQueryFilters,
  ): Promise<IndexEntry[]>;

  /**
   * Retrieve entries matching filters, ordered by coverageScore descending.
   * No similarity ranking — pure metadata lookup.
   */
  queryByFilters(filters: IndexQueryFilters): Promise<IndexEntry[]>;

  /**
   * Compute aggregate coverage statistics for a project.
   * Used by the coverage engine to produce CoverageSummary.
   */
  getCoverageStats(projectRoot: string): Promise<IndexCoverageStats>;

  /**
   * Remove all indexed entries for a project.
   * Called before a full rescan.
   */
  clear(projectRoot: string): Promise<void>;

  /**
   * Retrieve a single entry by its path within a project.
   * Returns null if no entry exists for the given path.
   * Added 2026-04-09; formalized in fcd-surface-fca-index-internal-ports-ext (2026-04-10).
   */
  getByPath(path: string, projectRoot: string): Promise<IndexEntry | null>;
}

// ── Entry type ───────────────────────────────────────────────────────────────

export interface IndexEntry {
  /** Deterministic ID: sha256(projectRoot + ':' + path), hex-truncated to 16 chars. */
  id: string;

  projectRoot: string;

  /** Path relative to projectRoot. */
  path: string;

  level: FcaLevel;

  /** FCA parts detected for this component with their file locations and excerpts. */
  parts: ComponentPart[];

  /** Documentation completeness score. Range 0–1. */
  coverageScore: number;

  /**
   * Embedding of the component's concatenated documentation.
   * Dimension must match EmbeddingClientPort.dimensions.
   */
  embedding: number[];

  /** ISO 8601 timestamp of last index update. */
  indexedAt: string;
}

// ── Query filters ────────────────────────────────────────────────────────────

export interface IndexQueryFilters {
  /** Required: scope all queries to one project. */
  projectRoot: string;

  /** Filter to specific FCA levels. Omit for all levels. */
  levels?: FcaLevel[];

  /** Filter to components that have at least one of these parts present. */
  parts?: FcaPart[];

  /** Exclude components with coverageScore below this threshold. */
  minCoverageScore?: number;
}

// ── Coverage statistics ──────────────────────────────────────────────────────

export interface IndexCoverageStats {
  totalComponents: number;

  /** Weighted average coverage score across all components. */
  weightedAverage: number;

  /**
   * For each FcaPart: fraction of components that have this part present.
   * 1.0 = every component has this part; 0.0 = no components have it.
   */
  byPart: Record<FcaPart, number>;
}

// ── Error ────────────────────────────────────────────────────────────────────

export class IndexStoreError extends Error {
  constructor(
    message: string,
    public readonly code: 'STORE_UNAVAILABLE' | 'SCHEMA_MISMATCH' | 'WRITE_FAILED' | 'READ_FAILED',
  ) {
    super(message);
    this.name = 'IndexStoreError';
  }
}
