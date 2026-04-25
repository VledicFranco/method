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
 * via `FcaIndexConfig.languages` — YAML accepts only built-in profile names.
 *
 * Stability policy:
 *   - The `LanguageProfile` shape itself is frozen. Adding or removing fields
 *     is a breaking change (semver-major).
 *   - Built-in profile rules MAY be extended (e.g. recognizing a new test-file
 *     suffix, supporting a new package marker) as semver-minor when the change
 *     is purely additive — existing classifications are preserved.
 *   - Built-in rule changes that RECLASSIFY existing files (e.g. moving a
 *     pattern from `verification` to `domain`) are semver-major because they
 *     shift downstream query results for projects that index without an
 *     explicit `languages` config.
 *   - Adding a new built-in profile to `BUILT_IN_PROFILES` is semver-minor.
 *   - Removing a built-in profile is semver-major.
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
   * File names that mark a directory as an L3 package root. Two pattern forms
   * are supported:
   *   - **Exact match:** `'package.json'`, `'pom.xml'` match only those exact
   *     filenames.
   *   - **Suffix glob:** a leading `*` matches any filename ending in the
   *     remainder. `'*.sbt'` matches `build.sbt`, `'project.sbt'`, etc.
   *
   * No prefix matching, brace expansion, or full glob syntax (e.g.
   * `'*.{py,pyi}'`, `'requirements*.txt'`) — list each filename explicitly
   * if multiple exact names apply (e.g. Python uses `['pyproject.toml',
   * 'setup.py', 'setup.cfg']` as three entries).
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
   *   `interfaceFile` — when set, a directory containing this filename
   *      qualifies as a component regardless of source file count. Matched
   *      case-INsensitively so `Index.ts` and `index.ts` both qualify
   *      (cross-platform safety on Windows + Mac case-preserving filesystems).
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
