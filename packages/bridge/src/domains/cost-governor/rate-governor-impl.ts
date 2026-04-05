/**
 * SingleAccountRateGovernor — implements BridgeRateGovernor for a single
 * account (no routing, no policies). Multi-account deferred to a future PRD.
 *
 * Uses TokenBucket for rate limiting and BackpressureQueue for callers
 * waiting for capacity. On releaseSlot, optionally persists an observation
 * via the injected onObservation callback.
 */

import type {
  ProviderClass,
  SlotId,
  AccountId,
  AccountUtilization,
  InvocationSignature,
} from '@method/types';
import type {
  BridgeRateGovernor,
  DispatchSlot,
  AcquireOptions,
  ObserveOutcome,
} from '../../ports/rate-governor.js';
import { SaturationError } from '@method/pacta';
import { TokenBucket } from './token-bucket.js';
import { BackpressureQueue } from './backpressure-queue.js';

export interface RateGovernorImplConfig {
  burstCapacity: number;
  weeklyCap: number;
  concurrentCap: number;
  /** Max time to wait in queue before throwing SaturationError. */
  queueWaitTimeoutMs?: number;
}

export interface SlotRecord {
  slot: DispatchSlot;
  /** Captured signature for observation recording (if known). */
  signature?: InvocationSignature;
}

export type OnObservation = (outcome: ObserveOutcome, record: SlotRecord) => void;

export class SingleAccountRateGovernor implements BridgeRateGovernor {
  private readonly bucket: TokenBucket;
  private readonly queue = new BackpressureQueue();
  private readonly active = new Map<SlotId, SlotRecord>();
  private slotCounter = 0;
  private readonly accountId: AccountId;
  private readonly defaultTimeoutMs: number;

  constructor(
    private readonly config: RateGovernorImplConfig,
    private readonly onObservation?: OnObservation,
  ) {
    this.bucket = new TokenBucket({
      burstCapacity: config.burstCapacity,
      weeklyCap: config.weeklyCap,
      concurrentCap: config.concurrentCap,
    });
    this.accountId = 'default' as AccountId;
    this.defaultTimeoutMs = config.queueWaitTimeoutMs ?? 30_000;
  }

  async acquireSlot(opts: AcquireOptions): Promise<DispatchSlot> {
    const timeoutMs = opts.timeoutMs;

    // Fast path — try immediate acquisition
    if (this.bucket.tryConsume()) {
      return this.makeSlot(opts);
    }

    // Queue wait
    try {
      await this.queue.enqueue(timeoutMs, opts.abortSignal);
    } catch (err) {
      // Translate queue errors into SaturationError for callers
      const message = (err as Error).message;
      if (message.includes('exceeded') || message.includes('Aborted')) {
        throw new SaturationError(opts.providerClass, timeoutMs);
      }
      throw err;
    }

    // Try again after dequeue signal
    if (this.bucket.tryConsume()) {
      return this.makeSlot(opts);
    }

    throw new SaturationError(opts.providerClass, timeoutMs);
  }

  async releaseSlot(outcome: ObserveOutcome): Promise<void> {
    const record = this.active.get(outcome.slotId);
    this.active.delete(outcome.slotId);
    this.bucket.release();

    // Signal next waiter
    this.queue.dequeue();

    // Emit observation callback
    if (record) {
      this.onObservation?.(outcome, record);
    }
  }

  utilization(_providerClass: ProviderClass): readonly AccountUtilization[] {
    const util = this.bucket.utilization();
    const status: AccountUtilization['status'] =
      util.burstPct >= 100 || util.weeklyPct >= 100
        ? 'saturated'
        : 'ready';
    return [{
      accountId: this.accountId,
      burstWindowUsedPct: util.burstPct,
      weeklyUsedPct: util.weeklyPct,
      inFlightCount: util.inFlight,
      backpressureActive: this.queue.size > 0,
      status,
    }];
  }

  activeSlots(): readonly DispatchSlot[] {
    return [...this.active.values()].map(r => r.slot);
  }

  /**
   * Track the signature for a slot so releaseSlot can emit an observation.
   * Called by the throttler/strategy layer after acquireSlot.
   */
  attachSignature(slotId: SlotId, signature: InvocationSignature): void {
    const record = this.active.get(slotId);
    if (record) record.signature = signature;
  }

  /** Sweep leaked slots whose maxLifetimeMs has elapsed. */
  sweep(onLeak?: (slot: DispatchSlot) => void): number {
    const now = Date.now();
    const leaked: DispatchSlot[] = [];
    for (const [slotId, record] of this.active) {
      if (now - record.slot.acquiredAt > record.slot.maxLifetimeMs) {
        leaked.push(record.slot);
        this.active.delete(slotId);
        this.bucket.release();
        this.queue.dequeue();
      }
    }
    for (const slot of leaked) {
      onLeak?.(slot);
    }
    return leaked.length;
  }

  private makeSlot(opts: AcquireOptions): DispatchSlot {
    const slotId = `slot-${++this.slotCounter}-${Date.now()}` as SlotId;
    const slot: DispatchSlot = {
      slotId,
      providerClass: opts.providerClass,
      accountId: this.accountId,
      acquiredAt: Date.now(),
      estimatedCostUsd: opts.estimatedCostUsd,
      maxLifetimeMs: 60_000,
    };
    this.active.set(slotId, { slot });
    return slot;
  }
}
