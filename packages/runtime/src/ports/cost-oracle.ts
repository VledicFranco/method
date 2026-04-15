/**
 * CostOracle — Port interface (PRD 051 S1).
 *
 * Consumed by strategies domain (dry-run) and MCP tool.
 * Implemented by cost-governor domain.
 */

import type { InvocationSignature, CostBand } from '@method/types';

// ── Estimate types ──────────────────────────────────────────────

export interface NodeEstimate {
  readonly nodeId: string;
  readonly signature: InvocationSignature;
  readonly cost: CostBand;
  readonly durationMs: CostBand;
}

export interface StrategyEstimate {
  readonly nodes: readonly NodeEstimate[];
  readonly totalCost: CostBand;
  readonly totalDurationMs: CostBand;
  readonly unknownNodes: readonly string[];
}

// ── Port interface ──────────────────────────────────────────────

export interface CostOracle {
  /** Walk a DAG and estimate total cost/time via critical-path with parallelism-discount. */
  estimateStrategy(
    nodeSignatures: ReadonlyMap<string, InvocationSignature>,
    dagEdges: ReadonlyMap<string, readonly string[]>,
  ): StrategyEstimate;

  /** Record an actual outcome. Called after releaseSlot. */
  record(
    sig: InvocationSignature,
    actualCostUsd: number,
    actualDurationMs: number,
    accountId: string,
  ): void;
}
