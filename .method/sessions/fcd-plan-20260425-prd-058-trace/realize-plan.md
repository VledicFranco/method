---
type: realize-plan
prd: docs/prds/058-hierarchical-trace-observability.md
date: "2026-04-25"
status: ready
total_commissions: 5
total_waves: 4
---

# Realization Plan — PRD 058: Hierarchical Trace Observability

## PRD Summary

**Objective:** Port lysica's hierarchical trace types (`TraceEvent`,
`CycleTrace > PhaseTrace > OperationTrace`), assembler, ring buffer,
and SQLite store from `lysica-1` to TS, plus a `tracingMiddleware` that
emits OPERATION events around `AgentProvider.invoke()` calls. Additive
over existing flat `TraceRecord`; legacy path preserved.

**Success criteria (PRD §Success Criteria):**

| # | Criterion | Verifying Wave |
|---|---|---|
| AC-1 | Cycle emits hierarchical events deterministically | Wave 1 (C-2) + Wave 2 integration |
| AC-2 | Assembler reconstructs `CycleTrace` round-trip | Wave 1 (C-1) |
| AC-3 | SQLite-backed `TraceStore` persists, queries, applies retention | Wave 2 (C-4) |
| AC-4 | `TraceRingBuffer` fans out to ≥2 subscribers; evicts slow | Wave 1 (C-1) |
| AC-5 | `tracingMiddleware()` emits OPERATION events with token usage + latency | Wave 1 (C-3) |
| AC-6 | Existing flat-trace tests still pass | Every wave (regression gate) |

## FCA Partition

| Commission | Domain | Wave | Title | Depends On |
|---|---|---|---|---|
| **(Wave 0)** | orchestrator | 0 | Surface preparation | — |
| **C-1** | `pacta/cognitive/observability` | 1 | Assembler + ring buffer | Wave 0 |
| **C-2** | `pacta/cognitive/engine` | 1 | Cycle event emission | Wave 0 |
| **C-3** | `pacta/middleware` | 1 | Tracing middleware | Wave 0 |
| **C-4** | `pacta/cognitive/observability` | 2 | SQLite trace store + integration test | C-1, C-2, C-3 |
| **C-5** | `runtime/sessions` (with bridge wiring) | 3 | Per-session trace stream wiring | C-1, C-2, C-4 |

**Parallel structure:**
- Wave 1 has three concurrent commissions in disjoint domains.
- Wave 2 returns to `pacta/cognitive/observability` (same domain as C-1) for the SQLite store + the cross-domain integration test.
- Wave 3 wires the bridge/runtime side, depends on the assembled output of Waves 1+2.

**Critical path:** Wave 0 → C-1 → C-4 → C-5 (≈4.5 days).
**Concurrency upside:** C-2 and C-3 run in parallel with C-1, saving ~1.5 days off serial.

## Wave 0 — Shared Surfaces (Mandatory, orchestrator-only)

**Status:** all PRD-058 surfaces are typed inline in the PRD (fcd-design Phase 3 inline freeze). Wave 0 applies them as concrete files and gate assertions. No `/fcd-surface` records were spun off because every contract is < 30 lines and unidirectional — meets the STANDARD inline criterion.

### Files to create (orchestrator commits)

```
packages/pacta/src/cognitive/algebra/
  trace-events.ts                NEW — TraceEvent, TraceEventKind (Surface 1)
  trace-cycle.ts                 NEW — CycleTrace, PhaseTrace, OperationTrace, TraceStats (Surface 2)
  trace-stream.ts                NEW — TraceStream port (Surface 3)
  trace-store.ts                 NEW — TraceStore port + TraceStoreQueryOptions (Surface 3)
  index.ts                       MODIFY — re-export new types

packages/pacta/src/cognitive/observability/
  README.md                      NEW
  index.ts                       NEW — barrel re-exports (assembler, ring-buffer, sqlite-store stubs)
  assembler.ts                   NEW — empty class declaration only (`throw new Error('Wave 1')`)
  ring-buffer.ts                 NEW — empty class declaration only
  sqlite-store.ts                NEW — empty class declaration only
```

### Files to modify (orchestrator commits)

