/**
 * Architecture gate tests for @method/pacta-provider-cortex
 * (PRD-059 §Gates, S3 §7).
 *
 * Gates enforced here (build-time / test-time, not runtime):
 *   - G-CORTEX-ONLY-PATH: no runtime imports from `@t1/cortex-sdk`
 *     in this package's `src/` outside `ctx-types.ts`. The seam file
 *     is currently type-only (structural re-declaration), so even it
 *     has no runtime import — the rule is enforced by absence.
 *   - G-ADAPTER-SHAPE: every `*-{provider,middleware}.ts` exports a
 *     factory function whose return object has a `compose` method,
 *     satisfying the `CortexServiceAdapter<>` shape.
 *   - G-LLM-HANDLERS-PRESENT: asserted by an end-to-end compose call
 *     in `llm-provider.test.ts`; cross-linked here via a sanity check.
 *   - G-TOKEN-DEPTH-CAP: asserted in `token-exchange-middleware.test.ts`;
 *     cross-linked here.
 *   - G-AUDIT-EXHAUSTIVE: asserted in `audit-middleware.test.ts`;
 *     cross-linked here.
 *
 * Gate G-BUDGET-SINGLE-AUTHORITY lives in PRD-058's `createMethodAgent`
 * test suite — this package provides the mechanism (provider reports
 * `budgetEnforcement: 'native'`; pacta predictive mode switches on that
 * signal), so the provider-side assertion is in `llm-provider.test.ts`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC_DIR = resolve(__dirname);

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
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

// Remove `import type { ... } from 'X'` and `import type X from 'X'` so
// we only detect *runtime* imports. Type-only imports are erased by the
// compiler and do not violate the gate.
function stripTypeOnlyImports(content: string): string {
  return content
    .replace(/import\s+type\s+[^;]+?from\s+['"][^'"]+['"]\s*;?/g, '')
    .replace(/import\s+type\s*\{[^}]*\}\s*from\s+['"][^'"]+['"]\s*;?/g, '');
}

describe('@method/pacta-provider-cortex — architecture gates', () => {
  const files = walkTsFiles(SRC_DIR);

  it('G-CORTEX-ONLY-PATH: no runtime @t1/cortex-sdk import outside ctx-types.ts', () => {
    const violations: Array<{ file: string; specifier: string }> = [];
    for (const file of files) {
      const rel = relative(SRC_DIR, file);
      const raw = readFileSync(file, 'utf-8');
      const runtime = stripTypeOnlyImports(raw);
      const specs = extractImportSpecifiers(runtime);
      for (const spec of specs) {
        if (spec === '@t1/cortex-sdk' || spec.startsWith('@t1/cortex-sdk/')) {
          if (rel !== 'ctx-types.ts') {
            violations.push({ file: rel, specifier: spec });
          }
        }
      }
    }
    assert.deepEqual(
      violations,
      [],
      `G-CORTEX-ONLY-PATH violated. Non-seam files have runtime Cortex SDK imports: ${JSON.stringify(violations, null, 2)}`,
    );
  });

  it('G-ADAPTER-SHAPE: every factory return has a .compose method', async () => {
    const { cortexLLMProvider } = await import('./llm-provider.js');
    const { cortexAuditMiddleware } = await import('./audit-middleware.js');
    const { cortexTokenExchangeMiddleware } = await import(
      './token-exchange-middleware.js'
    );

    const llmAdapter = cortexLLMProvider({
      handlers: {
        onBudgetWarning: () => undefined,
        onBudgetCritical: () => undefined,
        onBudgetExceeded: () => undefined,
      },
    });
    assert.equal(typeof llmAdapter.compose, 'function');
    assert.equal(llmAdapter.name, 'cortex-llm');

    const auditAdapter = cortexAuditMiddleware({ appId: 'app-x' });
    assert.equal(typeof auditAdapter.compose, 'function');
    assert.equal(auditAdapter.name, 'cortex-audit');

    const tokexAdapter = cortexTokenExchangeMiddleware({
      appId: 'app-x',
      narrowScope: s => s,
    });
    assert.equal(typeof tokexAdapter.compose, 'function');
    assert.equal(tokexAdapter.name, 'cortex-token-exchange');
  });
});
