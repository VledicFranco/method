/**
 * Cluster registry — 10 clusters across 4 layers.
 *
 * Wave 0 stub — C-3 populates with full entries (10 clusters binding
 * feature IDs to layers with narratives).
 *
 * Inventory (from PRD 056 §Surface 2):
 *   methodology: session-lifecycle, routing-transition
 *   method:      step-execution
 *   strategy:    node-types, gates-control-flow, data-flow-oversight, execution-engine
 *   agent:       agent-execution
 */

import type { Cluster } from './types.js';
import type { Layer } from '../layers/types.js';

export const clusterRegistry: Cluster[] = [];

export function getCluster(id: string): Cluster {
  const cluster = clusterRegistry.find((c) => c.id === id);
  if (!cluster) throw new Error(`Cluster not found: ${id}`);
  return cluster;
}

export function clustersByLayer(layerId: Layer['id']): Cluster[] {
  return clusterRegistry.filter((c) => c.layerId === layerId);
}
