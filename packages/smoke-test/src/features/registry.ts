/**
 * Feature registry — 47 features across 10 clusters.
 *
 * Wave 0 stub — C-3 populates with full entries and implements
 * computeCoverage() to populate coverage/coveringCaseIds from the case registry.
 *
 * Inventory (from PRD 056 §Surface 3):
 *   4 methodology-layer features (session-lifecycle)
 *   4 methodology-layer features (routing-transition)
 *   5 method-layer features (step-execution)
 *   5+5+4+8 = 22 strategy-layer features
 *   6 agent-layer features
 *   Total: 41 features (adjust if design doc feature count differs)
 */

import type { Feature } from './types.js';
import type { SmokeTestCase } from '../cases/index.js';

export const featureRegistry: Feature[] = [];

export function getFeature(id: string): Feature {
  const feature = featureRegistry.find((f) => f.id === id);
  if (!feature) throw new Error(`Feature not found: ${id}`);
  return feature;
}

export function featuresByCluster(clusterId: string): Feature[] {
  return featureRegistry.filter((f) => f.clusterId === clusterId);
}

/**
 * Compute feature coverage from the current case registry.
 *
 * For each feature, finds cases whose `features[]` contains the feature ID.
 * Sets `coverage` to 'covered' if any case covers it, 'gap' otherwise.
 * Populates `coveringCaseIds` with the list of matching case IDs.
 *
 * Mutates the feature entries in place. Idempotent — safe to re-run.
 *
 * Wave 0 stub — C-3 implements the body.
 */
export function computeCoverage(cases: SmokeTestCase[]): void {
  for (const feature of featureRegistry) {
    const covering = cases.filter((c) => c.features.includes(feature.id));
    feature.coveringCaseIds = covering.map((c) => c.id);
    feature.coverage = covering.length > 0 ? 'covered' : 'gap';
  }
}
