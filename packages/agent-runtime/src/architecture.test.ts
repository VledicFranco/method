/**
 * Architecture gates — source-scan tests for PRD-058 §6.6.
 *
 *   - G-BOUNDARY-NO-CORTEX-VALUE-IMPORT — forbid runtime imports from
 *     `@cortex/*` or `@t1/cortex-sdk`; only `import type` is allowed.
 *   - G-LAYER — agent-runtime is L3; forbid imports from `@method/bridge` (L4).
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

describe('G-LAYER: agent-runtime does not reach upward to L4 packages', () => {
  it('no import from @method/bridge in agent-runtime src', () => {
    const files = walkTs(SRC_ROOT);
    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      if (/from\s+['"]@method\/bridge/.test(content)) violations.push(file);
    }
    assert.deepStrictEqual(violations, []);
  });

  it('no import from @method/cluster in agent-runtime src', () => {
    const files = walkTs(SRC_ROOT);
    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      if (/from\s+['"]@method\/cluster/.test(content)) violations.push(file);
    }
    assert.deepStrictEqual(violations, []);
  });
});
