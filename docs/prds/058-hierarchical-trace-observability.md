---
type: prd
title: "PRD 058: Hierarchical Trace Observability — Streaming Events, Assembled Cycles, Persistent Sinks"
date: "2026-04-25"
status: complete
tier: medium
depends_on: []
enables: []
blocked_by: []
complexity: medium
domains: [pacta/cognitive/algebra, pacta/cognitive/observability, pacta/middleware, bridge/domains/sessions, bridge/domains/strategies]
surfaces:
  - "TraceEvent + TraceEventKind (streaming primitive) — frozen 2026-04-25 (Wave 0)"
  - "CycleTrace > PhaseTrace > OperationTrace (assembled hierarchy) — frozen 2026-04-25 (Wave 0)"
  - "TraceSink port (event-shaped) + TraceStream + TraceStore — frozen 2026-04-25 (Wave 0)"
related:
  - ".method/sessions/fcd-design-20260425-lysica-port-portfolio/notes.md"
  - ".method/sessions/fcd-plan-20260425-prd-058-trace/realize-plan.md"
  - "../lysica-1/src/pacta/core/trace/types.py"
  - "../lysica-1/src/lysica/observability/"
progress:
  wave_0: complete
  wave_1: complete (C-1, C-2, C-3)
  wave_2: complete (C-4 — extracted into @methodts/pacta-trace-sqlite)
  wave_3: complete (C-5 framework + bridge composition wiring landed via agent A)
---

## Progress log

