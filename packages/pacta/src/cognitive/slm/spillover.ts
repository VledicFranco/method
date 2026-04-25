// SPDX-License-Identifier: Apache-2.0
/**
 * SpilloverSLMRuntime — primary + fallback SLM with health probing —
 * PRD 057 Wave 4.
 *
 * Implements `SLMInferer`. Wraps a primary `SLMInferer` and a fallback
 * `SLMInferer`. Dispatches to the primary while healthy; on a primary
 * error, marks the runtime degraded and routes to the fallback. Optional
 * active health probe periodically tests the primary so we can recover
 * back to healthy without bouncing on a successful primary call.
 *
 * Health states (`HealthState`):
 *   - `'unknown'`  — initial; treat as healthy for dispatch
 *   - `'healthy'`  — primary is the dispatch target
 *   - `'degraded'` — fallback is the dispatch target until probe recovers
 *
 * Active vs passive health:
 *   - Passive (no probe): degradation is sticky per call. Without an
 *     active probe, we never recover automatically — the consumer must
 *     observe metrics or restart.
 *   - Active (probe + start()): a `setInterval` polls the probe at
 *     `checkIntervalMs` and updates state. Inline recovery probes also
 *     fire per-call when degraded and `recoveryCheckIntervalMs` has
 *     elapsed since the last probe.
 *
 * Timer note: Node's `setInterval` keeps the event loop alive. We call
 * `.unref()` on the handle so a forgotten `start()` does not block
 * process exit. Tests must call `stop()` to deterministically end the
 * loop.
 *
 * @see docs/prds/057-slm-cascade-infrastructure.md (Wave 4)
 */

import type { SLMInferer } from '../../ports/slm-inferer.js';
import type {
  SLMInferenceResult,
  SLMInferOptions,
  HealthState,
  HealthProbe,
  SpilloverMetrics,
} from './types.js';
import { SLMError } from './errors.js';

const DEFAULT_RECOVERY_CHECK_INTERVAL_MS = 30_000;

export interface SpilloverConfig {
  readonly primary: SLMInferer;
  readonly fallback: SLMInferer;
  /** Active probe interval (ms). 0 = passive only. Default 0. */
  readonly checkIntervalMs?: number;
  /** Recovery probe interval (ms) when degraded. Default 30000. */
  readonly recoveryCheckIntervalMs?: number;
  /** Optional active health probe. When set, called periodically. */
  readonly probe?: HealthProbe;
}

interface MutableMetrics {
  primaryHandled: number;
  fallbackHandled: number;
  primaryFailures: number;
  healthProbeFailures: number;
  lastHealthChangeAt: number;
}

export class SpilloverSLMRuntime implements SLMInferer {
  private readonly primary: SLMInferer;
  private readonly fallback: SLMInferer;
  private readonly checkIntervalMs: number;
  private readonly recoveryCheckIntervalMs: number;
  private readonly probe?: HealthProbe;

  private health: HealthState = 'unknown';
  private lastProbeAt = 0;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private readonly _metrics: MutableMetrics = {
    primaryHandled: 0,
    fallbackHandled: 0,
    primaryFailures: 0,
    healthProbeFailures: 0,
    lastHealthChangeAt: 0,
  };

  constructor(config: SpilloverConfig) {
    this.primary = config.primary;
    this.fallback = config.fallback;
    this.checkIntervalMs = config.checkIntervalMs ?? 0;
    this.recoveryCheckIntervalMs =
      config.recoveryCheckIntervalMs ?? DEFAULT_RECOVERY_CHECK_INTERVAL_MS;
    this.probe = config.probe;
  }

  get healthState(): HealthState {
    return this.health;
  }

  get metrics(): SpilloverMetrics {
    return {
      primaryHandled: this._metrics.primaryHandled,
      fallbackHandled: this._metrics.fallbackHandled,
      primaryFailures: this._metrics.primaryFailures,
      healthProbeFailures: this._metrics.healthProbeFailures,
      lastHealthChangeAt: this._metrics.lastHealthChangeAt,
    };
  }

  /** Start the active probe loop. Idempotent — second call is a no-op. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (!this.probe || this.checkIntervalMs <= 0) return;
    const handle = setInterval(() => {
      void this.runProbe();
    }, this.checkIntervalMs);
    // Don't keep the process alive on a forgotten start().
    if (typeof handle.unref === 'function') handle.unref();
    this.intervalHandle = handle;
  }

  /** Stop the probe loop. Idempotent. */
  async stop(): Promise<void> {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.started = false;
  }

  async infer(prompt: string, options?: SLMInferOptions): Promise<SLMInferenceResult> {
    // If degraded but probe is configured and recovery interval has elapsed,
    // run an inline probe before deciding the dispatch target.
    if (this.health === 'degraded' && this.probe) {
      const sinceLastProbe = Date.now() - this.lastProbeAt;
      if (sinceLastProbe >= this.recoveryCheckIntervalMs) {
        await this.runProbe();
      }
    }

    if (this.health === 'healthy' || this.health === 'unknown') {
      try {
        const result = await this.primary.infer(prompt, options);
        // Successful primary call confirms health.
        this.transition('healthy');
        this._metrics.primaryHandled++;
        return result;
      } catch (e) {
        this._metrics.primaryFailures++;
        this.transition('degraded');
        return await this.useFallback(prompt, options, 'primary-error', e);
      }
    }
    // Degraded → fallback (recovery already attempted above).
    return await this.useFallback(prompt, options, 'primary-unhealthy');
  }

  private async useFallback(
    prompt: string,
    options: SLMInferOptions | undefined,
    reason: 'primary-error' | 'primary-unhealthy',
    cause?: unknown,
  ): Promise<SLMInferenceResult> {
    let raw: SLMInferenceResult;
    try {
      raw = await this.fallback.infer(prompt, options);
    } catch (e) {
      // Both primary and fallback failed — surface a useful error.
      throw new SLMError(
        `SpilloverSLMRuntime: primary ${reason}, fallback also failed: ${
          (e as Error).message
        }`,
        { cause: cause ?? e },
      );
    }
    this._metrics.fallbackHandled++;
    return {
      ...raw,
      escalated: true,
      fallbackReason: reason,
    };
  }

  /** Run the probe and update state. Increments `healthProbeFailures` on a `false` result. */
  private async runProbe(): Promise<void> {
    if (!this.probe) return;
    this.lastProbeAt = Date.now();
    let ok = false;
    try {
      ok = await this.probe();
    } catch {
      ok = false;
    }
    if (ok) {
      this.transition('healthy');
    } else {
      if (this.health !== 'degraded') {
        this.transition('degraded');
      }
      this._metrics.healthProbeFailures++;
    }
  }

  private transition(next: HealthState): void {
    if (this.health === next) return;
    this.health = next;
    this._metrics.lastHealthChangeAt = Date.now();
  }
}
