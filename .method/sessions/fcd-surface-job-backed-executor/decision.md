---
type: co-design-record
surface: "JobBackedExecutor + CortexScheduledPact"
slug: fcd-surface-job-backed-executor
date: "2026-04-14"
owner: "@methodts/runtime"
producer: "@methodts/runtime (defines ports + helper)"
consumer: "Cortex tenant app (via ctx.jobs + ctx.schedule)"
direction: "A -> B (runtime declares contract; tenant app provides transport)"
status: frozen
mode: new
related_prds: [062, 061, 057, 058, 060, 071, 075]
depends_on:
  - fcd-surface-session-store (S4 — checkpointRef semantics; session dir empty at freeze time, carry-over documented)
  - fcd-surface-method-agent-port (MethodAgentPort — Ctx shape; session dir empty at freeze time)
  - fcd-surface-runtime-package-boundary (what lives in @methodts/runtime vs @methodts/agent-runtime)
---

# Co-Design Record — JobBackedExecutor + CortexScheduledPact

> *Pact continuation model: a pact whose execution spans worker boundaries.*
> *The pact suspends to `ctx.jobs`, resumes on the next turn in a fresh process,*
> *and the runtime guarantees checkpoint continuity, budget carry-over, and*
> *idempotency across Cortex's at-least-once SQS delivery.*

## 1. Scope & Direction

**What flows:**

| Flow | Direction | Frequency |
|---|---|---|
| Continuation envelope (pact suspends → next worker picks up) | runtime → tenant job queue → runtime | once per pact turn that yields |
| Handler registration (runtime installs one `method.pact.continue` handler per app) | runtime → `ctx.jobs.handle` | once, at tenant app boot |
| Schedule binding (cron fires → enqueues pact invocation) | `ctx.schedule` → `ctx.jobs` → runtime handler | per cron tick |
| DLQ observation (4th nack → terminal pact failure event) | tenant DLQ → runtime DLQ adapter → `AgentEvent` | rare (retries exhausted) |

**Direction:** producer defines the control contract; consumer (the tenant app)
provides `ctx.jobs` + `ctx.schedule` transports. The runtime does NOT own SQS or
EventBridge — those are Cortex's. The runtime owns what a "continuation" IS.

**Ownership:** `@methodts/runtime` owns `JobBackedExecutor`, `ScheduledPact`, and
the continuation envelope schema. Cortex owns the transport (PRD-071 / PRD-075)
and provides it via `ctx`.

## 2. Interface

### 2.1 Continuation Envelope (THE wire schema)

The single JSON payload that crosses SQS. Versioned. Idempotency key baked in.

```typescript
// packages/runtime/src/ports/continuation-envelope.ts

/**
 * ContinuationEnvelope v1 — the wire format for pact continuations.
 *
 * Written to ctx.jobs as the job payload whenever a pact yields (suspends)
 * between workers. The next worker pulls it, rehydrates via SessionStore,
 * and invokes the pact with `nextAction` as the resumption signal.
 *
 * INVARIANT: (sessionId, turnIndex) is the idempotency key. At-least-once
 * SQS delivery may invoke a handler with the same envelope twice; the
 * runtime MUST detect duplicates via the SessionStore's `lastAckedTurn`
 * and ack-without-re-executing on replay.
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
}

/** Opaque reference to a checkpoint in SessionStore (S4). */
export interface CheckpointRef {
  /** SessionStore-scoped id; opaque to Cortex. */
  id: string;
  /** Content hash for integrity check on load. */
  hash: string;
  /** Size hint (bytes) — lets workers reject oversized loads fast. */
  sizeBytes: number;
}

/** Opaque reference to a budget reservation. */
export interface BudgetRef {
  /** Reservation id returned by `ctx.llm` reservation call (S3). */
  reservationId: string;
  /** Strategy the envelope was issued under (see §7). */
  strategy: BudgetCarryStrategy;
  /** Budget remaining at envelope emission (USD). Advisory — authoritative value lives in ctx.llm. */
  remainingUsd: number;
  /** Absolute wall-clock deadline (UTC ms). After this, the continuation MUST refuse. */
  expiresAt: number;
}

/** What the resumption turn must perform. */
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

export type BudgetCarryStrategy =
  | 'fresh-per-continuation'   // each turn reserves a new micro-budget
  | 'batched-held'             // one big reservation; debited on each continuation
  | 'predictive-prereserve';   // runtime reserves N turns ahead, releases leftover
```

### 2.2 `JobBackedExecutor` Port

