# Realization Plan — Projection-Based State Persistence

**PRD:** `.method/sessions/fcd-design-persistence-projections/prd.md`
**Session:** `fcd-plan-20260405-1400-persistence-projections`

## PRD Summary

**Objective:** Unify state persistence across bridge domains via projections over the event log. Eliminate state loss on restart (builds, conversations, methodology sessions) by replacing per-domain ad hoc persistence with a single pattern: `Projection<S>` reducers over `BridgeEvent.sequence`.

**Success Criteria (from PRD):**
- **PRD-AC-1:** Bridge restart recovers in-memory domain state. Restart test: start build → kill bridge → restart → `GET /api/builds` returns the build.
- **PRD-AC-2:** New domains add persistence in one file + one register call. No bespoke persistence code per domain.
- **PRD-AC-3:** Event log stays bounded — rolling 3-day window via rotation.

## FCA Partition

| Domain | Layer | Status | Role |
|---|---|---|---|
| `shared/persistence/` | L2 | NEW | Projection library + snapshot I/O |
| `shared/event-bus/` | L2 | EXISTING | EventReader extension + rotation |
| `domains/build/` | L3 | EXISTING | First projection consumer |
| `server-entry.ts` | L4 | COMPOSITION ROOT | Orchestrator-owned wiring |

**Shared surfaces** (orchestrator-owned, never touched by commissions):
`ports/*`, `shared/persistence/types.ts`, `shared/persistence/index.ts`, `package.json`, `tsconfig.json`, `architecture.test.ts`.

## Commission Summary

| ID | Domain | Wave | Title | Depends On | Parallel With | Est. Tasks |
|---|---|---|---|---|---|---|
| C-1 | shared/persistence | 1 | ProjectionStore library | — | C-2 | 7 |
| C-2 | shared/event-bus | 1 | EventReader extension on PersistenceSink | — | C-1 | 4 |
| C-3 | domains/build | 2 | BuildsProjection + routes migration | C-1, C-2 | — | 6 |
| C-4 | shared/event-bus | 3 | EventRotator with 3-day window | C-1, C-2 | — | 6 |

Total: **4 commissions, 3 implementation waves + Wave 0**.

## Wave 0 — Shared Surfaces (MANDATORY, orchestrator applies)

All 4 surfaces frozen per PRD Phase 3. No commission touches these files.

### Port Interfaces

| File | Surface | Producer | Consumer |
|---|---|---|---|
| `packages/bridge/src/ports/projection.ts` | S1: `Projection<S>` | any domain | ProjectionStore |
| `packages/bridge/src/ports/projection-store.ts` | S2: `ProjectionStore`, `StartResult` | shared/persistence | composition root, domains |
| `packages/bridge/src/ports/event-reader.ts` | S3: `EventReader` | shared/event-bus | shared/persistence |
| `packages/bridge/src/ports/event-rotator.ts` | S-rotator: `EventRotator`, `RotateOptions`, `RotateResult` | shared/event-bus | composition root (scheduler) |

### Shared Types

| File | Content |
|---|---|
| `packages/bridge/src/shared/persistence/types.ts` | S4: `ProjectionSnapshot` canonical entity |
| `packages/bridge/src/shared/persistence/index.ts` | Barrel export (types only at this stage) |

### Gate Assertions (added to `architecture.test.ts`)

- **G-BOUNDARY:** `shared/persistence/` exports only via `index.ts`; no imports from `domains/`.
- **G-PORT:** ProjectionStore consumers import from `ports/projection-store.ts`, not implementation.
- **G-LAYER:** `shared/persistence/` (L2) has no imports from `domains/` (L3) or bridge app (L4).
- **G-ENTITY:** `ProjectionSnapshot` imported only from `shared/persistence/types.ts`.

### Wave 0 Verification

- `npm run build` passes (TypeScript compiles with new port files)
- `npx tsc --noEmit` passes
- Existing tests pass (`npm test`)
- New gate assertions present in architecture.test.ts (may initially skip if no implementations exist yet — become active in Wave 1)

---

## Wave 1 — Library + EventReader (parallel)

### C-1: ProjectionStore library

Implements the projection runtime: snapshot load, event replay, live subscription, debounced snapshot writing.

### C-2: EventReader extension on PersistenceSink

Extends existing `PersistenceSink` with cursor-based event reading for projection replay.

---

## Wave 2 — First consumer

### C-3: BuildsProjection + routes migration

Defines `BuildsProjection implements Projection<BuildsState>`, migrates `routes.ts` to read from `ProjectionStore`. Orchestrator wires composition root (`server-entry.ts`).

