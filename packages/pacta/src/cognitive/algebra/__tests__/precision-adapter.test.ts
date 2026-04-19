// SPDX-License-Identifier: Apache-2.0
/**
 * Precision Adapter Tests — 6 scenarios per PRD 035 Phase 2.
 *
 * Validates:
 * 1. precisionToConfig maps 0.0 to minimal config (1024 tokens, 1.0 temp, 'minimal')
 * 2. precisionToConfig maps 1.0 to thorough config (8192 tokens, 0.3 temp, 'thorough')
 * 3. precisionToConfig maps 0.5 to standard config
 * 4. PrecisionAdapter wraps ProviderAdapter — invoke() delegates correctly
 * 5. PrecisionAdapter adjusts pact template based on precision value
 * 6. Custom PrecisionAdapterConfig overrides defaults
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  precisionToConfig,
  createPrecisionAdapter,
  type PrecisionAdapterConfig,
} from '../precision-adapter.js';
import type { ProviderAdapter, AdapterConfig, ProviderAdapterResult } from '../provider-adapter.js';
import type { ReadonlyWorkspaceSnapshot } from '../workspace-types.js';

// ── Test Helpers ────────────────────────────────────────────────

/** Create a mock ProviderAdapter that records calls. */
function createMockAdapter(): ProviderAdapter & {
  calls: Array<{ snapshot: ReadonlyWorkspaceSnapshot; config: AdapterConfig }>;
} {
  const calls: Array<{ snapshot: ReadonlyWorkspaceSnapshot; config: AdapterConfig }> = [];

  return {
    calls,
    async invoke(
      snapshot: ReadonlyWorkspaceSnapshot,
      config: AdapterConfig,
    ): Promise<ProviderAdapterResult> {
      calls.push({ snapshot, config });
      return {
        output: 'mock response',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 150,
        },
        cost: { totalUsd: 0.001, perModel: {} },
      };
    },
  };
}

/** Minimal workspace snapshot for testing. */
const EMPTY_SNAPSHOT: ReadonlyWorkspaceSnapshot = [];

/** Base adapter config for testing. */
const BASE_CONFIG: AdapterConfig = {
  pactTemplate: { mode: { type: 'oneshot' } },
  systemPrompt: 'test prompt',
};

// ── Tests ───────────────────────────────────────────────────────

describe('precisionToConfig', () => {
  it('maps 0.0 to minimal config (AC-09)', () => {
    const result = precisionToConfig(0.0);

    assert.deepStrictEqual(result, {
      maxOutputTokens: 1024,
      temperature: 1.0,
      promptDepth: 'minimal',
    });
  });

  it('maps 1.0 to thorough config (AC-09)', () => {
    const result = precisionToConfig(1.0);

    assert.strictEqual(result.maxOutputTokens, 8192);
    assert.ok(Math.abs(result.temperature - 0.3) < 1e-5);
    assert.strictEqual(result.promptDepth, 'thorough');
  });

  it('maps 0.5 to standard config', () => {
    const result = precisionToConfig(0.5);

    // Tokens: 1024 + 0.5 * (8192 - 1024) = 1024 + 3584 = 4608
    assert.strictEqual(result.maxOutputTokens, 4608);
    // Temperature: 1.0 - 0.5 * (1.0 - 0.3) = 1.0 - 0.35 = 0.65
    assert.ok(Math.abs(result.temperature - 0.65) < 1e-5);
    // Prompt depth: 0.5 >= 0.3 and 0.5 < 0.7 → standard
    assert.strictEqual(result.promptDepth, 'standard');
  });

  it('custom PrecisionAdapterConfig overrides defaults', () => {
    const customConfig: PrecisionAdapterConfig = {
      minTokens: 512,
      maxTokens: 4096,
      maxTemperature: 0.8,
      minTemperature: 0.1,
      depthThresholds: [0.4, 0.8],
    };

    // At precision 0.0 with custom config
    const minResult = precisionToConfig(0.0, customConfig);
    assert.deepStrictEqual(minResult, {
      maxOutputTokens: 512,
      temperature: 0.8,
      promptDepth: 'minimal',
    });

    // At precision 1.0 with custom config
    const maxResult = precisionToConfig(1.0, customConfig);
    assert.strictEqual(maxResult.maxOutputTokens, 4096);
    assert.ok(Math.abs(maxResult.temperature - 0.1) < 1e-5);
    assert.strictEqual(maxResult.promptDepth, 'thorough');

    // At precision 0.5 with custom config: 0.4 <= 0.5 < 0.8 → standard
    const midResult = precisionToConfig(0.5, customConfig);
    assert.strictEqual(midResult.promptDepth, 'standard');

    // At precision 0.35 with custom config: 0.35 < 0.4 → minimal
    const lowResult = precisionToConfig(0.35, customConfig);
    assert.strictEqual(lowResult.promptDepth, 'minimal');
  });

  it('clamps precision below 0 to 0', () => {
    const result = precisionToConfig(-0.5);
    assert.deepStrictEqual(result, {
      maxOutputTokens: 1024,
      temperature: 1.0,
      promptDepth: 'minimal',
    });
  });

  it('clamps precision above 1 to 1', () => {
    const result = precisionToConfig(1.5);
    assert.strictEqual(result.maxOutputTokens, 8192);
    assert.ok(Math.abs(result.temperature - 0.3) < 1e-5);
    assert.strictEqual(result.promptDepth, 'thorough');
  });
});

