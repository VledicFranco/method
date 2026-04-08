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

// TODO C-6: implement gate assertions using scanImports helper
// Stubs pass until domains exist — filled in during C-6 commission.

describe('G-PORT-SCANNER: scanner uses FileSystemPort, not node:fs', () => {
  it('placeholder — implement in C-6', () => {
    expect(true).toBe(true); // stub: replace with real import scan in C-6
  });
});

describe('G-PORT-QUERY: query engine uses EmbeddingClientPort, not HTTP clients', () => {
  it('placeholder — implement in C-6', () => {
    expect(true).toBe(true); // stub: replace with real import scan in C-6
  });
});

describe('G-BOUNDARY-CLI: cli imports only from ports/, not domain internals', () => {
  it('placeholder — implement in C-6', () => {
    expect(true).toBe(true); // stub: replace with real import scan in C-6
  });
});

describe('G-LAYER: fca-index does not import @method/mcp or @method/bridge', () => {
  it('placeholder — implement in C-6', () => {
    expect(true).toBe(true); // stub: replace with real import scan in C-6
  });
});