```typescript
// packages/runtime/src/ports/job-backed-executor.ts

import type { Pact, AgentEvent, AgentResult } from '@methodts/pacta';
import type {
  ContinuationEnvelope,
  CheckpointRef,
  BudgetRef,
  NextAction,
} from './continuation-envelope.js';

/**
 * JobBackedExecutor — drives a pact across worker boundaries via ctx.jobs.
 *
 * Owner:    @methodts/runtime
 * Producer: @methodts/runtime (impl: CortexJobBackedExecutor)
 * Consumer: tenant app composition root (wires ctx.jobs into the executor)
 * Status:   frozen 2026-04-14
 *
 * The tenant app never calls `enqueue`/`dispatch` directly — it registers
 * the executor once (`attach(ctx.jobs)`) and the runtime internally emits
 * continuations whenever a pact yields.
 */
export interface JobBackedExecutor {
  /**
   * Wire the executor into a tenant's ctx.jobs. Registers exactly ONE handler
   * (`method.pact.continue`) that dispatches all pact continuations for the
   * entire app. Idempotent — safe to call in app boot or test harnesses.
   *
   * Must be called before `start()`. Throws if called twice with different
   * JobClient instances.
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
}

export type PactFactory = (rehydrated: {
  checkpoint: unknown;         // opaque — SessionStore deserializes
  budget: BudgetRef;
  nextAction: NextAction;
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
  /** Called by runtime when the continuation is effectively DLQ'd (attempt=4 failed). */
  signalDeadLetter: (error: string) => Promise<void>;
}
```

### 2.3 `ScheduledPact` Helper

```typescript
// packages/runtime/src/scheduling/scheduled-pact.ts

import type { PactFactory } from '../ports/job-backed-executor.js';
import type { ScheduleClient } from '../ports/schedule-client.js';

/**
 * ScheduledPact — binds a Cortex-app `schedules[]` entry to a pact factory.
 *
 * The tenant app writes:
 *
 *   // cortex-app.ts
 *   export default cortexApp({
 *     schedules: [
 *       { name: 'daily-twin-report',
 *         cron: '0 9 * * MON-FRI',
 *         job: 'method.pact.continue',
 *         payload: ScheduledPact.payload('daily-twin-report') }
 *     ],
 *     onBoot: (ctx) => {
 *       runtime.attach(ctx.jobs);
 *       runtime.registerPact('daily-twin-report', dailyTwinReportFactory);
 *     }
 *   });
 *
 * The schedule fires -> EventBridge enqueues a `method.pact.continue` job
 * whose payload is a synthetic "start" envelope -> the single continuation
 * handler dispatches to the registered factory.
 */
export interface ScheduledPact {
  /**
   * Build the JSON payload a Cortex schedule entry must carry to instantiate
   * the named pact on tick. Opaque to Cortex; parsed by the runtime handler.
   */
  payload(pactKey: string, options?: ScheduleOptions): ScheduledPactPayload;

  /**
   * Optional: register the schedule at runtime (as opposed to declaratively
   * in the manifest). Returns the ScheduleBinding.name for later delete.
   */
  bind(schedules: ScheduleClient, options: ScheduleBindOptions): Promise<string>;

  /** Unbind a previously registered schedule. */
  unbind(schedules: ScheduleClient, name: string): Promise<void>;
}

export interface ScheduleOptions {
  /** Input context passed to the pact factory on each tick. */
  initialContext?: Record<string, unknown>;
  /** Per-tick budget cap (USD). Overrides pact default. */
  perTickBudgetUsd?: number;
  /** Budget strategy for this scheduled pact. */
  budgetStrategy?: 'fresh-per-continuation' | 'batched-held' | 'predictive-prereserve';
}

export interface ScheduledPactPayload {
  /** Magic marker so the continuation handler recognises synthetic starts. */
  kind: 'scheduled-pact-tick';
  pactKey: string;
  initialContext: Record<string, unknown>;
  budgetStrategy: NonNullable<ScheduleOptions['budgetStrategy']>;
  perTickBudgetUsd?: number;
}

export interface ScheduleBindOptions {
  name: string;
  cron: string;
  pactKey: string;
  options?: ScheduleOptions;
}

/** Minimal slice of ctx.schedule the runtime consumes. */
export interface ScheduleClient {
  create(name: string, def: { cron: string; job: string; payload: unknown }): Promise<void>;
  delete(name: string): Promise<void>;
  list(): Promise<Array<{ name: string; cron: string }>>;
}
```

### 2.4 DLQ Visibility Contract

