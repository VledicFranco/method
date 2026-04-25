// SPDX-License-Identifier: Apache-2.0
/**
 * ProjectScanner — Walks a project and scans every component, producing
 * ScannedComponent[].
 *
 * Profile-driven (since v0.4.0). The scanner accepts an ordered list of
 * `LanguageProfile`s; defaults to `[typescript]` to preserve v0.3.x behavior.
 *
 * Per-profile contributions:
 *   - `componentRule`: a directory qualifies if any active profile considers
 *     it a component (interface file present, or ≥ minSourceFiles in that
 *     profile's extensions).
 *   - `packageMarkers`: union of markers across active profiles for L3
 *     detection (e.g. `package.json`, `build.sbt`, `go.mod`, `pyproject.toml`).
 *   - `sourceExtensions`: union — drives "any source file" boundary detection
 *     and L1 single-file detection.
 *   - `filePatterns` / `subdirPatterns`: passed to FcaDetector for part
 *     classification (first-match-wins across profiles).
 *
 * Default source globs (when `sourcePatterns` is unset) are derived from the
 * union of profile source extensions: e.g. `['src/**\/*.ts', 'src/**\/*.scala', ...]`
 * for a TS+Scala scan. Default exclude patterns mirror v0.3.x:
 * `['**\/__tests__/**', '**\/*.test.ts', '**\/*.spec.ts', '**\/*.d.ts']` —
 * these are TS-specific but harmless for other languages.
 *
 * docText composition is unchanged from v0.3.x (PRD 053 follow-up): only
 * documentation/interface/port excerpts are used for embedding; verification/
 * boundary/observability/architecture/domain excerpts are kept in `parts` for
 * display but excluded from `docText`. Fallback to all parts if the
 * "describes what it IS" set produces an empty docText.
 *
 * ID: sha256(projectRoot + ':' + relativePath), hex prefix 16 chars.
 */

import { createHash } from 'node:crypto';
import type { FileSystemPort, DirEntry } from '../ports/internal/file-system.js';
import type { ProjectScanConfig } from '../ports/manifest-reader.js';
import type { FcaLevel, FcaPart } from '../ports/context-query.js';
import type { LanguageProfile } from './profiles/index.js';
import { DEFAULT_LANGUAGES } from './profiles/index.js';
import { FcaDetector } from './fca-detector.js';
import { CoverageScorer } from './coverage-scorer.js';

/**
 * Parts whose excerpts are used to build `docText` for embedding. These are
 * the parts that describe what the component IS, not what its tests or
 * structural markers cover.
 */
const EMBEDDING_PARTS: ReadonlySet<FcaPart> = new Set(['documentation', 'interface', 'port']);

export interface ScannedComponent {
  /** Deterministic ID: sha256(projectRoot + ':' + relativePath), hex prefix 16 chars. */
  id: string;
  projectRoot: string;
  /** Path relative to projectRoot. */
  path: string;
  level: FcaLevel;
  parts: Array<{ part: FcaPart; filePath: string; excerpt: string }>;
  coverageScore: number;
  /** Concatenated documentation text — used downstream for embedding. */
  docText: string;
  /** ISO 8601 timestamp when the component was indexed. */
  indexedAt: string;
}

const DEFAULT_REQUIRED_PARTS: FcaPart[] = ['interface', 'documentation'];
const DEFAULT_EXCLUDE_PATTERNS: string[] = [
  '**/__tests__/**',
  '**/*.test.ts',
  '**/*.spec.ts',
  '**/*.d.ts',
];

/** Default source patterns when no profiles are active beyond TypeScript. */
const TS_DEFAULT_SOURCE_PATTERNS = ['src/**', 'packages/*/src/**'];

export class ProjectScanner {
  private readonly languages: ReadonlyArray<LanguageProfile>;
  private readonly sourceExtensions: ReadonlyArray<string>;
  private readonly packageMarkers: ReadonlyArray<string>;