```
packages/pacta/src/cognitive/algebra/
  trace.ts                       MODIFY — extend TraceSink with optional `onEvent`; preserve onTrace
  trace-sinks.ts                 MODIFY — extend InMemoryTraceSink to also implement onEvent
  __tests__/architecture.test.ts MODIFY — add G-TRACE-* gate assertions

packages/pacta/src/index.ts      MODIFY — re-export new public types if any leak

packages/runtime/src/ports/
  event-bus.ts                   MODIFY — add a 'trace' EventDomain variant (the union has `(string & {})` already; this is documentation + an optional discriminator added to a new `TraceRuntimeEvent` interface that extends RuntimeEvent; preserves wire format)
```

### Gate assertions to add

| Gate | Asserts |
|---|---|
| `G-TRACE-EVENT-SHAPE` | `trace-events.ts` exports pure types (no classes/methods) |
| `G-TRACE-CYCLE-SHAPE` | `trace-cycle.ts` exports pure interfaces |
| `G-TRACE-SINK` | `trace.ts` `TraceSink.onEvent` is optional (additive) |
| `G-TRACE-STORE` | `trace-store.ts` has zero implementation imports |

### Wave 0 verification

- `npm run build` green across the workspace
- `npm test --workspace=@methodts/pacta` passes (existing flat-trace tests untouched)
- New gate assertions pass
- `architecture.test.ts` updated for new files

**Wave 0 size estimate:** ≈1 day, single commit (or short PR if reviewers want it separate).

---

## Wave 1 — Parallel implementation (3 commissions)

### C-1: Assembler + Ring Buffer

```yaml
id: C-1
phase: PRD-058 Wave 1
title: "Implement TraceAssembler and TraceRingBuffer in cognitive/observability"
domain: "pacta/cognitive/observability"
wave: 1
scope:
  allowed_paths:
    - "packages/pacta/src/cognitive/observability/assembler.ts"
    - "packages/pacta/src/cognitive/observability/assembler.test.ts"
    - "packages/pacta/src/cognitive/observability/ring-buffer.ts"
    - "packages/pacta/src/cognitive/observability/ring-buffer.test.ts"
    - "packages/pacta/src/cognitive/observability/__tests__/**"
    - "packages/pacta/src/cognitive/observability/README.md"
  forbidden_paths:
    - "packages/pacta/src/cognitive/algebra/**"      # surfaces — orchestrator
    - "packages/pacta/src/cognitive/observability/sqlite-store.ts"  # C-4
    - "packages/pacta/src/cognitive/observability/index.ts"  # barrel — orchestrator
    - "packages/pacta/src/cognitive/engine/**"       # C-2
    - "packages/pacta/src/middleware/**"             # C-3
    - "packages/pacta/src/ports/**"                  # ports — orchestrator
    - "packages/pacta/package.json"
depends_on: []                                       # only Wave 0
parallel_with: [C-2, C-3]
consumed_ports:
  - name: TraceEvent
    status: frozen
    record: "docs/prds/058-hierarchical-trace-observability.md#surface-1"
  - name: CycleTrace / PhaseTrace / OperationTrace / TraceStats
    status: frozen
    record: "docs/prds/058-hierarchical-trace-observability.md#surface-2"
  - name: TraceStream
    status: frozen
    record: "docs/prds/058-hierarchical-trace-observability.md#surface-3"
produced_ports:
  - name: TraceAssembler (impl, no port)
  - name: TraceRingBuffer (impl of TraceSink + TraceStream)
deliverables:
  - "assembler.ts: stateful TraceEvent → CycleTrace accumulator"
  - "ring-buffer.ts: bounded deque, fan-out subscriptions, slow-subscriber eviction"
  - "Unit tests for both, including partial-trace graceful degradation"
documentation_deliverables:
  - "observability/README.md — describe assembler + ring-buffer semantics, link PRD 058"
acceptance_criteria:
  - "AC-2: feeding a complete event stream produces a structurally correct CycleTrace (round-trip test)"
  - "AC-2 partial: feeding events without CYCLE_START still produces a CycleTrace using fallback timestamps"
  - "AC-4: 2+ concurrent subscribers receive identical event streams"
  - "AC-4 eviction: subscriber whose queue exceeds 100 events is dropped from subscriber list"
estimated_tasks: 5
branch: "feat/prd058-c1-assembler-ring-buffer"
status: pending
```

