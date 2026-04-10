---
type: prd
title: "Projection-Based State Persistence"
date: "2026-04-05"
status: draft
domains: [shared/persistence (new), shared/event-bus, build, server-entry]
surfaces: [Projection, ProjectionStore, EventReader, ProjectionSnapshot]
---

# Projection-Based State Persistence

## Problem

Bridge restart loses in-memory state that users depend on. Specifically: the builds list, conversation history, methodology sessions, token usage cache, and other per-domain state held in `Map` instances vanish on every restart. Users have lost work mid-build multiple times.

Root cause is not file persistence failing — sessions and events persist reliably. The issue is that **each domain picked its own persistence approach (or none)**, creating a hodgepodge with no consistent pattern. Several critical domains (`build`, `conversation`, `methodology`, `tokens`) don't persist at all.

The Universal Event Bus (PRD 026) already captures every domain event in `.method/events.jsonl` with monotonic `sequence` numbers and exposes `PersistenceSink.replay()` — but no domain actually reads this log to reconstruct its state on startup. Events are the de facto source of truth, yet nothing reads them back.

## Constraints

- **Preserve working persistence** — sessions (`session-persistence.ts`), build checkpoints (`checkpoint-adapter.ts`), and experiment logs work today and are out of scope for migration.
- **Event bus is fixed infrastructure** — `BridgeEvent.sequence` and `PersistenceSink.replay()` already exist and must be reused, not redesigned.
- **Single-process per machine** — cluster mode means multi-machine federation, not shared state. Each bridge owns its own local persistence files. No cross-process locking needed.
- **FCA layer stack** — new code lives at L2 (`shared/persistence/`), alongside `shared/event-bus/`. No upward dependencies.
- **Snapshot atomicity** — crash-mid-write must not corrupt recovery state (write-tmp + rename pattern).

## Success Criteria

1. **Bridge restart recovers in-memory domain state** for any domain that registers a projection. Verified by restart test: start a build, kill bridge, restart, `GET /api/builds` still returns the build.
2. **New domains add persistence in one file** — a `Projection<S>` implementation + single `register()` call at the composition root. No new storage formats, no bespoke persistence code per domain.
3. **Event log stays bounded** — rolling 3-day window via rotation, archived beyond that. Main `events.jsonl` cannot grow unbounded.

## Scope

**In scope:**
- `Projection<S>` contract and `ProjectionStore` library in `shared/persistence/`
- First consumer: `build` domain (replaces in-memory `Map` in routes.ts)
- Snapshot writing (per-domain JSON files in `.method/projections/`)
- Event log rotation (archive events older than 3 days)
- Startup replay flow (snapshot load → event replay → live subscription)

**Out of scope:**
- Migrating existing working persistence (sessions, checkpoints, experiments)
- SQLite or other database backing stores
- Cross-machine state sync (belongs to cluster federation, different concern)
- Projections for `conversation`, `methodology`, `tokens`, `triggers` — the library ships with `build` as proof, others migrate in follow-ups using the same pattern

## Domain Map

```
server-entry (composition root)
       │
       │ register(projection)
       ▼
shared/persistence/ (NEW) ──────── get<S>(domain) ────→ build/routes.ts
       │                                                      │
       │ subscribe(sink)                                       │ read state
       ▼                                                       ▼
shared/event-bus/ (PersistenceSink) ─── replay() ──→ ProjectionStore
       │                                            (in-memory Maps, per-domain)
       │ rotate(cutoff)
       ▼
   events.archive/ (NEW)
```

**Affected domains:**

| Domain | Change | New surface? |
|---|---|---|
| `shared/persistence/` | **NEW** — ProjectionStore library | Produces S1, S2 |
| `shared/event-bus/` | Extended — expose replay with cursor filter; add rotation | Produces S3, S4 |
| `build` | First consumer — define BuildsProjection, remove in-memory Map | Consumes S1, S2 |
| `server-entry.ts` | Composition-root wiring | Consumes S2 |

## Surfaces (Primary Deliverable)

### S1: `Projection<S>` — the domain-implemented contract

**Owner:** `shared/persistence/` | **Producer → Consumer:** any domain → ProjectionStore | **Direction:** unidirectional (store calls into projection)

```typescript
/**
 * A projection subscribes to events and maintains in-memory state that can be
 * reconstructed from the event log. Implementations are pure reducers.
 */
export interface Projection<S> {
  /** Domain name — used as snapshot filename (e.g. 'build' → .method/projections/build.json). */
  readonly domain: string;

  /** Returns the empty initial state. Called when no snapshot exists. */
  initialState(): S;

  /**
   * Pure reducer: apply an event to current state, return new state.
   * Must be deterministic. Events that don't apply should return state unchanged.
   */
  reduce(state: S, event: BridgeEvent): S;

  /** Serialize state to JSON string for snapshot. Omit to disable snapshots (replay-only). */
  serialize?(state: S): string;

  /** Deserialize snapshot back to state. Required if `serialize` is defined. */
  deserialize?(raw: string): S;

  /** Snapshot every N events after the last snapshot. Default 100. */
  readonly snapshotEveryN?: number;
}
```

