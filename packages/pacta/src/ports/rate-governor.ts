// SPDX-License-Identifier: Apache-2.0
/**
 * RateGovernor — Base port interface (PRD 051 S2).
 *
 * Defined in pacta (L3) so the Throttler middleware can consume it
 * without importing from bridge (L4). Bridge implements this interface
 * and extends it with utilization/activeSlots for admin endpoints.
 */

import type { ProviderClass, SlotId, AccountId } from '@methodts/types';

// ── Slot types ──────────────────────────────────────────────────

export interface DispatchSlot {
  readonly slotId: SlotId;
  readonly providerClass: ProviderClass;
  readonly accountId: AccountId;
  readonly acquiredAt: number;
  readonly estimatedCostUsd: number;
  readonly maxLifetimeMs: number;
}

export interface AcquireOptions {
  providerClass: ProviderClass;
  estimatedCostUsd: number;
  /** REQUIRED — callers must reason about how long they're willing to wait. */
  timeoutMs: number;
  abortSignal?: AbortSignal;
}

export interface ObserveOutcome {
  slotId: SlotId;
  actualCostUsd: number;
  actualDurationMs: number;
  /** Provider reports retries it made internally. */
  attemptCount: number;
  outcome: 'success' | 'transient_error' | 'permanent_error' | 'rate_limited' | 'timeout';
}

// ── Base interface (consumed by Throttler middleware) ────────────

export interface RateGovernor {
  acquireSlot(opts: AcquireOptions): Promise<DispatchSlot>;
  releaseSlot(outcome: ObserveOutcome): Promise<void>;
}

// ── Errors ──────────────────────────────────────────────────────

/** Thrown when all accounts are saturated and projected wait exceeds timeoutMs. */
export class SaturationError extends Error {
  constructor(providerClass: ProviderClass, timeoutMs: number) {
    super(
      `All ${providerClass} accounts saturated; projected wait exceeds ${timeoutMs}ms`,
    );
    this.name = 'SaturationError';
  }
}
