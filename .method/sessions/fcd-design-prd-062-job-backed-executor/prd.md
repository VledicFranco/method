---
type: prd
title: "PRD-062 — JobBackedExecutor + CortexScheduledPact"
slug: fcd-design-prd-062-job-backed-executor
date: "2026-04-14"
status: implemented-partial (PR #186 — Wave 1 `fresh-per-continuation` only; Wave 2 `batched-held` blocked on Cortex O1)
version: 0.1
size: M
group: B
phase: 3
domains:
  - "@methodts/runtime (new package — continuation model lives here)"
  - "@methodts/agent-runtime (re-exports ScheduledPact + payload builder)"
  - "@methodts/bridge (in-process executor preserved for standalone mode)"
  - "@methodts/pacta (extends AgentEvent union with pact.dead_letter)"
surfaces:
  - S5 (JobBackedExecutor + CortexScheduledPact) — IMPLEMENTS
  - S4 (SessionStore + CheckpointSink) — CONSUMES
  - S3 (CortexServiceAdapters) — CONSUMES (BudgetRef via ctx.llm.reserve/settle)
  - S2 (RuntimePackageBoundary) — CONSUMES (runtime subpath exports)
related_prds: [057, 058, 059, 060, 061, 063]
related_surfaces:
  - .method/sessions/fcd-surface-job-backed-executor/decision.md
  - .method/sessions/fcd-surface-session-store/decision.md
  - .method/sessions/fcd-surface-cortex-service-adapters/decision.md
depends_on_cortex_prds: [071, 075, 068, 065, 061]
open_questions_blocking:
  - O1 (ctx.llm.reserve()/settle() API — Cortex PRD-068 extension)
---

# PRD-062 — JobBackedExecutor + CortexScheduledPact

## Summary

Ship the **pact-continuation model** that lets a single pact execution span worker
boundaries by handing off to `ctx.jobs` between turns, plus the `ScheduledPact`
helper that binds cron schedules (e.g. 9am Twin reports) to method-backed
agents. This PRD implements frozen surface **S5** and consumes S4, S3, S2.

Concretely, this PRD ships:

1. `CortexJobBackedExecutor` — registers one `method.pact.continue` handler per
   tenant app, pulls the next continuation envelope, rehydrates via
   `SessionStore.resume`, runs the pact turn, and either yields (enqueues the
   next envelope) or completes.
2. `ScheduledPact` helper — builds manifest `schedules[]` payloads and
   (optionally) binds schedules at runtime via `ctx.schedule`.
3. `DlqObserver` adapter — emits a terminal `pact.dead_letter` `AgentEvent`
   when `ctx.jobs` exhausts retries.
4. `InProcessExecutor` — backwards-compatible implementation of the same port
   wrapping today's `StrategyExecutor`, so the standalone bridge keeps working.
5. Manifest schema additions so Cortex tenant apps can declare
   `spec.methodology.scheduledPacts[]` and the runtime's
   `method.pact.continue` handler at build time.

---

## Problem

The bridge's `StrategyExecutor` (`packages/bridge/src/domains/strategies/strategy-executor.ts`)
and cron `ScheduleTrigger` (`packages/bridge/src/domains/triggers/schedule-trigger.ts`)
are **in-process**: a pact runs inside a single Node event loop, and schedules
fire via `setInterval` against a local timer. Two blocking consequences for
Cortex:

1. **No restart survival.** A Cortex-hosted agent container restarts (deploy,
   scale event, OOM) mid-pact → the pact is lost. Today's bridge writes JSONL
   checkpoints but has no mechanism to *resume* from them in a fresh process.
   Twins Wave 1 requires overnight pacts; an overnight pact that dies on
   deploy is worse than no pact at all.
2. **No cluster-safe scheduling.** The bridge's `ScheduleTrigger` only works
   for the node it runs on. In Cortex, schedules must fire through
   EventBridge (`ctx.schedule`, PRD-075) so they survive container lifecycle
   and are visible to the platform. An `setInterval` in a library cannot
   satisfy this.

The April 21 Twin demo (9am daily report) and Group B Twins Wave 1 both
require the same primitive: **a pact that suspends to durable storage between
turns and resumes on the next worker**. That primitive is missing.

---

## Constraints

### Hard constraints (from frozen surfaces)

- **C-1 — One handler per app.** Exactly one `ctx.jobs.handle('method.pact.continue', ...)`
  call per tenant app. Factory dispatch by `pactKey` happens inside the
  handler (S5 §3). Gate `G-ONE-HANDLER`.
- **C-2 — Continuation envelope is frozen at `version: 1`.** Shape per S5 §2.1:
  `(version, sessionId, turnIndex, checkpointRef, budgetRef, nextAction,
  pactKey, tokenContext, emittedAt, traceId)`. Breaking changes require
  `version: 2` + dual-parse window. Gate `G-ENVELOPE-VERSION`.
- **C-3 — Idempotency via `(sessionId, turnIndex)` against `SessionStore.lastAckedTurn`.**
  SessionStore S4 owns the check; the executor MUST consult it before
  executing any turn. Gate `G-IDEMPOTENCY`.
- **C-4 — Budget single authority is `ctx.llm`.** `BudgetRef.reservationId`
  carries the Cortex reservation handle. Default carry-over = `batched-held`.
  Pacta's `budgetEnforcer` runs in `mode: 'predictive'` when the provider is
  `CortexLLMProvider` (capability `budgetEnforcement === 'native'`).
- **C-5 — Backoff stratification.** Pacta `onExhaustion` and Cortex
  `1/5/25/125s` retries do NOT overlap. Pacta decides "yield vs fail";
  Cortex retries only what pacta throws (transient infra). See
  Architecture §5.
- **C-6 — Ports only.** Runtime internals import `JobClient` /
  `ScheduleClient` port types, never `@cortex/sdk` directly. Gate `G-PORT`.

### Cortex dependencies

- **C-7 — Depends on Cortex PRD-071** (`ctx.jobs`): at-least-once delivery,
  attempt counter in handler ctx, DLQ after 4 failed attempts, concurrency
  "1 in-flight per handler" in v1.
- **C-8 — Depends on Cortex PRD-075** (`ctx.schedule`): EventBridge-backed
  cron, schedule entry enqueues a job by `job` + `payload`, no schedule
  chaining in v1 (Cortex §4).
- **C-9 — Blocked on Cortex Open Question O1** (`ctx.llm.reserve()/settle()`
  API shape — PRD-068 extension). `batched-held` cannot ship without this.
  Mitigation in Risks §R-1.

### Soft constraints

- **C-10 — SQS message size ≤ 256 KB.** Envelope is ~1-2 KB plus opaque
  `CheckpointRef` / `BudgetRef`. Well under the cap, but if any future
  `NextAction` variant grows (e.g. gate approval artifact preview), we
  enforce a 32 KB soft cap in the executor and reject at `yield()`.
- **C-11 — `BudgetRef.expiresAt`** provides an absolute wall-clock deadline;
  continuations that arrive after it refuse with terminal `budget_expired`
  event. Prevents zombie pacts draining reservations after intent has passed.
- **C-12 — Pacta `pacta` is a peer dep.** The executor imports `Pact`,
  `AgentEvent`, `AgentResult` types but does NOT bring its own pacta
  version.

---

## Success Criteria

**SC-1 — Overnight pact survives container restart.**
A pact configured with `batched-held` budget runs across N ≥ 3 continuations,
with a container restart injected between any two turns. On resume the new
worker rehydrates from `SessionStore.resume`, uses the same `BudgetRef`, and
completes with total cost ≤ the original `maxCostUsd`. Metric: 100/100 runs
in the conformance suite's restart-fuzz fixture.

**SC-2 — Daily 9am scheduled pact fires in Cortex.**
A `ScheduledPact.payload('daily-twin-report')` placed in manifest
`schedules[]` with cron `0 9 * * MON-FRI` triggers an EventBridge event that
enqueues `method.pact.continue`, which dispatches to the `daily-twin-report`
factory and produces an `AgentResult` within the per-tick budget. Smoke test
in `samples/cortex-daily-twin-agent/` runs against Cortex local dev stack.

**SC-3 — DLQ replay produces observable terminal event.**
When a pact's continuation throws 4 times (forced by a fixture), the runtime
DLQ observer emits `{ type: 'pact.dead_letter', sessionId, pactKey,
turnIndex, lastError, attempts, traceId }` on the host's `AgentEvent` stream
and (via `CortexEventConnector`, PRD-063) a `method.pact.dead_letter`
`ctx.event`. Operators can inspect via `cortex-app jobs inspect-dlq --app ...`.

**SC-4 — At-least-once replay is idempotent.**
The conformance suite's replay-fuzz fixture delivers every envelope twice
(simulating Cortex SQS redelivery). Turn execution occurs exactly once per
`turnIndex`; the second delivery is acked without side effects. Metric: no
duplicate `AgentEvent`s, no duplicate `ctx.llm.settle` calls.

**SC-5 — Standalone bridge remains green.**
`npm run bridge:test` (in-process executor path) passes all existing smoke
tests. No regression in `packages/smoke-test` suite. `InProcessExecutor`
wraps today's `StrategyExecutor` without changing its behaviour.

---

## Scope

### In scope

- `@methodts/runtime` port files from S5 §7: `job-backed-executor.ts`,
  `continuation-envelope.ts`, `dlq-observer.ts`, `scheduled-pact.ts`,
  plus new `schedule-client.ts`.
- `@methodts/runtime/executors/cortex-job-backed-executor.ts` — concrete
  Cortex implementation.
- `@methodts/runtime/executors/in-process-executor.ts` — standalone bridge
  implementation wrapping `StrategyExecutor`.
- `@methodts/runtime/scheduling/scheduled-pact.ts` — payload builder +
  runtime binding helper.
- `@methodts/runtime/dlq/cortex-dlq-observer.ts` — DLQ inspection adapter
  emitting `PactDeadLetterEvent`.
- `@methodts/agent-runtime` re-exports: `ScheduledPact`, `JobBackedExecutor`
  type, `ContinuationEnvelope` type, the `payload()` builder.
- `@methodts/pacta` `AgentEvent` union extension: adds
  `PactDeadLetterEvent` variant.
- Manifest schema additions (see Architecture §9) for
  `spec.methodology.scheduledPacts[]` and the `method.pact.continue`
  handler declaration.
- Gate assertions from S5 §8: `G-PORT`, `G-BOUNDARY`, `G-ENVELOPE-VERSION`,
  `G-IDEMPOTENCY`, `G-ONE-HANDLER`.
- Conformance fixtures: restart-fuzz (SC-1), replay-fuzz (SC-4),
  dlq-terminal (SC-3). Shipped via `@methodts/pacta-testkit/conformance`
  (PRD-065).

### Out of scope

- **`ctx.llm.reserve()/settle()` API design** — Cortex owns (O1). This PRD
  consumes whatever shape PRD-068 ships; interim we ship
  `fresh-per-continuation` as the only working strategy.
- **DLQ re-enqueue / operator replay UI.** S5 §9 notes this is deferred;
  today we only emit a terminal event.
- **Cross-app scheduling.** A pact that triggers a pact in another
  Cortex app is blocked on PRD-080 (App-to-App Deps). S5 §10.4.
- **Schedule hot-edit.** Manifest-declared schedules are deploy-time;
  runtime `bind`/`unbind` is provided but not used by Wave 1.
- **Migration of bridge `domains/triggers` to the job-backed model.** The
  standalone bridge continues using `ScheduleTrigger` + `InProcessExecutor`.
  Migration is a Phase 3 follow-up; this PRD leaves bridge behaviour
  unchanged.
- **Envelope streaming / chunking.** If the 32 KB soft cap is hit, the turn
  fails. Large-payload support (artifact references) is a PRD-063 /
  ctx.storage concern.
- **`SessionStore.lastAckedTurn` semantics.** S4 owns this; PRD-061
  ships it. This PRD consumes it.

---

## Domain Map

```
 @methodts/runtime                      @methodts/agent-runtime                Cortex ctx.*
 ───────────────                      ─────────────────────                ────────────
 JobBackedExecutor port  ───defines───────────────────────────>
 ContinuationEnvelope    ───defines───────────────────────────>
 ScheduledPact helper    ────────re-exports──>  ScheduledPact
 CortexJobBackedExecutor ──attach(ctx.jobs)──────────────────────────────> ctx.jobs [PRD-071]
 ScheduledPact.bind()    ──create(cron,job,pl)───────────────────────────> ctx.schedule [PRD-075]
 CortexDlqObserver       ──onDeadLetter──────────────────────────────────> (AgentEvent → host)
 (CortexLLMProvider/S3)  ──reserve/settle (via BudgetRef)────────────────> ctx.llm.reserve [O1]
 SessionStore (S4)       ──resume/appendCheckpoint/lastAckedTurn─────────> ctx.storage [PRD-064]

 @methodts/bridge                       @methodts/pacta
 ──────────────                       ─────────────
 InProcessExecutor  ─implements port  AgentEvent += pact.dead_letter
   wraps StrategyExecutor (today)
```

**Arrow classification (per S5):** all producer/consumer relationships are
already frozen as S5 ports. This PRD adds **zero new cross-domain ports**
— it is an *implementation* PRD. The only new shared type is the
`PactDeadLetterEvent` variant added to the `@methodts/pacta` `AgentEvent`
union, which is additive.

---

## Surfaces

PRD-062 **implements S5**. All surfaces are already frozen; below is the
consumption map only.

| Surface | Role | Decision file | Items consumed |
|---------|------|---------------|----------------|
| S5 JobBackedExecutor + ScheduledPact | **implements** | `fcd-surface-job-backed-executor/decision.md` | entire port — §2 interfaces, §3 handler model, §5 budget strategies, §6 idempotency, §8 gates |
| S4 SessionStore + CheckpointSink | consumes | `fcd-surface-session-store/decision.md` | `resume(sessionId, workerId)`, `appendCheckpoint(sessionId, checkpoint, fencingToken)`, `lastAckedTurn` field, `loadLatestCheckpoint` |
| S3 CortexServiceAdapters | consumes | `fcd-surface-cortex-service-adapters/decision.md` | `BudgetRef.reservationId` from `CortexLLMProvider`, the `ctx.llm.reserve/settle` handle shape (pending O1) |
| S2 RuntimePackageBoundary | consumes | `fcd-surface-runtime-package-boundary/decision.md` | `@methodts/runtime` subpath exports (`/ports`, `/executors`, `/scheduling`) |

**No new surfaces.** If implementation reveals a needed contract change,
it requires a fresh `/fcd-surface` session and promotes envelope to
`version: 2`.

---

## Architecture

### 1. Continuation envelope — the wire schema

Per S5 §2.1 (frozen, verbatim):

```typescript
export interface ContinuationEnvelope {
  version: 1;
  sessionId: string;
  turnIndex: number;
  checkpointRef: CheckpointRef;
  budgetRef: BudgetRef;
  nextAction: NextAction;
  pactKey: string;
  tokenContext: TokenContext;
  emittedAt: number;
  traceId: string;
}
```

Key invariants:

- `(sessionId, turnIndex)` is the global idempotency key.
- `checkpointRef.hash` allows fast integrity check before expensive load.
- `budgetRef.expiresAt` is an absolute deadline; continuations arriving
  after it refuse.
- `nextAction` is a discriminated union: `'resume' | 'retry' | 'gate_wait'`.
  Extensible (future `'human_in_loop'`); existing handlers default-case to
  terminal error.

### 2. `CortexJobBackedExecutor` internal flow

```
attach(jobs):
  if attached → throw DuplicateAttachError
  jobs.handle('method.pact.continue', dispatch)
  attached = { jobs }

start({ pactKey, initialPrompt, userSub, ... }):
  sessionId = uuid()
  traceId   = uuid()
  SessionStore.create({ sessionId, pactKey, userSub, ... })
  envelope  = buildInitialEnvelope(pactKey, initialPrompt, userSub, traceId)
  try { runTurnInline(envelope) }            // first turn synchronous
  catch (Yield y) { await jobs.enqueue('method.pact.continue', y.envelope) }
  return { sessionId, traceId }

dispatch(payload, { attempt, signalDeadLetter }):
  envelope = parseEnvelope(payload)                       // handles ScheduledPactPayload → initial envelope
  validateVersion(envelope.version)                       // reject != 1
  validateExpiry(envelope.budgetRef.expiresAt)            // terminal if past
  session = await SessionStore.load(envelope.sessionId)
  if session.lastAckedTurn >= envelope.turnIndex:
    return                                                // idempotent replay: ack without executing
  { fencingToken } = await SessionStore.resume(envelope.sessionId, workerId)
  checkpoint       = await SessionStore.loadLatestCheckpoint(envelope.sessionId)
  factory          = pactRegistry.get(envelope.pactKey)   // throws if missing
  pact             = factory({ checkpoint, budget: envelope.budgetRef, nextAction: envelope.nextAction })

  try {
    result = await runOneTurn(pact, envelope, fencingToken)
  } catch (e) {
    classifyFailure(e, attempt, signalDeadLetter)         // see §5
    throw e | return   (depending on class)
  }

  // Turn outcome is 'yield' or 'complete'
  if result.kind === 'yield':
    nextEnvelope = result.toEnvelope(envelope, sessionId, turnIndex + 1)
    await SessionStore.appendCheckpoint(sessionId, result.checkpoint, fencingToken)
    await markLastAckedTurn(sessionId, envelope.turnIndex, fencingToken)
    await jobs.enqueue('method.pact.continue', nextEnvelope)
  else if result.kind === 'complete':
    await SessionStore.appendCheckpoint(sessionId, result.checkpoint, fencingToken)
    await markLastAckedTurn(sessionId, envelope.turnIndex, fencingToken)
    await SessionStore.finalize(sessionId, 'completed')
    // host sees AgentResult via the onEvent channel (PRD-058, not here)

  // ack is implicit: handler returns without throwing
```

Critical ordering: `appendCheckpoint` and `markLastAckedTurn` must both be
durable **before** the handler returns (which triggers SQS ack). A crash
between "turn completed, side effects fired" and "ack to SQS" causes SQS
redelivery; the idempotency check then prevents re-execution. SessionStore's
I-3 invariant (FENCED appends) guarantees only one worker can write per
`turnIndex`.

### 3. Handler registration — one per app

Per S5 §3 (frozen decision): exactly one `ctx.jobs.handle('method.pact.continue', ...)`
per app. Dispatch by `pactKey` happens inside the handler. Alternative (one
handler per pact key) was rejected because:

- Cortex v1 handler concurrency is "1 in-flight per handler" — 50 pact keys
  would mean 50 independent worker slots.
- Dispatch inside the handler is O(1) factory-map lookup.
- Operators inspect one DLQ, not N.

`DuplicateAttachError` thrown if `attach` called twice with different
`JobClient` instances. `ScheduledPactPayload` (synthetic "start" from a
cron tick) is recognised by its `kind: 'scheduled-pact-tick'` marker and
synthesised into an initial envelope before dispatch.

Gate `G-ONE-HANDLER` (from S5 §8): only one regex-matched `handle('method.pact.continue', ...)`
call in `cortex-job-backed-executor.ts`.

### 4. Three budget carry-over strategies

Per S5 §5. Default = `batched-held`.

| Strategy | Reservation moment | Settlement | Failure behaviour | Status in PRD-062 |
|----------|--------------------|------------|-------------------|-------------------|
| `fresh-per-continuation` | Each turn calls `ctx.llm.reserve(perTurnUsd)` | Each turn settles its own ref; next turn gets a new `BudgetRef` | Per-turn overshoot is pacta's problem | **Ships Wave 1** — only strategy that doesn't require O1 |
| `batched-held` (default) | Once at pact start: `ctx.llm.reserve(maxCostUsd)` | Per-turn `ctx.llm.settle(reservationId, actualUsd)`; release remainder on finalize | Pacta `budgetEnforcer` in `mode: 'predictive'` pre-checks reservation balance | **Ships Wave 2** — gated on O1 |
| `predictive-prereserve` | Runtime reserves `N * avgTurnCost` ahead based on telemetry | Debit per turn; release unused | Same predictive pre-check | **Ships Wave 3** — gated on O1 + per-pact telemetry |

Cross-continuation invariant: the handler NEVER calls `reserve()` on
inherited `BudgetRef`s — it only reads, settles, or releases. Only
`fresh-per-continuation` reserves per turn.

Unknown strategy value → defensive fallback to `batched-held`.

### 5. Backoff reconciliation — pacta vs Cortex

Per S5 §4 (frozen):

| Failure class | Owner | Mechanism | Handler action |
|---------------|-------|-----------|----------------|
| Transient infra (SQS, network, worker OOM) | Cortex | `1/5/25/125s` retries | **Throw** — Cortex retries |
| Tool call failure inside turn | Pacta | ReAct / Reflexion internal recovery | Recovered inside turn; normal yield |
| LLM provider 5xx / rate limit | Pacta | Pacta retry middleware (exists) | Either succeeds (yield) or escalates |
| Budget exhaustion (`maxCostUsd` hit) | Pacta | `onExhaustion` policy | **Ack + terminal AgentEvent** — NOT a Cortex retry |
| Checkpoint hash mismatch | Pacta | Hard fail — replay can't help | **Ack + signal DLQ explicitly** (emit dead-letter event, then return) |
| Pacta retry-with-new-params (reflexion concluded retry warranted with different args) | Pacta | Emit new envelope with `nextAction: { type: 'retry', attempt, lastError }` | Normal yield path |

Rule: the handler's outcome classifier makes the ack/throw decision at
exactly one site (`classifyFailure`). Throwing always means "Cortex, please
retry per your curve." Acking always means "we handled it, do not retry."

### 6. Idempotency across at-least-once delivery

Per S5 §6. Ordering (MUST be durable before ack):

1. Check: `session.lastAckedTurn >= envelope.turnIndex` → ack-no-execute.
2. Execute turn.
3. `appendCheckpoint(sessionId, checkpoint, fencingToken)` — SessionStore
   atomically bumps `latestCheckpointSequence`.
4. `markLastAckedTurn(sessionId, envelope.turnIndex, fencingToken)` — same
   doc update if possible, otherwise separate but idempotent.
5. Enqueue next envelope (if yielding).
6. Return (ack).

Step 4 is the critical barrier. S4 I-3 (fencing) guarantees that a worker
whose lease expired between steps 2 and 4 can't write stale data; the
replacement worker starts over from step 1 with a fresh lease, sees the
same `lastAckedTurn`, and re-runs the turn. Events emitted during the turn
(to `ctx.events`) carry `traceId + turnIndex` so downstream consumers can
dedupe if needed. The runtime itself does NOT dedupe events — it only
guarantees turn execution is at-most-once (and at-least-once when combined
with retries).

Gate `G-IDEMPOTENCY`: the continuation handler source file must reference
`lastAckedTurn` and `turnIndex`.

### 7. DLQ visibility contract

Two emission paths for terminal pact failure — the `PactDeadLetterEvent`
is emitted on BOTH:

1. **Inline (from the handler itself)** — when pacta classifies "ack + signal
   DLQ" (e.g. budget exhaustion, checkpoint corruption, `budget_expired`).
   The handler calls `SessionStore.finalize(sessionId, 'failed', reason)`
   then emits `PactDeadLetterEvent` on the `AgentEvent` channel (host's
   `onEvent`). Host translates to `ctx.audit.event()` and, per PRD-063,
   `ctx.events.emit('method.pact.dead_letter', ...)`.
2. **External (from Cortex's DLQ)** — when Cortex exhausts its 4 retries
   because the handler kept throwing (genuine transient errors that
   didn't recover). The tenant app's DLQ inspection job (operator-run
   or scheduled) calls `CortexDlqObserver.onDeadLetter(envelope, dlqRecord)`.
   The observer emits the same `PactDeadLetterEvent`.

Both paths write:

```typescript
{
  type: 'pact.dead_letter',
  sessionId: envelope.sessionId,
  pactKey: envelope.pactKey,
  turnIndex: envelope.turnIndex,
  lastError: record.lastError | pactaError.message,
  attempts: record.attempts | 1,
  traceId: envelope.traceId
}
```

Storage writes (for `cortex-app jobs inspect-dlq` parity):

- `SessionStore.finalize(sessionId, 'failed')` — moves session to terminal.
- A dedicated `session.dlqRecord` field on the snapshot (new, added to S4's
  `SessionSnapshot`, opaque to S4 port) holds the terminal envelope for
  operator inspection.

Gate: a conformance test verifies both paths emit exactly one
`PactDeadLetterEvent` per sessionId (not two, even if both trigger —
idempotent via `lastAckedTurn` + session status).

### 8. `ScheduledPact` helper

Two usage modes:

**Declarative (preferred for Wave 1):**

```typescript
// cortex-app.ts
export default cortexApp({
  schedules: [{
    name: 'daily-twin-report',
    cron: '0 9 * * MON-FRI',
    job: 'method.pact.continue',
    payload: ScheduledPact.payload('daily-twin-report', {
      initialContext: { twinId: 'franco' },
      budgetStrategy: 'fresh-per-continuation', // until O1 resolves
      perTickBudgetUsd: 2.0,
    }),
  }],
  onBoot: async (ctx) => {
    await runtime.attach(ctx.jobs);
    runtime.registerPact('daily-twin-report', dailyTwinReportFactory);
  },
});
```

The cron tick fires → EventBridge enqueues a `method.pact.continue` job
with the declared payload → the handler recognises `kind: 'scheduled-pact-tick'`
→ synthesises an initial envelope → dispatches to the `daily-twin-report`
factory.

**Imperative:**

```typescript
await ScheduledPact.bind(ctx.schedule, {
  name: 'incident-sla-check',
  cron: '*/15 * * * *',
  pactKey: 'incident-sla-check',
});
// later:
await ScheduledPact.unbind(ctx.schedule, 'incident-sla-check');
```

Useful for pacts that are created/destroyed based on runtime state
(e.g. user-configured schedules in the Twin UI).

### 9. Manifest schema additions

Additive to Cortex tenant app manifest schema. Two new blocks:

```yaml
# cortex-app manifest (YAML or TS equivalent)
spec:
  methodology:
    # (existing fields from PRD-064 …)

    # NEW: pact continuation handler declaration. Required for any app
    # that uses @methodts/runtime JobBackedExecutor. Exactly one per app.
    pactContinueHandler:
      jobType: method.pact.continue
      # Concurrency is taken from PRD-071 default (1 in-flight) unless
      # overridden. Cortex validates at deploy.
      concurrency: 1

    # NEW: declarative scheduled pacts. Each entry generates a
    # ctx.schedule registration + a manifest-known job payload.
    scheduledPacts:
      - name: daily-twin-report
        cron: "0 9 * * MON-FRI"
        pactKey: daily-twin-report
        options:
          budgetStrategy: fresh-per-continuation
          perTickBudgetUsd: 2.0
          initialContext:
            twinId: franco
```

Build-time generator (`@methodts/agent-runtime/bin/gen-manifest`) reads this
block and emits the raw Cortex `schedules[]` entries with
`ScheduledPact.payload(...)` values. Gate: the generator must be idempotent
— running it twice produces identical manifest output.

Fallback: tenant apps that don't use the generator can call
`ScheduledPact.payload(...)` inline in their manifest TS — the schema
additions are a convenience, not a requirement.

### 10. Layer placement

| Component | Package | Layer | Notes |
|-----------|---------|-------|-------|
| `JobBackedExecutor` port | `@methodts/runtime/ports` | L3 | Zero transport deps |
| `ContinuationEnvelope` types | `@methodts/runtime/ports` | L3 | Plain data |
| `CortexJobBackedExecutor` | `@methodts/runtime/executors` | L3 | Imports `JobClient` only |
| `InProcessExecutor` | `@methodts/runtime/executors` | L3 | Wraps `StrategyExecutor` — forwards unchanged |
| `ScheduledPact` | `@methodts/runtime/scheduling` | L3 | Consumer-facing re-exported from `@methodts/agent-runtime` |
| `CortexDlqObserver` | `@methodts/runtime/dlq` | L3 | Emits `AgentEvent` |
| `PactDeadLetterEvent` | `@methodts/pacta` (extend `AgentEvent` union) | L2 | Additive — one-line union extension |
| Manifest generator | `@methodts/agent-runtime/bin` | L4 (tool) | Build-time CLI; not imported by runtime |

Bridge `@methodts/bridge/domains/strategies/strategy-executor.ts` stays put
— `InProcessExecutor` is a new thin adapter over it, in `@methodts/runtime`.

### 11. Gate plan

From S5 §8 (five gates) plus one new:

| Gate | File | Assertion |
|------|------|-----------|
| `G-PORT` | `packages/runtime/src/architecture.test.ts` | `cortex-job-backed-executor.ts` imports from port files only; no `@cortex/sdk` or `ctx.jobs` type imports |
| `G-BOUNDARY` | same | `scheduled-pact.ts` doesn't import `EventBridgeScheduler` or `@cortex/infra` |
| `G-ENVELOPE-VERSION` | same | `continuation-envelope.ts` contains literal `version: 1` |
| `G-IDEMPOTENCY` | same | `cortex-job-backed-executor.ts` references `lastAckedTurn` AND `turnIndex` |
| `G-ONE-HANDLER` | same | exactly one `handle('method.pact.continue', ...)` regex match |
| `G-DLQ-SINGLE-EMIT` (new) | `packages/runtime/src/dlq/dlq-observer.test.ts` | Both inline + external DLQ paths produce ≤ 1 `PactDeadLetterEvent` per sessionId (idempotent) |

---

## Risks

### R-1 — O1 blocking (`ctx.llm.reserve()/settle()` API)

**Severity:** HIGH. **Probability:** MEDIUM.
`batched-held` — the default strategy per S5 — cannot ship without the
Cortex reservation API. Until O1 resolves:

- Ship `fresh-per-continuation` as the only production strategy.
- Mark `batched-held` as "compile-time recognised, runtime not-implemented"
  in the executor — throws `BatchedHeldNotImplementedError` with a link to
  O1.
- Document in the Twins Wave 1 migration guide that overnight pacts must
  accept per-turn reservations until O1 ships.

Escalation: CTO + Cortex PRD-068 owner. Target: O1 resolution by Wave 2
start.

### R-2 — SQS 256 KB message cap with opaque refs

**Severity:** LOW. **Probability:** LOW.
Today's envelope is ~1-2 KB; safe. But future `NextAction` variants
(e.g. `human_in_loop` with an approval prompt) could grow. Mitigation: a
32 KB soft cap enforced in `JobBackedExecutor.yield()`; payloads above it
fail loudly with guidance to move the data into `ctx.storage` and pass a
reference. Monitor envelope size in telemetry (p99 per pact key).

### R-3 — Replay storms on deploy

**Severity:** MEDIUM. **Probability:** MEDIUM.
If a deploy interrupts N in-flight pacts, Cortex redelivers all N at
once on restart. With `ctx.jobs` concurrency = 1, they serialize; with
higher concurrency they thunder. Mitigation:

- Idempotency check is cheap (one SessionStore read) — no work lost, just
  throughput pressure.
- `BudgetRef.expiresAt` caps zombie replay.
- Operational: document expected behaviour for operators; add a smoke
  test that validates deploy-restart under load.

### R-4 — Checkpoint + lastAckedTurn atomicity

**Severity:** MEDIUM. **Probability:** LOW.
If `appendCheckpoint` succeeds and `markLastAckedTurn` fails, replay
re-executes the turn. Mitigation: implement `markLastAckedTurn` as a
field on the same SessionStore write that appends the checkpoint (single
Mongo update with `$set` on both). If SessionStore can't guarantee this
atomically, escalate to S4 amendment.

### R-5 — `pacta` AgentEvent union extension

**Severity:** LOW. **Probability:** LOW.
Adding `PactDeadLetterEvent` to pacta's discriminated union is a minor
version bump in `@methodts/pacta`. Any existing `switch` on `AgentEvent`
variants without a default case becomes non-exhaustive. Mitigation: grep
for `switch (event.type)` across the monorepo; add default cases;
changelog entry; TS strict "noImplicitReturns" catches at compile time.

### R-6 — Manifest schema drift from Cortex

**Severity:** LOW. **Probability:** MEDIUM.
Cortex's manifest schema (RFC-005) is evolving. Our
`spec.methodology.scheduledPacts[]` addition must be coordinated with
Cortex. Mitigation: treat the new blocks as advisory in Wave 1 (fallback:
inline `ScheduledPact.payload(...)` in manifest TS); PR Cortex-side schema
addition in Wave 2.

---

## Acceptance Gates

### Wave 0 — Ports + types (no impl)

- `packages/runtime/src/ports/{job-backed-executor,continuation-envelope,dlq-observer,schedule-client}.ts` exist with frozen signatures from S5.
- `packages/runtime/src/scheduling/scheduled-pact.ts` exists as a typed stub.
- `@methodts/pacta` `AgentEvent` union extended with `PactDeadLetterEvent`; all downstream exhaustive switches updated.
- `@methodts/agent-runtime` re-exports `ScheduledPact`, `JobBackedExecutor` type, `ContinuationEnvelope` type, `payload()` builder.
- Gates `G-PORT` + `G-BOUNDARY` + `G-ENVELOPE-VERSION` green.
- **Definition of done:** PRD-061 (SessionStore) + PRD-059 (BudgetRef from S3) Wave 0 merged; this Wave 0 compiles against them.

### Wave 1 — CortexJobBackedExecutor + `fresh-per-continuation`

- `CortexJobBackedExecutor.attach/start/yield/stop` implemented.
- `ScheduledPact.payload()` + `bind()`/`unbind()` implemented.
- `fresh-per-continuation` budget strategy fully wired against S3's
  current `CortexLLMProvider` (no reservation API needed).
- `CortexDlqObserver.onDeadLetter()` emits `PactDeadLetterEvent`.
- Gates `G-IDEMPOTENCY` + `G-ONE-HANDLER` + `G-DLQ-SINGLE-EMIT` green.
- **SC-2** (daily 9am) + **SC-3** (DLQ terminal) + **SC-4** (at-least-once replay) pass against Cortex local dev stack.
- **Definition of done:** a sample app `samples/cortex-daily-twin-agent/` runs end-to-end; conformance fixtures pass.

### Wave 2 — `batched-held` strategy (gated on O1)

- `ctx.llm.reserve()/settle()` API lands in Cortex PRD-068.
- `CortexLLMProvider` exposes `reserve(maxCostUsd): Promise<BudgetRef>` + `settle(ref, actualUsd)`.
- `batched-held` strategy wired; default switches from `fresh-per-continuation` to `batched-held`.
- Pacta `budgetEnforcer` `mode: 'predictive'` verified against reservation.
- **SC-1** (overnight pact across restarts) passes.
- **Definition of done:** Twins Wave 1 agent migrated to `batched-held`;
  restart-fuzz conformance passes 100/100.

### Wave 3 — `InProcessExecutor` + backwards-compat + `predictive-prereserve`

- `InProcessExecutor` implementing the full `JobBackedExecutor` port by
  wrapping `StrategyExecutor` + an in-memory job queue.
- Bridge composition root wires `InProcessExecutor` for standalone mode.
- `predictive-prereserve` strategy using per-pact telemetry from PRD-063.
- **SC-5** (standalone bridge smoke tests green) verified.
- **Definition of done:** `npm run bridge:test` green; `predictive-prereserve`
  ships behind a feature flag in at least one tenant app.

---

## Open Questions

| # | Question | Owner | Blocking? | Notes |
|---|----------|-------|-----------|-------|
| O1 | `ctx.llm.reserve()/settle()` API shape | Cortex (PRD-068 extension) | **YES for Wave 2** | Roadmap §8 Q2, S5 §10.1, S3 §7. Without this, `batched-held` cannot ship. Wave 1 uses `fresh-per-continuation` only. |
| O2 | Per-app envelope size limit beyond SQS 256 KB | Cortex | No (Wave 2 nice-to-have) | S5 §10.2 |
| O3 | EventBridge payload cap for `ScheduledPactPayload` with large `initialContext` | Cortex | No (documented constraint) | S5 §10.3 |
| O4 | Cross-app scheduling | Cortex (PRD-080) | No (explicit out-of-scope) | Deferred per S5 §10.4 |
| O5 | Manifest schema addition — who owns `spec.methodology.scheduledPacts[]`? | Cortex + Method joint | No (fallback works) | See R-6 |
| O6 | `markLastAckedTurn` atomicity on S4 — single-write with `appendCheckpoint`? | Method (PRD-061 amendment?) | No (mitigated) | See R-4 |

---

## References

- **Surface decisions** (frozen 2026-04-14):
  - `.method/sessions/fcd-surface-job-backed-executor/decision.md` — S5
  - `.method/sessions/fcd-surface-session-store/decision.md` — S4
  - `.method/sessions/fcd-surface-cortex-service-adapters/decision.md` — S3
  - `.method/sessions/fcd-surface-runtime-package-boundary/decision.md` — S2
- **Method today:**
  - `packages/bridge/src/domains/strategies/strategy-executor.ts` — in-process executor (becomes `InProcessExecutor` wrapee)
  - `packages/bridge/src/domains/triggers/schedule-trigger.ts` — in-process cron (diverges from job-backed model)
- **Cortex:**
  - `t1-repos/t1-cortex-1/docs/prds/071-jobs-service.md` — `ctx.jobs`
  - `t1-repos/t1-cortex-1/docs/prds/075-scheduling-service.md` — `ctx.schedule`
  - `t1-repos/t1-cortex-1/docs/prds/068-llm-service.md` — `ctx.llm` (+ pending O1)
  - `t1-repos/t1-cortex-1/docs/prds/065-audit-service.md` — `ctx.audit`
- **Roadmap context:** `docs/roadmap-cortex-consumption.md` §§4.1(6), 4.2(8), 5-B2/B3, 7 Phase 3, 8 Q2, 10 S5
