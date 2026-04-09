/**
 * ComplianceSuggestionPort — Port for generating FCA compliance improvement suggestions.
 *
 * A caller provides a component path; the producer looks it up in the index,
 * determines which FCA parts are missing, and returns stub content for each.
 * No embedding calls — pure SQLite lookup + template generation.
 *
 * Owner:     @method/fca-index (compliance domain)
 * Consumer:  CLI (fca-index suggest command)
 * Direction: fca-index → cli (unidirectional)
 * Co-designed: 2026-04-09
 * Status:    frozen
 */

import type { FcaPart } from './context-query.js';

// ── Port interface ───────────────────────────────────────────────────────────

export interface ComplianceSuggestionPort {
  /**
   * Generate compliance suggestions for a component.
   * Returns the component's current coverage score and stub content for each missing FCA part.
   *
   * An empty `missingParts` array means the component is fully documented.
   *
   * @throws ComplianceSuggestionError with code 'NOT_FOUND' if path is not indexed.
   * @throws ComplianceSuggestionError with code 'INDEX_NOT_FOUND' if project has no index.
   * @throws ComplianceSuggestionError with code 'SUGGESTION_FAILED' on internal errors.
   */
  suggest(request: ComplianceSuggestionRequest): Promise<ComplianceSuggestion>;
}

// ── Request type ─────────────────────────────────────────────────────────────

export interface ComplianceSuggestionRequest {
  /**
   * Component path relative to projectRoot.
   * Must match exactly how it was indexed (e.g., 'src/compliance').
   */
  path: string;

  /** Absolute path to the project root. */
  projectRoot: string;
}

// ── Result types ─────────────────────────────────────────────────────────────

export interface ComplianceSuggestion {
  /** Component path relative to projectRoot. */
  componentPath: string;

  /** Coverage score as stored in the index. Range 0–1. */
  currentScore: number;

  /**
   * Stub content for each FCA part that is missing from this component.
   * Empty array if the component is fully documented (all required parts present).
   */
  missingParts: PartSuggestion[];
}

/** A suggestion for a single missing FCA part. */
export interface PartSuggestion {
  /** The missing FCA part. */
  part: FcaPart;

  /**
   * Suggested filename, relative to the component's directory.
   * e.g. 'README.md', 'index.ts', 'ports.ts'
   */
  suggestedFile: string;

  /**
   * Exact content to write to the suggested file.
   * All component-name references are filled in from the component path.
   * Writing this content directly creates a valid stub.
   */
  templateContent: string;
}

// ── Error type ───────────────────────────────────────────────────────────────

export class ComplianceSuggestionError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'INDEX_NOT_FOUND' | 'SUGGESTION_FAILED',
  ) {
    super(message);
    this.name = 'ComplianceSuggestionError';
  }
}
