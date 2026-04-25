// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for SpilloverSLMRuntime — PRD 057 Wave 4.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SpilloverSLMRuntime } from './spillover.js';
import type { SLMInferer } from '../../ports/slm-inferer.js';
import type { SLMInferenceResult, SLMInferOptions, HealthProbe } from './types.js';

class StubInferer implements SLMInferer {
  public calls = 0;
  constructor(
    private readonly result: SLMInferenceResult,
    private readonly throwError?: Error,
  ) {}
  async infer(_prompt: string, _options?: SLMInferOptions): Promise<SLMInferenceResult> {
    this.calls++;
    if (this.throwError) throw this.throwError;
    return this.result;
  }
}

const ok = (output = 'p'): SLMInferenceResult => ({
  output,
  confidence: 0.8,
  inferenceMs: 1,
  escalated: false,
});

describe('SpilloverSLMRuntime', () => {
  it('initial state is "unknown" and primary handles the first call', async () => {
    const primary = new StubInferer(ok('primary'));
    const fallback = new StubInferer(ok('fallback'));
    const sp = new SpilloverSLMRuntime({ primary, fallback });
    assert.equal(sp.healthState, 'unknown');
    const result = await sp.infer('hi');
    assert.equal(result.output, 'primary');
    assert.equal(result.escalated, false);
    assert.equal(sp.healthState, 'healthy');
    assert.equal(sp.metrics.primaryHandled, 1);
    assert.equal(sp.metrics.fallbackHandled, 0);
  });

  it('on primary error, falls back to fallback and marks degraded', async () => {
    const primary = new StubInferer(ok('p'), new Error('primary down'));
    const fallback = new StubInferer(ok('fallback'));
    const sp = new SpilloverSLMRuntime({ primary, fallback });
    const result = await sp.infer('hi');
    assert.equal(result.output, 'fallback');
    assert.equal(result.escalated, true);
    assert.equal(result.fallbackReason, 'primary-error');
    assert.equal(sp.healthState, 'degraded');
    assert.equal(sp.metrics.primaryFailures, 1);
    assert.equal(sp.metrics.fallbackHandled, 1);
    assert.equal(sp.metrics.primaryHandled, 0);
  });

  it('while degraded, dispatches to fallback without retrying primary (no probe)', async () => {
    const primary = new StubInferer(ok('p'), new Error('primary down'));
    const fallback = new StubInferer(ok('fallback'));
    const sp = new SpilloverSLMRuntime({ primary, fallback });
    await sp.infer('first');
    primary.calls = 0;
    const result = await sp.infer('second');
    assert.equal(result.output, 'fallback');
    assert.equal(result.escalated, true);
    assert.equal(result.fallbackReason, 'primary-unhealthy');
    assert.equal(primary.calls, 0, 'primary should not be retried while degraded');
    assert.equal(fallback.calls, 2);
  });

  it('inline recovery probe restores healthy when probe returns true', async () => {
    let primaryThrows = true;
    const primary: SLMInferer = {
      async infer(): Promise<SLMInferenceResult> {
        if (primaryThrows) throw new Error('primary down');
        return ok('primary-back');
      },
    };
    const fallback = new StubInferer(ok('fallback'));
    let probeOk = false;
    const probe: HealthProbe = async () => probeOk;
    const sp = new SpilloverSLMRuntime({
      primary,
      fallback,
      probe,
      recoveryCheckIntervalMs: 0, // probe every call when degraded
    });
    // Trigger degradation.
    await sp.infer('first');
    assert.equal(sp.healthState, 'degraded');
    // Primary still down, probe says no → still degraded → fallback.
    let r = await sp.infer('second');
    assert.equal(r.output, 'fallback');
    assert.equal(r.fallbackReason, 'primary-unhealthy');
    assert.equal(sp.healthState, 'degraded');
    assert.ok(sp.metrics.healthProbeFailures >= 1);
    // Bring primary back.
    primaryThrows = false;
    probeOk = true;
    r = await sp.infer('third');
    assert.equal(r.output, 'primary-back');
    assert.equal(r.escalated, false);
    assert.equal(sp.healthState, 'healthy');
  });

  it('start/stop is idempotent and unrefs the timer', async () => {
    const primary = new StubInferer(ok('p'));
    const fallback = new StubInferer(ok('f'));
    const probe: HealthProbe = async () => true;
    const sp = new SpilloverSLMRuntime({
      primary,
      fallback,
      probe,
      checkIntervalMs: 50,
    });
    await sp.start();
    await sp.start(); // second start is a no-op
    await sp.stop();
    await sp.stop(); // second stop is a no-op
    // No assertion on probe calls; we just verify the calls don't throw and
    // the test process can exit (timer was unref'd).
    assert.ok(true);
  });

  it('start with no probe configured is a no-op', async () => {
    const primary = new StubInferer(ok('p'));
    const fallback = new StubInferer(ok('f'));
    const sp = new SpilloverSLMRuntime({ primary, fallback });
    await sp.start();
    await sp.stop();
    assert.ok(true);
  });

  it('throws when both primary and fallback fail', async () => {
    const primary = new StubInferer(ok('p'), new Error('primary down'));
    const fallback = new StubInferer(ok('f'), new Error('fallback down'));
    const sp = new SpilloverSLMRuntime({ primary, fallback });
    await assert.rejects(() => sp.infer('hi'), /fallback also failed/);
  });

  it('lastHealthChangeAt updates on state transitions', async () => {
    const primary = new StubInferer(ok('p'), new Error('primary down'));
    const fallback = new StubInferer(ok('f'));
    const sp = new SpilloverSLMRuntime({ primary, fallback });
    assert.equal(sp.metrics.lastHealthChangeAt, 0);
    await sp.infer('hi'); // unknown → degraded
    const t1 = sp.metrics.lastHealthChangeAt;
    assert.ok(t1 > 0);
  });

  it('probe failure increments healthProbeFailures', async () => {
    const primary = new StubInferer(ok('p'), new Error('down'));
    const fallback = new StubInferer(ok('f'));
    const probe: HealthProbe = async () => false;
    const sp = new SpilloverSLMRuntime({
      primary,
      fallback,
      probe,
      recoveryCheckIntervalMs: 0,
    });
    await sp.infer('first'); // -> degraded via primary error
    await sp.infer('second'); // probe fires, returns false -> healthProbeFailures++
    assert.ok(sp.metrics.healthProbeFailures >= 1);
  });

  it('probe rejection (throw) is treated as failure', async () => {
    const primary = new StubInferer(ok('p'), new Error('down'));
    const fallback = new StubInferer(ok('f'));
    const probe: HealthProbe = async () => {
      throw new Error('probe blew up');
    };
    const sp = new SpilloverSLMRuntime({
      primary,
      fallback,
      probe,
      recoveryCheckIntervalMs: 0,
    });
    await sp.infer('first'); // degraded
    await sp.infer('second'); // probe throws → still degraded
    assert.equal(sp.healthState, 'degraded');
    assert.ok(sp.metrics.healthProbeFailures >= 1);
  });
});