```typescript
// packages/runtime/src/ports/dlq-observer.ts

import type { AgentEvent } from '@methodts/pacta';
import type { ContinuationEnvelope } from './continuation-envelope.js';

/**
 * When Cortex's retry policy exhausts (attempt=4 failed, moved to DLQ),
 * the tenant app MUST give the runtime a chance to observe and emit a
 * terminal AgentEvent. This port is attached to the DLQ inspection hook.
 *
 * The tenant provides the signal (either by polling `GET /v1/admin/apps/:id/jobs/dlq`
 * in an operator job, or by handling the runtime's dedicated DLQ adapter).
 * The runtime's adapter: for each DLQ entry whose jobType is `method.pact.continue`,
 * unpack the envelope and emit `PactDeadLetterEvent`.
 */
export interface DlqObserver {
  onDeadLetter(
    envelope: ContinuationEnvelope,
    dlqRecord: DlqRecord,
  ): Promise<AgentEvent>;
}

export interface DlqRecord {
  jobId: string;
  attempts: number;
  lastError: string;
  deadLetteredAt: number; // UTC ms
}

/** AgentEvent variant emitted when a pact hits DLQ. Pacta type extension. */
export interface PactDeadLetterEvent {
  type: 'pact.dead_letter';
  sessionId: string;
  pactKey: string;
  turnIndex: number;
  lastError: string;
  attempts: number;
  traceId: string;
}
```

## 3. Handler Registration — One Handler per App

**Decision: exactly ONE `method.pact.continue` handler per tenant app.**

Rejected alternative: one handler per pact key (e.g. `method.pact.daily-twin-report`).

Rationale:
- Cortex PRD-071 §5.5 handler concurrency is "1 in-flight per handler" in v1.
  One handler per pact would serialise unrelated pacts needlessly — 50 pact
  keys would mean 50 independent worker slots the SDK must manage.
- The dispatch cost inside a single handler (factory lookup by `pactKey`) is
  O(1). No benefit to pushing dispatch out to Cortex.
- One handler means one quota line item (`jobs.enqueue` hits the same
  counter regardless of which pact) which matches how the tenant app
  reasons about its budget.
- Operators debugging pact failures look at one DLQ, not 50 — `cortex-app
  jobs inspect-dlq --app my-app` shows everything pact-related in one view.

Contract: `runtime.attach(ctx.jobs)` registers `method.pact.continue`. If the
tenant app calls `attach` twice with different `JobClient` instances, throws
`DuplicateAttachError`. If the tenant app itself declares a handler for
`method.pact.continue` elsewhere, that's a configuration bug — runtime detects
via attempt to call `handle` and fails loudly.

## 4. Backoff Reconciliation — Pacta vs Cortex

**Pacta today (`BudgetContract.onExhaustion`):** `'stop' | 'warn' | 'error'`.
No retry curve — budget exhaustion is terminal; the agent surfaces an error.

**Cortex (`PRD-071 §5.4`):** fixed `1s → 5s → 25s → 125s`, 4 retries, then DLQ.
Non-negotiable in v1.

**Decision: stratify.**

