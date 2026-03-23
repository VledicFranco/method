// ── PRD 012 Phase 2: Adaptive Settle Delay ──────────────────────
// Replaces fixed SETTLE_DELAY_MS with a per-session adaptive algorithm
// that starts fast and backs off only on false-positive cutoffs.

export interface AdaptiveSettleConfig {
  /** Starting delay — aggressive default. */
  initialDelayMs: number;       // 300ms
  /** Maximum delay — cap to prevent runaway backoff. */
  maxDelayMs: number;           // 2000ms
  /** Backoff multiplier when a false-positive cutoff is detected. */
  backoffFactor: number;        // 1.5
  /** Reset delay to initial when a tool-output marker is detected. */
  resetOnToolMarker: boolean;   // true
  /** Minimum delay floor — never go below this. */
  floorDelayMs: number;         // 200ms
}

const DEFAULT_CONFIG: AdaptiveSettleConfig = {
  initialDelayMs: 300,
  maxDelayMs: 2000,
  backoffFactor: 1.5,
  resetOnToolMarker: true,
  floorDelayMs: 200,
};

/**
 * Parse adaptive settle configuration from environment variables.
 * Falls back to defaults for unset vars.
 */
export function parseAdaptiveSettleConfig(env: Record<string, string | undefined>): AdaptiveSettleConfig {
  return {
    initialDelayMs: parseInt(env.ADAPTIVE_SETTLE_INITIAL_MS ?? '300', 10),
    maxDelayMs: parseInt(env.ADAPTIVE_SETTLE_MAX_MS ?? '2000', 10),
    backoffFactor: parseFloat(env.ADAPTIVE_SETTLE_BACKOFF ?? '1.5'),
    resetOnToolMarker: true,
    floorDelayMs: 200,
  };
}

/**
 * Check whether adaptive settle is enabled via env var.
 * Default: true.
 */
export function isAdaptiveSettleEnabled(env: Record<string, string | undefined>): boolean {
  return (env.ADAPTIVE_SETTLE_ENABLED ?? 'true') !== 'false';
}

/**
 * Per-session adaptive settle delay tracker.
 *
 * Algorithm:
 * 1. Start at initialDelayMs (300ms)
 * 2. After each response completion, check for false-positive cutoff:
 *    if next PTY data arrives within FALSE_POSITIVE_THRESHOLD_MS of the
 *    settle timer firing → multiply delay by backoffFactor
 * 3. When a tool-output marker is detected (via PTY watcher), reset to
 *    initialDelayMs — tool calls produce predictable output patterns
 * 4. Cap at maxDelayMs, floor at floorDelayMs
 * 5. Track false_positive_count for diagnostics
 */
export class AdaptiveSettleDelay {
  private currentDelayMs: number;
  private _falsePositiveCount = 0;
  private _lastSettleFiredAt: number | null = null;
  private readonly config: AdaptiveSettleConfig;

  /** Threshold: if next data arrives within this window after settle fired,
   *  it's a false positive (response was cut short). */
  static readonly FALSE_POSITIVE_THRESHOLD_MS = 100;

  constructor(config?: Partial<AdaptiveSettleConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentDelayMs = this.config.initialDelayMs;
  }

  /** Current settle delay in milliseconds. */
  get delayMs(): number {
    return this.currentDelayMs;
  }

  /** Number of false-positive cutoffs detected. */
  get falsePositiveCount(): number {
    return this._falsePositiveCount;
  }

  /**
   * Called when the settle timer fires (response declared complete).
   * Records the timestamp for false-positive detection.
   */
  recordSettleFired(): void {
    this._lastSettleFiredAt = Date.now();
  }

  /**
   * Called when new PTY data arrives after a settle was declared.
   * If data arrives within FALSE_POSITIVE_THRESHOLD_MS of the settle,
   * it means the response was cut short → back off.
   *
   * Returns true if a false positive was detected.
   */
  checkFalsePositive(): boolean {
    if (this._lastSettleFiredAt === null) return false;

    const elapsed = Date.now() - this._lastSettleFiredAt;
    this._lastSettleFiredAt = null; // consume the marker

    if (elapsed <= AdaptiveSettleDelay.FALSE_POSITIVE_THRESHOLD_MS) {
      this._falsePositiveCount++;
      this.currentDelayMs = Math.min(
        Math.max(
          Math.round(this.currentDelayMs * this.config.backoffFactor),
          this.config.floorDelayMs,
        ),
        this.config.maxDelayMs,
      );
      return true;
    }

    return false;
  }

  /**
   * Called when a tool-output marker is detected in PTY output.
   * Resets delay to initialDelayMs — tool calls produce predictable patterns
   * where shorter delays are safe.
   */
  resetOnToolMarker(): void {
    if (this.config.resetOnToolMarker) {
      this.currentDelayMs = this.config.initialDelayMs;
      this._lastSettleFiredAt = null;
    }
  }

  /**
   * Reset to initial state (e.g., for testing).
   */
  reset(): void {
    this.currentDelayMs = this.config.initialDelayMs;
    this._falsePositiveCount = 0;
    this._lastSettleFiredAt = null;
  }
}
