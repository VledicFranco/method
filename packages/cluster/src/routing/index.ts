// SPDX-License-Identifier: Apache-2.0
/**
 * routing/ — Capacity-weighted work routing (PRD 039).
 *
 * WorkRouter: interface for routing a task to a peer node.
 * CapacityWeightedRouter: selects the peer with the most available capacity
 *   (CPU headroom × free session slots). Falls back to round-robin on tie.
 *   Zero transport dependencies — routing is a pure function of ClusterState.
 */

export { CapacityWeightedRouter } from './router.js';
export type { WorkRouter } from './router.js';
export { RouterConfigSchema } from './router.config.js';
export type { RouterConfig } from './router.config.js';
