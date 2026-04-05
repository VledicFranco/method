/**
 * Throttler Middleware — wraps provider invocations with rate-limit slot
 * acquisition + release, and records outcomes for observability.
 *
 * Middleware ordering: Throttler (outermost) → Budget Enforcer → Output
 * Validator → Provider. The throttler wraps everything so the slot is held
 * for the full pipeline duration.
 *
 * Slot lifecycle (PRD 051 S2):
 *   1. acquireSlot(): blocks until a slot is available or timeout/abort.
 *   2. invoke inner pipeline.
 *   3. releaseSlot(): always called (try/finally), even on throw.
 */

import type { Pact, AgentRequest, AgentResult } from '../pact.js';
import type { ProviderClass, SlotId } from '@method/types';
import type { RateGovernor, DispatchSlot, ObserveOutcome } from '../ports/rate-governor.js';
import {
  isProviderError,
  isTransientError,
  isPermanentError,
  RateLimitError,
} from '../errors.js';

type InvokeFn<T> = (pact: Pact<T>, request: AgentRequest) => Promise<AgentResult<T>>;

export interface ThrottlerOptions {
  readonly rateGovernor: RateGovernor;
  readonly providerClass: ProviderClass;
  /** Max time to wait for a slot before throwing SaturationError. */
  readonly slotTimeoutMs?: number;
  /** Estimated cost for slot reservation. Default $0.05. */
  readonly estimatedCostUsd?: number;
}

/**
 * Wrap an InvokeFn with rate-limit slot acquisition.
 *
 * Every invocation acquires a slot before running. On completion (success
 * or error), the slot is released with the outcome. The caller of this
 * middleware must hold a reference to the rate governor for lifecycle
 * cleanup.
 */
export function throttler<T>(
  inner: InvokeFn<T>,
  options: ThrottlerOptions,
): InvokeFn<T> {
  const {
    rateGovernor,
    providerClass,
    slotTimeoutMs = 30_000,
    estimatedCostUsd = 0.05,
  } = options;

  return async (pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>> => {
    const slot: DispatchSlot = await rateGovernor.acquireSlot({
      providerClass,
      estimatedCostUsd,
      timeoutMs: slotTimeoutMs,
      abortSignal: request.abortSignal,
    });

    const startedAt = Date.now();
    let outcome: ObserveOutcome['outcome'] = 'success';
    let actualCostUsd = 0;
    let actualDurationMs = 0;
    let attemptCount = 1;
    let result: AgentResult<T> | undefined;
    let thrown: unknown;

    try {
      result = await inner(pact, request);
      actualCostUsd = result.cost?.totalUsd ?? 0;
      actualDurationMs = result.durationMs ?? (Date.now() - startedAt);
      attemptCount = result.turns ?? 1;
      outcome = 'success';
    } catch (err) {
      thrown = err;
      actualDurationMs = Date.now() - startedAt;
      outcome = classifyOutcome(err);
    } finally {
      await rateGovernor.releaseSlot({
        slotId: slot.slotId,
        actualCostUsd,
        actualDurationMs,
        attemptCount,
        outcome,
      });
    }

    if (thrown !== undefined) throw thrown;
    return result!;
  };
}

function classifyOutcome(err: unknown): ObserveOutcome['outcome'] {
  if (err instanceof RateLimitError) return 'rate_limited';
  if (isProviderError(err)) {
    if (isTransientError(err)) {
      // Check for timeout by code
      const code = (err as { code?: string }).code;
      if (code === 'TIMEOUT') return 'timeout';
      return 'transient_error';
    }
    if (isPermanentError(err)) return 'permanent_error';
  }
  // Unknown error — classify as transient to be conservative
  return 'transient_error';
}

/** Utility: create a slot-id brand helper for tests/impls. */
export function brandSlotId(id: string): SlotId {
  return id as SlotId;
}
