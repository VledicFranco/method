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
import type { FileSystemPort } from '../ports/internal/file-system.js';
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
    private readonly fs: FileSystemPort,
    private readonly config: QueryEngineConfig,
  ) {}

  async query(request: ContextQueryRequest): Promise<ContextQueryResult> {
    const { projectRoot, coverageThreshold = 0.8 } = this.config;
    const topK = request.topK ?? 5;
    const startedAtMs = Date.now();

    logQueryEvent('start', {
      query: truncateForLog(request.query),
      topK,
      levels: request.levels,
      parts: request.parts,
      minCoverageScore: request.minCoverageScore,
    });

    // Step 1: embed the query
    let queryEmbedding: number[];
    try {
      const embeddings = await this.embedder.embed([request.query]);
      queryEmbedding = embeddings[0];
    } catch (err) {
      logQueryEvent('error', { stage: 'embed', query: truncateForLog(request.query) });
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

    // Step 6: check freshness — compare each entry's directory mtime to its indexedAt.
    // Only checks the top-K returned results, not the entire index (performance constraint).
    const staleComponents: string[] = [];
    for (const entry of entries) {
      const absPath = `${projectRoot}/${entry.path}`;
      try {
        const mtime = await this.fs.getModifiedTime(absPath);
        const indexedAtMs = new Date(entry.indexedAt).getTime();
        if (mtime > indexedAtMs) {
          staleComponents.push(entry.path);
        }
      } catch {
        // Path may not exist or be inaccessible — skip silently.
      }
    }

    // Step 7: format results
    const results = this.formatter.format(entries);

    // Observability: summarise what we're returning so SC-1 can be watched in
    // production. Counts top-1 excerpt usage which is the budget we spend on
    // actionable previews.
    const top1 = results[0];
    const top1ExcerptChars = top1
      ? top1.parts.reduce((s, p) => s + (p.excerpt?.length ?? 0), 0)
      : 0;
    const restExcerptChars = results
      .slice(1)
      .reduce((s, r) => s + r.parts.reduce((a, p) => a + (p.excerpt?.length ?? 0), 0), 0);

    logQueryEvent('done', {
      query: truncateForLog(request.query),
      results: results.length,
      mode,
      top1_path: top1?.path,
      top1_relevance: top1?.relevanceScore,
      top1_excerpt_chars: top1ExcerptChars,
      rest_excerpt_chars: restExcerptChars,
      total_excerpt_chars: top1ExcerptChars + restExcerptChars,
      stale: staleComponents.length,
      duration_ms: Date.now() - startedAtMs,
    });

    return {
      mode,
      results,
      staleComponents: staleComponents.length > 0 ? staleComponents : undefined,
    };
  }
}

// ── Observability ────────────────────────────────────────────────────────────

/**
 * Emit a structured log line to stderr. Matches the `[fca-index] ...` prefix
 * pattern used elsewhere in this package (see embedding-client.ts). Format is
 * one JSON object per line, preceded by the scope prefix, so `grep` and `jq`
 * both work:
 *
 *   [fca-index.query] {"event":"done","results":5,"mode":"production",...}
 *
 * Kept intentionally simple — no LoggerPort indirection. When a formal
 * ObservabilityPort lands, migrate these call sites to emit via the port.
 */
function logQueryEvent(event: string, fields: Record<string, unknown>): void {
  try {
    const payload = JSON.stringify({ event, ts: new Date().toISOString(), ...fields });
    process.stderr.write(`[fca-index.query] ${payload}\n`);
  } catch {
    // Never let logging break a query.
  }
}

/** Truncate a string to keep log lines bounded. */
function truncateForLog(s: string, max = 120): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
