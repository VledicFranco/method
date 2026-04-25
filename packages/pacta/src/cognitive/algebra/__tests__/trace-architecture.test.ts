// SPDX-License-Identifier: Apache-2.0
/**
 * Architecture gate tests for PRD 058 trace surfaces.
 *
 *  - G-TRACE-EVENT-SHAPE: trace-events.ts exports pure types — no classes,
 *    no methods, no runtime values beyond type re-exports.
 *  - G-TRACE-CYCLE-SHAPE: trace-cycle.ts exports pure interfaces.
 *  - G-TRACE-SINK: TraceSink.onEvent is optional (additive over the existing
 *    onTrace) so legacy implementers compile unchanged.
 *  - G-TRACE-STORE: trace-store.ts has zero implementation imports — pure
 *    port; depends only on trace-cycle types.
 *
 *  @see docs/prds/058-hierarchical-trace-observability.md
 *  @see .method/sessions/fcd-plan-20260425-prd-058-trace/realize-plan.md
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// __tests__/trace-architecture.test.ts → algebra/
const ALGEBRA_DIR = resolve(__dirname, '..');

function read(file: string): string {
  return readFileSync(join(ALGEBRA_DIR, file), 'utf-8');
}

function extractImports(content: string): string[] {
  const out: string[] = [];
  const re = /from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) out.push(m[1]);
  return out;
}

describe('PRD 058 — trace surface gates', () => {
  it('G-TRACE-EVENT-SHAPE: trace-events.ts is pure types', () => {
    const src = read('trace-events.ts');
    // No class declarations
    assert.doesNotMatch(src, /\bclass\s+\w+/);
    // No standalone function declarations (allows interface methods)
    assert.doesNotMatch(src, /^export\s+function\s/m);
    assert.doesNotMatch(src, /^function\s/m);
    // No runtime const/let/var values besides type-only structures
    assert.doesNotMatch(src, /^export\s+(const|let|var)\s/m);
  });

  it('G-TRACE-CYCLE-SHAPE: trace-cycle.ts is pure types', () => {
    const src = read('trace-cycle.ts');
    assert.doesNotMatch(src, /\bclass\s+\w+/);
    assert.doesNotMatch(src, /^export\s+function\s/m);
    assert.doesNotMatch(src, /^function\s/m);
    assert.doesNotMatch(src, /^export\s+(const|let|var)\s/m);
  });

  it('G-TRACE-SINK: TraceSink.onEvent is optional (additive)', () => {
    const src = read('trace.ts');
    // Look for `onEvent?` in the TraceSink interface block.
    // The interface is on a single contiguous block; we just match the optional marker.
    assert.match(
      src,
      /onEvent\?\s*\(\s*event\s*:\s*TraceEvent\s*\)/,
      'TraceSink.onEvent must be declared optional with `?`',
    );
    // onTrace must remain non-optional for back-compat.
    assert.match(
      src,
      /onTrace\s*\(\s*record\s*:\s*TraceRecord\s*\)\s*:\s*void/,
      'TraceSink.onTrace must remain non-optional (back-compat)',
    );
  });

  it('G-TRACE-STORE: trace-store.ts has zero implementation imports', () => {
    const src = read('trace-store.ts');
    const imports = extractImports(src);
    // Allowed: same-directory type imports (trace-cycle, trace-events, etc.)
    // Disallowed: anything that pulls implementation code in.
    const forbiddenPrefixes = [
      '../',          // sibling cognitive subdirs (modules, engine, observability)
      '../../',       // parent of cognitive (pact.ts is OK only via algebra/trace.ts; not here)
      '@methodts/',   // any external method package
      'better-sqlite3',
      'fs',
      'node:fs',
      'node:path',
    ];
    for (const spec of imports) {
      for (const f of forbiddenPrefixes) {
        assert.ok(
          !spec.startsWith(f),
          `trace-store.ts must not import "${spec}" (forbidden prefix "${f}") — port stays pure`,
        );
      }
    }
    // Whitelist: only `./trace-cycle.js` and `./trace-events.js` (the latter is
    // optional; storeCycle takes CycleTrace which is in trace-cycle).
    for (const spec of imports) {
      assert.ok(
        spec === './trace-cycle.js' || spec === './trace-events.js' || spec.startsWith('./'),
        `trace-store.ts: unexpected import "${spec}"`,
      );
    }
  });
});
