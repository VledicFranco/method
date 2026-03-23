import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  AdaptiveSettleDelay,
  parseAdaptiveSettleConfig,
  isAdaptiveSettleEnabled,
} from './adaptive-settle.js';

// ── AdaptiveSettleDelay Unit Tests ───────────────────────────────

describe('AdaptiveSettleDelay (PRD 012 Phase 2)', () => {
  let settle: AdaptiveSettleDelay;

  beforeEach(() => {
    settle = new AdaptiveSettleDelay();
  });

  describe('initial state', () => {
    it('starts at 300ms initial delay', () => {
      assert.equal(settle.delayMs, 300);
    });

    it('has zero false positives', () => {
      assert.equal(settle.falsePositiveCount, 0);
    });
  });

  describe('custom config', () => {
    it('respects custom initialDelayMs', () => {
      const s = new AdaptiveSettleDelay({ initialDelayMs: 500 });
      assert.equal(s.delayMs, 500);
    });

    it('respects custom maxDelayMs', () => {
      const s = new AdaptiveSettleDelay({ initialDelayMs: 1500, maxDelayMs: 2000, backoffFactor: 2 });
      s.recordSettleFired();
      // Force immediate false positive
      const detected = s.checkFalsePositive();
      assert.ok(detected);
      // 1500 * 2 = 3000, but capped at 2000
      assert.equal(s.delayMs, 2000);
    });
  });

  describe('false-positive detection', () => {
    it('detects false positive when data arrives within threshold', () => {
      settle.recordSettleFired();
      // Immediately check — 0ms elapsed, well within 100ms threshold
      const detected = settle.checkFalsePositive();
      assert.ok(detected);
      assert.equal(settle.falsePositiveCount, 1);
    });

    it('backs off delay on false positive', () => {
      settle.recordSettleFired();
      settle.checkFalsePositive();
      // 300 * 1.5 = 450
      assert.equal(settle.delayMs, 450);
    });

    it('caps at maxDelayMs', () => {
      // Force multiple backoffs to hit cap
      for (let i = 0; i < 20; i++) {
        settle.recordSettleFired();
        settle.checkFalsePositive();
      }
      assert.ok(settle.delayMs <= 2000);
      assert.equal(settle.delayMs, 2000);
    });

    it('does not detect false positive without prior settle', () => {
      const detected = settle.checkFalsePositive();
      assert.ok(!detected);
      assert.equal(settle.falsePositiveCount, 0);
      assert.equal(settle.delayMs, 300);
    });

    it('consumes the settle marker — second check is not a false positive', () => {
      settle.recordSettleFired();
      settle.checkFalsePositive(); // consumes
      const detected = settle.checkFalsePositive();
      assert.ok(!detected);
      assert.equal(settle.falsePositiveCount, 1); // unchanged
    });

    it('does not detect false positive when data arrives after threshold', async () => {
      settle.recordSettleFired();
      // Wait beyond the threshold (100ms)
      await new Promise(r => setTimeout(r, 120));
      const detected = settle.checkFalsePositive();
      assert.ok(!detected);
      assert.equal(settle.falsePositiveCount, 0);
      assert.equal(settle.delayMs, 300);
    });
  });

  describe('backoff progression', () => {
    it('follows geometric backoff progression', () => {
      // 300 → 300*1.5=450 → 450*1.5=675 → 675*1.5=1013 → 1013*1.5≈1520 → capped 2000
      const steps: number[] = [];
      for (let i = 0; i < 5; i++) {
        settle.recordSettleFired();
        settle.checkFalsePositive();
        steps.push(settle.delayMs);
      }
      assert.equal(steps[0], 450);
      assert.equal(steps[1], 675);
      assert.equal(steps[2], 1013);
      // Step 3: 1013 * 1.5 = 1519.5, rounds to 1520
      assert.ok(steps[3] >= 1519 && steps[3] <= 1520, `Step 3: expected ~1520, got ${steps[3]}`);
      assert.equal(steps[4], 2000); // capped
    });

    it('stays at maxDelayMs after hitting cap', () => {
      // Force to cap
      for (let i = 0; i < 10; i++) {
        settle.recordSettleFired();
        settle.checkFalsePositive();
      }
      assert.equal(settle.delayMs, 2000);

      // One more backoff — still 2000
      settle.recordSettleFired();
      settle.checkFalsePositive();
      assert.equal(settle.delayMs, 2000);
    });
  });

  describe('resetOnToolMarker()', () => {
    it('resets delay to initialDelayMs', () => {
      // Back off first
      settle.recordSettleFired();
      settle.checkFalsePositive();
      assert.equal(settle.delayMs, 450);

      settle.resetOnToolMarker();
      assert.equal(settle.delayMs, 300);
    });

    it('clears pending settle marker', () => {
      settle.recordSettleFired();
      settle.resetOnToolMarker();
      // checkFalsePositive should not detect anything since marker was cleared
      const detected = settle.checkFalsePositive();
      assert.ok(!detected);
    });

    it('respects resetOnToolMarker=false config', () => {
      const s = new AdaptiveSettleDelay({ resetOnToolMarker: false });
      s.recordSettleFired();
      s.checkFalsePositive();
      const backoffDelay = s.delayMs;

      s.resetOnToolMarker();
      // Should NOT reset
      assert.equal(s.delayMs, backoffDelay);
    });
  });

  describe('reset()', () => {
    it('resets all state', () => {
      settle.recordSettleFired();
      settle.checkFalsePositive();
      settle.recordSettleFired();
      settle.checkFalsePositive();

      settle.reset();
      assert.equal(settle.delayMs, 300);
      assert.equal(settle.falsePositiveCount, 0);
    });
  });

  describe('floorDelayMs', () => {
    it('never goes below floorDelayMs', () => {
      const s = new AdaptiveSettleDelay({
        initialDelayMs: 100,
        floorDelayMs: 200,
        backoffFactor: 0.5, // would decrease but floor prevents it
      });
      // 100 is below floor, but that's the initial. Backoff: 100 * 0.5 = 50 → clamped to 200
      s.recordSettleFired();
      s.checkFalsePositive();
      assert.ok(s.delayMs >= 200);
    });
  });
});

