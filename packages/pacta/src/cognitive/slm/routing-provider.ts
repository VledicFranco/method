// SPDX-License-Identifier: Apache-2.0
/**
 * RoutingProvider — pre-call dispatch via TierRouter — PRD 057 Wave 3.
 *
 * Consults a `TierRouter` to pick a tier name BEFORE invoking any
 * provider. Looks the name up in a registry of `AgentProvider`s and
 * dispatches. On unknown tier names or `TierRouterError`, falls back
 * to a configured default tier. Tracks per-tier dispatch counts and
 * average latency.
 *
 * Pairs with `CascadeProvider` (post-hoc escalation) to give callers
 * the full input → routing → cascade story.
 *
 * @see docs/prds/057-slm-cascade-infrastructure.md (Wave 3)
 */

import type { AgentProvider, ProviderCapabilities } from '../../ports/agent-provider.js';
import type { TierRouter } from '../../ports/tier-router.js';
import type { Pact, AgentRequest, AgentResult } from '../../pact.js';
import type { RoutingMetrics } from './types.js';
import { TierRouterError } from '../../ports/tier-router.js';

export interface RoutingProviderConfig {
  readonly router: TierRouter;
  readonly providers: ReadonlyMap<string, AgentProvider>;
  /** Fallback name when router throws TierRouterError or returns an unknown tier. Must be in providers. */
  readonly defaultTier: string;
}

interface MutableTierMetrics {
  dispatched: number;
  totalLatencyMs: number;
}

export class RoutingProvider implements AgentProvider {
  readonly name = 'routing';
  private readonly router: TierRouter;
  private readonly providers: ReadonlyMap<string, AgentProvider>;
  private readonly defaultTier: string;
  private readonly metricsByTier = new Map<string, MutableTierMetrics>();
  private defaultFallbacks = 0;

  constructor(config: RoutingProviderConfig) {
    if (config.providers.size === 0) {
      throw new Error('RoutingProvider requires at least one provider');
    }
    if (!config.providers.has(config.defaultTier)) {
      throw new Error(
        `RoutingProvider: defaultTier "${config.defaultTier}" is not in providers map`,
      );
    }
    this.router = config.router;
    this.providers = config.providers;
    this.defaultTier = config.defaultTier;
    for (const name of config.providers.keys()) {
      this.metricsByTier.set(name, { dispatched: 0, totalLatencyMs: 0 });
    }
  }

  capabilities(): ProviderCapabilities {
    // Mirror CascadeProvider: any provider may be selected, so expose the
    // intersection of modes. Conservative defaults for everything else.
    const caps: ProviderCapabilities = {
      modes: [],
      streaming: false,
      resumable: false,
      budgetEnforcement: 'none',
      outputValidation: 'none',
      toolModel: 'none',
    };
    const list = Array.from(this.providers.values());
    if (list.length === 0) return caps;
    const all = list.map((p) => p.capabilities());
    const allModes = new Set(all[0]!.modes);
    for (let i = 1; i < all.length; i++) {
      const tm = new Set(all[i]!.modes);
      for (const m of allModes) if (!tm.has(m)) allModes.delete(m);
    }
    caps.modes = Array.from(allModes);
    return caps;
  }

  async invoke<T>(pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>> {
    let tierName: string;
    try {
      tierName = await this.router.select(pact, request);
    } catch (e) {
      if (e instanceof TierRouterError) {
        tierName = this.defaultTier;
        this.defaultFallbacks++;
      } else {
        throw e;
      }
    }
    let provider = this.providers.get(tierName);
    if (provider === undefined) {
      // Unknown tier name from router — fall back to default.
      this.defaultFallbacks++;
      tierName = this.defaultTier;
      provider = this.providers.get(this.defaultTier)!;
    }
    const metrics = this.metricsByTier.get(tierName)!;
    const start = Date.now();
    try {
      const result = await provider.invoke(pact, request);
      const elapsed = Date.now() - start;
      metrics.dispatched++;
      metrics.totalLatencyMs += elapsed;
      return result;
    } catch (e) {
      const elapsed = Date.now() - start;
      metrics.dispatched++;
      metrics.totalLatencyMs += elapsed;
      throw e;
    }
  }

  /** Snapshot of routing metrics. */
  get metrics(): RoutingMetrics {
    const out = new Map<string, { dispatched: number; avgLatencyMs: number }>();
    for (const [name, m] of this.metricsByTier) {
      out.set(name, {
        dispatched: m.dispatched,
        avgLatencyMs: m.dispatched > 0 ? m.totalLatencyMs / m.dispatched : 0,
      });
    }
    return { perTier: out, defaultFallbacks: this.defaultFallbacks };
  }

  /** Reset all per-tier counters. */
  resetMetrics(): void {
    for (const m of this.metricsByTier.values()) {
      m.dispatched = 0;
      m.totalLatencyMs = 0;
    }
    this.defaultFallbacks = 0;
  }
}