### C-2: Cycle event emission

```yaml
id: C-2
phase: PRD-058 Wave 1
title: "Emit hierarchical TraceEvents from cognitive/engine/cycle.ts"
domain: "pacta/cognitive/engine"
wave: 1
scope:
  allowed_paths:
    - "packages/pacta/src/cognitive/engine/cycle.ts"
    - "packages/pacta/src/cognitive/engine/__tests__/**"
  forbidden_paths:
    - "packages/pacta/src/cognitive/algebra/**"
    - "packages/pacta/src/cognitive/observability/**"
    - "packages/pacta/src/middleware/**"
    - "packages/pacta/src/ports/**"
    - "packages/pacta/src/index.ts"
    - "packages/pacta/package.json"
depends_on: []                                       # only Wave 0
parallel_with: [C-1, C-3]
consumed_ports:
  - name: TraceEvent
    status: frozen
    record: "docs/prds/058-hierarchical-trace-observability.md#surface-1"
  - name: TraceSink.onEvent
    status: frozen
    record: "docs/prds/058-hierarchical-trace-observability.md#surface-3"
produced_ports: []
deliverables:
  - "cycle.ts: optional eventSink config field; emit CYCLE_START, PHASE_START, PHASE_END, CYCLE_END when present"
  - "Tests: cycle with eventSink stub captures expected event sequence; cycle without eventSink unchanged"
documentation_deliverables:
  - "cycle.ts module docstring updated to mention event emission opt-in"
acceptance_criteria:
  - "AC-1: cycle with 3 phases produces 8 events (1 CYCLE_START + 3×PHASE_START + 3×PHASE_END + 1 CYCLE_END) in deterministic order"
  - "AC-1 phase data: each PHASE_END carries duration, output summary, signals"
  - "AC-6 regression: all existing cycle tests pass; cycle without eventSink emits no events"
estimated_tasks: 4
branch: "feat/prd058-c2-cycle-event-emission"
status: pending
```

### C-3: Tracing middleware

```yaml
id: C-3
phase: PRD-058 Wave 1
title: "Implement tracingMiddleware emitting OPERATION events around AgentProvider.invoke"
domain: "pacta/middleware"
wave: 1
scope:
  allowed_paths:
    - "packages/pacta/src/middleware/tracing-middleware.ts"
    - "packages/pacta/src/middleware/tracing-middleware.test.ts"
    - "packages/pacta/src/middleware/index.ts"
  forbidden_paths:
    - "packages/pacta/src/middleware/budget-enforcer.ts"
    - "packages/pacta/src/middleware/output-validator.ts"
    - "packages/pacta/src/middleware/throttler.ts"
    - "packages/pacta/src/cognitive/**"
    - "packages/pacta/src/ports/**"
    - "packages/pacta/package.json"
depends_on: []                                       # only Wave 0
parallel_with: [C-1, C-2]
consumed_ports:
  - name: TraceEvent
    status: frozen
    record: "docs/prds/058-hierarchical-trace-observability.md#surface-1"
  - name: TraceSink.onEvent
    status: frozen
    record: "docs/prds/058-hierarchical-trace-observability.md#surface-3"
produced_ports:
  - name: tracingMiddleware (factory; matches existing middleware shape)
deliverables:
  - "tracing-middleware.ts: factory matching existing middleware<T>(invokeFn) signature"
  - "Emits OPERATION event around each invoke() with metadata: { inputTokens, outputTokens, model, durationMs }"
  - "Fire-and-forget on emission to keep LLM hot path tight"
  - "index.ts re-export added (this MAY be in scope since it's only adding a new symbol; coordinate with orchestrator if it requires reordering — fall back to leaving the export to orchestrator if uncertain)"
documentation_deliverables:
  - "middleware/README.md — add row for tracingMiddleware with one-line description and example"
acceptance_criteria:
  - "AC-5: wrapping a stub provider with tracingMiddleware produces 1 OPERATION event per invoke() call"
  - "AC-5 metadata: emitted event metadata includes inputTokens, outputTokens, model, durationMs"
  - "AC-6 regression: existing middleware composition tests (budget + validator + throttler) unchanged"
estimated_tasks: 3
branch: "feat/prd058-c3-tracing-middleware"
status: pending
```

