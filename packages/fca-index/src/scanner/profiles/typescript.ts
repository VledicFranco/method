// SPDX-License-Identifier: Apache-2.0
/**
 * TypeScript LanguageProfile — captures the scanner's pre-v0.4.0 behavior
 * exactly. This profile is the default when no `languages` config is given,
 * preserving full backward compatibility for existing fca-index users.
 *
 * Detection rules mirror `fca-detector.ts` v0.3.0:
 *   - `README.md` / `*.md` (excluding test markdown) → documentation
 *   - `*.test.ts`, `*.spec.ts`, `*.contract.test.ts` → verification
 *   - `architecture.ts` → architecture
 *   - `*.metrics.ts`, `*.observability.ts` → observability
 *   - `*port.ts` (incl. `.port.ts`, `-port.ts`) → port
 *   - `*-domain.ts` → domain
 *   - `index.ts` (with `export` keyword) → interface
 *
 * Subdirectory rules: `ports/`, `observability/`, `arch/`, `domain/`.
 *
 * Component qualification: directory contains `index.ts` OR ≥ 2 `.ts` files.
 *
 * Extractors: JSDoc `/** ... *\/` for doc blocks; `export type|interface|...`
 * lines for interfaces.
 */

import type { LanguageProfile } from './types.js';

const MAX_EXCERPT = 600;

export const typescriptProfile: LanguageProfile = {
  name: 'typescript',
  sourceExtensions: ['.ts'],
  packageMarkers: ['package.json'],
  filePatterns: [
    // Documentation: README.md or any *.md (test markdown excluded)
    { pattern: /^README\.md$/, part: 'documentation' },
    { pattern: /^(?!.*\.test\.md$).*\.md$/, part: 'documentation' },
    // Verification: *.test.ts, *.spec.ts, *.contract.test.ts
    { pattern: /\.contract\.test\.ts$/, part: 'verification' },
    { pattern: /\.test\.ts$/, part: 'verification' },
    { pattern: /\.spec\.ts$/, part: 'verification' },
    // Architecture: architecture.ts
    { pattern: /^architecture\.ts$/, part: 'architecture' },
    // Observability: *.metrics.ts, *.observability.ts
    { pattern: /\.metrics\.ts$/, part: 'observability' },
    { pattern: /\.observability\.ts$/, part: 'observability' },
    // Port: *port.ts (matches *.port.ts, *-port.ts, anything ending port.ts)
    { pattern: /port\.ts$/, part: 'port' },
    // Domain: *-domain.ts
    { pattern: /-domain\.ts$/, part: 'domain' },
    // Interface: index.ts (only when it has an export — handled by `condition`)
    { pattern: /^index\.ts$/, part: 'interface', condition: 'has-export' },
  ],
  subdirPatterns: {
    ports: 'port',
    observability: 'observability',
    arch: 'architecture',
    domain: 'domain',
  },
  componentRule: {
    interfaceFile: 'index.ts',
    minSourceFiles: 2,
  },
  extractInterfaceExcerpt(content) {
    // Match the v0.3.0 behavior: collect lines starting with `export <kind>`,
    // join, and return ≤600 chars (or fall back to the first 600 chars).
    const lines = content.split('\n');
    const sigLines: string[] = [];
    for (const line of lines) {
      if (/^\s*export\s+(type|interface|function|class|abstract|const|enum|declare)/.test(line)) {
        sigLines.push(line);
      }
    }
    if (sigLines.length === 0) {
      return content.slice(0, MAX_EXCERPT).trimEnd();
    }
    return sigLines.join('\n').slice(0, MAX_EXCERPT).trimEnd();
  },
  extractDocBlock(content) {
    // Leading JSDoc /** ... */ — same as v0.3.0.
    const match = content.match(/^\s*\/\*\*([\s\S]*?)\*\//);
    if (!match) return '';
    return match[0].slice(0, MAX_EXCERPT).trimEnd();
  },
};
