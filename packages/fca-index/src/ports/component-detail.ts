/**
 * ComponentDetailPort — Port for full component detail retrieval from an FCA-indexed project.
 *
 * A caller provides a component path; the producer looks it up in the SQLite index
 * and returns all stored fields: level, parts (with file locations and excerpts),
 * full docText, and indexedAt timestamp.
 *
 * No embedding calls are made — this is a pure SQLite lookup.
 *
 * Owner:     @method/fca-index
 * Consumer:  @method/mcp (context_detail tool handler)
 * Direction: fca-index → mcp (unidirectional)
 * Co-designed: 2026-04-09
 * Status:    frozen
 */

import type { FcaLevel, FcaPart } from './context-query.js';

// ── Port interface ───────────────────────────────────────────────────────────

export interface ComponentDetailPort {
  /**
   * Retrieve full detail for a single indexed component by its path.
   *
   * @throws ComponentDetailError with code 'NOT_FOUND' if the path is not in the index.
   * @throws ComponentDetailError with code 'INDEX_NOT_FOUND' if the project has no index.
   * @throws ComponentDetailError with code 'LOOKUP_FAILED' on store errors.
   */
  getDetail(request: ComponentDetailRequest): Promise<ComponentDetail>;
}

// ── Request type ─────────────────────────────────────────────────────────────

export interface ComponentDetailRequest {
  /**
   * Component path relative to projectRoot.
   * Must match exactly how it was indexed (e.g., 'src/ports/context-query.ts').
   */
  path: string;

  /** Absolute path to the project root. */
  projectRoot: string;
}

// ── Result type ──────────────────────────────────────────────────────────────

export interface ComponentDetail {
  /** Path relative to projectRoot. */
  path: string;

  /** FCA level of this component. */
  level: FcaLevel;

  /**
   * All FCA parts present for this component.
   * filePath is relative to projectRoot — consistent with ComponentContext.path.
   * excerpt is the first ~500 chars of the most relevant section for this part.
   */
  parts: ComponentDetailPart[];

  /**
   * Full concatenated documentation text as stored in the index.
   * This is the source text that was embedded for semantic search.
   */
  docText: string;

  /** ISO 8601 timestamp of last index update for this component. */
  indexedAt: string;
}

/** One FCA part within a full component detail response. */
export interface ComponentDetailPart {
  part: FcaPart;

  /** File path for this part, relative to projectRoot. */
  filePath: string;

  /**
   * Key excerpt from this part (first ~500 chars of the most relevant section).
   * Omitted if the part has no indexed content.
   */
  excerpt?: string;
}

// ── Error type ───────────────────────────────────────────────────────────────

export class ComponentDetailError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'INDEX_NOT_FOUND' | 'LOOKUP_FAILED',
  ) {
    super(message);
    this.name = 'ComponentDetailError';
  }
}
