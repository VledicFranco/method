// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucket } from './token-bucket.js';

describe('TokenBucket', () => {
  it('allows consumption up to burst capacity', () => {
    const bucket = new TokenBucket({ burstCapacity: 3, concurrentCap: 10 });
    assert.ok(bucket.tryConsume());
    assert.ok(bucket.tryConsume());
    assert.ok(bucket.tryConsume());
    assert.ok(!bucket.tryConsume()); // exhausted
  });

  it('enforces concurrent cap', () => {
    const bucket = new TokenBucket({ burstCapacity: 100, concurrentCap: 2 });
    assert.ok(bucket.tryConsume());
    assert.ok(bucket.tryConsume());
    assert.ok(!bucket.tryConsume()); // concurrent cap hit
    bucket.release();
    assert.ok(bucket.tryConsume()); // now we have room
  });

  it('available never goes negative', () => {
    const bucket = new TokenBucket({ burstCapacity: 2, concurrentCap: 10 });
    bucket.tryConsume();
    bucket.tryConsume();
    bucket.tryConsume(); // fails but shouldn't break
    assert.ok(bucket.available() >= 0);
  });

  it('release does not underflow inFlight', () => {
    const bucket = new TokenBucket({ burstCapacity: 10, concurrentCap: 10 });
    bucket.release(); // release without consume
    bucket.release();
    // Should not crash or go negative
    const snap = bucket.snapshot();
    assert.equal(snap.inFlight, 0);
  });

  it('snapshot and restore round-trip', () => {
    const bucket = new TokenBucket({ burstCapacity: 100, concurrentCap: 10 });
    bucket.tryConsume();
    bucket.tryConsume();
    const snap = bucket.snapshot();

    const bucket2 = new TokenBucket({ burstCapacity: 100, concurrentCap: 10 });
    bucket2.restore(snap);
    // inFlight is always 0 after restore (in-flight lost on restart)
    assert.equal(bucket2.snapshot().inFlight, 0);
    // burstConsumed should be approximately restored (minus refill for elapsed)
    assert.ok(bucket2.snapshot().burstConsumed <= 2);
  });

  it('utilization reports percentages', () => {
    const bucket = new TokenBucket({ burstCapacity: 10, concurrentCap: 5, weeklyCap: 100 });
    bucket.tryConsume();
    const util = bucket.utilization();
    assert.equal(util.burstPct, 10);
    assert.equal(util.weeklyPct, 1);
    assert.equal(util.inFlight, 1);
  });

  it('weekly cap enforcement', () => {
    const bucket = new TokenBucket({ burstCapacity: 1000, concurrentCap: 1000, weeklyCap: 3 });
    assert.ok(bucket.tryConsume());
    bucket.release();
    assert.ok(bucket.tryConsume());
    bucket.release();
    assert.ok(bucket.tryConsume());
    bucket.release();
    assert.ok(!bucket.tryConsume()); // weekly cap hit
  });
});