---

## Wave 2 — SQLite store + cross-domain integration

### C-4: SQLite trace store + end-to-end integration test

```yaml
id: C-4
phase: PRD-058 Wave 2
title: "Implement SqliteTraceStore + cross-domain integration test"
domain: "pacta/cognitive/observability"
wave: 2
scope:
  allowed_paths:
    - "packages/pacta/src/cognitive/observability/sqlite-store.ts"
    - "packages/pacta/src/cognitive/observability/sqlite-store.test.ts"
    - "packages/pacta/src/cognitive/observability/__tests__/integration.test.ts"
    - "packages/pacta/src/cognitive/observability/README.md"
  forbidden_paths:
    - "packages/pacta/src/cognitive/observability/assembler.ts"   # C-1's
    - "packages/pacta/src/cognitive/observability/ring-buffer.ts" # C-1's
    - "packages/pacta/src/cognitive/algebra/**"
    - "packages/pacta/src/cognitive/engine/**"
    - "packages/pacta/src/middleware/**"
    - "packages/pacta/src/ports/**"
    - "packages/pacta/package.json"
depends_on: [C-1, C-2, C-3]
parallel_with: []
consumed_ports:
  - name: TraceEvent
    status: frozen
  - name: CycleTrace
    status: frozen
  - name: TraceStore
    status: frozen
    record: "docs/prds/058-hierarchical-trace-observability.md#surface-3"
  - name: TraceAssembler (from C-1)
    status: shipped-wave-1
produced_ports:
  - name: SqliteTraceStore (impl of TraceSink + TraceStore)
deliverables:
  - "sqlite-store.ts: better-sqlite3-backed TraceStore with retention cleanup"
  - "Schema: cycle_traces table with denormalized columns + JSON blob"
  - "Stats aggregation (TraceStats from list of CycleTraces)"
  - "Integration test: cycle.ts (C-2) + tracingMiddleware (C-3) + assembler (C-1) → SqliteTraceStore round-trip on disk"
documentation_deliverables:
  - "observability/README.md — final shape with sqlite-store details, retention policy"
acceptance_criteria:
  - "AC-3: storeCycle + getCycle round-trip preserves all CycleTrace fields (deep equality)"
  - "AC-3 retention: cycles older than retention_days deleted on initialize()"
  - "AC-3 query: getCycles({ since, before, limit }) returns expected slice"
  - "AC-3 stats: getStats({ windowCycles: 10 }) returns correct aggregate over a 12-cycle dataset"
  - "Integration: a real 3-phase cycle with tracingMiddleware emits events that the assembler turns into a CycleTrace identical to a programmatically constructed reference"
estimated_tasks: 6
branch: "feat/prd058-c4-sqlite-store"
status: pending
```

---

## Wave 3 — Bridge/runtime wiring

### C-5: Per-session trace stream wiring

```yaml
id: C-5
phase: PRD-058 Wave 3
title: "Wire per-session TraceRingBuffer into runtime/sessions; route TraceRuntimeEvent through bridge bus"
domain: "runtime/sessions" (primary) + "bridge/domains/sessions" (composition)
wave: 3
scope:
  allowed_paths:
    - "packages/runtime/src/sessions/**"
    - "packages/bridge/src/domains/sessions/factory.ts"
    - "packages/bridge/src/domains/sessions/__tests__/**"
  forbidden_paths:
    - "packages/runtime/src/event-bus/**"            # orchestrator (Wave 0 already touched ports/event-bus.ts)
    - "packages/runtime/src/ports/**"
    - "packages/bridge/src/shared/**"                # orchestrator territory
    - "packages/bridge/src/server-entry.ts"          # composition root, orchestrator
    - "packages/pacta/**"                            # frozen
depends_on: [C-1, C-2, C-4]
parallel_with: []
consumed_ports:
  - name: TraceRingBuffer (impl from C-1)
    status: shipped-wave-1
  - name: TraceStore (port)
    status: frozen
  - name: SqliteTraceStore (impl from C-4)
    status: shipped-wave-2
  - name: RuntimeEvent (existing)
    status: frozen
produced_ports: []
deliverables:
  - "runtime/sessions: per-session TraceRingBuffer (1024 events default), exposed as a TraceStream"
  - "bridge/domains/sessions/factory.ts: wire ring buffer to per-session WebSocket pane"
  - "Smoke test: spin up a session via npm run bridge:test, observe TraceEvent stream on /ws/traces"
documentation_deliverables:
  - "runtime/sessions/README.md — note the new TraceStream accessor and frontend contract"
acceptance_criteria:
  - "Per-session ring buffer constructed with 1024 capacity by default"
  - "Frontend WebSocket consumer can subscribe and receive TraceEvents in real time"
  - "Smoke test: bridge boot + a 3-cycle agent run produces ≥12 events on the WebSocket (3 phases × 4 events) without backpressure errors"
  - "AC-6 regression: bridge sessions tests pass unchanged when no TraceSink is configured (default-off)"
estimated_tasks: 5
branch: "feat/prd058-c5-bridge-trace-wiring"
status: pending
```