**Inter-wave orchestrator work** (applied before C-3):
- Instantiate `ProjectionStore` in `server-entry.ts` after `EventBus` + `PersistenceSink` are wired
- Inject `EventReader` from PersistenceSink into ProjectionStore

**Inter-wave orchestrator work** (applied after C-3):
- Call `projectionStore.register(new BuildsProjection())` in server-entry.ts
- Call `await projectionStore.start()` before route registration
- Log StartResult

---

## Wave 3 — Event rotation

### C-4: EventRotator implementation

Implements `EventRotator` with 3-day window, safety guard integration, gzipped archive writes.

**Inter-wave orchestrator work** (after C-4):
- Schedule daily rotation task in `server-entry.ts` (`setInterval` or trigger)
- Wire `projectionStore.maxSafeCutoff` as safety guard
- Default: `olderThanDays: 3`, configurable via env `EVENT_ROTATION_DAYS`

---

## Commission Cards

```yaml
- id: C-1
  phase: "PRD Wave 1 (ProjectionStore library)"
  title: "Implement ProjectionStore library with snapshot I/O"
  domain: "shared/persistence"
  wave: 1
  scope:
    allowed_paths:
      - "packages/bridge/src/shared/persistence/projection-store.ts"
      - "packages/bridge/src/shared/persistence/projection-store.test.ts"
      - "packages/bridge/src/shared/persistence/snapshot-writer.ts"
      - "packages/bridge/src/shared/persistence/snapshot-writer.test.ts"
      - "packages/bridge/src/shared/persistence/snapshot-loader.ts"
      - "packages/bridge/src/shared/persistence/snapshot-loader.test.ts"
      - "packages/bridge/src/shared/persistence/integration.test.ts"
    forbidden_paths:
      - "packages/bridge/src/ports/**"
      - "packages/bridge/src/shared/persistence/index.ts"
      - "packages/bridge/src/shared/persistence/types.ts"
      - "packages/bridge/src/domains/**"
      - "packages/bridge/src/server-entry.ts"
      - "packages/bridge/src/architecture.test.ts"
      - "packages/*/package.json"
      - "packages/*/tsconfig.json"
  depends_on: []
  parallel_with: [C-2]
  consumed_ports:
    - name: "Projection"
      status: frozen
      record: ".method/sessions/fcd-design-persistence-projections/prd.md#s1"
    - name: "EventReader"
      status: frozen
      record: ".method/sessions/fcd-design-persistence-projections/prd.md#s3"
    - name: "EventSink"
      status: existing
      record: "packages/bridge/src/ports/event-bus.ts"
    - name: "FileSystemProvider"
      status: existing
      record: "packages/bridge/src/ports/filesystem.ts"
  produced_ports:
    - name: "ProjectionStore"
  deliverables:
    - "packages/bridge/src/shared/persistence/projection-store.ts"
    - "packages/bridge/src/shared/persistence/snapshot-writer.ts"
    - "packages/bridge/src/shared/persistence/snapshot-loader.ts"
    - "Unit + integration tests green"
  documentation_deliverables:
    - "Add README or docstring explaining ProjectionStore lifecycle (load → replay → subscribe)"
  acceptance_criteria:
    - "ProjectionStore.start() loads snapshot, replays events from snapshot.cursor, subscribes to live events — verified by integration test → PRD-AC-2"
    - "Snapshot writes are atomic (write-tmp + fsync + rename) — verified by unit test simulating crash → PRD-AC-1 safety"
    - "Reducer failures during replay logged and counted in StartResult.skippedEvents, do not halt startup → PRD-AC-1 resilience"
    - "Live event path triggers snapshot every snapshotEveryN events (default 100) — verified by unit test → PRD-AC-3 efficiency"
    - "maxSafeCutoff() returns min cursor across all registered projections — verified by unit test → PRD-AC-3 safety"
  estimated_tasks: 7
  branch: "feat/persistence-projections-c1-projection-store"
  status: pending

- id: C-2
  phase: "PRD Wave 2 (EventReader extension)"
  title: "Add cursor-based event reading to PersistenceSink"
  domain: "shared/event-bus"
  wave: 1
  scope:
    allowed_paths:
      - "packages/bridge/src/shared/event-bus/persistence-sink.ts"
      - "packages/bridge/src/shared/event-bus/persistence-sink.test.ts"
      - "packages/bridge/src/shared/event-bus/index.ts"
    forbidden_paths:
      - "packages/bridge/src/ports/**"
      - "packages/bridge/src/shared/persistence/**"
      - "packages/bridge/src/domains/**"
      - "packages/bridge/src/server-entry.ts"
      - "packages/bridge/src/architecture.test.ts"
      - "packages/*/package.json"
      - "packages/*/tsconfig.json"
  depends_on: []
  parallel_with: [C-1]
  consumed_ports:
    - name: "EventReader"
      status: frozen
      record: ".method/sessions/fcd-design-persistence-projections/prd.md#s3"
  produced_ports:
    - name: "EventReader"
      implemented_on: "PersistenceSink"
  deliverables:
    - "readEventsSince(seq) method on PersistenceSink"
    - "PersistenceSink exported as EventReader via shared/event-bus/index.ts"
    - "Unit tests for cursor filtering + corruption tolerance"
  documentation_deliverables:
    - "Update persistence-sink.ts docstring to describe EventReader capability"
  acceptance_criteria:
    - "PersistenceSink.readEventsSince(seq) returns events with sequence > seq in append order → PRD-AC-1 (enables projection replay)"
    - "Malformed JSONL lines skipped gracefully (do not throw) → PRD-AC-1 resilience"
    - "Existing replay() behavior unchanged (regression) → backward compat"
    - "Reader reuses existing file parsing logic (no duplication) → code quality"
  estimated_tasks: 4
  branch: "feat/persistence-projections-c2-event-reader"
  status: pending

- id: C-3
  phase: "PRD Wave 3 (BuildsProjection + consumer migration)"
  title: "BuildsProjection + migrate routes.ts to ProjectionStore"
  domain: "domains/build"
  wave: 2
  scope:
    allowed_paths:
      - "packages/bridge/src/domains/build/builds-projection.ts"
      - "packages/bridge/src/domains/build/builds-projection.test.ts"
      - "packages/bridge/src/domains/build/routes.ts"
      - "packages/bridge/src/domains/build/__tests__/routes.test.ts"
    forbidden_paths:
      - "packages/bridge/src/ports/**"
      - "packages/bridge/src/shared/**"
      - "packages/bridge/src/server-entry.ts"
      - "packages/bridge/src/architecture.test.ts"
      - "packages/bridge/src/domains/build/orchestrator.ts"
      - "packages/bridge/src/domains/build/checkpoint-adapter.ts"
      - "packages/bridge/src/domains/build/conversation-adapter.ts"
      - "packages/bridge/src/domains/build/strategy-executor-adapter.ts"
      - "packages/*/package.json"
      - "packages/*/tsconfig.json"
  depends_on: [C-1, C-2]
  parallel_with: []
  consumed_ports:
    - name: "Projection"
      status: frozen
      record: ".method/sessions/fcd-design-persistence-projections/prd.md#s1"
    - name: "ProjectionStore"
      status: frozen
      record: ".method/sessions/fcd-design-persistence-projections/prd.md#s2"
  produced_ports: []
  deliverables:
    - "BuildsProjection class implementing Projection<BuildsState>"
    - "Reducer handles 8 event types (build.started, build.phase_started, build.phase_completed, build.gate_waiting, build.gate_resolved, build.cost_updated, build.aborted, build.completed)"
    - "routes.ts reads build list from ProjectionStore.get('build')"
  documentation_deliverables:
    - "Add docstring to builds-projection.ts explaining read-model vs write-model relationship with BuildOrchestrator"
  acceptance_criteria:
    - "BuildsProjection.reduce handles all 8 event types, each verified by unit test → PRD-AC-1"
    - "Restart integration test: start build → emit events → kill bridge → restart → routes.ts /api/builds returns build with correct status → PRD-AC-1"
    - "Existing routes.ts tests pass after migration (behavior preserved) → regression"
    - "No direct imports of ProjectionStore implementation — only via ports/projection-store.ts → G-PORT"
    - "BuildOrchestrator state unchanged (write model) — projection is read-model only → architecture integrity"
  estimated_tasks: 6
  branch: "feat/persistence-projections-c3-builds-projection"
  status: pending

- id: C-4
  phase: "PRD Wave 4 (Event rotation)"
  title: "EventRotator with 3-day window and safety guard"
  domain: "shared/event-bus"
  wave: 3
  scope:
    allowed_paths:
      - "packages/bridge/src/shared/event-bus/event-rotator.ts"
      - "packages/bridge/src/shared/event-bus/event-rotator.test.ts"
      - "packages/bridge/src/shared/event-bus/index.ts"
    forbidden_paths:
      - "packages/bridge/src/ports/**"
      - "packages/bridge/src/shared/persistence/**"
      - "packages/bridge/src/shared/event-bus/persistence-sink.ts"
      - "packages/bridge/src/domains/**"
      - "packages/bridge/src/server-entry.ts"
      - "packages/bridge/src/architecture.test.ts"
      - "packages/*/package.json"
      - "packages/*/tsconfig.json"
  depends_on: [C-1, C-2]
  parallel_with: []
  consumed_ports:
    - name: "EventRotator"
      status: frozen
      record: ".method/sessions/fcd-design-persistence-projections/prd.md#s-rotator"
    - name: "FileSystemProvider"
      status: existing
      record: "packages/bridge/src/ports/filesystem.ts"
  produced_ports:
    - name: "EventRotator"
  deliverables:
    - "EventRotator class implementing the port"
    - "Archive writer: gzipped JSONL to .method/events.archive/YYYY-MM-DD.jsonl.gz"
    - "Main log compaction: remove archived entries, preserve recent"
    - "Unit tests for rotate flow, safety guard blocking, archive integrity"
  documentation_deliverables:
    - "Add docstring explaining rotation safety guard contract with ProjectionStore"
  acceptance_criteria:
    - "rotate() archives events older than olderThanDays to gzipped file → PRD-AC-3"
    - "Safety guard: rotation skipped (returns skipped:true) if safetyGuard returns cursor < oldest event-to-archive → PRD-AC-3 safety"
    - "Archive file is valid gzipped JSONL (verified by re-parsing) → data integrity"
    - "Main log shrinks after rotation (verified by file size) → PRD-AC-3"
    - "Archive writes complete before main log compaction (no data loss on crash) → PRD-AC-3 safety"
  estimated_tasks: 6
  branch: "feat/persistence-projections-c4-event-rotator"
  status: pending
```

