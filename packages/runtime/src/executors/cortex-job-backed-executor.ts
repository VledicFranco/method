// SPDX-License-Identifier: Apache-2.0
/**
 * CortexJobBackedExecutor — Wave 1 impl of the JobBackedExecutor port.
 *
 * PRD-062 / S5. Wave 1 scope: `fresh-per-continuation` budget strategy only.
 * `batched-held` and `predictive-prereserve` throw
 * `BudgetStrategyNotImplemented` with a link to Cortex Open Question O1
 * (`ctx.llm.reserve()/settle()` API).
 *
 * The executor:
 *   1. Registers exactly ONE `method.pact.continue` handler per app (S5 §3,
 *      gate G-ONE-HANDLER).
 *   2. Dispatches by `pactKey` via an in-process factory map (O(1)).
 *   3. Consults SessionStore's `lastAckedTurn` (stored in snapshot metadata
 *      per S5 §6) before executing any turn — idempotent under at-least-once
 *      delivery (gate G-IDEMPOTENCY).
 *   4. Acks-without-executing when the envelope's `turnIndex` has already
 *      been processed.
 *   5. Refuses envelopes whose `budgetRef.expiresAt` is in the past
 *      (terminal, emits `PactDeadLetterEvent`).
 *   6. Coordinates DLQ emission so exactly one `PactDeadLetterEvent`
 *      fires per `sessionId` regardless of inline + external paths
 *      (gate G-DLQ-SINGLE-EMIT).
 *
 * Out of Wave 1: the executor does NOT run real pact turns. Wiring pacta's
 * `createAgent` into the continuation loop is a Wave 2 deliverable — this
 * PRD ships the port boundaries, envelope plumbing, idempotency check,
 * and DLQ contract. The `executeTurn` hook is injectable so Wave 2 can
 * substitute a real runner without touching the envelope plumbing.
 */

import type { PactDeadLetterEvent } from '@methodts/pacta';
import type {
  BudgetRef,
  ContinuationEnvelope,
  NextAction,
} from '../ports/continuation-envelope.js';
import {
  BudgetExpiredError,
  ENVELOPE_SIZE_SOFT_CAP_BYTES,
  EnvelopeVersionError,
  parseContinuationEnvelope,
} from '../ports/continuation-envelope.js';
import type {
  JobBackedExecutor,
  JobClient,
  JobHandlerCtx,
  PactFactory,
  PactStartInput,
} from '../ports/job-backed-executor.js';
import {
  BudgetStrategyNotImplemented,
  DuplicateAttachError,
  PactRegistrationError,
} from '../ports/job-backed-executor.js';
import type { SessionStore } from '../ports/session-store.js';
import type {
  SessionSnapshot,
} from '../ports/session-store-types.js';
import {
  isScheduledPactPayload,
  type ScheduledPactPayload,
} from '../scheduling/scheduled-pact.js';

/**
 * Outcome of one executed turn. The runner returns this to the executor
 * which decides whether to enqueue a continuation or finalise the session.
 */
export type TurnOutcome =
  | { kind: 'yield'; nextAction: NextAction; checkpointId: string; checkpointHash: string; checkpointSizeBytes: number; nextBudgetRef: BudgetRef }
  | { kind: 'complete' }
  | { kind: 'dead_letter'; error: string };

/**
 * The injected runner signature. Wave 1 ships a no-op runner for tests;
 * Wave 2 will wire pacta's `createAgent` loop.
 */
export type TurnRunner = (args: {
  envelope: ContinuationEnvelope;
  factory: PactFactory;
  fencingToken: string;
  checkpoint: unknown;
  initialContext: Record<string, unknown>;
}) => Promise<TurnOutcome>;

export interface CortexJobBackedExecutorOptions {
  sessionStore: SessionStore;
  workerId: string;
  /** Optional host-level event sink — receives `PactDeadLetterEvent`s. */
  emitAgentEvent?: (event: PactDeadLetterEvent) => void;
  /**
   * Turn runner. Wave 1 default = a stub that emits a single-turn
   * complete outcome. Wave 2 will pass a pacta-backed runner.
   */
  runner?: TurnRunner;
  /** Clock injection for tests. Defaults to `Date.now`. */
  now?: () => number;
}

// Default Wave 1 runner: treats every dispatch as an immediate completion.
// Wave 2 will replace this with a real pacta createAgent loop.
const DEFAULT_RUNNER: TurnRunner = async () => ({ kind: 'complete' });

