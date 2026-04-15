/**
 * Tests for the sliding-window rate limiter — PRD-063 §Tests.
 * Maps to N2 (rate cap respected).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createRateLimiter } from './rate-limiter.js';

describe('createRateLimiter', () => {
  it('rejects maxPerSecond ≤ 0', () => {
    assert.throws(() => createRateLimiter({ maxPerSecond: 0 }));
    assert.throws(() => createRateLimiter({ maxPerSecond: -1 }));
  });

  it('acquires up to cap within 1s window', () => {
    let t = 1_000_000;
    const rl = createRateLimiter({ maxPerSecond: 5, now: () => t });
    for (let i = 0; i < 5; i++) {
      assert.equal(rl.tryAcquire(), true, `attempt ${i} should succeed`);
    }
    assert.equal(rl.tryAcquire(), false);
    assert.equal(rl.windowCount(), 5);
  });

  it('resets on window rollover', () => {
    let t = 1_000_000;
    const rl = createRateLimiter({ maxPerSecond: 3, now: () => t });
    for (let i = 0; i < 3; i++) rl.tryAcquire();
    assert.equal(rl.tryAcquire(), false);
    t += 1001;
    assert.equal(rl.tryAcquire(), true);
    assert.equal(rl.windowCount(), 1);
  });

  it('waitTimeMs returns 0 when under cap', () => {
    let t = 1_000_000;
    const rl = createRateLimiter({ maxPerSecond: 5, now: () => t });
    rl.tryAcquire();
    assert.equal(rl.waitTimeMs(), 0);
  });

  it('waitTimeMs returns remaining window when at cap', () => {
    let t = 1_000_000;
    const rl = createRateLimiter({ maxPerSecond: 2, now: () => t });
    rl.tryAcquire();
    rl.tryAcquire();
    t += 400;
    const wait = rl.waitTimeMs();
    assert.ok(wait >= 590 && wait <= 610, `expected ~600, got ${wait}`);
  });

  it('burst at window boundary: tolerance ≤ 2× cap (documented, matches WebhookConnector)', () => {
    // Window boundary test — 12 acquired right before rollover + 12 immediately after
    // equals 24 in ≤1.01s. This is the S6 §4.4 documented tolerance.
    let t = 1_000_000;
    const rl = createRateLimiter({ maxPerSecond: 12, now: () => t });
    let ok = 0;
    for (let i = 0; i < 12; i++) if (rl.tryAcquire()) ok++;
    t += 1001;
    for (let i = 0; i < 12; i++) if (rl.tryAcquire()) ok++;
    assert.equal(ok, 24); // Both windows fully utilised — tolerance accepted.
  });
});