## Dependency DAG

```
Wave 0 (surfaces, orchestrator)
    │
    ├──► C-1 (shared/persistence) ──┐
    │                                ├──► C-3 (build) ──► Wave 2 done
    └──► C-2 (shared/event-bus) ────┤
                                     │
                                     └──► C-4 (shared/event-bus) ──► Wave 3 done
```

## Acceptance Gates (traceability)

| PRD AC | Commission ACs |
|---|---|
| PRD-AC-1 (restart recovery) | C-1 start-flow AC, C-1 atomicity AC, C-1 reducer-resilience AC, C-2 cursor-read AC, C-2 corruption-tolerance AC, C-3 all reducer ACs, C-3 restart integration test |
| PRD-AC-2 (one-file-per-domain pattern) | C-1 start-flow AC (establishes the pattern) |
| PRD-AC-3 (bounded log) | C-1 snapshot-interval AC, C-1 maxSafeCutoff AC, C-4 all ACs |

**Coverage:** All 3 PRD success criteria mapped to at least one commission AC. No orphan criteria.

## Verification Report

| Gate | Status | Notes |
|---|---|---|
| Single-domain commissions | **PASS** | Each commission touches exactly one FCA domain |
| No wave domain conflicts | **PASS** | Wave 1: persistence+event-bus (different); Wave 2: build only; Wave 3: event-bus only |
| DAG acyclic | **PASS** | Linear dependency chain, no cycles |
| Surfaces enumerated | **PASS** | 4 ports + 1 entity type, all frozen in PRD |
| Scope complete | **PASS** | Every commission has allowed + forbidden paths |
| Criteria traceable | **PASS** | Every commission AC traces to PRD-AC-{1,2,3} |
| PRD coverage | **PASS** | All 3 PRD success criteria mapped to commissions |
| Task bounds (3-8) | **PASS** | C-1:7, C-2:4, C-3:6, C-4:6 |
| Wave 0 non-empty | **PASS** | 4 port files + 2 types files + gate assertions |
| All consumed ports frozen | **PASS** | Every consumed_ports entry has status: frozen or existing |

