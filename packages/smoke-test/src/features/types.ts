// SPDX-License-Identifier: Apache-2.0
/**
 * Feature + Cluster — the smoke test's catalog of what the method runtime does.
 *
 * Features are grouped into Clusters; Clusters belong to a Layer. Every
 * SmokeTestCase.features[] entry must resolve to a Feature.id in the
 * registry (enforced by G-FEATURE-REF at server startup).
 *
 * Frozen in Wave 0 of PRD 056. Populated by C-3 (feature + cluster registries).
 */

import type { Layer } from '../layers/index.js';

export interface Cluster {
  id: string;
  layerId: Layer['id'];
  name: string;
  narrative: string;
  /** Ordered list of Feature.ids belonging to this cluster */
  featureIds: string[];
}

export interface Feature {
  /** Canonical feature ID — matches SmokeTestCase.features[] tags */
  id: string;
  layerId: Layer['id'];
  clusterId: string;
  /** Display name (e.g., 'Step Advancement') */
  name: string;
  /** 1-2 paragraph narrative explaining what this feature is and why it matters */
  narrative: string;
  /** Optional MCP tool / endpoint list exercised by this feature */
  endpoints?: string[];
  /** Coverage status — computed at startup by computeCoverage() */
  coverage: 'covered' | 'gap';
  /** Case IDs whose features[] tag this feature (populated by computeCoverage) */
  coveringCaseIds: string[];
  /** For gap features only — describes the smoke test that should exist */
  proposedTest?: {
    description: string;
    assertions: string[];
    endpoints: string[];
  };
}