  constructor(
    private readonly fs: FileSystemPort,
    private readonly detector: FcaDetector,
    private readonly scorer: CoverageScorer,
    languages?: ReadonlyArray<LanguageProfile>,
  ) {
    this.languages = languages && languages.length > 0 ? languages : DEFAULT_LANGUAGES;
    const exts = new Set<string>();
    const markers = new Set<string>();
    for (const profile of this.languages) {
      for (const e of profile.sourceExtensions) exts.add(e);
      for (const m of profile.packageMarkers) markers.add(m);
    }
    this.sourceExtensions = Array.from(exts);
    this.packageMarkers = Array.from(markers);
  }

  async scan(config: ProjectScanConfig): Promise<ScannedComponent[]> {
    const { projectRoot } = config;
    const sourcePatterns = config.sourcePatterns ?? this.deriveDefaultSourcePatterns();
    const excludePatterns = [...DEFAULT_EXCLUDE_PATTERNS, ...(config.excludePatterns ?? [])];
    const requiredParts = config.requiredParts ?? DEFAULT_REQUIRED_PARTS;

    // Collect all candidate directories by expanding source patterns.
    const candidateDirs = await this.collectCandidateDirs(projectRoot, sourcePatterns, excludePatterns);

    const components: ScannedComponent[] = [];
    const seenPaths = new Set<string>();

    for (const dir of candidateDirs) {
      if (seenPaths.has(dir)) continue;
      seenPaths.add(dir);

      const component = await this.scanDirectory(dir, projectRoot, requiredParts);
      if (component) {
        components.push(component);
      }
    }

    return components;
  }

  /**
   * When the user does not provide `sourcePatterns`, derive defaults from the
   * active profiles. For TypeScript-only scans (the v0.3.x default), use the
   * v0.3.x patterns verbatim to preserve baseline behavior. For multi-
   * language or non-TS scans, default to broad `src/**` and `packages/*\/src/**`
   * patterns — the same shape, but the candidate-directory walk uses the
   * union of source extensions to decide what "looks like a component".
   */
  private deriveDefaultSourcePatterns(): string[] {
    const isTsOnly =
      this.languages.length === 1 && this.languages[0].name === 'typescript';
    if (isTsOnly) return TS_DEFAULT_SOURCE_PATTERNS;
    // For polyglot or non-TS scans, broaden the search: `src/**` plus each
    // common monorepo root. We rely on the per-language `componentRule` to
    // filter out non-component directories.
    return ['src/**', 'packages/*/src/**', 'modules/**', 'apps/**'];
  }

  private async collectCandidateDirs(
    projectRoot: string,
    sourcePatterns: string[],
    excludePatterns: string[],
  ): Promise<string[]> {
    const dirs = new Set<string>();

    for (const pattern of sourcePatterns) {
      // Use glob to find matching files, then extract unique directories.
      const files = await this.fs
        .glob(pattern, projectRoot, { ignore: excludePatterns })
        .catch(() => []);

      for (const filePath of files) {
        // Get the directory of each matched file.
        const lastSlash = filePath.lastIndexOf('/');
        if (lastSlash >= 0) {
          dirs.add(filePath.slice(0, lastSlash));
        }
      }
    }

    // Always include the projectRoot itself as a candidate.
    dirs.add(projectRoot);

    return Array.from(dirs);
  }

  private async scanDirectory(
    dir: string,
    projectRoot: string,
    requiredParts: FcaPart[],
  ): Promise<ScannedComponent | null> {
    // Check if this directory qualifies as a component for any active profile.
    const isComponent = await this.isComponentDir(dir);
    if (!isComponent) return null;

    const relativePath = this.relativize(dir, projectRoot);
    const level = await this.detectLevel(dir);

    const rawParts = await this.detector.detect(dir, { requiredParts });
    const parts = rawParts.map(p => ({
      part: p.part,
      filePath: p.filePath,
      excerpt: p.excerpt ?? '',
    }));

    const detectedPartNames = parts.map(p => p.part);
    const coverageScore = this.scorer.score(detectedPartNames, requiredParts);

    // Prefer "describes what the component IS" parts for the embedding doc.
    // Fall back to all parts if those produce nothing.
    const embeddingParts = parts.filter(p => EMBEDDING_PARTS.has(p.part) && p.excerpt);
    const docText = (embeddingParts.length > 0 ? embeddingParts : parts.filter(p => p.excerpt))
      .map(p => p.excerpt)
      .join('\n\n');

    const id = createHash('sha256')
      .update(projectRoot + ':' + relativePath)
      .digest('hex')
      .slice(0, 16);

    return {
      id,
      projectRoot,
      path: relativePath,
      level,
      parts,
      coverageScore,
      docText,
      indexedAt: new Date().toISOString(),
    };
  }

