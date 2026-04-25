// SPDX-License-Identifier: Apache-2.0
/**
 * markdown-only LanguageProfile — README/docs-only detection.
 *
 * This profile detects ONLY documentation parts (README + *.md). It exists for
 * polyglot or docs-heavy repos where you want fca-index to surface the
 * documentation map of a directory without inferring source-file FCA structure
 * for any specific language.
 *
 * Use cases:
 *   - A docs-only repo (RFCs, PRDs, design notes) — surface the markdown
 *     navigation graph without spurious component detection.
 *   - As one entry in a polyglot `languages` list, paired with one or more
 *     source-language profiles, to ensure README/docs always count when other
 *     profiles miss them.
 *
 * Detection rules:
 *   - `README.md`, `README.rst`, `*.md`, `*.mdx` (excluding test markdown)
 *      → documentation
 *
 * No file or subdirectory rules for source code parts.
 *
 * L3 markers: none. Component qualification: directory contains a `README.md`,
 * `README.rst`, OR ≥ 1 markdown file.
 */

import type { LanguageProfile } from './types.js';

const MAX_EXCERPT = 600;

export const markdownOnlyProfile: LanguageProfile = {
  name: 'markdown-only',
  // No "source" extensions — markdown is the only thing detected. We list
  // .md/.mdx so that componentRule.minSourceFiles can use them as the file
  // population for component qualification.
  sourceExtensions: ['.md', '.mdx'],
  packageMarkers: [],
  filePatterns: [
    { pattern: /^README\.md$/, part: 'documentation' },
    { pattern: /^README\.rst$/, part: 'documentation' },
    { pattern: /^(?!.*\.test\.md$).*\.md$/, part: 'documentation' },
    { pattern: /^(?!.*\.test\.mdx$).*\.mdx$/, part: 'documentation' },
  ],
  subdirPatterns: {},
  componentRule: {
    interfaceFile: 'README.md',
    minSourceFiles: 1,
  },
  extractInterfaceExcerpt(content) {
    // For markdown there is no "interface" — the README's first paragraph
    // serves as the public surface. We let DocExtractor's markdown path
    // (which is profile-independent) handle this; this fallback is only
    // used when the caller asks for an interface excerpt from a non-md file.
    return content.slice(0, MAX_EXCERPT).trimEnd();
  },
  extractDocBlock() {
    // No doc-block extraction for markdown; the file IS the doc.
    return '';
  },
};
