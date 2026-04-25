// SPDX-License-Identifier: Apache-2.0
/**
 * DocExtractor — Extracts a short documentation excerpt from a source file.
 *
 * Profile-driven (since v0.4.0). The extractor takes a list of
 * `LanguageProfile`s and dispatches by source extension to each profile's
 * `extractInterfaceExcerpt` / `extractDocBlock`. Markdown handling is
 * profile-independent and shared (README.md / *.md → first paragraph).
 *
 * Behavior matches v0.3.x exactly when the only active profile is
 * `typescript`:
 *   - README.md / *.md → first paragraph (≤ 600 chars)
 *   - index.ts (interface part) → exported `type|interface|function|...` lines
 *   - other TS files → leading JSDoc block, fallback to first 600 chars
 *
 * For multi-language scans, the profile that "owns" the file (whose
 * `sourceExtensions` includes the file's extension) provides the extractors.
 * If the file's extension isn't claimed by any active profile, we fall back
 * to a generic first-600-chars excerpt.
 */

import type { FileSystemPort } from '../ports/internal/file-system.js';
import type { FcaPart } from '../ports/context-query.js';
import type { LanguageProfile } from './profiles/index.js';
import { DEFAULT_LANGUAGES } from './profiles/index.js';

const MAX_EXCERPT = 600;

export class DocExtractor {
  private readonly languages: ReadonlyArray<LanguageProfile>;

  constructor(
    private readonly fs: FileSystemPort,
    languages?: ReadonlyArray<LanguageProfile>,
  ) {
    this.languages = languages && languages.length > 0 ? languages : DEFAULT_LANGUAGES;
  }

  async extract(filePath: string, part: FcaPart): Promise<string> {
    const content = await this.fs.readFile(filePath, 'utf-8');
    const fileName = filePath.split('/').pop() ?? '';

    // Markdown handling is profile-independent — the file IS the doc.
    if (fileName.endsWith('.md') || fileName.endsWith('.mdx') || fileName.endsWith('.rst')) {
      return this.extractMarkdownParagraph(content);
    }

    const profile = this.findOwningProfile(fileName);

    // Interface excerpt — only when the file is the profile's `interfaceFile`
    // AND the requested part is `interface`. This preserves the v0.3.x
    // "index.ts + interface part → exported signatures" behavior, generalized
    // per profile.
    if (
      profile &&
      part === 'interface' &&
      profile.componentRule.interfaceFile === fileName &&
      profile.extractInterfaceExcerpt
    ) {
      return profile.extractInterfaceExcerpt(content).slice(0, MAX_EXCERPT).trimEnd();
    }

    // Doc block (JSDoc / ScalaDoc / docstring / godoc) — first match wins.
    if (profile?.extractDocBlock) {
      const block = profile.extractDocBlock(content);
      if (block) return block.slice(0, MAX_EXCERPT).trimEnd();
    }

    // Fallback: first 600 chars of file content.
    return content.slice(0, MAX_EXCERPT).trimEnd();
  }

  /**
   * Find the first profile whose `sourceExtensions` claim this file's
   * extension. Profile order matters when multiple profiles claim the same
   * extension (rare — only for extensions like `.md` shared with markdown-only).
   */
  private findOwningProfile(fileName: string): LanguageProfile | undefined {
    return this.languages.find(p =>
      p.sourceExtensions.some(ext => fileName.endsWith(ext)),
    );
  }

  private extractMarkdownParagraph(content: string): string {
    // Find first non-empty line, then read until first blank line.
    const lines = content.split('\n');
    let started = false;
    const paragraphLines: string[] = [];

    for (const line of lines) {
      if (!started) {
        if (line.trim() !== '') {
          started = true;
          paragraphLines.push(line);
        }
      } else {
        if (line.trim() === '') break;
        paragraphLines.push(line);
      }
    }

    return paragraphLines.join('\n').slice(0, MAX_EXCERPT).trimEnd();
  }
}
