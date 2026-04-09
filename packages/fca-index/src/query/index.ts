/**
 * query/ — Semantic search domain.
 *
 * Embeds a natural-language query, performs vector similarity search over the
 * Lance store, joins with SQLite metadata, and returns ranked ComponentContext
 * descriptors. Also provides ComponentDetailEngine for full component text retrieval.
 *
 * QueryEngine: implements ContextQueryPort — the primary agent-facing query surface.
 * ComponentDetailEngine: implements ComponentDetailPort — returns interface + docText for a path.
 * ResultFormatter: maps IndexEntry[] to ComponentContext[] with relevance scores.
 */

export { QueryEngine } from './query-engine.js';
export { ComponentDetailEngine } from './component-detail-engine.js';
export { ResultFormatter } from './result-formatter.js';
