/**
 * SLM Provider Adapter — decorator that routes cognitive module LLM calls
 * through a trained SLM, falling back to a frontier LLM when needed.
 *
 * Two defense lines prevent bad SLM outputs from reaching the cognitive cycle:
 *   Line 1 — DSL parse failure: if the SLM output is not valid Monitor DSL,
 *            the call is routed to the fallback LLM.
 *   Line 2 — Low confidence: if the SLM's confidence score is below the
 *            escalation threshold, the call is routed to the fallback LLM.
 *
 * When the SLM succeeds, cost is $0 (local inference) and token counts
 * reflect the SLM's own accounting.
 */

import type {
  ProviderAdapter,
  ProviderAdapterResult,
  ReadonlyWorkspaceSnapshot,
  AdapterConfig,
  MonitorReport,
  TokenUsage,
  CostReport,
} from '../../phase-1-llm-monitor/src/types.js';
import type { SLMInference, SLMResult } from './slm-inference.js';

// ── Metrics ────────────────────────────────────────────────────

/** Aggregate metrics tracked by the SLM adapter. */
export interface SLMAdapterMetrics {
  totalCalls: number;
  slmHandled: number;
  fallbackCalls: number;
  parseFailures: number;
  lowConfidenceEscalations: number;
  /** fallbackCalls / totalCalls (0 if no calls yet). */
  escalationRate: number;
}

// ── Config ─────────────────────────────────────────────────────

export interface SLMProviderAdapterConfig {
  slm: SLMInference;
  fallback: ProviderAdapter;
  parseDsl: (dsl: string) => MonitorReport | null;
  encodeDsl: (report: MonitorReport) => string;
  /** Confidence below which the adapter falls back to the frontier LLM. */
  escalationThreshold: number;
}

// ── Factory ────────────────────────────────────────────────────

/**
 * Create a ProviderAdapter decorator that attempts SLM inference first
 * and falls back to a frontier LLM when the SLM cannot produce a
 * reliable result.
 *
 * Returns both the adapter and a function to retrieve current metrics.
 */
export function createSLMProviderAdapter(
  config: SLMProviderAdapterConfig,
): ProviderAdapter & { getMetrics(): SLMAdapterMetrics } {
  const { slm, fallback, parseDsl, escalationThreshold } = config;

  // Mutable metrics state
  const metrics: Omit<SLMAdapterMetrics, 'escalationRate'> = {
    totalCalls: 0,
    slmHandled: 0,
    fallbackCalls: 0,
    parseFailures: 0,
    lowConfidenceEscalations: 0,
  };

  function getMetrics(): SLMAdapterMetrics {
    return {
      ...metrics,
      escalationRate: metrics.totalCalls > 0
        ? metrics.fallbackCalls / metrics.totalCalls
        : 0,
    };
  }

  async function invoke(
    workspaceSnapshot: ReadonlyWorkspaceSnapshot,
    adapterConfig: AdapterConfig,
  ): Promise<ProviderAdapterResult> {
    metrics.totalCalls++;

    // ── Step 1: Extract the content string from the workspace snapshot ──
    const inputText = workspaceSnapshot
      .map((entry) => String(entry.content))
      .join('\n');

    // ── Step 2: Call the SLM ──
    let slmResult: SLMResult;
    try {
      slmResult = await slm.generate(inputText);
    } catch {
      // SLM call failed entirely — go to fallback
      metrics.fallbackCalls++;
      return fallback.invoke(workspaceSnapshot, adapterConfig);
    }

    // ── Step 3: Line 1 defense — DSL parse check ──
    const parsed = parseDsl(slmResult.tokens);
    if (parsed === null) {
      metrics.parseFailures++;
      metrics.fallbackCalls++;
      return fallback.invoke(workspaceSnapshot, adapterConfig);
    }

    // ── Step 4: Line 2 defense — confidence check ──
    if (slmResult.confidence < escalationThreshold) {
      metrics.lowConfidenceEscalations++;
      metrics.fallbackCalls++;
      return fallback.invoke(workspaceSnapshot, adapterConfig);
    }

    // ── Step 5: SLM success — build result ──
    metrics.slmHandled++;

    const usage: TokenUsage = {
      inputTokens: slmResult.inputTokenCount,
      outputTokens: slmResult.outputTokenCount,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: slmResult.inputTokenCount + slmResult.outputTokenCount,
    };

    const cost: CostReport = {
      totalUsd: 0,
      perModel: {
        [`slm:${slm.modelId}`]: {
          tokens: usage,
          costUsd: 0,
        },
      },
    };

    // Output the parsed MonitorReport as JSON string
    return {
      output: JSON.stringify(parsed),
      usage,
      cost,
    };
  }

  return { invoke, getMetrics };
}
