/**
 * QueryEngine — ContextQueryPort implementation for the FCA index.
 *
 * Embeds the natural-language query, runs similarity search against the index
 * store with optional filters, determines the index mode (discovery / production),
 * and returns ranked ComponentContext descriptors.
 */

import type { ContextQueryPort, ContextQueryRequest, ContextQueryResult } from '../ports/context-query.js';
import { ContextQueryError } from '../ports/context-query.js';
import type { IndexStorePort, IndexQueryFilters } from '../ports/internal/index-store.js';
import type { EmbeddingClientPort } from '../ports/internal/embedding-client.js';
import { ResultFormatter } from './result-formatter.js';

export interface QueryEngineConfig {
  /** Absolute path to the indexed project root. */
  projectRoot: string;

  /**
   * Minimum weighted-average coverage score to report 'production' mode.
   * @default 0.8
   */
  coverageThreshold?: number;
}

export class QueryEngine implements ContextQueryPort {
  private readonly formatter = new ResultFormatter();

  constructor(
    private readonly store: IndexStorePort,
    private readonly embedder: EmbeddingClientPort,
    private readonly config: QueryEngineConfig,
  ) {}

  async query(request: ContextQueryRequest): Promise<ContextQueryResult> {
    const { projectRoot, coverageThreshold = 0.8 } = this.config;
    const topK = request.topK ?? 5;

    // Step 1: embed the query
    let queryEmbedding: number[];
    try {
      const embeddings = await this.embedder.embed([request.query]);
      queryEmbedding = embeddings[0];
    } catch (err) {
      throw new ContextQueryError('Query embedding failed', 'QUERY_FAILED');
    }

    // Step 2: build filters
    const filters: IndexQueryFilters = {
      projectRoot,
      levels: request.levels,
      parts: request.parts,
      minCoverageScore: request.minCoverageScore,
    };

    // Step 3: similarity search
    const entries = await this.store.queryBySimilarity(queryEmbedding, topK, filters);

    // Step 4: detect empty index
    if (entries.length === 0) {
      const stats = await this.store.getCoverageStats(projectRoot);
      if (stats.totalComponents === 0) {
        throw new ContextQueryError('No index found for project', 'INDEX_NOT_FOUND');
      }
    }

    // Step 5: determine mode
    const stats = await this.store.getCoverageStats(projectRoot);
    const mode = stats.weightedAverage >= coverageThreshold ? 'production' : 'discovery';

    // Step 6: format results
    const results = this.formatter.format(entries);

    return { mode, results };
  }
}
