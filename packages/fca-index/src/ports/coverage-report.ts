/**
 * CoverageReportPort — Port for retrieving FCA documentation coverage analysis.
 *
 * Owned by @method/fca-index. Consumed by two surfaces:
 *   1. CLI (`method-ctl` or `fca-index` binary) — renders human-readable tables
 *   2. @method/mcp (coverage_check tool) — returns structured data to agents
 *
 * The port returns a single CoverageReport. Both consumers receive the same data.
 * Presentation (table rendering vs. JSON formatting) is a consumer-side concern.
 *
 * Owner:     @method/fca-index
 * Consumers: CLI, @method/mcp
 * Direction: fca-index → CLI, fca-index → mcp (unidirectional to both)
 * Co-designed: 2026-04-08
 * Status:    frozen
 */

import type { FcaLevel, FcaPart, IndexMode } from './context-query.js';

// ── Port interface ───────────────────────────────────────────────────────────

export interface CoverageReportPort {
  /**
   * Compute and return a coverage report for a project.
   * Reads the index state; does not re-scan the filesystem.
   * The index must exist (run the scanner first).
   */
  getReport(request: CoverageReportRequest): Promise<CoverageReport>;
}

export interface CoverageReportRequest {
  /** Absolute path to the project root. */
  projectRoot: string;

  /**
   * Whether to include per-component breakdown in the response.
   * false → summary only (fast, low-token for MCP use)
   * true  → summary + all ComponentCoverageEntry items (full detail for CLI)
   * @default false
   */
  verbose?: boolean;
}

// ── Report types ─────────────────────────────────────────────────────────────

export interface CoverageReport {
  projectRoot: string;
  mode: IndexMode;
  generatedAt: string;          // ISO 8601 timestamp

  summary: CoverageSummary;

  /**
   * Per-component breakdown. Only present when verbose=true.
   * Sorted by coverageScore ascending (lowest coverage first).
   */
  components?: ComponentCoverageEntry[];
}

export interface CoverageSummary {
  /** Total number of FCA components in the index. */
  totalComponents: number;

  /** Weighted average coverage score across all components. Range 0–1. */
  overallScore: number;

  /** Coverage threshold configured for this project. */
  threshold: number;

  /** Whether overallScore >= threshold (production mode qualification). */
  meetsThreshold: boolean;

  /** Number of components with coverageScore = 1.0 (all required parts present). */
  fullyDocumented: number;

  /** Number of components with 0 < coverageScore < 1.0. */
  partiallyDocumented: number;

  /** Number of components with coverageScore = 0 (no documentation found). */
  undocumented: number;

  /**
   * Per-part average presence across all components.
   * E.g., { documentation: 0.92, interface: 0.87, port: 0.34, ... }
   * Reveals which FCA parts are systematically missing across the codebase.
   */
  byPart: Record<FcaPart, number>;
}

export interface ComponentCoverageEntry {
  /** Path relative to project root. */
  path: string;

  level: FcaLevel;

  /** Coverage score for this component. Range 0–1. */
  coverageScore: number;

  /** FCA parts that were found and indexed. */
  presentParts: FcaPart[];

  /** Required parts that are absent. */
  missingParts: FcaPart[];
}

// ── Error types ─────────────────────────────────────────────────────────────

export class CoverageReportError extends Error {
  constructor(
    message: string,
    public readonly code: 'INDEX_NOT_FOUND' | 'REPORT_FAILED',
  ) {
    super(message);
    this.name = 'CoverageReportError';
  }
}
