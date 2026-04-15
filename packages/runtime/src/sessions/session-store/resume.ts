/**
 * Adapter-agnostic resume algorithm — PRD-061 §6.3 / S4 §6.
 *
 * Callers pass a `SessionStore` plus a minimal `BudgetEnforcer` adapter; this
 * function performs the 5-step ritual:
 *
 *   1. atomic load + lease (delegated to `store.resume`)
 *   2. fingerprint check (via `requireFingerprint`)
 *   3. budget rehydrate-or-reserve (via `BudgetEnforcer.rehydrateOrReserve`)
 *   4. consumer-side event replay (via optional `EventReader`)
 *   5. lease heartbeat timer that renews the lease until stopped
 *
 * The algorithm itself is pure composition — no adapter-specific types leak in.
 */

import type { EventReader } from '../../ports/event-reader.js';
import type { SessionStore } from '../../ports/session-store.js';
import type {
  BudgetReservation,
  Checkpoint,
  NextAction,
  SessionSnapshot,
} from '../../ports/session-store-types.js';
import { SessionStoreError } from '../../ports/session-store-errors.js';

/** Minimal budget enforcer contract used by resume. Defined locally to avoid
 * a circular dep with `@method/pacta`; the real implementation lives there.
 */
export interface BudgetEnforcer {
  /**
   * Given the checkpoint's stored reservation (or null for fresh sessions),
   * decide whether to rehydrate the existing handle or reserve a fresh one.
   * MUST be idempotent — called exactly once per resume.
   */
  rehydrateOrReserve(prior: BudgetReservation | null): Promise<BudgetReservation>;
}

/** Bare-minimum pact reference shape. Adapter-neutral. */
export interface ResumedPact {
  readonly id: string;
  readonly version: string;
  readonly fingerprint: string;
}

/** Handle returned to the caller; stopping the heartbeat releases the lease. */
export interface LeaseHeartbeat {
  /** Stop renewing. Does NOT release the lease — call `store.releaseLease` for that. */
  stop(): void;
  /** Current timer ms-until-next-renew (test introspection). */
  readonly intervalMs: number;
}

export interface PerformResumeArgs {
  readonly store: SessionStore;
  readonly sessionId: string;
  readonly workerId: string;
  readonly pact: ResumedPact;
  readonly budget: BudgetEnforcer;
  readonly eventReader?: EventReader;
  readonly leaseTtlMs?: number;
  /**
   * Override for the heartbeat cadence. Default = `leaseTtlMs / 3`, clamped
   * between 1s and 10s.
   */
  readonly heartbeatIntervalMs?: number;
  /**
   * Override timer bindings for tests. Production callers leave this unset.
   */
  readonly timers?: TimerBindings;
}

export interface TimerBindings {
  readonly setInterval: (fn: () => void, ms: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
}

const DEFAULT_TIMERS: TimerBindings = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export interface ResumeOutcome {
  readonly snapshot: SessionSnapshot;
  readonly checkpoint: Checkpoint | null;
  readonly fencingToken: string;
  readonly leaseExpiresAt: string;
  readonly nextAction: NextAction;
  readonly freshBudget: BudgetReservation;
  readonly heartbeat: LeaseHeartbeat;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Run the 5-step resume algorithm. Rethrows adapter errors untouched so the
 * typed `SessionStoreError` reaches the caller intact.
 */
export async function performResume(args: PerformResumeArgs): Promise<ResumeOutcome> {
  const leaseTtlMs = args.leaseTtlMs ?? 30_000;

  // Step 1 & 2: atomic load + lease + fingerprint verification.
  const rc = await args.store.resume(args.sessionId, args.workerId, {
    leaseTtlMs,
    requireFingerprint: true,
    expectedFingerprint: args.pact.fingerprint,
  });

  // Belt-and-suspenders fingerprint check — implementations that do not
  // honour `expectedFingerprint` still get caught here.
  if (rc.snapshot.pactRef.fingerprint !== args.pact.fingerprint) {
    // Best-effort lease release; swallow errors so the original failure wins.
    await args.store.releaseLease(args.sessionId, rc.fencingToken).catch(() => undefined);
    throw new SessionStoreError(
      'FINGERPRINT_MISMATCH',
      `Pact fingerprint drift: stored=${rc.snapshot.pactRef.fingerprint} current=${args.pact.fingerprint}`,
      { sessionId: args.sessionId, retryable: false },
    );
  }

  // Step 3: budget rehydrate-or-reserve.
  const freshBudget = await args.budget.rehydrateOrReserve(rc.checkpoint?.pendingBudget ?? null);

  // Step 4: replay events to re-registered consumers (NOT to the agent).
  if (args.eventReader && rc.checkpoint) {
    const cursor = rc.checkpoint.eventCursor;
    // `EventReader` in this codebase offers `readRange`; if available, use it.
    const reader = args.eventReader as EventReader & {
      replay?: (opts: {
        filter: { sessionId: string };
        sinceSequence: number;
      }) => Promise<void>;
    };
    if (typeof reader.replay === 'function') {
      await reader.replay({
        filter: { sessionId: args.sessionId },
        sinceSequence: cursor.sequence,
      });
    }
    // Absence of `replay` is a documented soft path — see PRD-061 R-5. The
    // caller is expected to coordinate replay through its own bus when the
    // reader lacks seek.
  }

  // Step 5: start the lease heartbeat.
  const heartbeatMs = clamp(
    args.heartbeatIntervalMs ?? Math.floor(leaseTtlMs / 3),
    1_000,
    10_000,
  );
  const heartbeat = startLeaseHeartbeat({
    store: args.store,
    sessionId: args.sessionId,
    fencingToken: rc.fencingToken,
    intervalMs: heartbeatMs,
    leaseTtlMs,
    timers: args.timers ?? DEFAULT_TIMERS,
  });

  return {
    snapshot: rc.snapshot,
    checkpoint: rc.checkpoint,
    fencingToken: rc.fencingToken,
    leaseExpiresAt: rc.leaseExpiresAt,
    nextAction: rc.checkpoint?.nextAction ?? { kind: 'await-prompt' },
    freshBudget,
    heartbeat,
  };
}

interface HeartbeatArgs {
  readonly store: SessionStore;
  readonly sessionId: string;
  readonly fencingToken: string;
  readonly intervalMs: number;
  readonly leaseTtlMs: number;
  readonly timers: TimerBindings;
}

export function startLeaseHeartbeat(args: HeartbeatArgs): LeaseHeartbeat {
  const handle = args.timers.setInterval(() => {
    args.store
      .renewLease(args.sessionId, args.fencingToken, args.leaseTtlMs)
      .catch(() => {
        // Best-effort renewal. If the lease was lost (FENCED), the next
        // `appendCheckpoint` will surface the error. No throw from a timer.
      });
  }, args.intervalMs);

  return {
    stop() {
      args.timers.clearInterval(handle);
    },
    intervalMs: args.intervalMs,
  };
}
