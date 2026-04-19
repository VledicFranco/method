// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { percentile, computeBands } from './percentile.js';

describe('percentile', () => {
  it('returns sole element for single-element array', () => {
    assert.equal(percentile([42], 50), 42);
    assert.equal(percentile([42], 90), 42);
  });

  it('computes p50 of even distribution', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const p50 = percentile(sorted, 50);
    assert.ok(p50 >= 5 && p50 <= 6);
  });

  it('computes p90 of even distribution', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const p90 = percentile(sorted, 90);
    assert.ok(p90 >= 9 && p90 <= 10);
  });

  it('p0 returns first element', () => {
    assert.equal(percentile([10, 20, 30], 0), 10);
  });

  it('p100 returns last element', () => {
    assert.equal(percentile([10, 20, 30], 100), 30);
  });

  it('interpolates between adjacent values', () => {
    // [10, 20] p50 should be 15
    assert.equal(percentile([10, 20], 50), 15);
  });

  it('throws on empty array', () => {
    assert.throws(() => percentile([], 50));
  });

  it('handles identical values', () => {
    assert.equal(percentile([5, 5, 5, 5], 50), 5);
    assert.equal(percentile([5, 5, 5, 5], 90), 5);
  });
});

describe('computeBands', () => {
  it('computes p50 and p90 from unsorted array', () => {
    const values = [10, 1, 5, 3, 8, 2, 7, 4, 9, 6];
    const bands = computeBands(values);
    assert.ok(bands.p50 >= 5 && bands.p50 <= 6);
    assert.ok(bands.p90 >= 9 && bands.p90 <= 10);
  });
});