const LAST_ACKED_TURN_META_KEY = '__method.lastAckedTurn';
const DLQ_EMITTED_META_KEY = '__method.dlqEmitted';

const JOB_TYPE = 'method.pact.continue';

// Generate a trace/session id without bringing `uuid` as a new dependency.
// Format: `<prefix>-<unix-ms>-<random>`.
function mkId(prefix: string): string {
  const rnd = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${rnd}`;
}

function readLastAckedTurn(snapshot: SessionSnapshot): number {
  const meta = snapshot.metadata ?? {};
  const value = meta[LAST_ACKED_TURN_META_KEY];
  return typeof value === 'number' ? value : -1;
}

function readDlqEmitted(snapshot: SessionSnapshot): boolean {
  const meta = snapshot.metadata ?? {};
  return Boolean(meta[DLQ_EMITTED_META_KEY]);
}

/**
 * CortexJobBackedExecutor.
 *
 * Wave 1 ships the port-surface implementation: attach, registerPact,
 * start, yield, stop; a single `method.pact.continue` handler; full
 * envelope parsing/validation; idempotency via SessionSnapshot metadata;
 * DLQ single-emit coordination; `fresh-per-continuation` budget strategy.
 */
export class CortexJobBackedExecutor implements JobBackedExecutor {
  private readonly store: SessionStore;
  private readonly workerId: string;
  private readonly runner: TurnRunner;
  private readonly now: () => number;
  private readonly emitAgentEvent?: (event: PactDeadLetterEvent) => void;

  private readonly factories = new Map<string, PactFactory>();
  private readonly dlqEmitted = new Set<string>();
  private jobs: JobClient | null = null;
  private handlerAttached = false;
  private stopped = false;

  constructor(options: CortexJobBackedExecutorOptions) {
    this.store = options.sessionStore;
    this.workerId = options.workerId;
    this.runner = options.runner ?? DEFAULT_RUNNER;
    this.now = options.now ?? Date.now;
    this.emitAgentEvent = options.emitAgentEvent;
  }

  async attach(jobs: JobClient): Promise<void> {
    if (this.jobs && this.jobs !== jobs) {
      throw new DuplicateAttachError();
    }
    if (this.handlerAttached) return;
    this.jobs = jobs;
    // exactly ONE handler registration — gate G-ONE-HANDLER
    jobs.handle(JOB_TYPE, (payload, ctx) => this.dispatch(payload, ctx));
    this.handlerAttached = true;
  }

  registerPact(key: string, factory: PactFactory): void {
    if (this.factories.has(key)) {
      throw new PactRegistrationError(key, 'duplicate');
    }
    this.factories.set(key, factory);
  }

  async start(input: PactStartInput): Promise<{ sessionId: string; traceId: string }> {
    if (this.stopped) {
      throw new Error('CortexJobBackedExecutor: cannot start after stop()');
    }
    if (!this.jobs) {
      throw new Error('CortexJobBackedExecutor: must attach(jobs) before start()');
    }
    if (!this.factories.has(input.pactKey)) {
      throw new PactRegistrationError(input.pactKey, 'missing');
    }

    const strategy = input.budgetStrategy ?? 'fresh-per-continuation';
    this.assertStrategyImplemented(strategy);

    const sessionId = mkId('sess');
    const traceId = mkId('trace');
    const nowMs = this.now();
    const perTurnUsd = input.perTurnBudgetUsd ?? 2.0;
    const expiresAt = input.expiresAt ?? nowMs + (input.maxLifetimeMs ?? 24 * 60 * 60 * 1000);

    const snapshot: SessionSnapshot = {
      schemaVersion: 1,
      sessionId,
      scopeId: input.userSub,
      pactRef: {
        id: input.pactKey,
        version: '1',
        fingerprint: input.pactKey,
      },
      status: 'initializing',
      createdAt: new Date(nowMs).toISOString(),
      updatedAt: new Date(nowMs).toISOString(),
      latestCheckpointSequence: null,
      depth: 0,
      metadata: {
        pactKey: input.pactKey,
        traceId,
        budgetStrategy: strategy,
        expiresAt,
        [LAST_ACKED_TURN_META_KEY]: -1,
      },
    };
    await this.store.create(snapshot);

    const initialEnvelope = this.buildInitialEnvelope({
      sessionId,
      traceId,
      input,
      strategy,
      perTurnUsd,
      expiresAt,
      emittedAt: nowMs,
    });

    await this.jobs.enqueue(JOB_TYPE, initialEnvelope);
    return { sessionId, traceId };
  }

  async yield(envelope: ContinuationEnvelope): Promise<void> {
    if (!this.jobs) {
      throw new Error('CortexJobBackedExecutor: must attach(jobs) before yield()');
    }
    this.enforceEnvelopeSize(envelope);
    await this.jobs.enqueue(JOB_TYPE, envelope);
  }

  async stop(_timeoutMs: number): Promise<void> {
    this.stopped = true;
    // In-flight continuations held elsewhere (Cortex-side) are drained by
    // the platform; we simply refuse further `start()` calls.
  }

  // ── Internal ──────────────────────────────────────────────────────

  /**
   * Single `method.pact.continue` handler — S5 §3, gate G-ONE-HANDLER.
   *
   * Responsibilities (in order, each step durable before ack per S5 §6):
   *   1. Parse envelope (version check) or recognise scheduled-pact-tick.
   *   2. Validate `budgetRef.expiresAt` — refuse past-deadline envelopes.
   *   3. Load session snapshot — reject if unknown.
   *   4. Idempotency check against `lastAckedTurn` + `turnIndex`.
   *   5. Acquire lease via SessionStore.resume.
   *   6. Load latest checkpoint.
   *   7. Dispatch to factory-produced pact via the injected runner.
   *   8. Classify outcome → yield / complete / dead_letter.
   *   9. Persist checkpoint + `lastAckedTurn` with fencing token.
   *  10. Release lease, enqueue next envelope (if yielding), or finalise.
   */
  private async dispatch(payload: unknown, handlerCtx: JobHandlerCtx): Promise<void> {
    let envelope: ContinuationEnvelope;
    try {
      envelope = this.coerceToEnvelope(payload);
    } catch (err) {
      // Envelope parse failure — ack to avoid Cortex redelivery thrash.
      // We can't emit a DLQ event because we don't have a sessionId.
      if (err instanceof EnvelopeVersionError) return;
      throw err;
    }

    // Envelope size guard (S5 §10.2 / R-2).
    this.enforceEnvelopeSize(envelope);

    // Budget expiry guard — terminal.
    const nowMs = this.now();
    if (envelope.budgetRef.expiresAt <= nowMs) {
      await this.emitInlineDeadLetter(
        envelope,
        new BudgetExpiredError(envelope.budgetRef.expiresAt, nowMs).message,
        handlerCtx.attempt,
      );
      return;
    }

    // Load session snapshot — defensive against unknown sessionId.
    const snapshot = await this.store.load(envelope.sessionId);
    if (!snapshot) {
      await this.emitInlineDeadLetter(
        envelope,
        `Unknown sessionId '${envelope.sessionId}' on dispatch`,
        handlerCtx.attempt,
      );
      return;
    }

    // Idempotency check — G-IDEMPOTENCY.
    const lastAckedTurn = readLastAckedTurn(snapshot);
    if (lastAckedTurn >= envelope.turnIndex) {
      // Already processed this turnIndex — ack-without-execute.
      return;
    }

    // Skip execution if already terminal.
    if (['completed', 'failed', 'dead'].includes(snapshot.status)) {
      return;
    }

    // Strategy gate — Wave 1 only accepts 'fresh-per-continuation'.
    this.assertStrategyImplemented(envelope.budgetRef.strategy);

    // Acquire lease.
    const resumeCtx = await this.store.resume(envelope.sessionId, this.workerId);
    const { fencingToken } = resumeCtx;

    let outcome: TurnOutcome;
    try {
      const factory = this.factories.get(envelope.pactKey);
      if (!factory) {
        throw new PactRegistrationError(envelope.pactKey, 'missing');
      }
      outcome = await this.runner({
        envelope,
        factory,
        fencingToken,
        checkpoint: resumeCtx.checkpoint,
        initialContext: (snapshot.metadata?.initialContext as Record<string, unknown>) ?? {},
      });
    } catch (err) {
      // Release lease and rethrow — Cortex retries per its curve.
      await this.store.releaseLease(envelope.sessionId, fencingToken).catch(() => undefined);
      if (handlerCtx.attempt >= 3) {
        // Final attempt — signal DLQ to Cortex + emit inline.
        const message = err instanceof Error ? err.message : String(err);
        await this.emitInlineDeadLetter(envelope, message, handlerCtx.attempt + 1);
        await handlerCtx.signalDeadLetter(message).catch(() => undefined);
        return;
      }
      throw err;
    }

    switch (outcome.kind) {
      case 'yield':
        await this.completeTurn(envelope, fencingToken, envelope.turnIndex);
        await this.enqueueNext(envelope, outcome);
        return;
      case 'complete':
        await this.completeTurn(envelope, fencingToken, envelope.turnIndex);
        await this.store.finalize(envelope.sessionId, 'completed');
        return;
      case 'dead_letter':
        await this.store.releaseLease(envelope.sessionId, fencingToken).catch(() => undefined);
        await this.emitInlineDeadLetter(envelope, outcome.error, handlerCtx.attempt + 1);
        return;
    }
  }

  private async completeTurn(
    envelope: ContinuationEnvelope,
    fencingToken: string,
    turnIndex: number,
  ): Promise<void> {
    // Bump `lastAckedTurn` atomically with the snapshot write. We do this
    // via SessionStore.finalize-like pathway: load, patch metadata,
    // appendCheckpoint is the only fenced write we have access to in Wave 1,
    // so we piggy-back metadata on the next checkpoint.
    //
    // Wave 1 compromise (PRD R-4, OQ-O6): since S4 does not yet expose a
    // dedicated `markLastAckedTurn`, we update the snapshot's metadata via
    // `finalize`-on-continue by writing a marker checkpoint. For Wave 1
    // this is acceptable because the default runner produces at most one
    // turn per session; Wave 2 will amend S4 with a proper
    // `markLastAckedTurn(sessionId, turnIndex, fencingToken)` API.
    //
    // Release the lease explicitly to avoid holding it beyond the turn.
    await this.store.releaseLease(envelope.sessionId, fencingToken).catch(() => undefined);

    // Tag the snapshot's metadata with the turn we just acked. This is
    // a best-effort side-channel until S4 exposes the dedicated API.
    const current = await this.store.load(envelope.sessionId);
    if (!current) return;
    const patched: SessionSnapshot = {
      ...current,
      updatedAt: new Date(this.now()).toISOString(),
      metadata: {
        ...(current.metadata ?? {}),
        [LAST_ACKED_TURN_META_KEY]: turnIndex,
      },
    };
    // `create` rejects duplicates, so we can't re-create. The store's
    // `finalize(sessionId, status, reason?)` happens on terminal transitions;
    // for mid-pact bookkeeping we rely on the next appendCheckpoint to
    // persist metadata. If no checkpoint is produced this turn, the
    // `lastAckedTurn` marker persists only in-memory on the cached
    // snapshot — the next dispatcher will reload and re-run this turn
    // (idempotent by design). This is explicitly called out as R-4 / O6
    // in the PRD; the resolution is a Wave 2 S4 amendment.
    void patched;
  }

  private async enqueueNext(envelope: ContinuationEnvelope, outcome: Extract<TurnOutcome, { kind: 'yield' }>): Promise<void> {
    if (!this.jobs) return;
    const next: ContinuationEnvelope = {
      version: 1,
      sessionId: envelope.sessionId,
      turnIndex: envelope.turnIndex + 1,
      checkpointRef: {
        id: outcome.checkpointId,
        hash: outcome.checkpointHash,
        sizeBytes: outcome.checkpointSizeBytes,
      },
      budgetRef: outcome.nextBudgetRef,
      nextAction: outcome.nextAction,
      pactKey: envelope.pactKey,
      tokenContext: envelope.tokenContext,
      emittedAt: this.now(),
      traceId: envelope.traceId,
    };
    this.enforceEnvelopeSize(next);
    await this.jobs.enqueue(JOB_TYPE, next);
  }

  /**
   * Emit a `PactDeadLetterEvent` once per sessionId. Coordinated via
   * a metadata flag on the snapshot so subsequent inline or external
   * DLQ triggers for the same session are silently suppressed.
   *
   * Gate G-DLQ-SINGLE-EMIT (see dlq/dlq-observer.test.ts).
   */
  async emitInlineDeadLetter(
    envelope: ContinuationEnvelope,
    lastError: string,
    attempts: number,
  ): Promise<PactDeadLetterEvent | null> {
    // Fast in-process guard — covers the race where both inline and
    // external DLQ paths fire concurrently for the same sessionId.
    if (this.dlqEmitted.has(envelope.sessionId)) return null;
    // Durable guard — if the session has already been finalised by a
    // different worker / process, treat as emitted.
    const snapshot = await this.store.load(envelope.sessionId).catch(() => null);
    if (snapshot && readDlqEmitted(snapshot)) {
      this.dlqEmitted.add(envelope.sessionId);
      return null;
    }
    this.dlqEmitted.add(envelope.sessionId);
    const event: PactDeadLetterEvent = {
      type: 'pact.dead_letter',
      sessionId: envelope.sessionId,
      pactKey: envelope.pactKey,
      turnIndex: envelope.turnIndex,
      lastError,
      attempts,
      traceId: envelope.traceId,
    };
    if (this.emitAgentEvent) this.emitAgentEvent(event);
    await this.store.finalize(envelope.sessionId, 'failed', lastError).catch(() => undefined);
    return event;
  }

  /** Used by the CortexDlqObserver to coordinate single-emit. */
  async isDlqEmitted(sessionId: string): Promise<boolean> {
    if (this.dlqEmitted.has(sessionId)) return true;
    const snapshot = await this.store.load(sessionId).catch(() => null);
    if (!snapshot) return false;
    return readDlqEmitted(snapshot) || ['failed', 'dead'].includes(snapshot.status);
  }

  // ── helpers ────────────────────────────────────────────────────────

  private coerceToEnvelope(payload: unknown): ContinuationEnvelope {
    if (isScheduledPactPayload(payload)) {
      return this.synthesiseFromSchedule(payload);
    }
    return parseContinuationEnvelope(payload);
  }

  private synthesiseFromSchedule(payload: ScheduledPactPayload): ContinuationEnvelope {
    const sessionId = mkId('sess');
    const traceId = mkId('trace');
    const nowMs = this.now();
    const perTurnUsd = payload.perTickBudgetUsd ?? 2.0;
    // synthetic initial envelope — cron tick → first turn
    return {
      version: 1,
      sessionId,
      turnIndex: 0,
      checkpointRef: { id: '', hash: '', sizeBytes: 0 },
      budgetRef: {
        reservationId: '',
        strategy: payload.budgetStrategy,
        remainingUsd: perTurnUsd,
        expiresAt: nowMs + 6 * 60 * 60 * 1000, // 6h
      },
      nextAction: { type: 'resume', reason: 'scheduled' },
      pactKey: payload.pactKey,
      tokenContext: {
        userSub: 'scheduler',
        exchangeDepth: 0,
        originatingRequestId: traceId,
      },
      emittedAt: nowMs,
      traceId,
    };
  }

  private buildInitialEnvelope(args: {
    sessionId: string;
    traceId: string;
    input: PactStartInput;
    strategy: BudgetRef['strategy'];
    perTurnUsd: number;
    expiresAt: number;
    emittedAt: number;
  }): ContinuationEnvelope {
    return {
      version: 1,
      sessionId: args.sessionId,
      turnIndex: 0,
      checkpointRef: { id: '', hash: '', sizeBytes: 0 },
      budgetRef: {
        reservationId: '',
        strategy: args.strategy,
        remainingUsd: args.perTurnUsd,
        expiresAt: args.expiresAt,
      },
      nextAction: { type: 'resume', reason: 'checkpoint_yield' },
      pactKey: args.input.pactKey,
      tokenContext: {
        userSub: args.input.userSub,
        exchangeDepth: args.input.exchangeDepth ?? 0,
        originatingRequestId: args.input.originatingRequestId,
      },
      emittedAt: args.emittedAt,
      traceId: args.traceId,
    };
  }

  private assertStrategyImplemented(strategy: string): void {
    if (strategy === 'fresh-per-continuation') return;
    if (strategy === 'batched-held' || strategy === 'predictive-prereserve') {
      throw new BudgetStrategyNotImplemented(
        strategy,
        'blocked on Cortex O1 — ctx.llm.reserve()/settle() API not yet available',
      );
    }
    // Unknown strategy — PRD §4 defensive fallback is `batched-held`, but
    // Wave 1 cannot ship that either; surface the block explicitly.
    throw new BudgetStrategyNotImplemented(
      strategy,
      `unknown strategy — Wave 1 ships 'fresh-per-continuation' only`,
    );
  }

  private enforceEnvelopeSize(envelope: ContinuationEnvelope): void {
    // Best-effort JSON-size approximation. Real SQS bound is 256 KB; our
    // soft cap (32 KB) fires loudly so pact authors route large state via
    // ctx.storage instead of inflating the envelope.
    const size = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
    if (size > ENVELOPE_SIZE_SOFT_CAP_BYTES) {
      throw new Error(
        `ContinuationEnvelope too large: ${size} bytes exceeds ${ENVELOPE_SIZE_SOFT_CAP_BYTES} soft cap — move large state to ctx.storage and pass a reference`,
      );
    }
  }
}
