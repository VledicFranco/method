/**
 * Sliding-window rate limiter — mirrors WebhookConnector's approach
 * (PRD-063 §Architecture, S6 §4.4). Deliberately unsophisticated.
 *
 * Semantics:
 *   - `tryAcquire()` returns true if the current 1s window has fewer
 *     than `maxPerSecond` tokens, consuming one. False otherwise.
 *   - `waitTimeMs()` returns the ms until the next token would become
 *     available (current window end - now), clamped ≥ 0.
 *   - Window boundary tolerance: up to 2× the cap is acceptable at the
 *     boundary edge (documented; matches WebhookConnector).
 *
 * Injected `now()` for deterministic tests.
 */

export interface RateLimiter {
  tryAcquire(): boolean;
  waitTimeMs(): number;
  /** Test-only: current token count in the active window. */
  windowCount(): number;
}

export interface RateLimiterOptions {
  readonly maxPerSecond: number;
  /** Injected clock for tests. Defaults to `Date.now`. */
  readonly now?: () => number;
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  if (!Number.isFinite(opts.maxPerSecond) || opts.maxPerSecond <= 0) {
    throw new Error(
      `createRateLimiter: maxPerSecond must be > 0 (got ${opts.maxPerSecond})`,
    );
  }
  const now = opts.now ?? ((): number => Date.now());
  const max = opts.maxPerSecond;

  let windowStart = 0;
  let windowCount = 0;

  const roll = (t: number): void => {
    if (t - windowStart >= 1000) {
      windowStart = t;
      windowCount = 0;
    }
  };

  return {
    tryAcquire(): boolean {
      const t = now();
      roll(t);
      if (windowCount >= max) return false;
      windowCount += 1;
      return true;
    },
    waitTimeMs(): number {
      const t = now();
      roll(t);
      if (windowCount < max) return 0;
      const elapsed = t - windowStart;
      return Math.max(0, 1000 - elapsed);
    },
    windowCount(): number {
      return windowCount;
    },
  };
}
