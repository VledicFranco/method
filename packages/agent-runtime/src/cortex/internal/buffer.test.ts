// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for the bounded FIFO buffer — PRD-063 §Tests (buffer unit).
 *
 * Maps to N1 back-pressure thresholds.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createBoundedBuffer, type BufferThresholdEvent } from './buffer.js';

describe('createBoundedBuffer', () => {
  it('rejects non-positive capacity', () => {
    assert.throws(() => createBoundedBuffer(0));
    assert.throws(() => createBoundedBuffer(-1));
    assert.throws(() => createBoundedBuffer(1.5));
  });

  it('accepts up to capacity without drops', () => {
    const b = createBoundedBuffer<number>(3);
    assert.deepEqual(b.push(1), { accepted: true });
    assert.deepEqual(b.push(2), { accepted: true });
    assert.deepEqual(b.push(3), { accepted: true });
    assert.equal(b.depth(), 3);
    assert.equal(b.dropCount(), 0);
  });

  it('evicts oldest on overflow', () => {
    const b = createBoundedBuffer<number>(2);
    b.push(1);
    b.push(2);
    const res = b.push(3);
    assert.equal(res.accepted, false);
    assert.equal(res.dropped, 1);
    assert.equal(b.depth(), 2);
    assert.equal(b.dropCount(), 1);
  });

  it('shift returns FIFO order', () => {
    const b = createBoundedBuffer<number>(3);
    b.push(1);
    b.push(2);
    b.push(3);
    assert.equal(b.shift(), 1);
    assert.equal(b.shift(), 2);
    assert.equal(b.shift(), 3);
    assert.equal(b.shift(), undefined);
  });

  it('50% threshold fires once on first crossing', () => {
    const b = createBoundedBuffer<number>(10);
    const fired: BufferThresholdEvent[] = [];
    b.onThresholdCrossed((e) => fired.push(e));
    for (let i = 0; i < 4; i++) b.push(i); // 4/10 — no trigger
    assert.deepEqual(fired, []);
    b.push(4); // 5/10 — fires
    assert.deepEqual(fired, ['degraded-50']);
    b.push(5); // 6/10 — still above 50, should NOT re-fire
    assert.deepEqual(fired, ['degraded-50']);
  });

  it('90% threshold fires once after 50% already fired', () => {
    const b = createBoundedBuffer<number>(10);
    const fired: BufferThresholdEvent[] = [];
    b.onThresholdCrossed((e) => fired.push(e));
    for (let i = 0; i < 9; i++) b.push(i); // 9/10 → 50 then 90
    assert.deepEqual(fired, ['degraded-50', 'degraded-90']);
  });

  it('re-arms 50 and 90 after drop below 50% (no recovered if depth stays ≥ 10%)', () => {
    const b = createBoundedBuffer<number>(10);
    const fired: BufferThresholdEvent[] = [];
    b.onThresholdCrossed((e) => fired.push(e));
    for (let i = 0; i < 9; i++) b.push(i);
    assert.deepEqual(fired, ['degraded-50', 'degraded-90']);
    // Drain to 3/10 — below 50%, not below 10% → no recovered.
    for (let i = 0; i < 6; i++) b.shift();
    assert.equal(b.depth(), 3);
    // Refill to 9/10 — both 50 and 90 re-arm.
    for (let i = 0; i < 6; i++) b.push(i + 10);
    assert.deepEqual(fired, ['degraded-50', 'degraded-90', 'degraded-50', 'degraded-90']);
  });

  it('recovered fires once on drop below 10% after prior degraded', () => {
    const b = createBoundedBuffer<number>(10);
    const fired: BufferThresholdEvent[] = [];
    b.onThresholdCrossed((e) => fired.push(e));
    for (let i = 0; i < 5; i++) b.push(i); // trigger degraded-50
    assert.deepEqual(fired, ['degraded-50']);
    // Drain to 0
    for (let i = 0; i < 5; i++) b.shift();
    assert.deepEqual(fired, ['degraded-50', 'recovered-10']);
  });

  it('recovered does NOT fire without prior degraded', () => {
    const b = createBoundedBuffer<number>(10);
    const fired: BufferThresholdEvent[] = [];
    b.onThresholdCrossed((e) => fired.push(e));
    b.push(1);
    b.push(2);
    b.shift();
    b.shift();
    assert.deepEqual(fired, []);
  });

  it('listener errors are swallowed', () => {
    const b = createBoundedBuffer<number>(10);
    b.onThresholdCrossed(() => {
      throw new Error('bad listener');
    });
    // Should not throw
    for (let i = 0; i < 5; i++) b.push(i);
    assert.equal(b.depth(), 5);
  });
});
