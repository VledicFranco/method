// SPDX-License-Identifier: Apache-2.0
/**
 * Cost Governor — Canonical Types (PRD 051)
 *
 * L0 package: these types are consumed by bridge (L4), pacta (L3),
 * methodts (L2), and mcp (L3). No runtime deps — pure type definitions
 * with branded string types for compile-time safety.
 */

// ── Branded string types ────────────────────────────────────────

/** Opaque slot identifier — prevents string-swap bugs. */
export type SlotId = string & { readonly __brand: 'SlotId' };

/** Opaque account identifier — prevents string-swap bugs. */
export type AccountId = string & { readonly __brand: 'AccountId' };

// ── Provider classification ─────────────────────────────────────

export type ProviderClass = 'claude-cli' | 'anthropic-api' | 'ollama';

// ── Invocation signature (fingerprint for cost prediction) ──────

/**
 * Canonical fingerprint for an LLM invocation. Used as the lookup key
 * for historical cost/duration observations.
 *
 * Fields are canonicalized (capabilities sorted, size bucketed) so that
 * equivalent invocations produce identical signatures.
 */
export interface InvocationSignature {
  readonly methodologyId: string;
  /** Sorted, canonicalized capability names. */
  readonly capabilities: readonly string[];
  readonly model: string;
  readonly inputSizeBucket: 'xs' | 's' | 'm' | 'l' | 'xl';
}

// ── Cost estimation bands ───────────────────────────────────────

/**
 * Statistical cost/duration band with confidence metadata.
 * Used by CostOracle to express estimation uncertainty.
 */
export interface CostBand {
  readonly p50Usd: number;
  readonly p90Usd: number;
  readonly sampleCount: number;
  readonly confidence: 'low' | 'medium' | 'high';
}

// ── Account capacity & utilization ──────────────────────────────

/**
 * Static capacity declaration for a provider account.
 * Configured at boot; does not change at runtime.
 */
export interface AccountCapacity {
  readonly burstWindowMsgs: number;
  readonly weeklyMsgs: number;
  readonly concurrentCap: number;
}

/**
 * Runtime utilization snapshot for a single account.
 */
export interface AccountUtilization {
  readonly accountId: AccountId;
  readonly burstWindowUsedPct: number;
  readonly weeklyUsedPct: number;
  readonly inFlightCount: number;
  readonly backpressureActive: boolean;
  readonly status: 'ready' | 'saturated' | 'unavailable';
}
