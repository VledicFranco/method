// SPDX-License-Identifier: Apache-2.0
/**
 * JobBackedExecutor — drives a pact across worker boundaries via ctx.jobs.
 *
 * PRD-062 / S5 §2.2. Frozen: 2026-04-14.
 *
 * Owner:    @methodts/runtime
 * Producer: @methodts/runtime (impl: CortexJobBackedExecutor)
 * Consumer: tenant app composition root (wires ctx.jobs into the executor)
 *
 * The tenant app never calls `enqueue`/`dispatch` directly — it registers
 * the executor once (`attach(ctx.jobs)`) and the runtime internally emits
 * continuations whenever a pact yields.
 */

import type { Pact } from '@methodts/pacta';
import type {
  ContinuationEnvelope,
  BudgetRef,
  NextAction,
} from './continuation-envelope.js';

export interface JobBackedExecutor {
  /**
   * Wire the executor into a tenant's ctx.jobs. Registers exactly ONE handler
   * (`method.pact.continue`) that dispatches all pact continuations for the
   * entire app. Safe to call in app boot or test harnesses.
   *
   * Must be called before `start()`. Throws `DuplicateAttachError` if called
   * twice with different `JobClient` instances.
   */
  attach(jobs: JobClient): Promise<void>;

  /**
   * Register a pact factory under a stable key. Continuations reference pacts
   * by key so the envelope stays small and forward-compatible across deploys.
   *
   * A factory returns a `Pact` given the rehydrated input context.
   */
  registerPact(key: string, factory: PactFactory): void;

  /**
   * Start a new pact as a job-backed execution. Returns the sessionId —
   * results arrive via the tenant's `events` channel, not as a return value.
   *
   * The first turn runs inline (attempt to complete synchronously); if the
   * pact yields, subsequent turns run in jobs.
   */
  start(input: PactStartInput): Promise<{ sessionId: string; traceId: string }>;

  /**
   * Emit a continuation envelope. Called internally when a pact yields.
   * Surface is exposed on the port so alternative executors (testkit) can
   * observe + assert on envelope emission.
   */
  yield(envelope: ContinuationEnvelope): Promise<void>;

  /**
   * Graceful shutdown: stop accepting new pacts, drain in-flight continuations
   * up to `timeoutMs`, unack anything still running so SQS re-delivers.
   */
  stop(timeoutMs: number): Promise<void>;
}

export interface PactStartInput {
  pactKey: string;
  initialPrompt: string;
  userSub: string;
  originatingRequestId: string;
  /** Hard wall-clock cap across ALL continuations. Default 24h. */
  maxLifetimeMs?: number;
  /**
   * Budget strategy for this invocation. Defaults to `'fresh-per-continuation'`
   * in Wave 1 (S5 §5). Other strategies throw `BudgetStrategyNotImplemented`
   * until Cortex O1 (`ctx.llm.reserve()/settle()`) lands.
   */
  budgetStrategy?: 'fresh-per-continuation' | 'batched-held' | 'predictive-prereserve';
  /** Per-turn budget cap (USD) for `fresh-per-continuation`. Default 2.0. */
  perTurnBudgetUsd?: number;
  /** Absolute deadline for the whole pact (UTC ms). Default `now + 24h`. */
  expiresAt?: number;
  /** Optional initial context passed to the factory. */
  initialContext?: Record<string, unknown>;
  /** RFC 8693 exchange depth so far. Default 0. */
  exchangeDepth?: number;
}

/**
 * Factory signature. Called on every turn — the executor rehydrates
 * checkpoint + budget + nextAction, then invokes the factory to produce
 * a `Pact` that will execute this turn.
 */
export type PactFactory = (rehydrated: {
  /** Opaque — SessionStore deserializes. First turn sees `null`. */
  checkpoint: unknown;
  budget: BudgetRef;
  nextAction: NextAction;
  initialContext: Record<string, unknown>;
}) => Pact;

/**
 * Minimal slice of ctx.jobs the runtime consumes. Cortex's JobClient is
 * structurally compatible. A test-only LocalJobClient implements the same
 * surface for `npm run bridge:test`.
 */
export interface JobClient {
  enqueue(jobType: string, payload: unknown): Promise<{ jobId: string }>;
  handle(
    jobType: string,
    handler: (payload: unknown, ctx: JobHandlerCtx) => Promise<void>,
  ): void;
}

export interface JobHandlerCtx {
  /** Attempt number (0 = first delivery, 1-4 = retries per PRD-071). */
  attempt: number;
  /**
   * Called by runtime when the continuation is effectively DLQ'd (attempt=4
   * failed). Signals Cortex that the job should be moved to the DLQ rather
   * than retried further.
   */
  signalDeadLetter: (error: string) => Promise<void>;
}

/**
 * Thrown when `attach()` is called twice on the same executor with
 * structurally different `JobClient` instances. Re-attaching with the
 * same instance is a no-op (idempotent, S5 §3).
 */
export class DuplicateAttachError extends Error {
  constructor() {
    super('JobBackedExecutor.attach called twice with a different JobClient');
    this.name = 'DuplicateAttachError';
  }
}

/**
 * Thrown when `registerPact` is called twice with the same key, or when
 * `start`/dispatch references a pactKey that was never registered.
 */
export class PactRegistrationError extends Error {
  readonly pactKey: string;
  constructor(pactKey: string, reason: 'duplicate' | 'missing') {
    super(
      reason === 'duplicate'
        ? `Pact '${pactKey}' already registered`
        : `Pact '${pactKey}' not registered — call runtime.registerPact first`,
    );
    this.name = 'PactRegistrationError';
    this.pactKey = pactKey;
  }
}

/**
 * Thrown when the envelope requests a budget strategy that isn't
 * implemented in this wave (S5 §5).
 *
 * Wave 1 supports `'fresh-per-continuation'` only. `'batched-held'` and
 * `'predictive-prereserve'` are gated on Cortex Open Question O1
 * (`ctx.llm.reserve()/settle()` API).
 */
export class BudgetStrategyNotImplemented extends Error {
  readonly strategy: string;
  constructor(strategy: string, reason: string = 'blocked on Cortex O1') {
    super(`Budget strategy '${strategy}' not implemented in Wave 1 — ${reason}`);
    this.name = 'BudgetStrategyNotImplemented';
    this.strategy = strategy;
  }
}
