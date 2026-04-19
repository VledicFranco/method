// SPDX-License-Identifier: Apache-2.0
/**
 * FCA Architecture Gate Tests — @methodts/fca-index
 *
 * Structural fitness functions enforcing FCA invariants within this package.
 * Runs on every `npm test`. Added in Wave 0 as stubs; filled in C-6 (Wave 3).
 *
 * Gates:
 *   G-PORT-SCANNER:  scanner/ does not import node:fs or node:path directly
 *   G-PORT-QUERY:    query/ does not import HTTP clients directly
 *   G-BOUNDARY-CLI:  cli/ does not import domain internals (only ports/)
 *   G-LAYER:         this package does not import @methodts/mcp or @methodts/bridge
 *
 * References: docs/fractal-component-architecture/05-principles.md (P3, P7)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fg from 'fast-glob';

// fast-glob requires forward slashes; on Windows `resolve` returns
// backslashes, which silently match zero files (false-positive PASS).
const PKG_ROOT = resolve(import.meta.dirname, '..').replace(/\\/g, '/');
const SRC = `${PKG_ROOT}/src`;

/**
 * Read all TypeScript source files (not test files) in a directory.
 * Returns [] if the directory does not exist yet (e.g. cli/ before C-5 runs).
 */
function readSourceFiles(dir: string): string[] {
  try {
    return fg
      .sync(`${dir}/**/*.ts`, { ignore: ['**/*.test.ts', '**/*.spec.ts'] })
      .map(f => readFileSync(f, 'utf-8'));
  } catch {
    return [];
  }
}

describe('G-PORT-SCANNER: scanner uses FileSystemPort, not node:fs', () => {
  it('scanner/ has no direct node:fs or node:path imports', () => {
    const files = readSourceFiles(`${SRC}/scanner`);
    const violations = files.filter(content =>
      /from ['"]node:fs['"]/.test(content) ||
      /from ['"]node:path['"]/.test(content) ||
      /require\(['"]node:fs['"]\)/.test(content) ||
      /require\(['"]node:path['"]\)/.test(content),
    );
    expect(violations, 'scanner/ imports node:fs or node:path directly').toHaveLength(0);
  });
});

describe('G-PORT-QUERY: query engine uses EmbeddingClientPort, not HTTP clients', () => {
  it('query/ has no direct fetch, node:http, or node:https imports', () => {
    const files = readSourceFiles(`${SRC}/query`);
    const violations = files.filter(content =>
      /from ['"]node:http['"]/.test(content) ||
      /from ['"]node:https['"]/.test(content) ||
      /from ['"]node:fetch['"]/.test(content),
    );
    expect(violations, 'query/ imports HTTP clients directly').toHaveLength(0);
  });
});

describe('G-BOUNDARY-CLI: cli imports only from ports/, not domain internals', () => {
  it('cli/ does not import query-engine.js or coverage-engine.js directly', () => {
    const files = readSourceFiles(`${SRC}/cli`);
    // CLI is allowed to wire via factory/ports; it must not reach into domain internals.
    // Specifically: no direct imports of query-engine.js or coverage-engine.js from cli/.
    const violations = files.filter(content =>
      /from ['"]\.\.\/query\/query-engine['"]/.test(content) ||
      /from ['"]\.\.\/coverage\/coverage-engine['"]/.test(content),
    );
    expect(violations, 'cli/ imports domain internals directly (should use ports)').toHaveLength(0);
  });
});

describe('G-BOUNDARY-DETAIL: component-detail-engine does not import cli/ or @methodts/mcp', () => {
  it('query/ does not import cli/ or @methodts/mcp', () => {
    const files = readSourceFiles(`${SRC}/query`);
    const violations = files.filter(
      (content) =>
        /from ['"]\.\.\/cli\//.test(content) || /@methodts\/mcp/.test(content),
    );
    expect(violations, 'query/ imports cli/ or @methodts/mcp').toHaveLength(0);
  });
});

describe('G-BOUNDARY-COMPLIANCE: compliance-engine does not import cli/ or @methodts/mcp', () => {
  it('compliance/ does not import cli/ or @methodts/mcp', () => {
    const files = readSourceFiles(`${SRC}/compliance`);
    const violations = files.filter(
      (content) =>
        /from ['"]\.\.\/cli\//.test(content) || /@methodts\/mcp/.test(content),
    );
    expect(violations, 'compliance/ imports cli/ or @methodts/mcp').toHaveLength(0);
  });
});

describe('G-BOUNDARY-MCP: mcp/ composition root does not import domain internals', () => {
  it('mcp/ imports only from ports/, factory, and its own files', () => {
    const files = readSourceFiles(`${SRC}/mcp`);
    const violations = files.filter(content =>
      // Must not reach into scanner, index-store, query, coverage, compliance, or cli internals
      /from ['"]\.\.\/scanner\//.test(content) ||
      /from ['"]\.\.\/index-store\//.test(content) ||
      /from ['"]\.\.\/query\//.test(content) ||
      /from ['"]\.\.\/coverage\//.test(content) ||
      /from ['"]\.\.\/compliance\//.test(content) ||
      /from ['"]\.\.\/cli\//.test(content),
    );
    expect(violations, 'mcp/ imports domain internals (should use ports + factory)').toHaveLength(0);
  });
});

describe('G-LAYER: fca-index does not import @methodts/mcp or @methodts/bridge', () => {
  it('no source file imports @methodts/mcp or @methodts/bridge', () => {
    // Match real import/require statements only — JSDoc references in
    // comments (e.g. "Consumer: @methodts/mcp") are documentation, not
    // dependencies, and must not trigger this gate.
    const importPattern = /(?:from|require\()\s*['"]@methodts\/(?:mcp|bridge)['"]/;
    const allFiles = fg
      .sync(`${SRC}/**/*.ts`, { ignore: ['**/*.test.ts'] })
      .map(f => readFileSync(f, 'utf-8'));
    const violations = allFiles.filter(content => importPattern.test(content));
    expect(violations, 'fca-index imports @methodts/mcp or @methodts/bridge').toHaveLength(0);
  });
});

describe('G-PORT-OBSERVABILITY: domain code emits observability through the port, not stderr directly', () => {
  it('query/, index-store/, scanner/, coverage/, compliance/ do not write to process.stderr for observability', () => {
    // CLI user-facing error messages are presentation, not observability — excluded.
    // ObservabilityPort implementations (e.g., StderrObservabilitySink) are explicitly
    // allowed to write to stderr; they live in cli/ (composition root).
    const domainDirs = ['query', 'index-store', 'scanner', 'coverage', 'compliance'];
    const violations: string[] = [];
    for (const dir of domainDirs) {
      const files = fg.sync(`${SRC}/${dir}/**/*.ts`, {
        ignore: ['**/*.test.ts', '**/*.spec.ts'],
      });
      for (const file of files) {
        const content = readFileSync(file, 'utf-8');
        // Match actual stderr writes but skip matches inside string literals intended
        // as generated-code content (template-generator.ts contains a stub that will be
        // written OUT as code for a future component — not a real call site).
        if (/process\s*\.\s*stderr\s*\.\s*write/.test(content) && !file.endsWith('template-generator.ts')) {
          violations.push(file);
        }
      }
    }
    expect(violations, 'Domain code writes to process.stderr directly — use ObservabilityPort').toEqual([]);
  });
});
