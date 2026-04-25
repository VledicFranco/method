// SPDX-License-Identifier: Apache-2.0
/**
 * Go LanguageProfile — detects FCA parts in Go projects.
 *
 * Detection rules:
 *   - `README.md` / `*.md` (excluding test markdown) → documentation
 *   - `*_test.go` → verification
 *   - `architecture.go`, `arch.go` → architecture
 *   - `metrics.go`, `*_metrics.go`, `observability.go`, `telemetry.go`
 *      → observability
 *   - `port.go`, `ports.go`, `*_port.go` → port
 *   - `domain.go`, `*_domain.go` → domain
 *   - `doc.go` (Go's idiomatic package-doc file) → interface
 *
 * Subdirectory rules: `ports`, `observability`, `arch`, `domain`.
 *
 * L3 markers: `go.mod`, `go.sum`.
 *
 * Component qualification: directory contains `doc.go` OR ≥ 2 source
 * files (`.go`).
 *
 * Doc extraction: Godoc — leading `// ...` line block before the `package`
 * declaration, or block comments `/​* ... *​/`.
 * Interface excerpt: top-level `func`, `type`, `var`, `const` declarations.
 */

import type { LanguageProfile } from './types.js';

const MAX_EXCERPT = 600;

export const goProfile: LanguageProfile = {
  name: 'go',
  sourceExtensions: ['.go'],
  packageMarkers: ['go.mod', 'go.sum'],
  filePatterns: [
    // Documentation
    { pattern: /^README\.md$/, part: 'documentation' },
    { pattern: /^(?!.*\.test\.md$).*\.md$/, part: 'documentation' },
    // Verification — Go test files
    { pattern: /_test\.go$/, part: 'verification' },
    // Architecture
    { pattern: /^architecture\.go$/, part: 'architecture' },
    { pattern: /^arch\.go$/, part: 'architecture' },
    // Observability
    { pattern: /^metrics\.go$/, part: 'observability' },
    { pattern: /_metrics\.go$/, part: 'observability' },
    { pattern: /^observability\.go$/, part: 'observability' },
    { pattern: /^telemetry\.go$/, part: 'observability' },
    // Port
    { pattern: /^port\.go$/, part: 'port' },
    { pattern: /^ports\.go$/, part: 'port' },
    { pattern: /_port\.go$/, part: 'port' },
    // Domain
    { pattern: /^domain\.go$/, part: 'domain' },
    { pattern: /_domain\.go$/, part: 'domain' },
    // Interface — Go's idiomatic doc.go file is the package's public surface
    { pattern: /^doc\.go$/, part: 'interface' },
  ],
  subdirPatterns: {
    ports: 'port',
    observability: 'observability',
    arch: 'architecture',
    domain: 'domain',
  },
  componentRule: {
    interfaceFile: 'doc.go',
    minSourceFiles: 2,
  },
  extractInterfaceExcerpt(content) {
    // Top-level Go declarations: func, type, var, const.
    const lines = content.split('\n');
    const sigLines: string[] = [];
    for (const line of lines) {
      if (/^(func|type|var|const)\s+/.test(line)) {
        sigLines.push(line);
      }
    }
    if (sigLines.length === 0) {
      return content.slice(0, MAX_EXCERPT).trimEnd();
    }
    return sigLines.join('\n').slice(0, MAX_EXCERPT).trimEnd();
  },
  extractDocBlock(content) {
    // Godoc: capture leading `// ...` lines before the first `package` or
    // any non-comment statement. Falls back to a leading /* ... */ block.
    const lines = content.split('\n');
    const docLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('//')) {
        docLines.push(line);
        continue;
      }
      if (line.trim() === '') {
        if (docLines.length > 0) break;
        continue;
      }
      break;
    }
    if (docLines.length > 0) {
      return docLines.join('\n').slice(0, MAX_EXCERPT).trimEnd();
    }
    const block = content.match(/^\s*\/\*([\s\S]*?)\*\//);
    if (block) return block[0].slice(0, MAX_EXCERPT).trimEnd();
    return '';
  },
};
