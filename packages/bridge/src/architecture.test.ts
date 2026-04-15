/**
 * Architecture gate tests for @method/bridge (PRD-057 / S2 §11).
 *
 * - G-BRIDGE-USES-RUNTIME-PORTS: ACTIVE in C7. The gate enforces that bridge
 *   cross-domain imports of strategy / event-bus / cost-governor / sessions
 *   engine internals go through `@method/runtime/*` subpaths, not relative
 *   paths into moved directories. Violations are bugs.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC_DIR = resolve(__dirname);

function walkTsFiles(dir: string, out: string[] = []): string[] {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      walkTsFiles(full, out);
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('@method/bridge — architecture gates (PRD-057 / S2 §11)', () => {
  // PRD-057 C7: gate activated. Runs on every build.
  it('G-BRIDGE-USES-RUNTIME-PORTS: bridge imports engine internals via @method/runtime/*', () => {
    const roots = [
      join(SRC_DIR, 'domains'),
      join(SRC_DIR, 'shared'),
    ];
    const forbiddenPatterns: RegExp[] = [
      /from\s+['"](?:\.\.\/)+domains\/strategies\/strategy-executor/,
      /from\s+['"](?:\.\.\/)+shared\/event-bus\/in-memory-event-bus/,
      /from\s+['"](?:\.\.\/)+domains\/cost-governor\/(?:observations-store|cost-oracle-impl|rate-governor-impl)/,
    ];
    const violations: Array<{ file: string; line: string }> = [];

    for (const root of roots) {
      const files = walkTsFiles(root);
      for (const file of files) {
        const content = readFileSync(file, 'utf-8');
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
          for (const pattern of forbiddenPatterns) {
            if (pattern.test(line)) {
              violations.push({ file, line: line.trim() });
            }
          }
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Bridge cross-domain imports must use @method/runtime/* subpaths. Violations: ${JSON.stringify(violations, null, 2)}`,
    );
  });
});