| Date | Wave | Outcome |
|---|---|---|
| 2026-04-25 | Wave 0 | **Complete.** All three surfaces frozen as concrete TS files. Build green, all 988 pacta tests pass, 4 G-TRACE-* gate assertions pass. See [progress notes](#wave-0-complete-2026-04-25). |
| 2026-04-25 | Wave 1 / C-1 | **Complete.** TraceAssembler + TraceRingBuffer implemented with 12 new tests (5 assembler, 7 ring-buffer). 1000/1000 pacta tests pass. AC-2 + AC-4 verified. |
| 2026-04-25 | Wave 1 / C-2 | **Complete.** `cycle.ts` emits `cycle-start`, `phase-start/end`, `cycle-end` when any TraceSink declares `onEvent`. `try/finally` guarantees `cycle-end` on every exit path. 5 new tests. 1005/1005 pacta tests pass. AC-1 + AC-6 regression verified. |
| 2026-04-25 | Wave 1 / C-3 | **Complete.** `tracingMiddleware()` emits OPERATION TraceEvents around `AgentProvider.invoke()` calls. Fire-and-forget on the sink (verified: hot-path latency ≤ slow-sink latency). Result returned unchanged (observability-only contract). 7 new tests. 1014/1014 pacta tests pass. AC-5 verified. **Wave 1 complete.** |
| 2026-04-25 | Wave 2 / C-4 | **Complete.** `SqliteTraceStore` extracted into a new sibling package `@methodts/pacta-trace-sqlite` (pacta's `G-PORT` gate forbids native deps — `better-sqlite3` lives outside the framework package). 8 unit tests + 2 integration tests (cycle.ts → SqliteTraceStore round-trip). 1012 pacta + 10 trace-sqlite = 1022 tests pass. AC-3 (round-trip + retention + query + stats) verified. **Wave 2 complete.** |
| 2026-04-25 | Wave 3 / C-5 (framework) | **Framework piece complete.** `TraceEventBusSink` in `@methodts/runtime/sessions` translates pacta `TraceEvent`s onto the Universal Event Bus (`domain: 'trace'`, `type: 'trace.cycle_start'/'trace.phase_end'/...`). Mirrors the `CognitiveEventBusSink` pattern. 6 new tests, 640/640 runtime tests pass. |
| 2026-04-25 | Wave 3 / C-5 (bridge wiring) | **Complete (agent A).** Bridge cognitive sessions now construct a `TraceEventBusSink` per session (sessionId/projectId/experimentId/runId context) when an `EventBus` is present. ProviderAdapter is wrapped to emit OPERATION `TraceEvent`s on each LLM invocation — the bridge runs its own manual cognitive cycle (not pacta's `cycle.ts`), so this wrap is the integration point. Default-off contract: no behavior change when no event-aware sink is supplied. 8 new tests (4 bridge wiring, 4 runtime e2e). 644/644 runtime tests pass. **PRD 058 complete.** |

### Wave 0 complete (2026-04-25)

**Files created (orchestrator):**

- `packages/pacta/src/cognitive/algebra/trace-events.ts` — `TraceEvent`, `TraceEventKind` (Surface 1)
- `packages/pacta/src/cognitive/algebra/trace-cycle.ts` — `CycleTrace`, `PhaseTrace`, `OperationTrace`, `TraceStats` (Surface 2)
- `packages/pacta/src/cognitive/algebra/trace-stream.ts` — `TraceStream` port (Surface 3a)
- `packages/pacta/src/cognitive/algebra/trace-store.ts` — `TraceStore` port + `TraceStoreQueryOptions` + `TraceStoreStatsOptions` (Surface 3b)
- `packages/pacta/src/cognitive/observability/README.md` — domain README with mental model + migration policy
- `packages/pacta/src/cognitive/observability/index.ts` — barrel
- `packages/pacta/src/cognitive/observability/assembler.ts` — skeleton (throws Wave 1)
- `packages/pacta/src/cognitive/observability/ring-buffer.ts` — skeleton (throws Wave 1)
- `packages/pacta/src/cognitive/observability/sqlite-store.ts` — skeleton (throws Wave 2)
- `packages/pacta/src/cognitive/algebra/__tests__/trace-architecture.test.ts` — gate assertions

**Files modified (orchestrator):**

- `packages/pacta/src/cognitive/algebra/trace.ts` — `TraceSink.onEvent?(event: TraceEvent)` added (additive)
- `packages/pacta/src/cognitive/algebra/trace-sinks.ts` — `InMemoryTraceSink` and `ConsoleTraceSink` extended with `onEvent`; `InMemoryTraceSink.events()` accessor added
- `packages/pacta/src/cognitive/algebra/index.ts` — re-export new types
- `packages/pacta/src/cognitive/index.ts` — re-export `observability/`

**Files NOT touched in Wave 0 (deferred):**

- `packages/runtime/src/ports/event-bus.ts` — no change needed at this stage. `RuntimeEvent` already has the `(string & {})` escape hatch on `EventDomain`, so `'trace'` slots in without a type-level change. Actual integration (typed `TraceRuntimeEvent` discriminator) lands with C-5 in Wave 3.
- `packages/pacta/src/index.ts` — no top-level re-export change needed; new types reach consumers through the existing `cognitive/index.ts` cascade.

**Gate assertions (all passing):**

- `G-TRACE-EVENT-SHAPE` — `trace-events.ts` exports pure types only
- `G-TRACE-CYCLE-SHAPE` — `trace-cycle.ts` exports pure types only
- `G-TRACE-SINK` — `TraceSink.onEvent` is optional; `onTrace` remains non-optional
- `G-TRACE-STORE` — `trace-store.ts` has zero implementation imports

**Verification:**

- `npm run build --workspace=@methodts/pacta` — green
- `npm run build` (workspace) — green
- `npm test --workspace=@methodts/pacta` — 988 pass, 0 fail (existing flat-trace tests untouched, AC-6 regression gate held)

**Next:** Wave 1 (parallel) — C-1 (`observability` assembler + ring buffer), C-2 (`engine` cycle event emission), C-3 (`middleware` tracing). See [realize-plan.md](../../.method/sessions/fcd-plan-20260425-prd-058-trace/realize-plan.md).

---

# PRD 058: Hierarchical Trace Observability

## Problem

`@methodts/pacta` has only flat per-step traces. The current contract,
`TraceRecord` in `packages/pacta/src/cognitive/algebra/trace.ts`, captures
one `(moduleId, phase, timestamp, durationMs, monitoring, tokenUsage)`
per module step. The two built-in sinks
(`InMemoryTraceSink`, `ConsoleTraceSink` in `trace-sinks.ts`) just append
or pretty-print them.

That shape is fine for the algebra-level "did module X emit signal Y?"
question. It collapses everything else:

- **No cycle boundary.** The bridge UI cannot reconstruct "this is what
  cycle 47 looked like" without re-grouping records by some implicit
  cycle ID that doesn't exist in the trace.
- **No phase aggregation.** Cycle phases (OBSERVE, ATTEND, REMEMBER, ...)
  emit traces interleaved with other modules; there's no canonical
  per-phase view, no per-phase duration, no per-phase signal aggregation.
- **No nested operations.** When a phase calls an LLM (`OPERATION`), the
  call appears as a separate `TraceRecord` next to the phase's record
  rather than inside it. Bridge frontend trace viewers reconstruct the
  hierarchy ad-hoc per call site.
- **No persistent backend.** `InMemoryTraceSink` is fine for tests; the
  bridge keeps no canonical trace store. Strategy retros, cognitive
  experiments, and the experiments domain each persist their own slice.
- **No live stream API.** The frontend's session pane subscribes via the
  bridge WebSocket (`shared/event-bus`), but trace records flow through a
  separate path; consumers get one shape from `TraceSink` and another from
  the event bus.

The Python sister repo (`lysica-1`) shipped a hierarchical trace model with
streaming events, an assembler, and three concrete sinks (ring buffer,
SQLite store, self-monitor). The shape is well-tested, framework-level,
and answers all the gaps above. This PRD ports it.

The lysica work also includes a `TracingLLMProvider` decorator that emits
`OPERATION` trace events for every LLM call. method's middleware stack
(`budget-enforcer`, `output-validator`, `throttler`) is the natural place
for that wrapper — adding it makes per-LLM-call traces appear automatically
inside their parent phase.

## Constraints

- **Additive over flat `TraceRecord`.** The existing flat record is consumed
  by tests and possibly by the bridge experiments domain. We do not delete
  it in this PRD. We add hierarchical events as a parallel surface and let
  consumers migrate at their own pace.
- **No new wire protocol.** The bridge's `shared/event-bus/` already has a
  WebSocket and a JSONL persistence sink. The hierarchical trace events
  are new types but flow through the existing bus, not a parallel
  transport.
- **TraceSink stays the unifying port.** Whatever sink shape we pick, it
  must continue to satisfy the existing `TraceSink.onTrace(record)` callers
  during the migration window.
- **No OpenTelemetry adoption.** OTel-compatible export is out of scope —
  separate PRD when there's a target backend.
- **Bridge frontend changes are downstream.** This PRD ships the producer
  side and the persistence sink. The frontend trace viewer can adopt the
  new shape in a follow-up.

## Success Criteria

1. **Hierarchical events emitted from a real cycle.** Running a cognitive
   cycle through `cycle.ts` (with the new emitter wired in) produces a
   stream of `TraceEvent`s with `CYCLE_START`, per-phase `PHASE_START`/
   `PHASE_END`, and any `OPERATION` events from LLM/SLM calls inside the
   phase. The event stream is deterministic in test mode.
2. **Assembler reconstructs `CycleTrace`.** Feeding the event stream into
   `TraceAssembler` produces a single `CycleTrace` with nested
   `PhaseTrace`s and `OperationTrace`s, matching the shape lysica's
   tests verify.
3. **Persistent sink works.** A SQLite-backed `TraceStore` writes
   assembled cycles, supports time-range queries, and applies a retention
   policy. Backed by `better-sqlite3` (already in the bridge dep tree)
   with retention defaulting to 7 days.
4. **Live stream works.** A bounded `TraceRingBuffer` fans out events to
   ≥2 concurrent subscribers, evicts slow ones, and exposes a recent-N
   query.
5. **Tracing middleware emits OPERATION events.** Wrapping any
   `AgentProvider` with `tracingMiddleware()` causes `OPERATION` events
   to appear in the trace stream around each provider invocation, with
   token usage and latency populated.
6. **Existing flat-trace tests still pass.** The legacy `TraceRecord`
   path is untouched; tests against `InMemoryTraceSink` continue to work.

## Scope

In scope:

- New `pacta/cognitive/observability/` directory under `@methodts/pacta`
  containing trace event types, assembler, ring buffer, and SQLite store.
- New trace-event-shaped `TraceSink` port (`onEvent`); the existing
  flat-`onTrace` port stays in place during migration.
- `tracingMiddleware()` for `pacta/middleware/` that emits OPERATION
  trace events around each LLM call.
- Wiring inside `cycle.ts` to emit CYCLE / PHASE events when an event
  sink is configured. Backward-compat: if no event sink is configured,
  no behavior change.
- Bridge composition wiring so the event-bus and persistence layer can
  consume the new event types.

Out of scope:

- Replacing `TraceRecord` with `TraceEvent` everywhere. Migration is
  consumer-paced.
- Bridge frontend trace viewer changes.
- OpenTelemetry export.
- Distributed tracing (cross-process correlation IDs, parent spans).
- Cognitive experiments domain rewriting its own persistence on top of
  this — that's a follow-up PRD.

**Anti-capitulation:** if a reviewer asks "while we're here, swap
`TraceRecord` for `TraceEvent` everywhere", refuse. The point of additive
ports is to ship without coordinating every consumer. Migration is a
follow-up.

## Domain Map

```
   ┌──────────────────────────────────────────────────────────────────┐
   │                  pacta/cognitive/engine/cycle.ts                  │
   │  emits CYCLE_START / PHASE_START / PHASE_END / CYCLE_END events   │
   └────────────────┬─────────────────────────────────────────────────┘
                    │ TraceEvent
                    ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │              pacta/middleware/tracing-middleware.ts               │
   │  wraps AgentProvider; emits OPERATION events around each call     │
   └────────────────┬─────────────────────────────────────────────────┘
                    │ TraceEvent
                    ▼
            ┌────────────────────┐
            │   TraceSink        │   (new port — `onEvent`)
            └─────┬───────┬──────┘
                  │       │
        ┌─────────┘       └──────────────┐
        ▼                                ▼
 ┌──────────────────┐           ┌──────────────────────┐
 │  TraceRingBuffer │           │   SqliteTraceStore   │
 │  fan-out streams │           │  + TraceAssembler    │
 │  (live UI)       │           │  (history + queries) │
 └──────────────────┘           └──────────────────────┘
        │                                │
        ▼                                ▼
 frontend WebSocket            bridge cost-governor / retros / experiments
```

Affected domains:

| Domain | Change |
|---|---|
| `pacta/cognitive/algebra/trace.ts` (existing) | **Extend.** Add new event types alongside existing `TraceRecord`. Existing port `TraceSink.onTrace` preserved; new `onEvent` added. |
| `pacta/cognitive/observability` | **New.** Houses `TraceAssembler`, `TraceRingBuffer`, `SqliteTraceStore`. |
| `pacta/cognitive/engine/cycle.ts` | **Extend.** When configured with an event sink, emit CYCLE/PHASE events. Default-off keeps current behavior. |
| `pacta/middleware` | **Extend.** Add `tracingMiddleware()` that emits OPERATION events. |
| `bridge/shared/event-bus` | **Extend.** Recognize `TraceEvent` as a typed event variant; route to WebSocket + persistence sinks. |
| `bridge/domains/sessions` | **Wire.** Construct `TraceRingBuffer` per session for the live frontend stream. |
| `bridge/domains/strategies` | **Optionally consume.** Strategy retros can read recent cycles via `TraceStore.getCycles()`. Out-of-scope wiring. |

## Surfaces (Primary Deliverable)

Three surfaces — all STANDARD per fcd-design 3.2.

### Surface 1 — `TraceEvent` + `TraceEventKind` (streaming primitive)

**Owner:** `pacta/cognitive/algebra` · **Producer:** `cycle.ts`, `tracingMiddleware`, any module that wants to emit OPERATION events · **Consumer:** any sink

**Direction:** producer → sink (one-way emission)

**Status:** to freeze in Wave 0

**New** `packages/pacta/src/cognitive/algebra/trace-events.ts`:

```typescript
export type TraceEventKind =
  | 'cycle-start'
  | 'cycle-end'
  | 'phase-start'
  | 'phase-end'
  | 'operation';

export interface TraceEvent {
  /** Unique per emission. */
  readonly eventId: string;
  /** Identifies the cycle this event belongs to. Stable across a cycle. */
  readonly cycleId: string;
  readonly kind: TraceEventKind;
  /** Human-readable name: "observe", "reasoner", "llm-complete", "slm-cascade". */
  readonly name: string;
  /** Wall-clock time of emission (ms since epoch). */
  readonly timestamp: number;
  /** Set on *_END and OPERATION events; undefined on *_START. */
  readonly durationMs?: number;
  /** Set when event belongs to a phase; undefined on cycle-level events. */
  readonly phase?: string;
  /** Free-form payload. Producers should keep this small. */
  readonly data?: Readonly<Record<string, unknown>>;
  /** Signals captured at emission time. Optional. */
  readonly signals?: readonly MonitoringSignal[];
}
```

**Consumer-usage minimality check:** `kind` must enumerate every event
type a consumer needs to discriminate on. The lysica enum has exactly the
5 we need (cycle/phase × start/end + operation). Adding more later is
additive. Removing requires migration. Frozen as 5.

**Gate:** `G-TRACE-EVENT-SHAPE` — `TraceEvent` is a pure type with no
methods, no class wrapping, no inheritance. Asserted via the existing
`architecture.test.ts` pattern.

### Surface 2 — `CycleTrace > PhaseTrace > OperationTrace` (assembled hierarchy)

**Owner:** `pacta/cognitive/algebra` · **Producer:** `TraceAssembler` (and any direct constructor) · **Consumer:** trace stores, retros, frontend viewers

**Direction:** assembler/store → consumers

**Status:** to freeze in Wave 0

**New** `packages/pacta/src/cognitive/algebra/trace-cycle.ts`:

```typescript
export interface OperationTrace {
  readonly operation: string;     // "llm-complete", "slm-inference", "memory-retrieve"
  readonly startedAt: number;
  readonly durationMs: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PhaseTrace {
  readonly phase: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
  readonly inputSummary: string;
  readonly outputSummary: string;
  readonly signals: readonly MonitoringSignal[];
  readonly operations: readonly OperationTrace[];
  readonly error?: string;
}

export interface CycleTrace {
  readonly cycleId: string;
  readonly cycleNumber: number;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
  readonly inputText: string;
  readonly outputText: string;
  readonly phases: readonly PhaseTrace[];
  readonly signals: readonly MonitoringSignal[];
  readonly tokenUsage?: TokenUsage;
  readonly workspaceSnapshot?: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

export interface TraceStats {
  readonly cycleCount: number;
  readonly avgDurationMs: number;
  readonly avgInputTokens: number;
  readonly avgOutputTokens: number;
  readonly phaseAvgDurations: ReadonlyMap<string, number>;
  readonly signalCounts: ReadonlyMap<string, number>;
  readonly slmEscalationRate: number | null;
}
```

**Consumer-usage minimality check:** `inputSummary`/`outputSummary` are
strings rather than the full inputs to bound payload size; consumers
needing the full input can query the underlying provider trace through
`metadata`. `workspaceSnapshot` is optional because strategies sometimes
need it and live UI doesn't. Both fields verified in lysica's consumer
tests; kept.

**Gate:** `G-TRACE-CYCLE-SHAPE` — types are pure interfaces, no
embedded behavior.

### Surface 3 — `TraceSink` (event-shaped) + `TraceStream` + `TraceStore`

**Owner:** `pacta/cognitive/algebra` · **Producer:** event-emitting code · **Consumer:** sinks (ring buffer, sqlite, custom)

**Direction:** producer → sink; sink → consumer queries (TraceStore reads)

**Status:** to freeze in Wave 0

**Extended port** in `packages/pacta/src/cognitive/algebra/trace.ts`:

```typescript
// Existing — preserved as-is
export interface TraceSink {
  onTrace(record: TraceRecord): void;

  /**
   * Emit a hierarchical trace event. Optional — sinks that only handle
   * flat records can leave this undefined. Producers prefer onEvent
   * when both are available.
   */
  onEvent?(event: TraceEvent): void | Promise<void>;
}
```

**New ports** in `packages/pacta/src/cognitive/algebra/trace-stream.ts`:

```typescript
export interface TraceStream {
  /**
   * Subscribe to live trace events. Returns an async iterator.
   * Slow subscribers whose internal queue fills are disconnected.
   */
  subscribe(): AsyncIterable<TraceEvent>;
}
```

**New ports** in `packages/pacta/src/cognitive/algebra/trace-store.ts`:

```typescript
export interface TraceStoreQueryOptions {
  readonly limit?: number;
  readonly since?: number;   // ms since epoch
  readonly before?: number;
}

export interface TraceStore {
  storeCycle(trace: CycleTrace): Promise<void>;
  getCycle(cycleId: string): Promise<CycleTrace | null>;
  getCycles(options?: TraceStoreQueryOptions): Promise<readonly CycleTrace[]>;
  getStats(options?: { windowCycles?: number }): Promise<TraceStats>;
}
```

**Consumer-usage minimality check:** lysica's full `TraceStore` API has 4
read methods. Verified in consumer tests (web API, self-monitor). All four
kept. No write-time methods beyond `storeCycle` — sinks that *also*
implement `TraceSink.onEvent` write through the assembler.

**Gates:**
- `G-TRACE-SINK` — `TraceSink.onEvent` signature additive, doesn't break existing implementers.
- `G-TRACE-STORE` — `TraceStore` interface has zero implementation imports.

### Entity check

`MonitoringSignal` and `TokenUsage` are existing canonical types — reused
unchanged. `TraceRecord` is preserved (legacy). New types
(`TraceEvent`, `TraceEventKind`, `OperationTrace`, `PhaseTrace`,
`CycleTrace`, `TraceStats`) are all framework-level and live next to their
existing analogs in `cognitive/algebra/`.

### Surface summary

| # | Surface | Owner | Producer → Consumer | Status | Gate |
|---|---|---|---|---|---|
| 1 | `TraceEvent` + kinds | `cognitive/algebra` | emitters → sinks | to-freeze | G-TRACE-EVENT-SHAPE |
| 2 | `CycleTrace > PhaseTrace > OperationTrace` | `cognitive/algebra` | assembler → consumers | to-freeze | G-TRACE-CYCLE-SHAPE |
| 3 | `TraceSink.onEvent`, `TraceStream`, `TraceStore` | `cognitive/algebra` | producer → sink, sink → query consumers | to-freeze | G-TRACE-SINK, G-TRACE-STORE |

## Per-Domain Architecture

### `pacta/cognitive/algebra` (extended)

```
packages/pacta/src/cognitive/algebra/
  trace.ts                    Existing — extend with onEvent on TraceSink
  trace-events.ts             NEW — TraceEvent, TraceEventKind
  trace-cycle.ts              NEW — CycleTrace, PhaseTrace, OperationTrace, TraceStats
  trace-stream.ts             NEW — TraceStream port
  trace-store.ts              NEW — TraceStore port
  trace-sinks.ts              Existing — extend InMemoryTraceSink to also implement onEvent
```

### `pacta/cognitive/observability` (NEW)

```
packages/pacta/src/cognitive/observability/
  README.md
  index.ts
  assembler.ts                TraceAssembler — TraceEvent stream → CycleTrace
  assembler.test.ts
  ring-buffer.ts              TraceRingBuffer — bounded buffer + fan-out
  ring-buffer.test.ts
  sqlite-store.ts             SqliteTraceStore — better-sqlite3 backend
  sqlite-store.test.ts
```

**Decisions:**
- **`better-sqlite3` over `node:sqlite`.** The bridge already depends on
  `better-sqlite3` for the strategies persistence layer. Using the same
  driver keeps deps consistent and avoids the `node:sqlite` experimental
  API status.
- **Synchronous SQLite I/O wrapped in async.** `better-sqlite3` is sync;
  the `TraceStore` interface is async to match the lysica shape and to
  allow alternative async backends (Postgres, MongoDB) later.

### `pacta/cognitive/engine/cycle.ts` (extended)

Add an optional `eventSink?: TraceSink & { onEvent: NonNullable<TraceSink['onEvent']> }`
to the cycle config. When present:

- Emit `CYCLE_START` at cycle entry, `CYCLE_END` at exit (with aggregate
  data: phase count, signal count).
- Around each phase invocation, emit `PHASE_START`/`PHASE_END` (with
  duration, output summary, error if any).

Phase modules don't need to know about events — emission is centralized
in the cycle wrapper. Modules that want OPERATION-granularity events
emit them directly through the sink they receive (see middleware below).

### `pacta/middleware/tracing-middleware.ts` (NEW)

```typescript
export interface TracingMiddlewareOptions {
  readonly sink: { onEvent(event: TraceEvent): void | Promise<void> };
  /**
   * Producer for the cycle ID — typically read from the surrounding
   * cycle context. Defaults to a per-call random ID (useful for tests).
   */
  readonly cycleId?: () => string;
  /** Phase tag attached to each emitted event. */
  readonly phase?: string;
}

export function tracingMiddleware(
  options: TracingMiddlewareOptions
): <T>(next: InvokeFn<T>) => InvokeFn<T>;
```

Emits an `OPERATION` event around each `AgentProvider.invoke()` with
`metadata: { inputTokens, outputTokens, model }`.

### `bridge/shared/event-bus`

Add `TraceEvent` as a typed event variant. The existing `WebSocketSink`,
`PersistenceSink`, and `ChannelSink` already accept untyped `BridgeEvent`s
— they pass through unchanged.

### `bridge/domains/sessions`

When a cognitive session boots, construct a per-session `TraceRingBuffer`
sized at 1024 events. Wire it as both an event sink (writes via `onEvent`)
and a stream consumer for the WebSocket frontend (reads via `subscribe()`).

### `bridge/domains/strategies` (optional, downstream)

Out of scope. Future PRDs may consume `TraceStore.getCycles()` for retros.

### Layer Stack Cards

| Component | Layer | Domain | Consumed Ports |
|---|---|---|---|
| `TraceAssembler` | L2 | `cognitive/observability` | (pure) |
| `TraceRingBuffer` | L2 | `cognitive/observability` | (in-memory only) |
| `SqliteTraceStore` | L3 | `cognitive/observability` | (better-sqlite3) |
| `tracingMiddleware` | L3 | `pacta/middleware` | `TraceSink.onEvent` |

No card escalation needed.

## Phase Plan

### Wave 0 — Surfaces (≈1 day)

1. Add types: `trace-events.ts`, `trace-cycle.ts`, `trace-stream.ts`, `trace-store.ts`.
2. Extend `TraceSink` with optional `onEvent`.
3. Create `pacta/cognitive/observability/` skeleton (empty implementations).
4. Add gate assertions: G-TRACE-EVENT-SHAPE, G-TRACE-CYCLE-SHAPE, G-TRACE-SINK, G-TRACE-STORE.

**Acceptance:** build green; existing flat-trace tests still pass.

### Wave 1 — Assembler + Ring Buffer (≈1.5 days)

1. Implement `TraceAssembler`: stateful event stream → `CycleTrace`. Graceful degradation on missing CYCLE_START.
2. Implement `TraceRingBuffer`: bounded deque, fan-out subscriptions, slow-subscriber eviction.
3. Tests: lysica's test cases ported to TS + edge cases for partial traces.

**Acceptance:** assembler & ring-buffer tests green.

### Wave 2 — SQLite Store (≈1 day)

1. Implement `SqliteTraceStore` with `better-sqlite3`.
2. Schema: `cycle_traces` table with denormalized columns + JSON blob.
3. Retention cleanup on `initialize()`.
4. Stats aggregation.

**Acceptance:** sqlite-store tests green; retention applies on init.

### Wave 3 — Cycle emission + tracing middleware (≈1.5 days)

1. Wire CYCLE/PHASE event emission into `cycle.ts` (default-off, keyed on `eventSink` presence).
2. Implement `tracingMiddleware()`.
3. Compose-time test: a 3-phase cycle through `cycle.ts` with `tracingMiddleware` wrapping the LLM provider produces a complete event stream → assembler → CycleTrace round-trip.

**Acceptance:** end-to-end test green; bridge boots unchanged when no event sink configured.

### Wave 4 — Bridge wiring (≈1 day)

1. `bridge/shared/event-bus`: route `TraceEvent` through existing sinks.
2. `bridge/domains/sessions`: per-session `TraceRingBuffer`.
3. Optional: a single `SqliteTraceStore` per bridge process for history.
4. Smoke test: run a cognitive session via `npm run bridge:test`, observe events on the WebSocket.

**Acceptance:** bridge frontend's existing trace pane shows nothing new (still consumes legacy traces) but the new event stream is observable on `/ws/traces`.

### Acceptance Gates

| Wave | Tests | Gates | Done |
|---|---|---|---|
| 0 | architecture.test.ts | G-TRACE-* | Surfaces typed and asserted |
| 1 | assembler.test.ts, ring-buffer.test.ts | (cumulative) | Round-trip events → cycle trace |
| 2 | sqlite-store.test.ts | (cumulative) | Cycle persisted, queryable, retention applied |
| 3 | cycle integration test, tracing-middleware.test.ts | (cumulative) | LLM call inside phase produces OPERATION nested under PHASE inside CYCLE |
| 4 | bridge smoke (`npm run bridge:test` + manual WebSocket) | (cumulative) | Events flow through existing event-bus to frontend |

## Risks

- **R1 — Event volume.** Cognitive cycles may emit dozens of events per
  second under load. The ring buffer caps live volume; the SQLite store
  could grow unbounded. **Mitigation:** retention default 7 days; an
  optional `maxRowsPerCycle` cap; cost-governor can include trace storage
  in its budget if it becomes relevant.
- **R2 — Async sink ordering.** `onEvent` returning `Promise<void>` means
  emitters must `await` (or fire-and-forget). Cycle emission `await`s; the
  middleware fire-and-forgets to keep the LLM hot path tight.
  **Mitigation:** the assembler is order-tolerant (key by cycleId, not
  arrival order).
- **R3 — Legacy `TraceRecord` lingering.** Two trace shapes coexisting
  for an unknown duration is a long tail of "which one to use". **Mitigation:**
  the README in `cognitive/observability/` names the migration policy
  explicitly: new code emits events, old code keeps records, both flow
  through `TraceSink`. A deprecation PRD removes records when no consumer
  remains.
- **R4 — Bridge dep on `better-sqlite3` native build.** Already in tree
  for strategies; no new risk. **Mitigation:** none needed.
- **R5 — Workspace snapshot ballooning the JSON blob.** Default opt-out;
  strategies that want it pay the cost. **Mitigation:** snapshot field
  is optional and excluded from the default ring-buffer event payload.

## Related Work

- `../lysica-1/src/pacta/core/trace/types.py` — type reference.
- `../lysica-1/src/lysica/observability/{assembler,ring_buffer,sqlite_store}.py` — implementation reference.
- `packages/pacta/src/cognitive/algebra/trace.ts` — the existing flat shape that survives.
- `packages/bridge/src/shared/event-bus/` — the bus we plug into.

## Open Questions

1. Should `tracingMiddleware()` and the cycle emitter share a `cycleId`
   accessor (e.g., AsyncLocalStorage) so middleware events automatically
   nest under the right cycle? Wave 3 decides — if a clean accessor
   exists, use it; otherwise pass `cycleId` through middleware options.
2. Does the bridge need a *single* shared `SqliteTraceStore` or one per
   session/strategy run? Default: one per bridge process; revisit if
   queries get slow.
3. Should we emit a `TraceEvent` for every monitor signal, or only at
   PHASE_END / OPERATION boundaries? Default: bundle signals on the
   PHASE_END event (lysica's choice). A high-frequency signal-by-signal
   stream is a follow-up if a consumer needs it.