**Minimality note:** No `onStartup()` or `onShutdown()` hooks — projections are pure reducers. State lifetime is managed by ProjectionStore.

**Gate:** G-BOUNDARY — type lives in `shared/persistence/projection.ts`. Consumers import from there only.
**Status:** frozen.

### S2: `ProjectionStore` — composition-root + domain-consumer port

**Owner:** `shared/persistence/` | **Producer → Consumer:** persistence library → composition root (register) + domains (read)

```typescript
export interface ProjectionStore {
  /**
   * Register a projection. Must be called before start().
   * Throws if domain is already registered.
   */
  register<S>(projection: Projection<S>): void;

  /**
   * Load snapshots → replay events from snapshot cursor → subscribe to live events.
   * Called once at composition root after EventBus is ready.
   * Returns summary stats for logging.
   */
  start(): Promise<StartResult>;

  /**
   * Read current in-memory state for a domain.
   * Returns null if not registered or not yet started.
   */
  get<S>(domain: string): S | null;

  /**
   * Lowest cursor across all projection snapshots. Used by EventRotator
   * as a safety guard — events at or below this sequence are safe to archive.
   */
  maxSafeCutoff(): number | null;
}

export interface StartResult {
  readonly projectionsLoaded: number;
  readonly snapshotsRestored: number;
  readonly eventsReplayed: number;
  readonly skippedEvents: number;   // events that failed reducer (logged, not thrown)
  readonly durationMs: number;
}
```

**Minimality note:** Considered exposing `subscribe()` on the store for consumers wanting live state updates. Removed — consumers either poll `get()` or subscribe to the EventBus directly. Adding it now is speculative.

**Gate:** G-PORT — ProjectionStore is consumed via `ports/projection-store.ts`, never by direct import of the implementation.
**Status:** frozen.

### S3: `EventReader` — event-bus replay capability (extension of existing)

**Owner:** `shared/event-bus/` | **Producer → Consumer:** PersistenceSink → ProjectionStore

```typescript
/**
 * Read historical events from the persistent log for projection replay.
 * The existing PersistenceSink.replay() returns a window; we need cursor-based filtering.
 */
export interface EventReader {
  /**
   * Read events from the log where sequence > sinceSeq.
   * Returns events in append order. Filters corrupt lines gracefully.
   */
  readEventsSince(sinceSeq: number): Promise<BridgeEvent[]>;
}
```

**Minimality note:** Considered `AsyncIterable<BridgeEvent>` for streaming large logs. Deferred — 3-day window bounds log size to manageable levels (~few MB). Upgrade path clear if needed.

**Implementation note:** Wraps existing `PersistenceSink.replay()` logic but filters by seq instead of time window. Lives in PersistenceSink itself, exposed as separate method.

**Gate:** G-BOUNDARY — shared/persistence imports `EventReader` from `ports/event-reader.ts`.
**Status:** frozen.

### S4: `ProjectionSnapshot` — snapshot file format (shared entity)

**Owner:** `shared/persistence/` | canonical definition

```typescript
/**
 * On-disk snapshot format. Written to .method/projections/{domain}.json.
 */
export interface ProjectionSnapshot {
  readonly version: 1;
  readonly domain: string;
  readonly cursor: number;         // highest event.sequence included in state
  readonly eventCount: number;     // total events reduced (for debugging)
  readonly writtenAt: string;      // ISO 8601
  readonly state: string;          // projection.serialize(state) output
}
```

**Gate:** G-ENTITY — canonical type, all persistence code references `shared/persistence/types.ts`.
**Status:** frozen.

### Surface Summary

| Surface | Owner | Producer → Consumer | Status | Gate |
|---|---|---|---|---|
| `Projection<S>` | shared/persistence | library → domains | frozen | G-BOUNDARY |
| `ProjectionStore` | shared/persistence | library → composition root + domains | frozen | G-PORT |
| `EventReader` | shared/event-bus | PersistenceSink → ProjectionStore | frozen | G-BOUNDARY |
| `ProjectionSnapshot` | shared/persistence | canonical entity | frozen | G-ENTITY |

## Per-Domain Architecture

### shared/persistence/ (NEW)

**Layer:** L2 (infrastructure, alongside shared/event-bus)