**Note:** The bridge composition root (`server-entry.ts`) and `bridge/shared/event-bus/` adapters that recognize the `TraceRuntimeEvent` discriminator stay orchestrator-owned. After C-5 ships, the orchestrator commits a small wiring change in those files (≤ 30 lines) to feed the runtime ring buffer into `WebSocketSink`. This is a between-wave surface update per fcd-plan §4.3 — the discriminator type was already frozen in Wave 0; only concrete plumbing fills in.

---

## Wave summary table

| Wave | Commissions | Domains | Parallel? | Surface prep |
|---|---|---|---|---|
| 0 | (orchestrator) | algebra, observability skeleton, runtime ports | n/a | All trace types, port extensions, gate assertions |
| 1 | C-1, C-2, C-3 | observability, engine, middleware | YES — 3-way | none (all surfaces from Wave 0) |
| 2 | C-4 | observability | n/a | none |
| 3 | C-5 | runtime/sessions + bridge sessions | n/a | Between-wave: bridge composition root wiring (orchestrator) |

## Acceptance Gates (PRD AC → commission map)

| PRD AC | Where verified |
|---|---|
| AC-1 — Cycle emits hierarchical events deterministically | C-2 unit, C-4 integration |
| AC-2 — Assembler reconstructs CycleTrace round-trip | C-1 unit, C-4 integration |
| AC-3 — SQLite store persists, queries, retention | C-4 unit |
| AC-4 — Ring buffer fan-out + slow eviction | C-1 unit |
| AC-5 — `tracingMiddleware()` emits OPERATION with token usage | C-3 unit, C-4 integration |
| AC-6 — Existing flat-trace tests still pass | Every wave (regression suite) |

## Verification report (Phase 6 gates)

| # | Gate | Status |
|---|---|---|
| 1 | Single-domain commissions | **PASS** — every commission touches exactly one domain (C-5 spans `runtime/sessions` + `bridge/domains/sessions`, but those are tightly coupled producer/consumer in the same logical domain — note in risks below) |
| 2 | No wave domain conflicts | **PASS** — C-1 and C-4 are same domain but different waves |
| 3 | DAG acyclic | **PASS** — Wave 0 → {C-1, C-2, C-3} → C-4 → C-5 |
| 4 | Surface enumeration complete | **PASS** — every cross-commission dep references a frozen surface or a Wave-1 deliverable explicitly |
| 5 | Scope completeness | **PASS** — every commission has non-empty allowed + forbidden paths |
| 6 | Criteria traceability | **PASS** — every commission AC traces to AC-1..AC-6 |
| 7 | PRD coverage | **PASS** — all 6 success criteria mapped |
| 8 | Task bounds (3-8) | **PASS** — sizes 3, 4, 5, 5, 6 |
| 9 | Wave 0 non-empty | **PASS** — Wave 0 contains 4 new files, 3 modifications, 4 gate assertions |
| 10 | All consumed ports frozen | **PASS** — every consumed port either references a PRD surface or a Wave-1 deliverable |

**Overall: 10/10 gates pass.**

## Risk assessment

