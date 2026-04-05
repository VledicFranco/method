/**
 * Token Bucket — monotonic-clock-based rate limiter.
 *
 * Supports a 5h burst window + weekly cap + concurrency cap.
 * Uses process.hrtime.bigint() for elapsed-time math to avoid
 * wall-clock drift from system sleep.
 */

export interface TokenBucketConfig {
  /** Max messages in the burst window. */
  burstCapacity: number;
  /** Burst window duration in ms (default: 5h = 18_000_000). */
  burstWindowMs?: number;
  /** Max messages per week (0 = unlimited). */
  weeklyCap?: number;
  /** Max concurrent in-flight slots. */
  concurrentCap: number;
}

export class TokenBucket {
  private burstConsumed = 0;
  private weeklyConsumed = 0;
  private inFlight = 0;
  private lastRefillNs: bigint;
  private weekStartMs: number;

  readonly burstCapacity: number;
  readonly burstWindowMs: number;
  readonly weeklyCap: number;
  readonly concurrentCap: number;

  /** Messages per nanosecond refill rate. */
  private readonly refillRatePerNs: number;

  constructor(config: TokenBucketConfig) {
    this.burstCapacity = config.burstCapacity;
    this.burstWindowMs = config.burstWindowMs ?? 18_000_000; // 5h
    this.weeklyCap = config.weeklyCap ?? 0;
    this.concurrentCap = config.concurrentCap;

    this.refillRatePerNs =
      this.burstCapacity / (this.burstWindowMs * 1_000_000);
    this.lastRefillNs = process.hrtime.bigint();
    this.weekStartMs = Date.now();
  }

  /** Refill burst tokens based on elapsed monotonic time. */
  refill(): void {
    const now = process.hrtime.bigint();
    const elapsedNs = now - this.lastRefillNs;

    // Resume-from-sleep detection: elapsed > 5min → conservative 50% reset
    const elapsedMs = Number(elapsedNs) / 1_000_000;
    if (elapsedMs > 300_000) {
      this.burstConsumed = Math.floor(this.burstCapacity * 0.5);
      this.lastRefillNs = now;
      return;
    }

    const refilled = Math.min(
      Number(elapsedNs) * this.refillRatePerNs,
      this.burstConsumed, // never go below 0 consumed
    );

    this.burstConsumed = Math.max(0, this.burstConsumed - Math.floor(refilled));
    this.lastRefillNs = now;

    // Weekly reset check (wall clock — only for week boundary)
    const weekElapsedMs = Date.now() - this.weekStartMs;
    if (weekElapsedMs >= 7 * 24 * 60 * 60 * 1000) {
      this.weeklyConsumed = 0;
      this.weekStartMs = Date.now();
    }
  }

  /** Try to consume one slot. Returns true if allowed. */
  tryConsume(): boolean {
    this.refill();

    if (this.inFlight >= this.concurrentCap) return false;
    if (this.burstConsumed >= this.burstCapacity) return false;
    if (this.weeklyCap > 0 && this.weeklyConsumed >= this.weeklyCap) return false;

    this.burstConsumed++;
    this.weeklyConsumed++;
    this.inFlight++;
    return true;
  }

  /** Release one in-flight slot. */
  release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  /** Current available burst tokens (after refill). */
  available(): number {
    this.refill();
    return Math.max(0, this.burstCapacity - this.burstConsumed);
  }

  /** Snapshot for persistence / debugging. */
  snapshot(): TokenBucketSnapshot {
    return {
      burstConsumed: this.burstConsumed,
      weeklyConsumed: this.weeklyConsumed,
      inFlight: this.inFlight,
      weekStartMs: this.weekStartMs,
      lastRefillEpochMs: Date.now(),
    };
  }

  /** Restore from a persisted snapshot, clamping by elapsed time. */
  restore(snap: TokenBucketSnapshot): void {
    const elapsedMs = Date.now() - snap.lastRefillEpochMs;
    const refilled = Math.floor(
      (elapsedMs * 1_000_000) * this.refillRatePerNs,
    );
    this.burstConsumed = Math.max(0, snap.burstConsumed - refilled);
    this.weeklyConsumed = snap.weeklyConsumed;
    this.weekStartMs = snap.weekStartMs;
    this.inFlight = 0; // In-flight slots lost on restart
    this.lastRefillNs = process.hrtime.bigint();
  }

  /** Utilization percentages. */
  utilization(): { burstPct: number; weeklyPct: number; inFlight: number } {
    this.refill();
    return {
      burstPct: this.burstCapacity > 0
        ? (this.burstConsumed / this.burstCapacity) * 100
        : 0,
      weeklyPct: this.weeklyCap > 0
        ? (this.weeklyConsumed / this.weeklyCap) * 100
        : 0,
      inFlight: this.inFlight,
    };
  }
}

export interface TokenBucketSnapshot {
  burstConsumed: number;
  weeklyConsumed: number;
  inFlight: number;
  weekStartMs: number;
  lastRefillEpochMs: number;
}
