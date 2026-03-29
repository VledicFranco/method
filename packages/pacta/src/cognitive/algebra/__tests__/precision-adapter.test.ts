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

import { describe, it, expect, vi } from 'vitest';
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

    expect(result).toEqual({
      maxOutputTokens: 1024,
      temperature: 1.0,
      promptDepth: 'minimal',
    });
  });

  it('maps 1.0 to thorough config (AC-09)', () => {
    const result = precisionToConfig(1.0);

    expect(result.maxOutputTokens).toBe(8192);
    expect(result.temperature).toBeCloseTo(0.3, 5);
    expect(result.promptDepth).toBe('thorough');
  });

  it('maps 0.5 to standard config', () => {
    const result = precisionToConfig(0.5);

    // Tokens: 1024 + 0.5 * (8192 - 1024) = 1024 + 3584 = 4608
    expect(result.maxOutputTokens).toBe(4608);
    // Temperature: 1.0 - 0.5 * (1.0 - 0.3) = 1.0 - 0.35 = 0.65
    expect(result.temperature).toBeCloseTo(0.65, 5);
    // Prompt depth: 0.5 >= 0.3 and 0.5 < 0.7 → standard
    expect(result.promptDepth).toBe('standard');
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
    expect(minResult).toEqual({
      maxOutputTokens: 512,
      temperature: 0.8,
      promptDepth: 'minimal',
    });

    // At precision 1.0 with custom config
    const maxResult = precisionToConfig(1.0, customConfig);
    expect(maxResult.maxOutputTokens).toBe(4096);
    expect(maxResult.temperature).toBeCloseTo(0.1, 5);
    expect(maxResult.promptDepth).toBe('thorough');

    // At precision 0.5 with custom config: 0.4 <= 0.5 < 0.8 → standard
    const midResult = precisionToConfig(0.5, customConfig);
    expect(midResult.promptDepth).toBe('standard');

    // At precision 0.35 with custom config: 0.35 < 0.4 → minimal
    const lowResult = precisionToConfig(0.35, customConfig);
    expect(lowResult.promptDepth).toBe('minimal');
  });

  it('clamps precision below 0 to 0', () => {
    const result = precisionToConfig(-0.5);
    expect(result).toEqual({
      maxOutputTokens: 1024,
      temperature: 1.0,
      promptDepth: 'minimal',
    });
  });

  it('clamps precision above 1 to 1', () => {
    const result = precisionToConfig(1.5);
    expect(result.maxOutputTokens).toBe(8192);
    expect(result.temperature).toBeCloseTo(0.3, 5);
    expect(result.promptDepth).toBe('thorough');
  });
});

describe('createPrecisionAdapter', () => {
  it('wraps ProviderAdapter — invoke() delegates correctly', async () => {
    const mockAdapter = createMockAdapter();
    const precisionAdapter = createPrecisionAdapter(mockAdapter);

    const result = await precisionAdapter.invoke(EMPTY_SNAPSHOT, BASE_CONFIG);

    // Verify delegation happened
    expect(mockAdapter.calls).toHaveLength(1);
    expect(result.output).toBe('mock response');
    expect(result.usage.totalTokens).toBe(150);
  });

  it('adjusts pact template based on precision value', async () => {
    const mockAdapter = createMockAdapter();
    const precisionAdapter = createPrecisionAdapter(mockAdapter);

    // Invoke with high precision (1.0)
    await precisionAdapter.invokeWithPrecision(EMPTY_SNAPSHOT, BASE_CONFIG, 1.0);

    expect(mockAdapter.calls).toHaveLength(1);
    const passedConfig = mockAdapter.calls[0].config;

    // Should have maxOutputTokens set in budget
    expect(passedConfig.pactTemplate.budget).toBeDefined();
    expect((passedConfig.pactTemplate.budget as Record<string, unknown>).maxOutputTokens).toBe(8192);

    // Should have thorough prefix in system prompt
    expect(passedConfig.systemPrompt).toContain('Thoroughly and comprehensively: ');
    expect(passedConfig.systemPrompt).toContain('test prompt');

    // Now invoke with low precision (0.0)
    await precisionAdapter.invokeWithPrecision(EMPTY_SNAPSHOT, BASE_CONFIG, 0.0);

    const lowConfig = mockAdapter.calls[1].config;
    expect((lowConfig.pactTemplate.budget as Record<string, unknown>).maxOutputTokens).toBe(1024);
    expect(lowConfig.systemPrompt).toContain('Briefly: ');
    expect(lowConfig.systemPrompt).toContain('test prompt');
  });

  it('standard invoke() uses default precision of 0.5', async () => {
    const mockAdapter = createMockAdapter();
    const precisionAdapter = createPrecisionAdapter(mockAdapter);

    await precisionAdapter.invoke(EMPTY_SNAPSHOT, BASE_CONFIG);

    const passedConfig = mockAdapter.calls[0].config;
    // At precision 0.5: tokens = 4608, depth = standard (empty prefix)
    expect((passedConfig.pactTemplate.budget as Record<string, unknown>).maxOutputTokens).toBe(4608);
    // Standard depth has empty prefix, so systemPrompt should just be the original
    expect(passedConfig.systemPrompt).toBe('test prompt');
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
    expect(passedConfig.pactTemplate.mode).toEqual({ type: 'oneshot' });
    // Original streaming preserved
    expect(passedConfig.pactTemplate.streaming).toBe(true);
    // Budget added
    expect(passedConfig.pactTemplate.budget).toBeDefined();
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
    expect((passedConfig.pactTemplate.budget as Record<string, unknown>).maxOutputTokens).toBe(256);
    expect(passedConfig.systemPrompt).toContain('Briefly: ');
  });
});