| Failure class | Owner of retry | Mechanism |
|---|---|---|
| Transient infra error (network, SQS timeout, worker OOM) | Cortex | Cortex's 1/5/25/125s curve |
| Tool call failure inside pact turn | Pacta | Pact's internal recovery (ReAct loop, reflexion) |
| Budget exhaustion (maxCostUsd hit) | Pacta | `onExhaustion` policy — NOT a Cortex retry |
| LLM provider error (rate limit, 5xx) | Pacta | Pacta's retry middleware (already present), surfaced as successful turn yield if retries succeed |
| Checkpoint load failure | Pacta | Hard fail → terminal AgentEvent — no Cortex retry (replaying load failures can't help) |

**Rule:** the runtime's `method.pact.continue` handler MUST translate
outcomes at the boundary:

- Pacta "retryable" → handler throws (Cortex retries per its curve).
- Pacta "budget exhausted" → handler acks the job (no retry) and emits a
  terminal `AgentEvent`. Budget exhaustion is NOT transient.
- Pacta "checkpoint hash mismatch" → handler acks (don't retry a corrupted
  load) and signals DLQ via explicit mechanism (emit dead-letter event,
  then ack — do NOT throw to trigger Cortex retry).
- Pacta "yield" (normal progress) → handler acks the current job and
  enqueues the next continuation envelope.

This means **`onExhaustion` semantics do NOT conflict with Cortex retries**
— pacta controls what counts as failure vs yield, Cortex controls what
happens to failures that DO throw.

Implementation note: the continuation envelope carries `attempt` in
`NextAction.type='retry'` when the runtime decides a retry IS appropriate
but wants to re-enqueue under a new envelope (e.g. after a reflexion turn
concluded retry was warranted with different parameters). This is distinct
from Cortex's in-band retries.

## 5. Budget Carry-Over Strategy

**Decision: support all three, default to `batched-held`.**

Matrix:

| Strategy | When | Semantics |
|---|---|---|
| `fresh-per-continuation` | Demo / low-volume / untrusted pacts | Each turn reserves a small budget against `ctx.llm`. Simple, no race. Worst for cost governance — pacts that overshoot their reservation are the pacta's problem, not the platform's. |
| **`batched-held`** (default) | Production / overnight pacts | One `ctx.llm.reserve(maxCostUsd)` at pact start. `BudgetRef.reservationId` carries across all continuations; each turn debits via `ctx.llm.settle(reservationId, actualUsd)`. On final turn (or pact abort), settle remaining → released. This is the shape that matches pacta's existing `budget.maxCostUsd` contract. |
| `predictive-prereserve` | High-tier / long-horizon pacts with large budgets | Runtime reserves N turns ahead based on historical cost per turn. Releases any unused on completion. Closest to a scheduling optimizer; requires per-pact telemetry. |

**Relates to S3 (CortexLLMProvider):** the `BudgetRef.reservationId` is the
S3 output. This surface specifies the shape; S3 specifies the
`reserve/settle/release` API on `ctx.llm`. Open question OQ-2 in the
consumption roadmap (§8) — our answer: **soft reservation via dedicated
`ctx.llm.reserve()` API**, so pacta's enforcer is predictive pre-check
against the reservation balance, not a separate accounting layer.

**Cross-continuation invariant:** the tenant app's handler, on each
continuation, MUST NOT reserve a new budget — it reads `budgetRef` and
trusts it. Only the `fresh-per-continuation` strategy reserves per turn.

**Expiry:** `BudgetRef.expiresAt` gives an absolute wall-clock cap. If a
continuation arrives after this (e.g. DLQ replay days later), the handler
refuses with a terminal `budget_expired` AgentEvent. Prevents zombie pacts
draining reservations after the intent has passed.

## 6. Idempotency Across At-Least-Once Delivery

**Decision: SessionStore owns it.**

Each continuation writes a `lastAckedTurn` field to the session before
calling `ctx.jobs.ack`. On handler entry, the runtime:

1. Loads session by `sessionId`.
2. If `lastAckedTurn >= envelope.turnIndex` → this envelope was already
   processed. Ack-without-executing (Cortex deletes the message). Emit no
   events (they were already emitted by the first execution).
3. Otherwise → execute turn, update `lastAckedTurn = envelope.turnIndex`,
   ack.

This imposes a hard ordering constraint on SessionStore (S4): the
`lastAckedTurn` write must be durably persisted **BEFORE** the job is
acked. A crash between "turn completed, events emitted" and "ack to SQS"
causes SQS to redeliver, and the idempotency check prevents re-execution.

Events emitted during the turn are separately written to `ctx.events` —
they carry `traceId + turnIndex` so downstream consumers can dedupe if
needed. The runtime does NOT dedupe events itself; it only guarantees turn
execution is at-most-once.

## 7. Producer / Consumer Mapping

### Producer: `@methodts/runtime`

- **`packages/runtime/src/ports/job-backed-executor.ts`** — port interface (this doc).
- **`packages/runtime/src/ports/continuation-envelope.ts`** — envelope schema.
- **`packages/runtime/src/scheduling/scheduled-pact.ts`** — helper impl.
- **`packages/runtime/src/ports/dlq-observer.ts`** — DLQ observability port.
- **`packages/runtime/src/executors/cortex-job-backed-executor.ts`** — concrete impl (Wave 1 of PRD-062).
- **`packages/runtime/src/executors/in-process-executor.ts`** — backwards-compatible impl for standalone bridge (wraps today's `StrategyExecutor`).

Wiring: the `@methodts/agent-runtime` composition helper exposes
`runtime.attach(ctx.jobs)` + `runtime.registerPact(...)` as the
consumer-facing API. The tenant never imports from
`packages/runtime/src/ports/` directly — `@methodts/agent-runtime`
re-exports `ScheduledPact` and the payload builder.

### Consumer: tenant Cortex app

- **`cortex-app.ts` onBoot block** — calls `runtime.attach(ctx.jobs)` +
  `runtime.registerPact('daily-twin-report', factory)` + optionally
  `runtime.scheduled.bind(ctx.schedule, ...)`.
- **Manifest `schedules[]`** — declarative schedules use
  `ScheduledPact.payload('...')` to build the payload at build time.

## 8. Gate Assertions

```typescript
// In packages/runtime/src/architecture.test.ts

// G-PORT: runtime internals must consume ctx.jobs ONLY via JobClient interface
it('CortexJobBackedExecutor imports from port, not ctx.jobs type', () => {
  const violations = scanImports(
    'packages/runtime/src/executors/cortex-job-backed-executor.ts',
    ['@cortex/sdk', 'ctx.jobs'],
  );
  expect(violations).toEqual([]);
});

// G-BOUNDARY: ScheduledPact helper never imports from the concrete EventBridge impl
it('ScheduledPact uses ScheduleClient port, not cortex infra', () => {
  const violations = scanImports(
    'packages/runtime/src/scheduling/scheduled-pact.ts',
    ['EventBridgeScheduler', '@cortex/infra'],
  );
  expect(violations).toEqual([]);
});

// G-ENVELOPE-VERSION: envelope schema freeze — version field must be literal 1
it('ContinuationEnvelope.version is locked to 1 (freeze)', () => {
  const src = readFile('packages/runtime/src/ports/continuation-envelope.ts');
  expect(src).toMatch(/version:\s*1/);
});

// G-IDEMPOTENCY: every execution path in the continuation handler checks lastAckedTurn
it('continuation handler consults SessionStore.lastAckedTurn before executing', () => {
  const src = readFile('packages/runtime/src/executors/cortex-job-backed-executor.ts');
  expect(src).toMatch(/lastAckedTurn/);
  expect(src).toMatch(/turnIndex/);
});

// G-ONE-HANDLER: only one ctx.jobs.handle call for method.pact.continue
it('runtime registers exactly one method.pact.continue handler', () => {
  const src = readFile('packages/runtime/src/executors/cortex-job-backed-executor.ts');
  const matches = src.match(/handle\(['"`]method\.pact\.continue['"`]/g) ?? [];
  expect(matches.length).toBe(1);
});
```

## 9. Extensibility — What's NOT Frozen

- Additional `NextAction` variants (e.g. `{ type: 'human_in_loop'; promptId: string }`)
  — extendable via union; existing handlers default-case to terminal error.
- New `BudgetCarryStrategy` values — extendable union; default is
  `batched-held` when unknown strategy appears (defensive).
- Additional envelope fields — MUST keep `version: 1` semantics compatible;
  add optional fields only. Breaking change → `version: 2` + dual-parse window.
- DLQ replay semantics — today we emit a terminal event; future: operator
  UI to re-enqueue a DLQ entry as a NEW sessionId (same pactKey, fresh
  budget). Deferred.

## 10. Open Questions → Cortex Team

Picked up from roadmap §8 and specific to this surface:

1. **Reservation API shape on `ctx.llm`.** Requires `ctx.llm.reserve(maxUsd): Promise<BudgetRef>`
   and `ctx.llm.settle(ref, actualUsd)`. PRD-068 doesn't spec this yet; needs
   co-design (S3).
2. **Envelope size limit.** SQS message body is 256 KB. Our envelope is
   ~1-2 KB + opaque refs. Safe. But: does Cortex impose additional
   per-app limits? If yes, document.
3. **Schedule → job payload size.** EventBridge Scheduler also has size
   limits. `ScheduledPactPayload` with `initialContext` could exceed if
   misused. Document and add validation helper.
4. **Cross-app scheduling.** PRD-075 §4 "out of scope: schedule chaining".
   Confirmed: a pact that needs to invoke another app's pact must wait
   for PRD-080 (App-to-App Deps). Not in this surface.

## 11. Agreement

| Item | Value |
|---|---|
| **Frozen** | 2026-04-14 |
| **Surface name** | `JobBackedExecutor + CortexScheduledPact` |
| **Port files** | `packages/runtime/src/ports/{job-backed-executor,continuation-envelope,dlq-observer}.ts`, `packages/runtime/src/scheduling/scheduled-pact.ts` |
| **Consumer-facing re-export** | `@methodts/agent-runtime` re-exports `ScheduledPact`, `JobBackedExecutor` type, and the `payload` builder |
| **Changes require** | new `/fcd-surface` session; breaking envelope change → `version: 2` |
| **Related surfaces** | S3 (CortexLLMProvider — reservation API), S4 (SessionStore — checkpointRef + lastAckedTurn), MethodAgentPort (Ctx shape) |
| **PRD container** | PRD-062 |
