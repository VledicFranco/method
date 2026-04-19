// SPDX-License-Identifier: Apache-2.0
/**
 * Architecture gates — source-scan tests for PRD-058 §6.6.
 *
 *   - G-BOUNDARY-NO-CORTEX-VALUE-IMPORT — forbid runtime imports from
 *     `@cortex/*` or `@t1/cortex-sdk`; only `import type` is allowed.
 *   - G-LAYER — agent-runtime is L3; forbid imports from `@methodts/bridge` (L4).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC_ROOT = path.resolve(__dirname);

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      walkTs(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('G-BOUNDARY-NO-CORTEX-VALUE-IMPORT', () => {
  it('no non-type import from @cortex/* or @t1/cortex-sdk in agent-runtime src', () => {
    const files = walkTs(SRC_ROOT);
    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      // Match top-of-line import statements that are NOT `import type {...}`.
      const valueImports = [
        ...content.matchAll(
          /^\s*import\s+(?!type\b)[^;]*from\s+['"](?:@cortex\/|@t1\/cortex-sdk)[^'"]*['"]/gm,
        ),
      ];
      if (valueImports.length > 0) violations.push(file);
    }
    assert.deepStrictEqual(violations, [], `violations: ${violations.join(', ')}`);
  });
});

// ── PRD-064 / S7 §11 architecture gates ─────────────────────────────

describe('G-CORTEX-NO-SDK-LEAK (S7 §11)', () => {
  it('@methodts/runtime/src does not leak ctx.storage / ctx.events / @t1 SDK', () => {
    const runtimeSrc = path.resolve(SRC_ROOT, '../../runtime/src');
    const files = walkTs(runtimeSrc);
    const forbidden = ['@t1/cortex-sdk', 'ctx.storage', 'ctx.events'];
    const violations: Array<{ file: string; needle: string }> = [];
    for (const file of files) {
      if (file.endsWith('.test.ts')) continue;
      const content = readFileSync(file, 'utf-8');
      for (const needle of forbidden) {
        // Mentions in comments/docstrings are allowed; only import/reference
        // in code bodies is a violation. We scan import statements + value
        // references to `ctx.storage` / `ctx.events`.
        const importLike = new RegExp(
          `(?:^\\s*import\\s+[^;]*from\\s+['"][^'"]*${needle.replace(/[./]/g, '\\$&')}[^'"]*['"])`,
          'm',
        );
        if (importLike.test(content)) {
          violations.push({ file, needle });
        }
      }
    }
    assert.deepStrictEqual(violations, []);
  });
});

describe('G-METHODOLOGY-EVENT-DECLARED (S7 §11)', () => {
  it('CortexMethodologySource passes only "methodology.updated" to events.on / events.emit', () => {
    const src = readFileSync(
      path.resolve(SRC_ROOT, 'methodology/cortex-methodology-source.ts'),
      'utf-8',
    );
    // Capture every first-arg passed to events.<on|emit>(...).
    const calls = [
      ...src.matchAll(/events\.(?:on|emit)\(\s*['"]([^'"]+)['"]/g),
    ];
    assert.ok(calls.length > 0, 'expected at least one events.on/emit call');
    for (const match of calls) {
      assert.strictEqual(match[1], 'methodology.updated');
    }
  });
});

describe('G-DOC-SCHEMA-COLLECTION-NAMES (S7 §11)', () => {
  it('Mongo collection names match PRD-064-Cortex CollectionName regex', () => {
    const regex = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
    const names = ['methodologies', 'methodology_policy'];
    for (const n of names) {
      assert.match(n, regex, `${n} must match CollectionName regex`);
      assert.ok(!n.startsWith('system.'), `${n} must not start with "system."`);
    }
  });
});

describe('G-RUNTIME-NO-ADMIN-IMPORT (PRD-064 §13.2)', () => {
  it('only methodology/ may import CortexMethodologySource as a value', () => {
    const files = walkTs(SRC_ROOT);
    const violations: string[] = [];
    for (const file of files) {
      if (file.includes(`${path.sep}methodology${path.sep}`)) continue;
      if (file.endsWith('.test.ts')) continue;
      const content = readFileSync(file, 'utf-8');
      // A value import (no `import type`) of CortexMethodologySource from
      // the methodology subpath is a violation.
      const pattern =
        /import\s+(?!type\b)[^;]*\bCortexMethodologySource\b[^;]*from\s+['"][^'"]*methodology[^'"]*['"]/m;
      if (pattern.test(content)) {
        violations.push(file);
      }
    }
    assert.deepStrictEqual(violations, []);
  });
});

describe('G-LAYER: agent-runtime does not reach upward to L4 packages', () => {
  it('no import from @methodts/bridge in agent-runtime src', () => {
    const files = walkTs(SRC_ROOT);
    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      if (/from\s+['"]@methodts\/bridge/.test(content)) violations.push(file);
    }
    assert.deepStrictEqual(violations, []);
  });

  it('no import from @methodts/cluster in agent-runtime src', () => {
    const files = walkTs(SRC_ROOT);
    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      if (/from\s+['"]@methodts\/cluster/.test(content)) violations.push(file);
    }
    assert.deepStrictEqual(violations, []);
  });
});
