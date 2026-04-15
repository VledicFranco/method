/**
 * ContinuationEnvelope v1 — the wire format for pact continuations (PRD-062 / S5 §2.1).
 *
 * Frozen: 2026-04-14 — see `.method/sessions/fcd-surface-job-backed-executor/decision.md`.
 *
 * Written to `ctx.jobs` as the job payload whenever a pact yields (suspends)
 * between workers. The next worker pulls it, rehydrates via SessionStore,
 * and invokes the pact with `nextAction` as the resumption signal.
 *
 * INVARIANT: `(sessionId, turnIndex)` is the idempotency key. At-least-once
 * SQS delivery may invoke a handler with the same envelope twice; the
 * runtime MUST detect duplicates via SessionStore's `lastAckedTurn` and
 * ack-without-re-executing on replay.
 *
 * Breaking changes require `version: 2` + a dual-parse window. Gate
 * `G-ENVELOPE-VERSION` enforces the literal `version: 1` in this file.
 */

/** Opaque reference to a checkpoint in SessionStore (S4). */
export interface CheckpointRef {
  /** SessionStore-scoped id; opaque to Cortex. */
  id: string;
  /** Content hash for integrity check on load. */
  hash: string;
  /** Size hint (bytes) — lets workers reject oversized loads fast. */
  sizeBytes: number;
}

/**
 * Budget carry-over strategies (S5 §5).
 *
 * Wave 1 ships `fresh-per-continuation` only. `batched-held` and
 * `predictive-prereserve` are gated on Cortex Open Question O1
 * (`ctx.llm.reserve()/settle()` API). The executor throws
 * `BudgetStrategyNotImplemented` at runtime when an unimplemented
 * strategy is requested; unknown strategy values fall back defensively
 * to `batched-held` per S5 §9.
 */
export type BudgetCarryStrategy =
  | 'fresh-per-continuation'
  | 'batched-held'
  | 'predictive-prereserve';

/** Opaque reference to a budget reservation. */
export interface BudgetRef {
  /** Reservation id returned by `ctx.llm` reservation call (S3). */
  reservationId: string;
  /** Strategy the envelope was issued under (see §5). */
  strategy: BudgetCarryStrategy;
  /**
   * Budget remaining at envelope emission (USD). Advisory — authoritative
   * value lives in ctx.llm.
   */
  remainingUsd: number;
  /**
   * Absolute wall-clock deadline (UTC ms). After this, the continuation
   * MUST refuse.
   */
  expiresAt: number;
}

/**
 * What the resumption turn must perform (S5 §2.1).
 *
 * Scoped to the continuation envelope — this is NOT the same shape as
 * `NextAction` in `./session-store-types.ts`, which is the S4 checkpoint
 * resume hint. Consumers should import this type by its re-exported
 * alias `ContinuationNextAction` from the `/ports` barrel to disambiguate.
 */
export type NextAction =
  | { type: 'resume'; reason: 'async_io' | 'scheduled' | 'checkpoint_yield' }
  | { type: 'retry'; attempt: number; lastError: string }
  | { type: 'gate_wait'; gateId: string; waitingFor: string };

export interface TokenContext {
  /** User the pact acts on behalf of (sub claim). */
  userSub: string;
  /** Exchange depth so far (RFC 8693). Cortex caps at 2. */
  exchangeDepth: number;
  /** Original request id for audit trail. */
  originatingRequestId: string;
}

/**
 * PRD-067: cross-app continuation context.
 *
 * Present only when the continuation arose from or is awaiting a
 * `cross-app-invoke` node. Absent for pure in-app pacts — envelopes
 * serialised pre-PRD-067 round-trip byte-identically
 * (G-ENVELOPE-BACKWARD-COMPAT).
 *
 * Surface freeze: 2026-04-15 — additive extension of S5 `version: 1` per
 * S5 §9 ("Additional envelope fields — MUST keep version: 1 semantics
 * compatible; add optional fields only.").
 */
export interface CrossAppContinuationContext {
  /** Node id in the caller's DAG that triggered the cross-app call. */
  readonly callerNodeId: string;
  /** Target app id the caller dispatched to. */
  readonly targetAppId: string;
  /** Operation name on the target app. */
  readonly operation: string;
  /** Originating request id on the caller side — lets the resumption path
   *  correlate with the caller's audit entry. Matches
   *  `tokenContext.originatingRequestId` of the emitting envelope. */
  readonly originatingRequestId: string;
  /** Cortex PRD-080 decisionId returned on the outbound invoke — lookup key
   *  for audit correlation and (when async) callee-completion polling. */
  readonly targetDecisionId: string;
  /**
   * Phase of the cross-app call (PRD-067 §6.3):
   *   - "awaiting_callee" — caller suspended, callee's pact is running in
   *     its own app's job queue; resumption happens when the caller's
   *     ctx.events subscription receives
   *     `method.cross_app.target_event.type=completed`.
   *   - "completed" — output merged into DAG bundle, envelope moves on.
   *   - "failed" — target returned error; strategy gate decides retry.
   */
  readonly phase: 'awaiting_callee' | 'completed' | 'failed';
  /** Populated only when `phase === 'completed'` — opaque JSON merged by
   *  the `output_merge` policy of the caller node. */
  readonly calleeOutput?: Readonly<Record<string, unknown>>;
  /** Populated only when `phase === 'failed'` — human-readable reason for
   *  the gate decision. */
  readonly failureReason?: string;
}

