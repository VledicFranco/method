// SPDX-License-Identifier: Apache-2.0
/**
 * FcaDetector — Detects which FCA parts are present in a component directory.
 *
 * Detection is profile-driven (since v0.4.0). The detector accepts an ordered
 * list of `LanguageProfile`s and applies their file/subdirectory rules. The
 * union of detected parts across profiles is returned. Within a single file,
 * the FIRST matching rule across all profiles wins; profile order matters
 * only when two profiles have overlapping patterns.
 *
 * Default profile: `typescript` — the v0.3.x rule set is implemented as the
 * `typescriptProfile` constant, so callers that pass no profile or only
 * `typescript` get pre-v0.4 behavior unchanged.
 *
 * Subdirectory rules: a child directory whose name matches a profile's
 * `subdirPatterns` key contributes the corresponding part. The first source
 * file (any `sourceExtension` from any profile) inside that subdirectory is
 * used as the locator. The "boundary" part is implicit: any subdirectory
 * containing at least one source file (per any active profile) marks the
 * parent component as having a `boundary` part.
 */

import type { FileSystemPort, DirEntry } from '../ports/internal/file-system.js';
import type { FcaPart, ComponentPart } from '../ports/context-query.js';
import type { LanguageProfile } from './profiles/index.js';
import { DEFAULT_LANGUAGES } from './profiles/index.js';
import { DocExtractor } from './doc-extractor.js';

export interface FcaDetectorConfig {
  requiredParts?: FcaPart[];
}

export class FcaDetector {
  private readonly extractor: DocExtractor;
  private readonly languages: ReadonlyArray<LanguageProfile>;
  private readonly sourceExtensions: ReadonlyArray<string>;

  constructor(
    private readonly fs: FileSystemPort,
    languages?: ReadonlyArray<LanguageProfile>,
  ) {
    this.languages = languages && languages.length > 0 ? languages : DEFAULT_LANGUAGES;
    this.extractor = new DocExtractor(fs, this.languages);
    // Union of all source extensions across active profiles, used to identify
    // "any source file" for boundary/subdir detection.
    const exts = new Set<string>();
    for (const profile of this.languages) {
      for (const ext of profile.sourceExtensions) exts.add(ext);
    }
    this.sourceExtensions = Array.from(exts);
  }

  /**
   * Detect FCA parts present in componentDir.
   * Returns ComponentPart[] — only parts that are actually found.
   */
  async detect(componentDir: string, _config: FcaDetectorConfig): Promise<ComponentPart[]> {
    const entries = await this.safeReadDir(componentDir);
    const detectedParts: ComponentPart[] = [];
    const assignedParts = new Set<FcaPart>();

    for (const entry of entries) {
      if (entry.isDirectory) {
        // Subdirectory-based parts (ports/, observability/, arch/, domain/ —
        // exact set comes from the active profiles).
        const dirPart = this.classifySubDir(entry.name);
        if (dirPart && !assignedParts.has(dirPart)) {
          const subFiles = await this.safeReadDir(entry.path);
          const firstSource = this.findFirstSourceFile(subFiles);
          if (firstSource) {
            const excerpt = await this.safeExtract(firstSource.path, dirPart);
            detectedParts.push({ part: dirPart, filePath: firstSource.path, excerpt });
            assignedParts.add(dirPart);
          }
        }
        // Boundary: any subdirectory with at least one source file (in any
        // active profile's extensions) counts.
        if (!assignedParts.has('boundary')) {
          const subFiles = await this.safeReadDir(entry.path);
          const firstSource = this.findFirstSourceFile(subFiles);
          if (firstSource) {
            const excerpt = await this.safeExtract(firstSource.path, 'boundary');
            detectedParts.push({ part: 'boundary', filePath: firstSource.path, excerpt });
            assignedParts.add('boundary');
          }
        }
      } else {
        // File-based detection — first matching rule across all profiles wins.
        const part = await this.classifyFile(entry.name, entry.path);
        if (part && !assignedParts.has(part)) {
          const excerpt = await this.safeExtract(entry.path, part);
          detectedParts.push({ part, filePath: entry.path, excerpt });
          assignedParts.add(part);
        }
      }
    }

    return detectedParts;
  }

  /**
   * Find the first part the file matches across all active profiles.
   * Profile order matters only when two profiles match the same file — the
   * earlier-listed profile wins.
   */
  private async classifyFile(name: string, filePath: string): Promise<FcaPart | null> {
    for (const profile of this.languages) {
      for (const rule of profile.filePatterns) {
        if (!rule.pattern.test(name)) continue;
        if (rule.condition === 'has-export') {
          const content = await this.fs.readFile(filePath, 'utf-8');
          if (!/\bexport\b/.test(content)) continue;
        }
        return rule.part;
      }
    }
    return null;
  }

  /**
   * Map a subdirectory name to its FCA part using the active profiles. First
   * profile whose `subdirPatterns` contains the dir name wins.
   */
  private classifySubDir(dirName: string): FcaPart | null {
    for (const profile of this.languages) {
      const part = profile.subdirPatterns[dirName];
      if (part) return part;
    }
    return null;
  }

  /**
   * Locate the first directory entry whose name ends with one of the
   * union-of-all-active-profiles' source extensions.
   */
  private findFirstSourceFile(entries: DirEntry[]): DirEntry | undefined {
    return entries.find(
      e => !e.isDirectory && this.sourceExtensions.some(ext => e.name.endsWith(ext)),
    );
  }

  private async safeReadDir(dir: string): Promise<DirEntry[]> {
    try {
      return await this.fs.readDir(dir);
    } catch {
      return [];
    }
  }

  private async safeExtract(filePath: string, part: FcaPart): Promise<string> {
    try {
      return await this.extractor.extract(filePath, part);
    } catch {
      return '';
    }
  }
}
