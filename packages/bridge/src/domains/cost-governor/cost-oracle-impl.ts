/**
 * CostOracle implementation backed by HistoricalObservations.
 *
 * Computes p50/p90 bands per-signature from observation history.
 * Delegates DAG walking to estimator.ts.
 */

import type { InvocationSignature, CostBand } from '@method/types';
import type { CostOracle, StrategyEstimate } from '../../ports/cost-oracle.js';
import type { HistoricalObservations } from '../../ports/historical-observations.js';
import { computeBands } from './percentile.js';
import { estimateStrategy as walkDag } from './estimator.js';

export class HistogramCostOracle implements CostOracle {
  constructor(
    private readonly history: HistoricalObservations,
    private readonly onRecord?: (
      sig: InvocationSignature,
      costUsd: number,
      durationMs: number,
      accountId: string,
    ) => void,
  ) {}

  estimateStrategy(
    nodeSignatures: ReadonlyMap<string, InvocationSignature>,
    dagEdges: ReadonlyMap<string, readonly string[]>,
  ): StrategyEstimate {
    return walkDag(nodeSignatures, dagEdges, (sig) =>
      this.estimateSignature(sig),
    );
  }

  /** Internal: look up p50/p90 for a single signature. */
  private estimateSignature(
    sig: InvocationSignature,
  ): { cost: CostBand; durationMs: CostBand } | null {
    const obs = this.history.query(sig);
    if (obs.length === 0) return null;

    const costs = obs.map((o) => o.costUsd);
    const durations = obs.map((o) => o.durationMs);

    const costBands = computeBands(costs);
    const durationBands = computeBands(durations);

    const confidence: CostBand['confidence'] =
      obs.length >= 20 ? 'high' : obs.length >= 5 ? 'medium' : 'low';

    return {
      cost: {
        p50Usd: costBands.p50,
        p90Usd: costBands.p90,
        sampleCount: obs.length,
        confidence,
      },
      durationMs: {
        p50Usd: durationBands.p50,
        p90Usd: durationBands.p90,
        sampleCount: obs.length,
        confidence,
      },
    };
  }

  record(
    sig: InvocationSignature,
    actualCostUsd: number,
    actualDurationMs: number,
    accountId: string,
  ): void {
    // The actual observation storage happens via HistoricalObservations.append()
    // (called by the RateGovernor releaseSlot flow with AppendToken).
    // This method is a side-channel hook for CostOracle consumers.
    this.onRecord?.(sig, actualCostUsd, actualDurationMs, accountId);
  }
}