/**
 * The canonical continuation envelope. Frozen wire schema at `version: 1`.
 *
 * Extension rule: additional OPTIONAL fields may be added without a
 * version bump; any structural/required-field change requires `version: 2`
 * + a dual-parse window. The literal `version: 1` MUST be preserved
 * (G-ENVELOPE-VERSION).
 */
export interface ContinuationEnvelope {
  /** Envelope schema version. Bump on breaking changes. */
  version: 1;

  /** Stable pact identifier — survives across all continuations. */
  sessionId: string;

  /** Monotonic turn counter. n-th continuation has turnIndex = n. */
  turnIndex: number;

  /** Pointer into SessionStore for the checkpoint the next worker must load. */
  checkpointRef: CheckpointRef;

  /** Pointer into the budget reservation the next worker inherits. */
  budgetRef: BudgetRef;

  /** What the next worker must do when it wakes. */
  nextAction: NextAction;

  /** Pact factory registration key — which pact to instantiate. */
  pactKey: string;

  /** Parent user token context for RFC 8693 re-exchange on resume. */
  tokenContext: TokenContext;

  /** Timestamp the previous worker emitted the envelope (UTC ms). */
  emittedAt: number;

  /** Opaque tracing id spanning the full pact lifecycle. */
  traceId: string;

  /**
   * PRD-067: OPTIONAL cross-app continuation context.
   *
   * Present only when this continuation arose from or is awaiting a
   * `cross-app-invoke` node. Absent for pure in-app pacts; an envelope
   * serialised pre-PRD-067 round-trips byte-identically when this field is
   * missing (G-ENVELOPE-BACKWARD-COMPAT).
   *
   * This is an ADDITIVE extension of S5 `version: 1` per S5 §9 and does not
   * require a `version: 2` bump. See `CrossAppContinuationContext` above.
   */
  readonly crossApp?: CrossAppContinuationContext;
}

/**
 * Soft cap (bytes) on a serialised envelope, enforced by the executor at
 * `yield()` time (S5 §10.2). Well under the 256 KB SQS cap; keeps
 * envelopes small + cheap to transport.
 */
export const ENVELOPE_SIZE_SOFT_CAP_BYTES = 32 * 1024;

/**
 * Error thrown when the executor encounters a continuation whose
 * `version` is not `1`. The runtime MUST NOT attempt to parse forward.
 */
export class EnvelopeVersionError extends Error {
  readonly observedVersion: unknown;
  constructor(observedVersion: unknown) {
    super(
      `ContinuationEnvelope.version ${String(observedVersion)} not supported — runtime speaks version: 1`,
    );
    this.name = 'EnvelopeVersionError';
    this.observedVersion = observedVersion;
  }
}

/**
 * Error thrown when a continuation arrives after its budget reservation
 * has expired (`BudgetRef.expiresAt <= now`). Terminal — session is
 * finalised and a DLQ event is emitted (S5 §5 expiry, §7 DLQ).
 */
export class BudgetExpiredError extends Error {
  readonly expiresAt: number;
  readonly now: number;
  constructor(expiresAt: number, now: number) {
    super(`BudgetRef expired at ${new Date(expiresAt).toISOString()} (now ${new Date(now).toISOString()})`);
    this.name = 'BudgetExpiredError';
    this.expiresAt = expiresAt;
    this.now = now;
  }
}

/**
 * Structural validation of a raw payload into a `ContinuationEnvelope`.
 * Throws `EnvelopeVersionError` if `version !== 1`. Returns the same
 * reference on success (no structural copy — callers should treat as
 * immutable).
 */
export function parseContinuationEnvelope(payload: unknown): ContinuationEnvelope {
  if (!payload || typeof payload !== 'object') {
    throw new EnvelopeVersionError(undefined);
  }
  const maybe = payload as { version?: unknown };
  if (maybe.version !== 1) {
    throw new EnvelopeVersionError(maybe.version);
  }
  // Duck-typed: downstream consumers (the executor) validate shape by use.
  return payload as ContinuationEnvelope;
}
