// SPDX-License-Identifier: Apache-2.0
/**
 * SLM types — PRD 057 cascade infrastructure.
 *
 * Pure type module. Concrete shapes for SLM inference results, metrics,
 * and config. Consumed by SLMInferer impls (HttpBridgeSLMRuntime,
 * SpilloverSLMRuntime), SLMAsAgentProvider, and CascadeProvider.
 */

/** Result of a single SLM inference call. */
export interface SLMInferenceResult {
  /** The model's text output. */
  readonly output: string;
  /** Calibrated confidence in [0, 1]. */
  readonly confidence: number;
  /** Wall-clock latency in milliseconds. */
  readonly inferenceMs: number;
  /** True iff the runtime escalated internally (e.g., spillover hit fallback). */
  readonly escalated: boolean;
  /** When `escalated`, the reason — "primary-unhealthy", "primary-error", etc. */
  readonly fallbackReason?: string;
}

/** Optional per-call SLM inference options. */
export interface SLMInferOptions {
  /** Generation length cap. */
  readonly maxLength?: number;
  /** HTTP-bridge timeout cap. */
  readonly timeoutMs?: number;
}

/**
 * Aggregated SLM-runtime metrics. Updated by every SLM call. Read-only
 * from the consumer side; runtimes own the increment logic.
 */
export interface SLMMetrics {
  readonly totalCalls: number;
  readonly escalatedCalls: number;
  readonly avgConfidence: number;
  readonly avgInferenceMs: number;
}

/**
 * Per-tier metrics within a CascadeProvider. Keyed on tier name. The
 * cascade resets these on `resetMetrics()`.
 */
export interface CascadeTierMetrics {
  readonly invocations: number;
  readonly accepted: number;
  readonly avgLatencyMs: number;
  readonly avgConfidence: number | null;
}

/** Snapshot of cascade metrics across all tiers. */
export interface CascadeMetrics {
  readonly perTier: ReadonlyMap<string, CascadeTierMetrics>;
}

/** Health states for a Spillover runtime. */
export type HealthState = 'healthy' | 'degraded' | 'unknown';

/** Active health probe. Returns true iff the primary is reachable. */
export type HealthProbe = () => Promise<boolean>;

/** Routing-provider metrics (per-tier dispatch counts + latency). */
export interface RoutingMetrics {
  readonly perTier: ReadonlyMap<
    string,
    {
      dispatched: number;
      avgLatencyMs: number;
    }
  >;
  readonly defaultFallbacks: number;
}

/** Spillover-runtime metrics. */
export interface SpilloverMetrics {
  readonly primaryHandled: number;
  readonly fallbackHandled: number;
  readonly primaryFailures: number;
  readonly healthProbeFailures: number;
  readonly lastHealthChangeAt: number;
}