**Overall: 10/10 gates PASS**

## Risk Assessment

- **Critical path:** Wave 0 → C-1 → C-3. Longest dependency chain.
- **Largest wave:** Wave 1 (2 parallel commissions). Low contention (different domains).
- **Surface change count:** 4 new port files + 1 entity type = 5 surface artifacts in Wave 0.
- **New port count:** 4 (Projection, ProjectionStore, EventReader, EventRotator).
- **Read-model/write-model risk:** BuildsProjection reconstructs build list from events, but `BuildOrchestrator` holds live execution state. Mitigation: integration test comparing projection state to `orchestrator.getLiveState()` post-event.
- **Rotation safety risk:** getting `maxSafeCutoff` wrong loses data. Mitigation: `rotate()` writes archive BEFORE compacting main log; if archive write fails, abort without touching main log. Archive + main log are both valid at any crash point.

## Status Tracker

Total: **4 commissions, 4 waves** (including Wave 0)
Completed: **0 / 4**

| Wave | Commissions | Status |
|---|---|---|
| 0 | (orchestrator surface prep) | pending |
| 1 | C-1, C-2 | pending |
| 2 | C-3 | pending |
| 3 | C-4 | pending |

## Execute With

```
/fcd-commission --orchestrate .method/sessions/fcd-plan-20260405-1400-persistence-projections/realize-plan.md
```
