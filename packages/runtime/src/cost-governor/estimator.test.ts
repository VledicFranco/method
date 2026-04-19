// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateStrategy, heuristicEstimate } from './estimator.js';
import type { InvocationSignature, CostBand } from '@methodts/types';

const sigOf = (id: string): InvocationSignature => ({
  methodologyId: id,
  capabilities: [],
  model: 'test',
  inputSizeBucket: 's',
});

const knownEstimate = (
  sig: InvocationSignature,
  p50: number,
): { cost: CostBand; durationMs: CostBand } => ({
  cost: { p50Usd: p50, p90Usd: p50 * 1.5, sampleCount: 10, confidence: 'medium' },
  durationMs: {
    p50Usd: 10_000,
    p90Usd: 15_000,
    sampleCount: 10,
    confidence: 'medium',
  },
});

describe('heuristicEstimate', () => {
  it('returns non-zero cost for unknown signature', () => {
    const band = heuristicEstimate(sigOf('X'));
    assert.ok(band.p50Usd > 0);
    assert.equal(band.sampleCount, 0);
    assert.equal(band.confidence, 'low');
  });

  it('xs bucket has lower cost than xl', () => {
    const xs = heuristicEstimate({ ...sigOf('X'), inputSizeBucket: 'xs' });
    const xl = heuristicEstimate({ ...sigOf('X'), inputSizeBucket: 'xl' });
    assert.ok(xl.p50Usd > xs.p50Usd);
  });

  it('respects cost floor', () => {
    const band = heuristicEstimate({ ...sigOf('X'), inputSizeBucket: 'xs' });
    assert.ok(band.p50Usd >= 0.02); // COST_FLOOR_USD
  });
});

describe('estimateStrategy — 5 DAG shapes', () => {
  it('linear DAG (A -> B -> C)', () => {
    const signatures = new Map([
      ['A', sigOf('m1')],
      ['B', sigOf('m1')],
      ['C', sigOf('m1')],
    ]);
    const edges = new Map([
      ['A', []],
      ['B', ['A']],
      ['C', ['B']],
    ]);
    const result = estimateStrategy(
      signatures,
      edges,
      () => knownEstimate(sigOf('m1'), 0.10),
    );
    // Total cost = 3 * 0.10 = 0.30
    assert.ok(Math.abs(result.totalCost.p50Usd - 0.30) < 0.001);
    // Critical path = 3 nodes * 10000ms = 30000ms
    assert.equal(result.totalDurationMs.p50Usd, 30_000);
    assert.equal(result.unknownNodes.length, 0);
  });

  it('diamond DAG (A -> B,C -> D)', () => {
    const signatures = new Map([
      ['A', sigOf('m')],
      ['B', sigOf('m')],
      ['C', sigOf('m')],
      ['D', sigOf('m')],
    ]);
    const edges = new Map([
      ['A', []],
      ['B', ['A']],
      ['C', ['A']],
      ['D', ['B', 'C']],
    ]);
    const result = estimateStrategy(
      signatures,
      edges,
      () => knownEstimate(sigOf('m'), 0.05),
    );
    // Total cost = 4 * 0.05 = 0.20 (all nodes execute)
    assert.ok(Math.abs(result.totalCost.p50Usd - 0.20) < 0.001);
    // Critical path = 3 nodes on longest path (A->B->D or A->C->D) * 10000ms
    assert.equal(result.totalDurationMs.p50Usd, 30_000);
  });

  it('fan-out DAG (A -> B, C, D)', () => {
    const signatures = new Map([
      ['A', sigOf('m')],
      ['B', sigOf('m')],
      ['C', sigOf('m')],
      ['D', sigOf('m')],
    ]);
    const edges = new Map([
      ['A', []],
      ['B', ['A']],
      ['C', ['A']],
      ['D', ['A']],
    ]);
    const result = estimateStrategy(
      signatures,
      edges,
      () => knownEstimate(sigOf('m'), 0.05),
    );
    assert.ok(Math.abs(result.totalCost.p50Usd - 0.20) < 0.001);
    // Critical path: A -> any leaf = 2 nodes * 10000ms
    assert.equal(result.totalDurationMs.p50Usd, 20_000);
  });

  it('fan-in DAG (A, B, C -> D)', () => {
    const signatures = new Map([
      ['A', sigOf('m')],
      ['B', sigOf('m')],
      ['C', sigOf('m')],
      ['D', sigOf('m')],
    ]);
    const edges = new Map([
      ['A', []],
      ['B', []],
      ['C', []],
      ['D', ['A', 'B', 'C']],
    ]);
    const result = estimateStrategy(
      signatures,
      edges,
      () => knownEstimate(sigOf('m'), 0.05),
    );
    assert.ok(Math.abs(result.totalCost.p50Usd - 0.20) < 0.001);
    // Critical path: any of {A,B,C} -> D = 2 nodes
    assert.equal(result.totalDurationMs.p50Usd, 20_000);
  });

  it('unknown nodes get heuristic estimates + flagged', () => {
    const signatures = new Map([['A', sigOf('unknown')]]);
    const edges = new Map([['A', []]]);
    const result = estimateStrategy(signatures, edges, () => null);
    assert.equal(result.unknownNodes.length, 1);
    assert.equal(result.unknownNodes[0], 'A');
    assert.ok(result.totalCost.p50Usd >= 0.02); // floor applied
    assert.equal(result.totalCost.confidence, 'low');
  });
});

describe('estimateStrategy — confidence', () => {
  it('high confidence with 20+ samples', () => {
    const signatures = new Map([['A', sigOf('m')]]);
    const edges = new Map([['A', []]]);
    const result = estimateStrategy(signatures, edges, () => ({
      cost: { p50Usd: 0.1, p90Usd: 0.15, sampleCount: 25, confidence: 'high' },
      durationMs: { p50Usd: 5000, p90Usd: 7500, sampleCount: 25, confidence: 'high' },
    }));
    assert.equal(result.totalCost.confidence, 'high');
  });

  it('low confidence with < 5 samples', () => {
    const signatures = new Map([['A', sigOf('m')]]);
    const edges = new Map([['A', []]]);
    const result = estimateStrategy(signatures, edges, () => ({
      cost: { p50Usd: 0.1, p90Usd: 0.15, sampleCount: 2, confidence: 'low' },
      durationMs: { p50Usd: 5000, p90Usd: 7500, sampleCount: 2, confidence: 'low' },
    }));
    assert.equal(result.totalCost.confidence, 'low');
  });
});
