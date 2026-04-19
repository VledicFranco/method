// SPDX-License-Identifier: Apache-2.0
// ── Capacity-Weighted Router ────────────────────────────────────
//
// Selects the best cluster node for a work request using a weighted
// scoring function over resource headroom and project locality.
//
// The scoring function (from PRD 039 §3):
//
//   score(node) =
//     (sessionsMax - sessionsActive) / sessionsMax * sessionWeight
//     + memoryAvailableMb / memoryTotalMb * memoryWeight
//     + (1 - cpuLoadPercent / 100) * cpuWeight
//     + (hasProject(node, request.projectId) ? localityWeight : 0)
//
// Rules:
// - Only 'alive' nodes are candidates (draining/dead/suspect → score 0).
// - Nodes in request.excludeNodes are skipped entirely.
// - Ties broken by lowest sessionsActive.
// - Returns null when no candidates have capacity.

import type { ClusterNode, ClusterState, WorkRequest } from '../types.js';
import { RouterConfigSchema, type RouterConfig } from './router.config.js';

// ── Interface ──────────────────────────────────────────────────

/** Strategy interface for work routing. */
export interface WorkRouter {
  selectNode(request: WorkRequest, state: ClusterState): ClusterNode | null;
}

// ── Implementation ─────────────────────────────────────────────

export class CapacityWeightedRouter implements WorkRouter {
  private readonly config: Required<RouterConfig>;

  constructor(config: Partial<RouterConfig> = {}) {
    this.config = RouterConfigSchema.parse(config) as Required<RouterConfig>;
  }

  selectNode(request: WorkRequest, state: ClusterState): ClusterNode | null {
    const excludeSet = new Set(request.excludeNodes ?? []);
    const candidates = this.getCandidates(state, excludeSet);

    if (candidates.length === 0) return null;

    let best: ClusterNode | null = null;
    let bestScore = -1;

    for (const node of candidates) {
      const score = this.score(node, request);
      if (
        score > bestScore ||
        (score === bestScore && best !== null && node.resources.sessionsActive < best.resources.sessionsActive)
      ) {
        best = node;
        bestScore = score;
      }
    }

    return best;
  }

  /** Compute the weighted capacity score for a single node. */
  score(node: ClusterNode, request: WorkRequest): number {
    const r = node.resources;
    const { sessionWeight, memoryWeight, cpuWeight, localityWeight } = this.config;

    const sessionHeadroom = r.sessionsMax > 0
      ? (r.sessionsMax - r.sessionsActive) / r.sessionsMax
      : 0;

    const memoryHeadroom = r.memoryTotalMb > 0
      ? r.memoryAvailableMb / r.memoryTotalMb
      : 0;

    const cpuHeadroom = 1 - r.cpuLoadPercent / 100;

    const hasProject = request.projectId != null &&
      node.projects.some(p => p.projectId === request.projectId);

    return (
      sessionHeadroom * sessionWeight +
      memoryHeadroom * memoryWeight +
      cpuHeadroom * cpuWeight +
      (hasProject ? localityWeight : 0)
    );
  }

  /** Filter to alive nodes not in the exclude set. */
  private getCandidates(state: ClusterState, exclude: Set<string>): ClusterNode[] {
    const candidates: ClusterNode[] = [];

    // Include self if alive and not excluded
    if (state.self.status === 'alive' && !exclude.has(state.self.nodeId)) {
      candidates.push(state.self);
    }

    for (const [, node] of state.peers) {
      if (node.status !== 'alive') continue;
      if (exclude.has(node.nodeId)) continue;
      candidates.push(node);
    }

    return candidates;
  }
}
