/**
 * Critical-Path DAG Estimator — computes total cost/duration
 * via the longest path through a DAG with parallelism discount.
 */

import type { InvocationSignature, CostBand } from '@method/types';
import type { NodeEstimate, StrategyEstimate } from '../../ports/cost-oracle.js';

export interface SignatureEstimator {
  (sig: InvocationSignature): { cost: CostBand; durationMs: CostBand } | null;
}

/** Minimum cost floor — prevents zero-cost bypass. */
const COST_FLOOR_USD = 0.02;
const DURATION_FLOOR_MS = 5_000;

/** Empty-history heuristic: $0.05 default, scaled by size bucket. */
const SIZE_MULTIPLIERS: Record<string, number> = {
  xs: 0.5, s: 1.0, m: 2.0, l: 5.0, xl: 10.0,
};

export function heuristicEstimate(sig: InvocationSignature): CostBand {
  const mult = SIZE_MULTIPLIERS[sig.inputSizeBucket] ?? 1.0;
  const base = 0.05 * mult;
  return {
    p50Usd: Math.max(base, COST_FLOOR_USD),
    p90Usd: Math.max(base * 2, COST_FLOOR_USD),
    sampleCount: 0,
    confidence: 'low',
  };
}

function heuristicDuration(sig: InvocationSignature): CostBand {
  const mult = SIZE_MULTIPLIERS[sig.inputSizeBucket] ?? 1.0;
  const base = 30_000 * mult;
  return {
    p50Usd: Math.max(base, DURATION_FLOOR_MS), // reusing CostBand shape for duration
    p90Usd: Math.max(base * 2, DURATION_FLOOR_MS),
    sampleCount: 0,
    confidence: 'low',
  };
}

/**
 * Estimate a full strategy DAG.
 *
 * @param nodeSignatures - Map of nodeId -> InvocationSignature
 * @param dagEdges - Map of nodeId -> list of dependency nodeIds
 * @param estimateSignature - Lookup function for historical data
 */
export function estimateStrategy(
  nodeSignatures: ReadonlyMap<string, InvocationSignature>,
  dagEdges: ReadonlyMap<string, readonly string[]>,
  estimateSignature: SignatureEstimator,
): StrategyEstimate {
  const nodes: NodeEstimate[] = [];
  const unknownNodes: string[] = [];

  // Estimate each node
  const nodeEstimates = new Map<string, NodeEstimate>();
  for (const [nodeId, sig] of nodeSignatures) {
    const est = estimateSignature(sig);
    const cost = est?.cost ?? heuristicEstimate(sig);
    const durationMs = est?.durationMs ?? heuristicDuration(sig);

    if (!est) unknownNodes.push(nodeId);

    // Enforce floor
    const flooredCost: CostBand = {
      ...cost,
      p50Usd: Math.max(cost.p50Usd, COST_FLOOR_USD),
      p90Usd: Math.max(cost.p90Usd, COST_FLOOR_USD),
    };

    const ne: NodeEstimate = { nodeId, signature: sig, cost: flooredCost, durationMs };
    nodes.push(ne);
    nodeEstimates.set(nodeId, ne);
  }

  // Critical-path computation: longest duration path through DAG
  // Total cost = sum of all nodes (all must execute)
  // Total duration = critical path (longest chain accounting for parallelism)
  const memo = new Map<string, number>();

  function longestPath(nodeId: string): number {
    if (memo.has(nodeId)) return memo.get(nodeId)!;

    const est = nodeEstimates.get(nodeId);
    const selfDuration = est ? est.durationMs.p50Usd : DURATION_FLOOR_MS;

    const deps = dagEdges.get(nodeId) ?? [];
    let maxDepDuration = 0;
    for (const dep of deps) {
      maxDepDuration = Math.max(maxDepDuration, longestPath(dep));
    }

    const total = selfDuration + maxDepDuration;
    memo.set(nodeId, total);
    return total;
  }

  // Find all leaf nodes (nodes that no other node depends on)
  const allDeps = new Set<string>();
  for (const deps of dagEdges.values()) {
    for (const d of deps) allDeps.add(d);
  }
  const leafNodes = [...nodeSignatures.keys()].filter(n => !allDeps.has(n));
  // If no leaves found (possible with empty DAG), use all nodes
  const roots = leafNodes.length > 0 ? leafNodes : [...nodeSignatures.keys()];

  let criticalPathMs = 0;
  for (const root of roots) {
    criticalPathMs = Math.max(criticalPathMs, longestPath(root));
  }

  // Sum total cost across all nodes
  let totalP50 = 0;
  let totalP90 = 0;
  for (const ne of nodes) {
    totalP50 += ne.cost.p50Usd;
    totalP90 += ne.cost.p90Usd;
  }

  // Determine overall confidence
  const minSamples = Math.min(...nodes.map(n => n.cost.sampleCount));
  const confidence: CostBand['confidence'] =
    minSamples >= 20 ? 'high' : minSamples >= 5 ? 'medium' : 'low';

  return {
    nodes,
    totalCost: {
      p50Usd: totalP50,
      p90Usd: totalP90,
      sampleCount: minSamples,
      confidence,
    },
    totalDurationMs: {
      p50Usd: criticalPathMs,
      p90Usd: criticalPathMs * 1.5, // rough p90 estimate
      sampleCount: minSamples,
      confidence,
    },
    unknownNodes,
  };
}