describe('createPrecisionAdapter', () => {
  it('wraps ProviderAdapter — invoke() delegates correctly', async () => {
    const mockAdapter = createMockAdapter();
    const precisionAdapter = createPrecisionAdapter(mockAdapter);

    const result = await precisionAdapter.invoke(EMPTY_SNAPSHOT, BASE_CONFIG);

    // Verify delegation happened
    assert.strictEqual(mockAdapter.calls.length, 1);
    assert.strictEqual(result.output, 'mock response');
    assert.strictEqual(result.usage.totalTokens, 150);
  });

  it('adjusts pact template based on precision value', async () => {
    const mockAdapter = createMockAdapter();
    const precisionAdapter = createPrecisionAdapter(mockAdapter);

    // Invoke with high precision (1.0)
    await precisionAdapter.invokeWithPrecision(EMPTY_SNAPSHOT, BASE_CONFIG, 1.0);

    assert.strictEqual(mockAdapter.calls.length, 1);
    const passedConfig = mockAdapter.calls[0].config;

    // Should have maxOutputTokens set in budget
    assert.notStrictEqual(passedConfig.pactTemplate.budget, undefined);
    assert.strictEqual((passedConfig.pactTemplate.budget as Record<string, unknown>).maxOutputTokens, 8192);

    // Should have thorough prefix in system prompt
    assert.ok(passedConfig.systemPrompt!.includes('Thoroughly and comprehensively: '));
    assert.ok(passedConfig.systemPrompt!.includes('test prompt'));

    // Now invoke with low precision (0.0)
    await precisionAdapter.invokeWithPrecision(EMPTY_SNAPSHOT, BASE_CONFIG, 0.0);

    const lowConfig = mockAdapter.calls[1].config;
    assert.strictEqual((lowConfig.pactTemplate.budget as Record<string, unknown>).maxOutputTokens, 1024);
    assert.ok(lowConfig.systemPrompt!.includes('Briefly: '));
    assert.ok(lowConfig.systemPrompt!.includes('test prompt'));
  });

  it('standard invoke() uses default precision of 0.5', async () => {
    const mockAdapter = createMockAdapter();
    const precisionAdapter = createPrecisionAdapter(mockAdapter);

    await precisionAdapter.invoke(EMPTY_SNAPSHOT, BASE_CONFIG);

    const passedConfig = mockAdapter.calls[0].config;
    // At precision 0.5: tokens = 4608, depth = standard (empty prefix)
    assert.strictEqual((passedConfig.pactTemplate.budget as Record<string, unknown>).maxOutputTokens, 4608);
    // Standard depth has empty prefix, so systemPrompt should just be the original
    assert.strictEqual(passedConfig.systemPrompt, 'test prompt');
  });

  it('preserves original pact template fields', async () => {
    const mockAdapter = createMockAdapter();
    const precisionAdapter = createPrecisionAdapter(mockAdapter);

    const configWithExtra: AdapterConfig = {
      pactTemplate: {
        mode: { type: 'oneshot' },
        streaming: true,
      },
      systemPrompt: 'original prompt',
    };

    await precisionAdapter.invokeWithPrecision(EMPTY_SNAPSHOT, configWithExtra, 0.8);

    const passedConfig = mockAdapter.calls[0].config;
    // Original mode preserved
    assert.deepStrictEqual(passedConfig.pactTemplate.mode, { type: 'oneshot' });
    // Original streaming preserved
    assert.strictEqual(passedConfig.pactTemplate.streaming, true);
    // Budget added
    assert.notStrictEqual(passedConfig.pactTemplate.budget, undefined);
  });

  it('uses custom PrecisionAdapterConfig for mapping', async () => {
    const mockAdapter = createMockAdapter();
    const customConfig: PrecisionAdapterConfig = {
      minTokens: 256,
      maxTokens: 2048,
      maxTemperature: 0.9,
      minTemperature: 0.1,
      depthThresholds: [0.2, 0.6],
    };
    const precisionAdapter = createPrecisionAdapter(mockAdapter, customConfig);

    await precisionAdapter.invokeWithPrecision(EMPTY_SNAPSHOT, BASE_CONFIG, 0.0);

    const passedConfig = mockAdapter.calls[0].config;
    assert.strictEqual((passedConfig.pactTemplate.budget as Record<string, unknown>).maxOutputTokens, 256);
    assert.ok(passedConfig.systemPrompt!.includes('Briefly: '));
  });
});
