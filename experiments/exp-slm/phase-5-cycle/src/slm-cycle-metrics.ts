/**
 * SLM Cycle Metrics — per-cycle metric collection for SLM module performance tracking.
 *
 * Collects latency, confidence, parse success, fallback usage, and token counts
 * for each SLM module invocation across the cognitive cycle.
 */

// ── Types ───────────────────────────────────────────────────────

/** A single SLM module invocation metric. */
export interface SLMCycleMetric {
  cycle: number;
  module: 'monitor' | 'observer' | 'evaluator';
  latencyMs: number;
  confidence: number;
  parseSuccess: boolean;
  usedFallback: boolean;
  inputTokens: number;
  outputTokens: number;
}

/** Aggregated metrics for a complete experiment run. */
export interface SLMRunMetrics {
  cycles: SLMCycleMetric[];
  totalFallbacks: number;
  totalSlmCalls: number;
  fallbackRate: number;
  avgLatencyMs: number;
}

// ── Collector ───────────────────────────────────────────────────

export function createMetricsCollector(): {
  record(m: SLMCycleMetric): void;
  summarize(): SLMRunMetrics;
} {
  const cycles: SLMCycleMetric[] = [];

  return {
    record(m: SLMCycleMetric): void {
      cycles.push(m);
    },

    summarize(): SLMRunMetrics {
      const totalSlmCalls = cycles.length;
      const totalFallbacks = cycles.filter(c => c.usedFallback).length;
      const fallbackRate = totalSlmCalls > 0 ? totalFallbacks / totalSlmCalls : 0;
      const avgLatencyMs = totalSlmCalls > 0
        ? cycles.reduce((sum, c) => sum + c.latencyMs, 0) / totalSlmCalls
        : 0;

      return {
        cycles: [...cycles],
        totalFallbacks,
        totalSlmCalls,
        fallbackRate,
        avgLatencyMs,
      };
    },
  };
}
