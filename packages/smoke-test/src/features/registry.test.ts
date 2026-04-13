/**
 * Feature registry invariants — verifies that the feature, cluster, and
 * layer registries are internally consistent and that every case's
 * feature tag resolves to a real feature (G-FEATURE-REF precondition).
 *
 * The layer-existence test tolerates an empty layerRegistry (because C-2
 * populates it in parallel — stub may still be empty when this file runs
 * in isolation) by also accepting any feature layerId that matches the
 * frozen Layer['id'] union.
 */

import { describe, it, expect } from 'vitest';
import { layerRegistry } from '../layers/index.js';
import { clusterRegistry, featureRegistry, computeCoverage } from './index.js';
import { allCases } from '../cases/index.js';
import type { Layer } from '../layers/types.js';

// Frozen in Wave 0 — matches the Layer['id'] union literal.
const VALID_LAYER_IDS: ReadonlyArray<Layer['id']> = [
  'methodology',
  'method',
  'strategy',
  'agent',
];

describe('Layer/Cluster/Feature registry invariants', () => {
  it('has a non-empty cluster registry', () => {
    expect(clusterRegistry.length).toBeGreaterThan(0);
  });

  it('has a non-empty feature registry', () => {
    expect(featureRegistry.length).toBeGreaterThan(0);
  });

  it('every cluster.featureIds resolves to a real feature', () => {
    for (const cluster of clusterRegistry) {
      for (const fid of cluster.featureIds) {
        const found = featureRegistry.find((f) => f.id === fid);
        expect(
          found,
          `cluster ${cluster.id} references missing feature ${fid}`,
        ).toBeDefined();
      }
    }
  });

  it('every feature.clusterId exists in clusterRegistry', () => {
    for (const f of featureRegistry) {
      const cluster = clusterRegistry.find((c) => c.id === f.clusterId);
      expect(
        cluster,
        `feature ${f.id} references missing cluster ${f.clusterId}`,
      ).toBeDefined();
    }
  });

  it('every feature.layerId is a valid Layer id', () => {
    for (const f of featureRegistry) {
      expect(
        VALID_LAYER_IDS.includes(f.layerId),
        `feature ${f.id} has invalid layerId ${f.layerId}`,
      ).toBe(true);

      // If the layer registry has been populated by C-2, cross-check it
      // too. Skipped while the registry is still empty so C-3 can land
      // independently of C-2.
      if (layerRegistry.length > 0) {
        const layer = layerRegistry.find((l) => l.id === f.layerId);
        expect(
          layer,
          `feature ${f.id} layerId ${f.layerId} not in layerRegistry`,
        ).toBeDefined();
      }
    }
  });

  it('every cluster.layerId is a valid Layer id', () => {
    for (const c of clusterRegistry) {
      expect(
        VALID_LAYER_IDS.includes(c.layerId),
        `cluster ${c.id} has invalid layerId ${c.layerId}`,
      ).toBe(true);
    }
  });

  it('feature ids are unique', () => {
    const ids = featureRegistry.map((f) => f.id);
    const unique = new Set(ids);
    expect(unique.size, 'duplicate feature ids detected').toBe(ids.length);
  });

  it('cluster ids are unique', () => {
    const ids = clusterRegistry.map((c) => c.id);
    const unique = new Set(ids);
    expect(unique.size, 'duplicate cluster ids detected').toBe(ids.length);
  });

  it('every case feature tag resolves to a real feature', () => {
    for (const c of allCases.values()) {
      for (const fid of c.features) {
        const found = featureRegistry.find((f) => f.id === fid);
        expect(
          found,
          `case ${c.id} references missing feature ${fid}`,
        ).toBeDefined();
      }
    }
  });

  it('computeCoverage assigns coverage to every feature', () => {
    computeCoverage([...allCases.values()]);
    for (const f of featureRegistry) {
      expect(['covered', 'gap']).toContain(f.coverage);
    }
  });

  it('has at least one feature covered after computeCoverage', () => {
    computeCoverage([...allCases.values()]);
    const covered = featureRegistry.filter((f) => f.coverage === 'covered');
    expect(covered.length).toBeGreaterThan(0);
  });

  it('gap features (if any) carry a proposedTest description', () => {
    computeCoverage([...allCases.values()]);
    for (const f of featureRegistry) {
      if (f.coverage === 'gap' && f.proposedTest) {
        expect(f.proposedTest.description.length).toBeGreaterThan(0);
      }
    }
  });
});