// ── Configuration parsing tests ─────────────────────────────────

describe('parseAdaptiveSettleConfig', () => {
  it('returns defaults for empty env', () => {
    const config = parseAdaptiveSettleConfig({});
    assert.equal(config.initialDelayMs, 300);
    assert.equal(config.maxDelayMs, 2000);
    assert.equal(config.backoffFactor, 1.5);
    assert.equal(config.resetOnToolMarker, true);
    assert.equal(config.floorDelayMs, 200);
  });

  it('parses env overrides', () => {
    const config = parseAdaptiveSettleConfig({
      ADAPTIVE_SETTLE_INITIAL_MS: '500',
      ADAPTIVE_SETTLE_MAX_MS: '3000',
      ADAPTIVE_SETTLE_BACKOFF: '2.0',
    });
    assert.equal(config.initialDelayMs, 500);
    assert.equal(config.maxDelayMs, 3000);
    assert.equal(config.backoffFactor, 2.0);
  });
});

describe('isAdaptiveSettleEnabled', () => {
  it('returns true by default', () => {
    assert.ok(isAdaptiveSettleEnabled({}));
  });

  it('returns true for explicit true', () => {
    assert.ok(isAdaptiveSettleEnabled({ ADAPTIVE_SETTLE_ENABLED: 'true' }));
  });

  it('returns false when disabled', () => {
    assert.ok(!isAdaptiveSettleEnabled({ ADAPTIVE_SETTLE_ENABLED: 'false' }));
  });
});

// ── Integration with DiagnosticsTracker ─────────────────────────

describe('AdaptiveSettleDelay + DiagnosticsTracker integration', () => {
  it('diagnostics reports adaptive delay as current_settle_delay_ms', async () => {
    // Import DiagnosticsTracker dynamically to avoid circular issues
    const { DiagnosticsTracker } = await import('./diagnostics.js');

    const adaptive = new AdaptiveSettleDelay({ initialDelayMs: 300 });
    const tracker = new DiagnosticsTracker(1000, adaptive);

    // Before any backoff — should report 300ms (adaptive), not 1000ms (fixed)
    const snap1 = tracker.snapshot();
    assert.equal(snap1.current_settle_delay_ms, 300);

    // After backoff — should report updated delay
    adaptive.recordSettleFired();
    adaptive.checkFalsePositive();
    const snap2 = tracker.snapshot();
    assert.equal(snap2.current_settle_delay_ms, 450);
  });

  it('diagnostics reports false_positive_settles from adaptive', async () => {
    const { DiagnosticsTracker } = await import('./diagnostics.js');

    const adaptive = new AdaptiveSettleDelay();
    const tracker = new DiagnosticsTracker(1000, adaptive);

    adaptive.recordSettleFired();
    adaptive.checkFalsePositive();
    adaptive.recordSettleFired();
    adaptive.checkFalsePositive();

    const snap = tracker.snapshot();
    assert.equal(snap.false_positive_settles, 2);
  });

  it('diagnostics recordPromptCompletion uses adaptive delay for overhead', async () => {
    const { DiagnosticsTracker } = await import('./diagnostics.js');

    const adaptive = new AdaptiveSettleDelay({ initialDelayMs: 300 });
    const tracker = new DiagnosticsTracker(1000, adaptive);

    tracker.recordPromptCompletion();
    assert.equal(tracker.snapshot().total_settle_overhead_ms, 300);

    // After backoff
    adaptive.recordSettleFired();
    adaptive.checkFalsePositive(); // now 450ms
    tracker.recordPromptCompletion();
    assert.equal(tracker.snapshot().total_settle_overhead_ms, 750); // 300 + 450
  });

  it('diagnostics uses fixed delay when no adaptive settle', async () => {
    const { DiagnosticsTracker } = await import('./diagnostics.js');

    const tracker = new DiagnosticsTracker(1000);

    const snap = tracker.snapshot();
    assert.equal(snap.current_settle_delay_ms, 1000);

    tracker.recordPromptCompletion();
    assert.equal(tracker.snapshot().total_settle_overhead_ms, 1000);
  });
});
