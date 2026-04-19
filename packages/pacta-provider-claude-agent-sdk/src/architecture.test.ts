// SPDX-License-Identifier: Apache-2.0
/**
 * Architecture gates for @methodts/pacta-provider-claude-agent-sdk.
 *
 * G-PORT      — public exports match the symbol set frozen in PRD §S2/S3.
 * G-BOUNDARY  — no source file imports from `@t1/cortex-sdk` (Cortex
 *               specifics must live only in pacta-provider-cortex).
 * G-LAYER     — no upward imports of @methodts/runtime or @methodts/bridge.
 * G-COST      — placeholder until C-1 lands the cost-suppression defaults
 *               (Wave 0: assertion exists but allows the stub-throw shape).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      walk(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

const sourceFiles = walk(SRC);

describe('G-PORT: public exports match PRD §S2/S3', () => {
  it('index.ts exports the frozen surface symbols', async () => {
    const mod = await import('./index.js');
    assert.equal(typeof mod.claudeAgentSdkProvider, 'function', 'claudeAgentSdkProvider must be a function');
    // Type-only exports cannot be runtime-checked, but their presence is
    // enforced by tsc via the `export type` line in index.ts.
  });
});

describe('G-BOUNDARY: no @t1/cortex-sdk imports', () => {
  for (const file of sourceFiles) {
    const rel = file.replace(SRC, '').replace(/\\/g, '/');
    it(`${rel} does not import from @t1/cortex-sdk`, () => {
      const content = readFileSync(file, 'utf-8');
      assert.doesNotMatch(
        content,
        /from\s+['"]@t1\/cortex-sdk/,
        'pacta-provider-claude-agent-sdk must not import @t1/cortex-sdk; Cortex specifics live in pacta-provider-cortex',
      );
    });
  }
});

describe('G-LAYER: no upward layer imports', () => {
  const FORBIDDEN = ['@methodts/runtime', '@methodts/bridge', '@methodts/agent-runtime'];
  for (const file of sourceFiles) {
    const rel = file.replace(SRC, '').replace(/\\/g, '/');
    it(`${rel} has no upward layer imports`, () => {
      const content = readFileSync(file, 'utf-8');
      for (const pkg of FORBIDDEN) {
        const re = new RegExp(`from\\s+['"]${pkg.replace('/', '\\/')}`);
        assert.doesNotMatch(
          content,
          re,
          `${rel} must not import from ${pkg} (L3 → L4 violation)`,
        );
      }
    });
  }
});

describe('G-COST: cost-suppression defaults', () => {
  it('default provider applies tools=[], settingSources=[], agents={} per spike-2-overhead.md', async () => {
    // Build the provider with a minimal pact and confirm the SDK
    // options object that would be sent has all three suppression
    // knobs set to their cost-defending values. Removing any one of
    // these defaults is a regression — see spike-2-overhead.md for
    // the per-knob byte-cost analysis.
    const { claudeAgentSdkProvider, pactToSdkOptions } = await import('./index.js');
    const provider = claudeAgentSdkProvider({ apiKey: 'x' });
    assert.equal(provider.name, 'claude-agent-sdk');

    const { options } = pactToSdkOptions({
      pact: { mode: { type: 'oneshot' } },
      request: { prompt: 'test' },
      config: {},
      transportEnv: { ANTHROPIC_API_KEY: 'x' },
    });

    assert.deepEqual(options.tools, [], 'G-COST: tools must default to []');
    assert.deepEqual(options.settingSources, [], 'G-COST: settingSources must default to []');
    assert.deepEqual(options.agents, {}, 'G-COST: agents must default to {}');
  });
});
