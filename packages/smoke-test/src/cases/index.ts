/**
 * Smoke Test Case Registry
 *
 * Central registry of all smoke test cases. Each case maps to a strategy YAML
 * fixture or method step-sequence, declares which features it covers, and
 * specifies expected outcomes for automated verification.
 */

export interface SmokeTestCase {
  id: string;
  name: string;
  description: string;
  category: 'strategy' | 'method' | 'methodology';
  /** Abstraction layer this case operates at */
  layer: 'methodology' | 'method' | 'strategy' | 'agent';
  /** Which methodology features this case validates */
  features: string[];
  /** Path to YAML fixture (strategy) or module (method), relative to fixtures/ */
  fixture: string;
  /** mock = testkit providers, live = real API, both = runs in either mode */
  mode: 'mock' | 'live' | 'both';
  expected: SmokeExpected;
}

export interface SmokeExpected {
  status: 'completed' | 'failed' | 'suspended';
  /** Expected per-node statuses */
  nodeStatuses?: Record<string, 'completed' | 'failed' | 'gate_failed' | 'suspended'>;
  /** Artifact keys that must exist in the final bundle */
  artifactsProduced?: string[];
  /** Gate IDs that must have passed */
  gatesPassed?: string[];
  /** Gate IDs that must have failed */
  gatesFailed?: string[];
  /** Whether an oversight event should have been triggered */
  oversightTriggered?: boolean;
  /** Whether a retro should have been generated */
  retroGenerated?: boolean;
  /** Expected cost range [min, max] in USD */
  costRange?: [number, number];
  /** Error message substring (for expected failures) */
  errorContains?: string;
  /** Expected number of retries on a specific node */
  retriesOnNode?: { nodeId: string; count: number };
  /** Validate that specific artifact values match */
  artifactValues?: Record<string, unknown>;
  /** Validate parse error (for dag-validation-errors) */
  parseError?: boolean;
}

export { strategyCases } from './strategy-cases.js';
export { methodCases } from './method-cases.js';
export { methodologyCases } from './methodology-cases.js';

import { strategyCases } from './strategy-cases.js';
import { methodCases } from './method-cases.js';
import { methodologyCases } from './methodology-cases.js';

/** All smoke test cases, keyed by ID */
export const allCases: Map<string, SmokeTestCase> = new Map([
  ...strategyCases.map((c) => [c.id, c] as const),
  ...methodCases.map((c) => [c.id, c] as const),
  ...methodologyCases.map((c) => [c.id, c] as const),
]);

/** Get cases filtered by category */
export function casesByCategory(cat: 'strategy' | 'method' | 'methodology'): SmokeTestCase[] {
  return [...allCases.values()].filter((c) => c.category === cat);
}

/** Get cases filtered by feature tag */
export function casesByFeature(feature: string): SmokeTestCase[] {
  return [...allCases.values()].filter((c) => c.features.includes(feature));
}

/** All unique feature tags across all cases */
export function allFeatures(): string[] {
  const set = new Set<string>();
  for (const c of allCases.values()) {
    for (const f of c.features) set.add(f);
  }
  return [...set].sort();
}
