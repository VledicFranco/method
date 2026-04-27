// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PKG_ROOT = resolve(import.meta.dirname, '..');
const CONTEXT_TOOLS_FILE = `${PKG_ROOT}/src/context-tools.ts`;

describe('G-BOUNDARY-MCP: context-tools.ts uses @fractal-co-design/fca-index public API only', () => {
  it('context-tools.ts does not import fca-index internals', () => {
    const content = readFileSync(CONTEXT_TOOLS_FILE, 'utf-8');
    const internalImportPattern = /from ['"][^'"]*packages\/fca-index\/src\//;
    expect(internalImportPattern.test(content)).toBe(false);
  });
});

describe('G-DR04: context-tools.ts handlers are thin wrappers', () => {
  it('context-tools.ts has no business logic (no conditional domain branches)', () => {
    const content = readFileSync(CONTEXT_TOOLS_FILE, 'utf-8');
    // DR-04: no domain-specific conditionals (e.g. checking specific query strings,
    // routing based on domain names, etc.)
    // This is a structure check: the file should not grow beyond ~350 lines.
    // Threshold was raised from 250 → 350 when context_detail tool was added (2026-04-09).
    // Each new tool adds ~40–50 lines (definition + handler). Review for business logic if exceeded.
    const lineCount = content.split('\n').length;
    expect(lineCount, 'context-tools.ts has grown beyond 350 lines — review for business logic').toBeLessThan(350);
  });
});
