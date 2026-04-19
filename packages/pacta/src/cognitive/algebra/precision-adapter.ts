// SPDX-License-Identifier: Apache-2.0
/**
 * Precision Adapter — continuous precision parameter for LLM effort allocation.
 *
 * Wraps an existing ProviderAdapter with a precision-based configuration layer.
 * Precision is a scalar in [0, 1] that determines how carefully the LLM should
 * process its input:
 *
 *   precision = 0 → fast, cheap, approximate (low tokens, high temperature, minimal prompt)
 *   precision = 1 → slow, expensive, thorough (high tokens, low temperature, thorough prompt)
 *
 * Driven by MonitorV2's prediction error: high error → high precision.
 *
 * Replaces the v1 discrete effort levels ('low' | 'medium' | 'high') with a
 * principled continuous mapping following Da Costa et al. (2024) and Shenhav's
 * EVC framework (2013).
 *
 * See docs/prds/035-cognitive-monitoring-control-v2.md §4 for full design.
 */

import type { ProviderAdapter, AdapterConfig, ProviderAdapterResult } from './provider-adapter.js';
import type { ReadonlyWorkspaceSnapshot } from './workspace-types.js';

// ── Precision Config ────────────────────────────────────────────

/** Precision-based configuration for LLM invocations. */
export interface PrecisionConfig {
  /** Token budget — higher precision = more tokens allowed. */
  maxOutputTokens: number;
  /** Temperature — higher precision = lower temperature (more deterministic). */
  temperature: number;
  /** System prompt depth — higher precision = more detailed instructions. */
  promptDepth: 'minimal' | 'standard' | 'thorough';
}

// ── Precision Adapter Config ────────────────────────────────────

/** Configuration for the PrecisionAdapter factory. */
export interface PrecisionAdapterConfig {
  /** Minimum token budget (at precision = 0). Default: 1024. */
  minTokens?: number;
  /** Maximum token budget (at precision = 1). Default: 8192. */
  maxTokens?: number;
  /** Temperature at precision = 0. Default: 1.0. */
  maxTemperature?: number;
  /** Temperature at precision = 1. Default: 0.3. */
  minTemperature?: number;
  /** Prompt depth thresholds: [minimal->standard, standard->thorough]. Default: [0.3, 0.7]. */
  depthThresholds?: [number, number];
}

// ── Precision-to-Config Mapping ─────────────────────────────────

/** Prompt depth prefix strings for each depth level. */
const DEPTH_PREFIXES: Record<PrecisionConfig['promptDepth'], string> = {
  minimal: 'Briefly: ',
  standard: '',
  thorough: 'Thoroughly and comprehensively: ',
};

/**
 * Map a precision value in [0, 1] to concrete LLM configuration.
 *
 * The mapping is linear for tokens and temperature, with discrete thresholds
 * for prompt depth. Precision is clamped to [0, 1].
 *
 * @param precision - Continuous precision parameter in [0, 1].
 * @param config - Optional overrides for the mapping parameters.
 * @returns Concrete LLM configuration derived from the precision value.
 */
export function precisionToConfig(
  precision: number,
  config?: PrecisionAdapterConfig,
): PrecisionConfig {
  // Clamp precision to [0, 1]
  const p = Math.max(0, Math.min(1, precision));

  const minTokens = config?.minTokens ?? 1024;
  const maxTokens = config?.maxTokens ?? 8192;
  const maxTemp = config?.maxTemperature ?? 1.0;
  const minTemp = config?.minTemperature ?? 0.3;
  const [dLow, dHigh] = config?.depthThresholds ?? [0.3, 0.7];

  return {
    maxOutputTokens: Math.round(minTokens + p * (maxTokens - minTokens)),
    temperature: maxTemp - p * (maxTemp - minTemp),
    promptDepth: p < dLow ? 'minimal' : p < dHigh ? 'standard' : 'thorough',
  };
}

// ── Precision Adapter Interface ─────────────────────────────────

/**
 * Extended ProviderAdapter that accepts a precision parameter.
 *
 * Wraps the standard ProviderAdapter interface with precision-based
 * configuration. The underlying adapter is not modified.
 */
export interface PrecisionProviderAdapter extends ProviderAdapter {
  /**
   * Invoke with explicit precision control.
   *
   * @param workspaceSnapshot - Current workspace state.
   * @param config - Base adapter configuration.
   * @param precision - Continuous precision parameter in [0, 1].
   * @returns Provider result with precision-adjusted configuration.
   */
  invokeWithPrecision(
    workspaceSnapshot: ReadonlyWorkspaceSnapshot,
    config: AdapterConfig,
    precision: number,
  ): Promise<ProviderAdapterResult>;
}

// ── Factory ─────────────────────────────────────────────────────

/**
 * Create a PrecisionAdapter that wraps an existing ProviderAdapter.
 *
 * The adapter intercepts invoke() calls and adjusts the pact template
 * based on the current precision value. When invoked via the standard
 * invoke() method, a default precision of 0.5 (standard) is used.
 * Use invokeWithPrecision() for explicit precision control.
 *
 * @param inner - The underlying ProviderAdapter to wrap.
 * @param adapterConfig - Optional precision mapping configuration.
 * @returns A PrecisionProviderAdapter that delegates to the inner adapter.
 */
export function createPrecisionAdapter(
  inner: ProviderAdapter,
  adapterConfig?: PrecisionAdapterConfig,
): PrecisionProviderAdapter {
  /**
   * Build an adjusted AdapterConfig by merging precision-derived settings
   * into the caller's config.
   */
  function buildConfig(config: AdapterConfig, precision: number): AdapterConfig {
    const pc = precisionToConfig(precision, adapterConfig);
    const depthPrefix = DEPTH_PREFIXES[pc.promptDepth];

    return {
      ...config,
      pactTemplate: {
        ...config.pactTemplate,
        budget: {
          ...((config.pactTemplate.budget ?? {}) as Record<string, unknown>),
          maxOutputTokens: pc.maxOutputTokens,
        },
      },
      systemPrompt: depthPrefix + (config.systemPrompt ?? ''),
    };
  }

  return {
    async invoke(
      workspaceSnapshot: ReadonlyWorkspaceSnapshot,
      config: AdapterConfig,
    ): Promise<ProviderAdapterResult> {
      // Default precision for standard invoke() — neutral midpoint
      const adjustedConfig = buildConfig(config, 0.5);
      return inner.invoke(workspaceSnapshot, adjustedConfig);
    },

    async invokeWithPrecision(
      workspaceSnapshot: ReadonlyWorkspaceSnapshot,
      config: AdapterConfig,
      precision: number,
    ): Promise<ProviderAdapterResult> {
      const adjustedConfig = buildConfig(config, precision);
      return inner.invoke(workspaceSnapshot, adjustedConfig);
    },
  };
}
