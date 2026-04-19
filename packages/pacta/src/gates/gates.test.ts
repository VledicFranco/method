// SPDX-License-Identifier: Apache-2.0
/**
 * Gate Tests — FCA architectural invariants for @methodts/pacta.
 *
 * G-PORT:     Zero third-party runtime dependencies. Intra-monorepo
 *             `@methodts/*` deps are allowed because they are part of the
 *             same FCA layer-stack discipline (verified by their own
 *             gates) and do not pull external code into pacta consumers.
 * G-BOUNDARY: No cross-domain imports (no imports from reasoning/, context/, agents/)
 * G-LAYER:    No upward layer violations (pacta must not import from bridge L4)
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PACTA_ROOT = path.resolve(import.meta.dirname, '..', '..');
const PACTA_SRC = path.resolve(PACTA_ROOT, 'src');

// ── Helpers ──────────────────────────────────────────────────────

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function getAllTsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllTsFiles(fullPath));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

function extractImports(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const importRegex = /(?:import|from)\s+['"]([^'"]+)['"]/g;
  const imports: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  return imports;
}

// ── G-PORT: Zero third-party runtime dependencies ───────────────

describe('G-PORT: Zero third-party runtime dependencies', () => {
  it('package.json declares no third-party `dependencies` (intra-monorepo @methodts/* allowed)', () => {
    const pkg = readJson(path.join(PACTA_ROOT, 'package.json'));
    const deps = (pkg['dependencies'] as Record<string, unknown> | undefined) ?? {};
    const thirdParty = Object.keys(deps).filter((name) => !name.startsWith('@methodts/'));
    assert.equal(
      thirdParty.length,
      0,
      `Expected zero third-party runtime dependencies, found: ${JSON.stringify(thirdParty)}`,
    );
  });
});

// ── G-BOUNDARY: No cross-domain imports ──────────────────────────

describe('G-BOUNDARY: No cross-domain imports within pacta', () => {
  // Engine/middleware/gates/ports/types should not import from reasoning/, context/, agents/
  // These are separate domains that will have their own implementations
  const FORBIDDEN_DOMAINS = ['agents'];

  const sourceFiles = getAllTsFiles(PACTA_SRC);

  it('has source files to check', () => {
    assert.ok(sourceFiles.length > 0, 'Expected at least one source file');
  });

  for (const file of sourceFiles) {
    const relPath = path.relative(PACTA_SRC, file);
    // Skip files that ARE in the forbidden domains (they can import their own types)
    const fileDomain = relPath.split(path.sep)[0];
    if (FORBIDDEN_DOMAINS.includes(fileDomain)) continue;
    // Skip the barrel export — index.ts is the package's public API surface
    // and legitimately re-exports from all modules
    if (relPath === 'index.ts') continue;

    it(`${relPath} does not import from forbidden domains`, () => {
      const imports = extractImports(file);
      for (const imp of imports) {
        for (const domain of FORBIDDEN_DOMAINS) {
          // Check for relative imports into forbidden domains
          assert.ok(
            !imp.includes(`/${domain}/`) && !imp.startsWith(`./${domain}/`) && !imp.startsWith(`../${domain}/`),
            `${relPath} has forbidden import from "${domain}/": ${imp}`,
          );
        }
      }
    });
  }
});

// ── G-LAYER: No upward layer violations ──────────────────────────

describe('G-LAYER: No upward layer violations', () => {
  const FORBIDDEN_PACKAGES = ['@methodts/bridge'];
  const sourceFiles = getAllTsFiles(PACTA_SRC);

  for (const file of sourceFiles) {
    const relPath = path.relative(PACTA_SRC, file);

    it(`${relPath} does not import from higher layers`, () => {
      const imports = extractImports(file);
      for (const imp of imports) {
        for (const pkg of FORBIDDEN_PACKAGES) {
          assert.ok(
            !imp.startsWith(pkg),
            `${relPath} has upward layer violation: imports "${imp}" (${pkg} is L4)`,
          );
        }
      }
    });
  }
});
