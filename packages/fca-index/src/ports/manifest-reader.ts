// SPDX-License-Identifier: Apache-2.0
/**
 * ManifestReaderPort — Port for reading a project's FCA scan configuration.
 *
 * Owned by @methodts/fca-index. The default implementation reads `.fca-index.yaml`
 * at the project root and falls back to auto-detected FCA directory conventions
 * when no config file exists.
 *
 * This is an internal port — it separates the scanner domain from the filesystem
 * so scanner logic can be tested without touching the real filesystem.
 *
 * The consuming project participates by either:
 *   (a) Providing a `.fca-index.yaml` config file (ProjectScanConfig shape), or
 *   (b) Relying on auto-detection of standard FCA conventions.
 *
 * Owner:     @methodts/fca-index (defines interface + provides default implementation)
 * Consumer:  @methodts/fca-index scanner domain (internal)
 * Direction: filesystem → fca-index scanner (unidirectional)
 * Co-designed: 2026-04-08
 * Status:    frozen
 */

import type { FcaPart } from './context-query.js';

// ── Port interface ───────────────────────────────────────────────────────────

export interface ManifestReaderPort {
  /**
   * Read or derive the scan configuration for a project.
   * Reads `.fca-index.yaml` if present; otherwise returns auto-detected defaults.
   * Never throws for missing config — always returns a valid ProjectScanConfig.
   */
  read(projectRoot: string): Promise<ProjectScanConfig>;
}

// ── Configuration schema ─────────────────────────────────────────────────────

/**
 * ProjectScanConfig — the shape of `.fca-index.yaml` and the derived default.
 *
 * All fields are optional. The library provides sensible defaults for each.
 * This type IS the co-design contract: both the library and consuming projects
 * agree on this shape. Changes to this type require a new co-design session.
 */
export interface ProjectScanConfig {
  /**
   * Absolute path to the project root.
   * Derived at runtime — never written to .fca-index.yaml.
   */
  projectRoot: string;

  /**
   * Glob patterns for locating FCA source trees within the project.
   * @default ['src/**', 'source/**', 'packages/{pkg}/src/**', 'packages/{pkg}/source/**']
   */
  sourcePatterns?: string[];

  /**
   * Glob patterns to exclude from scanning.
   * Always excludes: node_modules, dist, build, .git, *.d.ts, *.js (in ts projects)
   * Use this for project-specific exclusions.
   * @default []
   */
  excludePatterns?: string[];

  /**
   * FCA parts considered required for 100% coverage on a component.
   * Components missing any of these parts will have coverageScore < 1.0.
   * @default ['interface', 'documentation']
   * Rationale: interface + docs are the minimum for an agent to understand a component.
   * Teams can add 'port', 'verification', 'observability' as they raise the bar.
   */
  requiredParts?: FcaPart[];

  /**
   * Coverage score threshold for production mode graduation.
   * When overallScore >= threshold, the index operates in production mode.
   * Must be library-computed against the actual filesystem — not self-certified.
   * @default 0.8
   */
  coverageThreshold?: number;

  /**
   * Voyage embedding model to use for semantic indexing.
   * @default 'voyage-3-lite'
   */
  embeddingModel?: string;

  /**
   * Embedding vector dimensions. Must match the model's output.
   * @default 512
   */
  embeddingDimensions?: number;

  /**
   * Directory for storing the index (SQLite + Lance vector DB).
   * Relative to projectRoot.
   * @default '.fca-index'
   */
  indexDir?: string;

  /**
   * Names of built-in language profiles to apply when scanning. Profiles drive
   * file/dir → FCA part classification and component qualification rules.
   * Built-in names (v0.4.0+): `'typescript'`, `'scala'`, `'python'`, `'go'`,
   * `'markdown-only'`. Order matters when two profiles match the same file —
   * the earlier-listed profile wins.
   *
   * To register a custom `LanguageProfile` programmatically, pass it via
   * `FcaIndexConfig.languages` (the SDK accepts `LanguageProfile[]` directly;
   * YAML stays simple and only references built-in profiles by name).
   *
   * @default ['typescript']
   * @since v0.4.0
   */
  languages?: string[];
}

// ── Error types ─────────────────────────────────────────────────────────────

export class ManifestReaderError extends Error {
  constructor(
    message: string,
    public readonly code: 'READ_FAILED' | 'INVALID_CONFIG',
  ) {
    super(message);
    this.name = 'ManifestReaderError';
  }
}
