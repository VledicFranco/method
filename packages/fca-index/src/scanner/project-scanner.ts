/**
 * ProjectScanner — Walks a project and scans every component, producing ScannedComponent[].
 *
 * Level detection logic:
 *   - Directory with package.json → L3
 *   - Directory is a src/ subdirectory with index.ts → L2
 *   - Single .ts file → L1
 *   - Otherwise → L2
 *
 * ID: sha256(projectRoot + ':' + relativePath), hex prefix 16 chars.
 *
 * docText: concatenation of all excerpt fields from detected parts, separated by '\n\n'.
 */

import { createHash } from 'node:crypto';
import type { FileSystemPort } from '../ports/internal/file-system.js';
import type { ProjectScanConfig } from '../ports/manifest-reader.js';
import type { FcaLevel, FcaPart } from '../ports/context-query.js';
import { FcaDetector } from './fca-detector.js';
import { CoverageScorer } from './coverage-scorer.js';

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

const DEFAULT_SOURCE_PATTERNS = ['src/**', 'packages/*/src/**'];
const DEFAULT_REQUIRED_PARTS: FcaPart[] = ['interface', 'documentation'];

export class ProjectScanner {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly detector: FcaDetector,
    private readonly scorer: CoverageScorer,
  ) {}

  async scan(config: ProjectScanConfig): Promise<ScannedComponent[]> {
    const { projectRoot } = config;
    const sourcePatterns = config.sourcePatterns ?? DEFAULT_SOURCE_PATTERNS;
    const excludePatterns = config.excludePatterns ?? [];
    const requiredParts = config.requiredParts ?? DEFAULT_REQUIRED_PARTS;

    // Collect all candidate directories by expanding source patterns
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

  private async collectCandidateDirs(
    projectRoot: string,
    sourcePatterns: string[],
    excludePatterns: string[],
  ): Promise<string[]> {
    const dirs = new Set<string>();

    for (const pattern of sourcePatterns) {
      // Use glob to find matching files, then extract unique directories
      const files = await this.fs.glob(pattern, projectRoot, { ignore: excludePatterns }).catch(() => []);

      for (const filePath of files) {
        // Get the directory of each matched file
        const lastSlash = filePath.lastIndexOf('/');
        if (lastSlash >= 0) {
          dirs.add(filePath.slice(0, lastSlash));
        }
      }
    }

    // Also include the projectRoot itself as a candidate
    dirs.add(projectRoot);

    return Array.from(dirs);
  }

  private async scanDirectory(
    dir: string,
    projectRoot: string,
    requiredParts: FcaPart[],
  ): Promise<ScannedComponent | null> {
    // Check if this directory qualifies as a component
    const isComponent = await this.isComponentDir(dir);
    if (!isComponent) return null;

    const relativePath = this.relativize(dir, projectRoot);
    const level = await this.detectLevel(dir, projectRoot);

    const rawParts = await this.detector.detect(dir, { requiredParts });
    const parts = rawParts.map(p => ({
      part: p.part,
      filePath: p.filePath,
      excerpt: p.excerpt ?? '',
    }));

    const detectedPartNames = parts.map(p => p.part);
    const coverageScore = this.scorer.score(detectedPartNames, requiredParts);

    const docText = parts
      .filter(p => p.excerpt)
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

  private async isComponentDir(dir: string): Promise<boolean> {
    const entries = await this.fs.readDir(dir).catch(() => []);

    const hasIndexTs = entries.some(e => !e.isDirectory && e.name === 'index.ts');
    if (hasIndexTs) return true;

    const tsFiles = entries.filter(e => !e.isDirectory && e.name.endsWith('.ts'));
    return tsFiles.length >= 2;
  }

  private async detectLevel(dir: string, projectRoot: string): Promise<FcaLevel> {
    const entries = await this.fs.readDir(dir).catch(() => []);

    // L3: has package.json
    const hasPackageJson = entries.some(e => !e.isDirectory && e.name === 'package.json');
    if (hasPackageJson) return 'L3';

    // L2: is a src/ subdirectory with index.ts
    const dirName = dir.split('/').pop() ?? '';
    const hasIndexTs = entries.some(e => !e.isDirectory && e.name === 'index.ts');
    if (dirName === 'src' && hasIndexTs) return 'L2';

    // L1: single .ts file component (the dir only has 1 ts file and no subdirs)
    const tsFiles = entries.filter(e => !e.isDirectory && e.name.endsWith('.ts'));
    const subDirs = entries.filter(e => e.isDirectory);
    if (tsFiles.length === 1 && subDirs.length === 0) return 'L1';

    return 'L2';
  }

  private relativize(absPath: string, projectRoot: string): string {
    if (absPath === projectRoot) return '.';
    if (absPath.startsWith(projectRoot + '/')) {
      return absPath.slice(projectRoot.length + 1);
    }
    return absPath;
  }
}