- **R-plan-1 — C-5 spans two packages.** `runtime/sessions` (the per-session ring-buffer accessor) and `bridge/domains/sessions/factory.ts` (consumes it) are in different packages but expressing the same logical domain ("sessions"). Treating them as one commission keeps the wiring atomic. **Mitigation:** explicit allowed_paths name both; reviewer checks that no shared/orchestrator file is touched.
- **R-plan-2 — Wave 1 three-way parallel may step on each other through shared `index.ts` re-exports.** `pacta/middleware/index.ts` is in C-3's allowed_paths (single new symbol export). If Wave 0 already exports the new middleware factory as a placeholder, C-3 stays clean. **Mitigation:** Wave 0 includes a forward-declared export (`tracingMiddleware` typed but unimplemented) so C-3's index.ts edit is a one-line swap of import target. If risky, pull index.ts back to orchestrator territory.
- **R-plan-3 — Cycle event emission is a behaviour change to a 846-line file.** C-2 modifies `cycle.ts`, the cognitive engine's most-tested file. **Mitigation:** the change is gated on `eventSink` presence — when undefined, behaviour identical to today. Existing cycle tests are regression-asserted in C-2.
- **R-plan-4 — `better-sqlite3` native build on CI.** Already a transitive dep of the bridge; no new risk. **Mitigation:** none.
- **R-plan-5 — No new CI/test gate against existing code.** No diff-scoped vs full-scope decision needed (per fcd-plan §6.3); the new gate assertions are fresh and only assert on new files.
- **R-plan-6 — Wave 0 is bigger than typical.** ≈1 day of orchestrator work (4 new files + 3 modifications + gates). Mitigation: split Wave 0 into two commits if the reviewer wants smaller chunks — types first, then port extensions + gates.

## Status tracker

```
Total: 5 commissions, 4 waves (including Wave 0)
Wave 0:  COMPLETE 2026-04-25  (orchestrator)
Wave 1:  C-1 pending, C-2 pending, C-3 pending  (parallel — unblocked)
Wave 2:  C-4 pending  (depends C-1, C-2, C-3)
Wave 3:  C-5 pending  (depends C-1, C-2, C-4)

Completed: 0 / 5 commissions, 1 / 4 waves (Wave 0 = orchestrator-only, no commissions)
```

### Wave 0 completion record (2026-04-25)

**What landed:**
- 4 new type files: `trace-events.ts`, `trace-cycle.ts`, `trace-stream.ts`, `trace-store.ts`
- `TraceSink.onEvent` extension (additive)
- `InMemoryTraceSink` / `ConsoleTraceSink` extended with `onEvent`
- Observability skeleton: README + index + 3 stub files (assembler, ring-buffer, sqlite-store) all throwing with explicit "PRD-058 Wave N, commission C-X" pointers
- Gate test file: `__tests__/trace-architecture.test.ts` with 4 passing assertions
- Algebra index + cognitive index re-exports

**What was deferred:**
- `runtime/ports/event-bus.ts` — no change required for Wave 0 (the `EventDomain` escape hatch admits `'trace'` without modification). Concrete `TraceRuntimeEvent` discriminator deferred to C-5 in Wave 3.

**Build/test outcomes:**
- `npm run build` (workspace) — green
- `npm test --workspace=@methodts/pacta` — 988 pass, 0 fail
- 4 G-TRACE-* gate assertions all pass
- AC-6 regression gate held: existing flat-trace tests untouched

**Risks observed during Wave 0:**
- R-plan-2 (index.ts coordination) — partially mitigated. `pacta/middleware/index.ts` was NOT touched in Wave 0, so C-3's edit to add `tracingMiddleware` export remains a fresh add (low risk of merge conflict).
- R-plan-6 (Wave 0 size) — completed in one commit; ≈30 minutes of orchestrator work, smaller than estimated 1 day.

**Wave 1 ready signal:** all consumed surfaces frozen; commissions C-1, C-2, C-3 can be dispatched in parallel.

## Execute with

```
# Wave 0 — orchestrator commits the surface prep
# (manual review or a focused agent — not commissioned out)

# Then orchestrate the remaining waves:
/fcd-commission --orchestrate .method/sessions/fcd-plan-20260425-prd-058-trace/realize-plan.md
```
