/**
 * Architecture gate tests for @method/runtime (PRD-057 / S2 §11).
 *
 * - G-RUNTIME-ZERO-TRANSPORT: no fastify / @fastify / ws / node-pty / express
 *   imports under packages/runtime/src.
 * - G-RUNTIME-NO-BRIDGE-BACKREF: no `@method/bridge` or `../../bridge/`
 *   imports under packages/runtime/src.
 * - G-RUNTIME-EVENT-TYPE-NEUTRAL: EventDomain keeps the `(string & {})`
 *   escape hatch (no closed union reintroduced).
 * - G-BRIDGE-USES-RUNTIME-PORTS: xit (disabled) — activated in C7.
 *
 * Scope: walks packages/runtime/src/**\/*.ts (skips *.test.ts).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// src/architecture.test.ts → src
const SRC_DIR = resolve(__dirname);
// src → packages/runtime
const PACKAGE_DIR = resolve(SRC_DIR, '..');

function walkTsFiles(dir: string, out: string[] = []): string[] {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      walkTsFiles(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

function extractImportSpecifiers(content: string): string[] {
  // Match `import ... from 'X'` and `import('X')` — captures specifier inside quotes.
  const results: string[] = [];
  const patterns = [
    /from\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]/g,
    /require\s*\(\s*['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
      results.push(m[1]);
    }
  }
  return results;
}

describe('@method/runtime — architecture gates (PRD-057 / S2 §11)', () => {
  const srcDir = join(PACKAGE_DIR, 'src');
  const files = walkTsFiles(srcDir);

  it('G-RUNTIME-ZERO-TRANSPORT: no transport dependencies', () => {
    const forbidden = ['fastify', '@fastify/', 'ws', 'node-pty', 'express'];
    const violations: Array<{ file: string; specifier: string }> = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      const specifiers = extractImportSpecifiers(content);
      for (const spec of specifiers) {
        for (const f of forbidden) {
          // 'ws' must match exactly (not 'websocket-something'); others use prefix match.
          const match = f === 'ws' ? spec === 'ws' : spec.startsWith(f);
          if (match) {
            violations.push({ file, specifier: spec });
          }
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `@method/runtime must have zero transport dependencies. Violations: ${JSON.stringify(violations, null, 2)}`,
    );
  });

  it('G-RUNTIME-NO-BRIDGE-BACKREF: no imports from @method/bridge', () => {
    const violations: Array<{ file: string; specifier: string }> = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      const specifiers = extractImportSpecifiers(content);
      for (const spec of specifiers) {
        if (spec === '@method/bridge' || spec.startsWith('@method/bridge/')) {
          violations.push({ file, specifier: spec });
        }
        if (spec.includes('/bridge/src/') || spec.includes('../../bridge/')) {
          violations.push({ file, specifier: spec });
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `@method/runtime must not back-reference @method/bridge. Violations: ${JSON.stringify(violations, null, 2)}`,
    );
  });

  it('G-RUNTIME-EVENT-TYPE-NEUTRAL: EventDomain keeps (string & {}) escape hatch', () => {
    const eventBusPath = join(srcDir, 'ports', 'event-bus.ts');
    const src = readFileSync(eventBusPath, 'utf-8');
    assert.match(
      src,
      /\(string\s*&\s*\{\s*\}\s*\)/,
      'EventDomain must retain the `(string & {})` escape hatch',
    );
  });

  // G-BRIDGE-USES-RUNTIME-PORTS is asserted on the bridge side (bridge's
  // architecture test). Activated in C7 per PRD-057 §8.

  // ── PRD-064 / S7 §11 ───────────────────────────────────────────
  it('G-METHODOLOGY-SOURCE-CORE-SYNC: core reads remain synchronous', () => {
    const portPath = join(srcDir, 'ports', 'methodology-source.ts');
    const src = readFileSync(portPath, 'utf-8');
    assert.ok(
      !/\blist\s*\(\s*\)\s*:\s*Promise</.test(src),
      'list() must remain synchronous',
    );
    assert.ok(
      !/\bgetMethod\s*\([^)]*\)\s*:\s*Promise</.test(src),
      'getMethod() must remain synchronous',
    );
    assert.ok(
      !/\bgetMethodology\s*\([^)]*\)\s*:\s*Promise</.test(src),
      'getMethodology() must remain synchronous',
    );
  });
});
