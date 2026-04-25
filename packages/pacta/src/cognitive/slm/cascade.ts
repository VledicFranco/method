// SPDX-License-Identifier: Apache-2.0
/**
 * CascadeProvider — N-tier confidence-gated AgentProvider — PRD 057 Surface 1.
 *
 * Wraps a list of `CascadeTier`s. Each call tries tiers in registration
 * order; the first whose `accept` predicate returns true (or whose
 * `accept` is undefined) handles the call. Otherwise the cascade
 * escalates to the next tier. The terminal tier should have
 * `accept: undefined` — it always handles when reached.
 *
 * Implements `AgentProvider` so it composes freely with middleware
 * (budgetEnforcer, outputValidator, throttler, tracingMiddleware) and
 * with `RoutingProvider` (PRD 057 Surface 2).
 *
 * @see docs/prds/057-slm-cascade-infrastructure.md (Surface 1)
 */

import type { AgentProvider, ProviderCapabilities } from '../../ports/agent-provider.js';
import type { Pact, AgentRequest, AgentResult } from '../../pact.js';
import type { CascadeMetrics, CascadeTierMetrics } from './types.js';

/**
 * Predicate run on a tier's `AgentResult` to decide whether the tier
 * keeps the result (`true`) or the cascade escalates (`false`).
 */
export type TierAcceptFn = (result: AgentResult<unknown>) => boolean;

/** One tier in a cascade. */
export interface CascadeTier {
  /** Unique within a cascade — used in metrics + logs. */
  readonly name: string;
  /** Provider for this tier. SLM tiers wrap via SLMAsAgentProvider. */
  readonly provider: AgentProvider;
  /**
   * Predicate run on this tier's response. `undefined` = always accept
   * (terminal tier or tier with no escalation signal).
   */
  readonly accept?: TierAcceptFn;
}

/**
 * Construct a `TierAcceptFn` that accepts iff
 * `result.confidence !== undefined && result.confidence >= threshold`.
 * `confidence === undefined` always rejects (escalates) — appropriate
 * for tiers configured to require a confidence signal.
 */
export function confidenceAbove(threshold: number): TierAcceptFn {
  if (threshold < 0 || threshold > 1 || Number.isNaN(threshold)) {
    throw new RangeError(`confidenceAbove threshold must be in [0, 1]; got ${threshold}`);
  }
  return (result) =>
    typeof result.confidence === 'number' && result.confidence >= threshold;
}

interface MutableTierMetrics {
  invocations: number;
  accepted: number;
  totalLatencyMs: number;
  totalConfidence: number;
  confidenceCount: number;
}

export class CascadeProvider implements AgentProvider {
  readonly name = 'cascade';
  private readonly tiers: readonly CascadeTier[];
  private readonly metricsByTier = new Map<string, MutableTierMetrics>();

  constructor(tiers: readonly CascadeTier[]) {
    if (tiers.length === 0) {
      throw new Error('CascadeProvider requires at least one tier');
    }
    const seen = new Set<string>();
    for (const t of tiers) {
      if (seen.has(t.name)) {
        throw new Error(`Duplicate tier name in cascade: ${t.name}`);
      }
      seen.add(t.name);
      this.metricsByTier.set(t.name, {
        invocations: 0,
        accepted: 0,
        totalLatencyMs: 0,
        totalConfidence: 0,
        confidenceCount: 0,
      });
    }
    this.tiers = tiers;
  }

  capabilities(): ProviderCapabilities {
    // Cascade exposes the *intersection* of its tiers' capabilities — any
    // tier might be selected, so the cascade can only promise what every
    // tier supports. Defaults to the most conservative.
    const caps: ProviderCapabilities = {
      modes: [],
      streaming: false,
      resumable: false,
      budgetEnforcement: 'none',
      outputValidation: 'none',
      toolModel: 'none',
    };
    if (this.tiers.length === 0) return caps;
    // Intersect modes: keep only modes every tier supports.
    const tierCaps = this.tiers.map((t) => t.provider.capabilities());
    const allModes = new Set(tierCaps[0]!.modes);
    for (let i = 1; i < tierCaps.length; i++) {
      const tm = new Set(tierCaps[i]!.modes);
      for (const m of allModes) if (!tm.has(m)) allModes.delete(m);
    }
    caps.modes = Array.from(allModes);
    return caps;
  }

  async invoke<T>(pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>> {
    let lastResult: AgentResult<T> | undefined;
    let lastError: unknown;
    for (let i = 0; i < this.tiers.length; i++) {
      const tier = this.tiers[i]!;
      const metrics = this.metricsByTier.get(tier.name)!;
      metrics.invocations++;
      const start = Date.now();
      try {
        const result = await tier.provider.invoke(pact, request);
        const elapsed = Date.now() - start;
        metrics.totalLatencyMs += elapsed;
        if (typeof result.confidence === 'number') {
          metrics.totalConfidence += result.confidence;
          metrics.confidenceCount++;
        }
        lastResult = result;
        if (tier.accept === undefined || tier.accept(result)) {
          metrics.accepted++;
          return result;
        }
        // accept = false → escalate to next tier.
      } catch (e) {
        const elapsed = Date.now() - start;
        metrics.totalLatencyMs += elapsed;
        lastError = e;
        // On error, fall through to next tier. If we exhaust, rethrow last.
      }
    }
    // No tier accepted; return the last result if any, else throw.
    if (lastResult) {
      // Mark the terminal tier (last) as accepted since we returned its result.
      const terminal = this.metricsByTier.get(this.tiers[this.tiers.length - 1]!.name)!;
      terminal.accepted++;
      return lastResult;
    }
    throw lastError ?? new Error('CascadeProvider: all tiers failed and none returned a result');
  }

  /** Snapshot per-tier metrics. */
  get metrics(): CascadeMetrics {
    const out = new Map<string, CascadeTierMetrics>();
    for (const [name, m] of this.metricsByTier) {
      out.set(name, {
        invocations: m.invocations,
        accepted: m.accepted,
        avgLatencyMs: m.invocations > 0 ? m.totalLatencyMs / m.invocations : 0,
        avgConfidence: m.confidenceCount > 0 ? m.totalConfidence / m.confidenceCount : null,
      });
    }
    return { perTier: out };
  }

  /** Reset all per-tier metric counters. */
  resetMetrics(): void {
    for (const m of this.metricsByTier.values()) {
      m.invocations = 0;
      m.accepted = 0;
      m.totalLatencyMs = 0;
      m.totalConfidence = 0;
      m.confidenceCount = 0;
    }
  }
}
