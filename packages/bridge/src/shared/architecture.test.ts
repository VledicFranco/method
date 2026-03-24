/**
 * FCA Architecture Gate Tests
 *
 * Structural validation that enforces Fractal Component Architecture invariants
 * at test time. These are fitness functions — they test the architecture itself,
 * not behavior. Runs on every `npm test`.
 *
 * Gates enforced:
 *   G-PORT:    Domain production code must not import fs/js-yaml/child_process directly
 *   G-BOUNDARY: Domains must not import sibling domain internals at runtime
 *   G-LAYER:   Lower-layer packages must not import higher-layer packages
 *
 * References: docs/fractal-component-architecture/05-principles.md (P3, P6, P7)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// ── Helpers ──────────────────────────────────────────────────────

const BRIDGE_SRC = join(import.meta.dirname, '..'); // packages/bridge/src
const DOMAINS_DIR = join(BRIDGE_SRC, 'domains');
const CORE_SRC = join(BRIDGE_SRC, '..', '..', 'core', 'src');
const MCP_SRC = join(BRIDGE_SRC, '..', '..', 'mcp', 'src');
const TYPES_SRC = join(BRIDGE_SRC, '..', '..', 'types', 'src');

/** Recursively collect all .ts files in a directory. */
function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

/** Check if a file is a test file. */
function isTestFile(filePath: string): boolean {
  return filePath.endsWith('.test.ts');
}

/** Extract import specifiers from a TypeScript file. */
function extractImports(filePath: string): Array<{
  line: number;
  specifier: string;
  isTypeOnly: boolean;
  raw: string;
}> {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const imports: Array<{ line: number; specifier: string; isTypeOnly: boolean; raw: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Match: import ... from 'specifier'
    // Match: import type ... from 'specifier'
    // Match: import { type Foo } from 'specifier' (inline type imports)
    const match = line.match(/^import\s+(type\s+)?.*?\s+from\s+['"]([^'"]+)['"]/);
    if (match) {
      const isTypeOnly = !!match[1]; // `import type` prefix
      imports.push({
        line: i + 1,
        specifier: match[2],
        isTypeOnly,
        raw: line,
      });
    }

    // Match: import 'specifier' (side-effect imports)
    const sideEffect = line.match(/^import\s+['"]([^'"]+)['"]/);
    if (sideEffect && !match) {
      imports.push({
        line: i + 1,
        specifier: sideEffect[1],
        isTypeOnly: false,
        raw: line,
      });
    }
  }
  return imports;
}

/** Get the domain name from a file path under domains/. */
function getDomain(filePath: string): string | null {
  const rel = relative(DOMAINS_DIR, filePath);
  if (rel.startsWith('..')) return null;
  return rel.split(sep)[0];
}

// ── Known exceptions (documented and intentional) ────────────────

/** Cross-domain runtime imports that are accepted with tracking. */
const BOUNDARY_EXCEPTIONS = new Set([
  // validateTargetIds is a pure validation function — moving to shared/ is PRD 025 scope
  'projects/routes.ts:../registry/resource-copier.js',
]);

/** Files that may use direct fs — infrastructure-boundary code per action plan. */
const FS_EXCEPTIONS = new Set([
  // Trigger watchers use native fs.watch() — fundamentally different from read/write
  'triggers/git-commit-trigger.ts',
  'triggers/file-watch-trigger.ts',
  // Scope-hook generates git pre-commit hooks — platform-coupled infrastructure
  'sessions/scope-hook.ts',
  // Event persistence files — deferred to PRD 025
  'projects/events/yaml-event-persistence.ts',
  'projects/events/jsonl-event-persistence.ts',
]);

// ── G-PORT: No direct external imports in domain production code ──

describe('G-PORT: Domain production code uses ports, not direct imports', () => {
  const FORBIDDEN_MODULES = [
    { pattern: /^(node:)?fs(\/promises)?$/, name: 'fs' },
    { pattern: /^js-yaml$/, name: 'js-yaml' },
  ];

  const domainFiles = collectTsFiles(DOMAINS_DIR).filter(f => !isTestFile(f));

  it('no direct fs or js-yaml imports in domain production code', () => {
    const violations: string[] = [];

    for (const file of domainFiles) {
      const rel = relative(DOMAINS_DIR, file).replace(/\\/g, '/');

      // Skip known exceptions
      if (FS_EXCEPTIONS.has(rel)) continue;

      const imports = extractImports(file);
      for (const imp of imports) {
        for (const forbidden of FORBIDDEN_MODULES) {
          if (forbidden.pattern.test(imp.specifier)) {
            violations.push(
              `${rel}:${imp.line} — imports '${imp.specifier}' directly (use port instead)`,
            );
          }
        }
      }
    }

    assert.deepStrictEqual(violations, [], [
      'FCA Principle 3 violation: domain code must access external deps through ports.',
      'Fix: accept FileSystemProvider/YamlLoader via constructor injection.',
      'If this is intentional, add the file to FS_EXCEPTIONS in architecture.test.ts.',
      '',
      ...violations,
    ].join('\n'));
  });
});