  /**
   * A directory qualifies as a component if ANY active profile considers it
   * one — interface file present, OR ≥ minSourceFiles in that profile's
   * source extensions.
   */
  private async isComponentDir(dir: string): Promise<boolean> {
    const entries = await this.fs.readDir(dir).catch(() => []);
    for (const profile of this.languages) {
      if (profile.componentRule.interfaceFile) {
        const has = entries.some(
          e => !e.isDirectory && e.name === profile.componentRule.interfaceFile,
        );
        if (has) return true;
      }
      const sourceFiles = entries.filter(
        e => !e.isDirectory && profile.sourceExtensions.some(ext => e.name.endsWith(ext)),
      );
      if (sourceFiles.length >= profile.componentRule.minSourceFiles) return true;
    }
    return false;
  }

  /**
   * Detect FCA level for the directory.
   *   L3 — directory contains any package marker (union across profiles)
   *   L2 — directory is named `src/` AND contains an interface file from any profile
   *   L1 — directory contains exactly 1 source file (any active extension) and no subdirs
   *   L2 — otherwise
   */
  private async detectLevel(dir: string): Promise<FcaLevel> {
    const entries = await this.fs.readDir(dir).catch(() => []);

    // L3: any profile's package marker is present.
    if (this.hasAnyPackageMarker(entries)) return 'L3';

    // L2: src/ subdirectory containing any profile's interface file.
    const dirName = dir.split('/').pop() ?? '';
    const hasAnyInterface = this.languages.some(profile =>
      profile.componentRule.interfaceFile
        ? entries.some(
            e => !e.isDirectory && e.name === profile.componentRule.interfaceFile,
          )
        : false,
    );
    if (dirName === 'src' && hasAnyInterface) return 'L2';

    // L1: single source file (any active extension), no subdirs.
    const sourceFiles = entries.filter(
      e => !e.isDirectory && this.sourceExtensions.some(ext => e.name.endsWith(ext)),
    );
    const subDirs = entries.filter(e => e.isDirectory);
    if (sourceFiles.length === 1 && subDirs.length === 0) return 'L1';

    return 'L2';
  }

  /**
   * Match an entry against any active profile's package markers. Markers
   * starting with `*` are treated as suffix patterns (e.g. `*.sbt`); other
   * markers are exact filename matches.
   */
  private hasAnyPackageMarker(entries: DirEntry[]): boolean {
    for (const marker of this.packageMarkers) {
      if (marker.startsWith('*')) {
        const suffix = marker.slice(1);
        if (entries.some(e => !e.isDirectory && e.name.endsWith(suffix))) return true;
      } else {
        if (entries.some(e => !e.isDirectory && e.name === marker)) return true;
      }
    }
    return false;
  }

  private relativize(absPath: string, projectRoot: string): string {
    // Normalize to forward slashes — fast-glob returns forward slashes on
    // Windows but node:path.resolve() returns backslashes, causing
    // startsWith to fail.
    const norm = (p: string) => p.replace(/\\/g, '/');
    const normAbs = norm(absPath);
    const normRoot = norm(projectRoot);
    if (normAbs === normRoot) return '.';
    if (normAbs.startsWith(normRoot + '/')) {
      return normAbs.slice(normRoot.length + 1);
    }
    return absPath;
  }
}
