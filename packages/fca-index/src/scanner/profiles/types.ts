// SPDX-License-Identifier: Apache-2.0
/**
 * LanguageProfile — declarative spec for how the scanner detects FCA parts in a
 * single language ecosystem.
 *
 * A profile carries:
 *   - file extension and package marker patterns (used for level detection +
 *     glob defaults),
 *   - file-name regex rules mapping to FCA parts,
 *   - subdirectory-name rules mapping to FCA parts,
 *   - the component qualification rule (interface file or minimum source files),
 *   - optional language-specific extractors for interface excerpts and the
 *     leading documentation block (JSDoc, ScalaDoc, docstring, godoc).
 *
 * Profiles are pure data — no I/O. They are consumed by FcaDetector,
 * DocExtractor, and ProjectScanner. The set of active profiles is unioned: a
 * directory is a component if ANY profile considers it one; a file is
 * classified by the FIRST profile rule that matches.
 *
 * The `LanguageProfile` shape is part of the public SDK surface and is the
 * extension point for new languages. Built-in profiles (`typescript`, `scala`,
 * `python`, `go`, `markdown-only`) ship with the package and can be referenced
 * by name in `.fca-index.yaml`. Custom profiles can be passed programmatically
 * via `FcaIndexConfig.languages`.
 *
 * Status: frozen 2026-04-25.
 */

import type { FcaPart } from '../../ports/context-query.js';

/**
 * One file-name pattern → FCA part rule. Optional `condition` lets the rule
 * fire only when the file content matches an extra check (currently only
 * `'has-export'` for interface files).
 */
export interface FilePatternRule {
  /** Regex tested against the file's basename (e.g. /\.test\.ts$/). */
  pattern: RegExp;
  /** FCA part this rule attributes the file to. */
  part: FcaPart;
  /**
   * Extra content-level check. Currently only `'has-export'` is supported —
   * for `interface` parts where the file must contain an `export` keyword.
   */
  condition?: 'has-export';
}

export interface LanguageProfile {
  /** Stable, lowercase, kebab-case name (e.g. `typescript`, `markdown-only`). */
  name: string;

  /**
   * Source file extensions for this language, including the leading dot
   * (e.g. `['.ts']`, `['.py', '.pyi']`). Used by `isComponentDir` and to
   * derive default source globs.
   */
  sourceExtensions: string[];

  /**
   * File names that mark a directory as an L3 package root (e.g.
   * `['package.json']` for npm, `['build.sbt', '*.sbt']` for sbt). Wildcards
   * are NOT supported — list each marker filename explicitly. For pattern
   * matching, use the `*.sbt`-style entries: any file whose basename matches
   * the marker (using simple suffix glob) qualifies.
   */
  packageMarkers: string[];

  /**
   * Filename → FCA part rules. Evaluated in order; first match wins per file.
   */
  filePatterns: FilePatternRule[];

  /**
   * Subdirectory-name → FCA part rules. A direct child directory whose name
   * matches a key marks the parent component as having that part (using the
   * first source file inside as the locator).
   */
  subdirPatterns: Record<string, FcaPart>;

  /**
   * Rules for whether a directory qualifies as an FCA component for this
   * language.
   *
   *   `interfaceFile` — when set, a directory containing this exact file
   *      (case-sensitive) qualifies as a component regardless of source
   *      file count.
   *   `minSourceFiles` — minimum number of source files (matching
   *      `sourceExtensions`) required to qualify.
   */
  componentRule: {
    interfaceFile?: string;
    minSourceFiles: number;
  };

  /**
   * Extract the public-API excerpt from the interface file's content
   * (default: per-language exported declarations). Receives raw file content;
   * returns the trimmed excerpt (≤600 chars handled by the caller).
   * If omitted, the caller falls back to a generic "first 600 chars" excerpt.
   */
  extractInterfaceExcerpt?: (content: string) => string;

  /**
   * Extract the leading documentation block from a source file (default:
   * language-specific, e.g. JSDoc `/** ... *\/` for TS). Returns the trimmed
   * block, or empty string when none is found.
   */
  extractDocBlock?: (content: string) => string;
}