**Directory:**
```
shared/persistence/
  index.ts                     # public exports
  projection.ts                # S1: Projection<S> interface
  projection-store.ts          # S2: ProjectionStore implementation
  snapshot-writer.ts           # debounced atomic writes to .method/projections/{domain}.json
  snapshot-loader.ts           # reads + validates snapshots on startup
  types.ts                     # S4: ProjectionSnapshot, StartResult
  projection-store.test.ts
  snapshot-writer.test.ts
  integration.test.ts          # full start() flow with fake events
```

**Ports consumed:**
- `EventReader` (S3) — for startup replay
- `EventBus` (existing) — to subscribe as an EventSink for live events
- `FileSystemProvider` (existing) — for snapshot I/O

**Internal model:**
- `ProjectionStore` holds `Map<domain, ProjectionRuntime<unknown>>`
- Each `ProjectionRuntime` wraps: the projection, current state, current cursor, event counter, snapshot scheduler
- `start()`:
  1. For each registered projection: load `.method/projections/{domain}.json` if present
  2. Initialize state from snapshot OR from `projection.initialState()`
  3. Call `eventReader.readEventsSince(cursor)`, feed each event through `projection.reduce`
  4. Update cursor to latest event.sequence
  5. Register as EventSink on the bus for live updates
- Live event path: reduce → update state → increment counter → schedule snapshot if counter % snapshotEveryN === 0
- Snapshot write: debounced 500ms, write to `{domain}.json.tmp`, fsync, rename to `{domain}.json`

**Failure modes:**
- Snapshot missing: replay from seq 0 (full log)
- Snapshot corrupt: log warning, discard, replay from 0
- Reducer throws during replay: log warning, skip event, continue (counted in `StartResult.skippedEvents`)
- Reducer throws on live event: log error, keep state unchanged, continue

**Verification:**
- Unit test each ProjectionRuntime flow with fake events
- Integration test: emit events → snapshot → restart → verify state matches
- Gate test: no imports from `domains/`, only from `ports/` and `shared/event-bus/`

### shared/event-bus/ (EXTENDED)

**Changes:**
- Add `EventReader` interface to `ports/event-reader.ts`
- Implement `EventReader.readEventsSince(seq)` on `PersistenceSink`
  - Reads JSONL, parses lines, filters `event.sequence > seq`, returns array
  - Reuses existing parsing/corruption-tolerance logic from `replay()`

**Gate:** No new gate tests required — extends existing port pattern.

### build/ (FIRST CONSUMER)

**Changes:**
- New file: `domains/build/builds-projection.ts` implementing `Projection<BuildsState>`
- `BuildsState = { entries: Record<string, BuildEntry> }`
- Reducer handles: `build.started`, `build.phase_started`, `build.phase_completed`, `build.gate_waiting`, `build.gate_resolved`, `build.cost_updated`, `build.aborted`, `build.completed`
- `routes.ts` — replace in-memory `ctx.builds: Map` with `projectionStore.get<BuildsState>('build')`
- Existing `BuildOrchestrator` continues to run in-process and emit events; projection observes those events to maintain the read model

**Note:** This is a read-model projection. The `BuildOrchestrator` remains the write model (holds live execution state for in-progress builds). The projection reconstructs the *list* and *status* of builds, which is what /api/builds needs. In-flight orchestrator state still relies on checkpoint files (unchanged).

**Migration path:**
1. Add BuildsProjection alongside existing Map — both populated
2. Switch `routes.ts` reads to ProjectionStore — verify identical behavior
3. Remove in-memory Map

**Verification:**
- Unit test reducer with sequences of events
- Integration test: start build → kill bridge → restart → list includes build with correct status
- Gate: no new cross-domain imports

### server-entry.ts (COMPOSITION ROOT)

**Changes:**
- Instantiate `ProjectionStore` after `PersistenceSink` and `EventBus` are wired
- Create `EventReader` from PersistenceSink
- Register `new BuildsProjection()`
- Call `await projectionStore.start()` before routes are registered
- Log `StartResult` at info level

**Daily rotation (Wave 4):**
- Background timer (or cron trigger) invokes `EventRotator.rotate({ olderThanDays: 3, safetyGuard: () => projectionStore.maxSafeCutoff() })`
- Owned by event-bus, scheduled from composition root

### Architecture Gates Plan

| Gate | Applies to | Assertion |
|---|---|---|
| G-PORT | shared/persistence | No direct import of PersistenceSink; uses EventReader port |
| G-BOUNDARY | shared/persistence | Exports only from `index.ts`; no imports from `domains/` |
| G-LAYER | shared/persistence | L2 — no imports from L3 (domains) or L4 (bridge app) |
| G-ENTITY | all consumers | `ProjectionSnapshot` imported from `shared/persistence/types.ts` only |
| G-BOUNDARY | build | `BuildsProjection` imports `Projection` from `ports/` or `shared/persistence/` |

