/**
 * ContextQueryPort — Port for semantic context retrieval from an FCA-indexed project.
 *
 * Owned by @method/fca-index. Consumed by @method/mcp (context_query tool handler).
 * The consumer sends a natural-language query and receives a ranked list of
 * ComponentContext descriptors — paths, part excerpts, and reliability scores.
 *
 * The agent uses these descriptors to decide which files to read next, eliminating
 * the token overhead of file-search heuristics.
 *
 * Owner:     @method/fca-index
 * Consumer:  @method/mcp
 * Direction: fca-index → mcp (unidirectional)
 * Co-designed: 2026-04-08
 * Status:    frozen
 */

// ── Shared enums ────────────────────────────────────────────────────────────

/** FCA level — L0 (function) through L5 (system). */
export type FcaLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

/** The eight structural parts of every FCA component. */
export type FcaPart =
  | 'interface'
  | 'boundary'
  | 'port'
  | 'domain'
  | 'architecture'
  | 'verification'
  | 'observability'
  | 'documentation';

/**
 * Index operating mode.
 * - discovery: coverage < threshold; results include coverage warnings
 * - production: coverage >= threshold; results are trusted
 */
export type IndexMode = 'discovery' | 'production';

// ── Port interface ───────────────────────────────────────────────────────────

export interface ContextQueryPort {
  /**
   * Query the FCA index for components relevant to a natural-language description.
   * Returns ranked ComponentContext descriptors — not file contents.
   * The caller reads files at the returned paths as needed.
   */
  query(request: ContextQueryRequest): Promise<ContextQueryResult>;
}

export interface ContextQueryRequest {
  /** Natural-language description of the code or concept needed. */
  query: string;

  /**
   * Maximum number of results to return.
   * @default 5
   */
  topK?: number;

  /**
   * Filter results to specific FCA structural parts.
   * E.g., ['port', 'interface'] to find only port definitions and public APIs.
   * Omit to search all parts.
   */
  parts?: FcaPart[];

  /**
   * Filter results to specific FCA levels.
   * E.g., ['L2', 'L3'] to find domain and package level components.
   * Omit to search all levels.
   */
  levels?: FcaLevel[];

  /**
   * Exclude components with coverage below this threshold.
   * Useful in discovery mode to focus on well-documented areas.
   * Range 0–1. Omit to return all results regardless of coverage.
   */
  minCoverageScore?: number;
}

export interface ContextQueryResult {
  /** Whether the index is in discovery or production mode. */
  mode: IndexMode;

  /** Ranked component descriptors, most relevant first. */
  results: ComponentContext[];

  /**
   * Paths (relative to projectRoot) of components whose directory mtime is newer
   * than their `indexedAt` timestamp. A non-empty list indicates the index may be
   * stale for these components. Omitted when all returned components are fresh.
   */
  staleComponents?: string[];
}

/**
 * A component descriptor returned by the context query.
 * Contains paths and excerpts — not full file contents.
 * The consumer decides which files to read based on these signals.
 */
export interface ComponentContext {
  /**
   * Directory or file path, relative to the indexed project root.
   * For L2+ components: directory path (e.g., 'src/domains/sessions/').
   * For L0–L1: file path (e.g., 'src/domains/sessions/session-pool.ts').
   */
  path: string;

  /** FCA level of this component. */
  level: FcaLevel;

  /** Which FCA parts are present and where to find them. */
  parts: ComponentPart[];

  /**
   * Semantic relevance to the query. Range 0–1.
   * 1.0 = exact match to query embedding; 0.0 = no similarity.
   */
  relevanceScore: number;

  /**
   * Documentation completeness score. Range 0–1.
   * 1.0 = all required FCA parts documented and indexed.
   * Below threshold = discovery mode warning applies.
   */
  coverageScore: number;
}

/** One FCA part of a component — its location and a brief excerpt. */
export interface ComponentPart {
  part: FcaPart;

  /** File path for this part, relative to project root. */
  filePath: string;

  /**
   * Key excerpt from this part — first ~500 chars of the most relevant section.
   * For 'documentation': README first paragraph.
   * For 'interface': exported interface/type signatures.
   * For 'port': port interface definition.
   * Omitted if the part has no indexed content.
   */
  excerpt?: string;
}

// ── Error types ─────────────────────────────────────────────────────────────

export class ContextQueryError extends Error {
  constructor(
    message: string,
    public readonly code: 'INDEX_NOT_FOUND' | 'INDEX_STALE' | 'QUERY_FAILED',
  ) {
    super(message);
    this.name = 'ContextQueryError';
  }
}