// ── G-BOUNDARY: No cross-domain runtime imports ──────────────────

describe('G-BOUNDARY: Domains do not import sibling domain internals at runtime', () => {
  const domainFiles = collectTsFiles(DOMAINS_DIR).filter(f => !isTestFile(f));

  it('no runtime imports across domain boundaries', () => {
    const violations: string[] = [];

    for (const file of domainFiles) {
      const domain = getDomain(file);
      if (!domain) continue;

      const rel = relative(DOMAINS_DIR, file).replace(/\\/g, '/');
      const imports = extractImports(file);

      for (const imp of imports) {
        // Skip type-only imports — they vanish at compile time
        if (imp.isTypeOnly) continue;

        // Imports from ../../ports/ and ../../shared/ are allowed — they're cross-cutting infrastructure
        if (imp.specifier.includes('/ports/') || imp.specifier.includes('/shared/')) continue;

        // Check if import points to a sibling domain
        // Pattern: ../siblingDomain/ (direct sibling reference)
        const siblingMatch = imp.specifier.match(/^\.\.\/([^/]+)/);
        if (siblingMatch) {
          const targetDomain = siblingMatch[1];
          // Only flag if target is actually a domain directory
          if (targetDomain !== domain && isDomainDir(targetDomain)) {
            // Check if this is a known exception
            const exceptionKey = `${rel}:${imp.specifier}`;
            if (BOUNDARY_EXCEPTIONS.has(exceptionKey)) continue;

            violations.push(
              `${rel}:${imp.line} — domain '${domain}' imports from sibling '${targetDomain}' at runtime: ${imp.raw}`,
            );
          }
        }
      }
    }

    assert.deepStrictEqual(violations, [], [
      'FCA Principle 7 violation: domains must not import sibling internals at runtime.',
      'Fix: use port interfaces or composition-root injection.',
      'Type-only imports (import type) are acceptable.',
      '',
      ...violations,
    ].join('\n'));
  });
});

/** Check if a directory name is a domain (exists under domains/). */
function isDomainDir(name: string): boolean {
  try {
    return statSync(join(DOMAINS_DIR, name)).isDirectory();
  } catch {
    return false;
  }
}

// ── G-LAYER: Lower-layer packages do not import higher layers ────

describe('G-LAYER: Package layer ordering is respected', () => {
  // Layer stack: L0 types → L1 core → L2 methodts → L3 mcp → L4 bridge
  const LAYER_VIOLATIONS: Array<{
    name: string;
    srcDir: string;
    forbidden: string[];
  }> = [
    {
      name: '@method/types (L0)',
      srcDir: TYPES_SRC,
      forbidden: ['@method/core', '@method/methodts', '@method/mcp', '@method/bridge'],
    },
    {
      name: '@method/core (L1)',
      srcDir: CORE_SRC,
      forbidden: ['@method/methodts', '@method/mcp', '@method/bridge'],
    },
    {
      name: '@method/mcp (L3)',
      srcDir: MCP_SRC,
      forbidden: ['@method/bridge'],
    },
  ];

  for (const layer of LAYER_VIOLATIONS) {
    it(`${layer.name} does not import higher-layer packages`, () => {
      let files: string[];
      try {
        files = collectTsFiles(layer.srcDir).filter(f => !isTestFile(f));
      } catch {
        // Package src dir may not exist in all environments
        return;
      }

      const violations: string[] = [];
      for (const file of files) {
        const rel = relative(layer.srcDir, file).replace(/\\/g, '/');
        const imports = extractImports(file);

        for (const imp of imports) {
          for (const forbidden of layer.forbidden) {
            if (imp.specifier === forbidden || imp.specifier.startsWith(forbidden + '/')) {
              violations.push(
                `${rel}:${imp.line} — imports '${imp.specifier}' (upward layer dependency)`,
              );
            }
          }
        }
      }

      assert.deepStrictEqual(violations, [], [
        `FCA layer violation: ${layer.name} must not import higher-layer packages.`,
        'Dependencies flow downward only: L0 → L1 → L2 → L3 → L4.',
        '',
        ...violations,
      ].join('\n'));
    });
  }
});