## Phase Plan

### Wave 0 — Surfaces (types + port interfaces)

**Deliverable:** All four surfaces frozen, zero business logic changes.

Files created:
- `shared/persistence/projection.ts` — S1 interface
- `shared/persistence/types.ts` — S4 ProjectionSnapshot, StartResult
- `ports/projection-store.ts` — S2 interface
- `ports/event-reader.ts` — S3 interface
- `shared/persistence/index.ts` — barrel exports

Gate assertions added to `architecture.test.ts`.

**Acceptance:** TypeScript compiles. Gate tests added. No runtime code.

### Wave 1 — ProjectionStore implementation

Files created:
- `shared/persistence/projection-store.ts`
- `shared/persistence/snapshot-writer.ts`
- `shared/persistence/snapshot-loader.ts`
- `shared/persistence/projection-store.test.ts`
- `shared/persistence/snapshot-writer.test.ts`
- `shared/persistence/integration.test.ts`

Depends on: Wave 0. Depends on: Wave 2 (EventReader) — **run in parallel with Wave 2, merge together**.

**Acceptance:** Unit + integration tests green. Can start, load snapshot, replay, subscribe, snapshot-on-threshold.

### Wave 2 — EventReader extension

Files modified:
- `shared/event-bus/persistence-sink.ts` — add `readEventsSince(seq)` method
- `shared/event-bus/persistence-sink.test.ts` — test cursor filtering
- `shared/event-bus/index.ts` — export EventReader implementation

**Acceptance:** PersistenceSink implements `EventReader`. Existing `replay()` behavior unchanged.

### Wave 3 — BuildsProjection + composition-root wiring

Files created:
- `domains/build/builds-projection.ts`
- `domains/build/builds-projection.test.ts`

Files modified:
- `domains/build/routes.ts` — read state from ProjectionStore
- `server-entry.ts` — instantiate ProjectionStore, register BuildsProjection, call start()

Depends on: Waves 1 + 2 merged.

**Acceptance:**
- Reducer unit tests cover all 8 event types
- Manual restart test: start build → kill bridge → restart → `GET /api/builds` returns build with correct status
- Existing build routes tests still pass

### Wave 4 — Event rotation (3-day window)

Files created:
- `ports/event-rotator.ts` — EventRotator interface
- `shared/event-bus/event-rotator.ts` — implementation
- `shared/event-bus/event-rotator.test.ts`

Files modified:
- `server-entry.ts` — schedule daily rotation, wire `projectionStore.maxSafeCutoff` as safety guard

**Acceptance:**
- Rotation archives events older than 3 days to `.method/events.archive/YYYY-MM-DD.jsonl.gz`
- Main `events.jsonl` shrinks after rotation
- Safety guard prevents rotating past projection snapshot cursors
- Disk usage test: 10k events, rotate, log shrinks

### Dependency DAG

```
Wave 0 (surfaces) ──→ Wave 1 (ProjectionStore) ──┐
       └───────────→ Wave 2 (EventReader) ───────┴──→ Wave 3 (BuildsProjection) ──→ Wave 4 (rotation)
```

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Reducer diverges from orchestrator state (read model ≠ write model) | Medium | Medium | Integration test comparing ProjectionStore state to orchestrator.getLiveState() after each phase |
| Snapshot atomicity (crash mid-write corrupts file) | Low | High | Write-tmp + fsync + rename pattern (standard) |
| Event log growth during replay window (before rotation ships) | Medium | Low | Wave 4 addresses; interim: log warnings when events.jsonl > 50MB |
| Seq counter reset across restarts (breaks cursor comparisons) | Low | High | `BridgeEvent.sequence` is already bus-assigned and persisted — verified existing behavior |
| Schema drift: old snapshots incompatible with new reducer | Medium | Medium | `ProjectionSnapshot.version` field; mismatch → discard snapshot, full replay |
| Projection reducer OOMs on massive replay | Low | High | Defer to rotation (bounded log) + `skipEvents` option in future |

## Open Questions (Resolved)

1. **Projection failures during replay:** Skip with logged warning, count in `StartResult.skippedEvents`, expose via health endpoint.
2. **Snapshots in git:** No. Add `.method/projections/` to `.gitignore`.
3. **Cross-process locking:** Not needed. Single bridge process per machine. Cluster = multi-machine federation, each machine owns its own state.

---

**Ready for:** `/fcd-plan` to decompose into commissions, or `/fcd-commission` starting with Wave 0.
