/**
 * FCA Architecture Gate Tests — @method/fca-index
 *
 * Structural fitness functions enforcing FCA invariants within this package.
 * Runs on every `npm test`. Added in Wave 0 as stubs; filled in C-6 (Wave 3).
 *
 * Gates:
 *   G-PORT-SCANNER:  scanner/ does not import node:fs or node:path directly
 *   G-PORT-QUERY:    query/ does not import HTTP clients directly
 *   G-BOUNDARY-CLI:  cli/ does not import domain internals (only ports/)
 *   G-LAYER:         this package does not import @method/mcp or @method/bridge
 *
 * References: docs/fractal-component-architecture/05-principles.md (P3, P7)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fg from 'fast-glob';

const PKG_ROOT = resolve(import.meta.dirname, '..');
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

describe('G-LAYER: fca-index does not import @method/mcp or @method/bridge', () => {
  it('no source file imports @method/mcp or @method/bridge', () => {
    const allFiles = fg
      .sync(`${SRC}/**/*.ts`, { ignore: ['**/*.test.ts'] })
      .map(f => readFileSync(f, 'utf-8'));
    const violations = allFiles.filter(content =>
      /@method\/mcp/.test(content) ||
      /@method\/bridge/.test(content),
    );
    expect(violations, 'fca-index imports @method/mcp or @method/bridge').toHaveLength(0);
  });
});
