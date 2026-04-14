---
type: prd
title: "PRD-061: CortexSessionStore + Checkpoint Resume Contract"
date: "2026-04-14"
status: draft
version: "0.1"
size: M
index: 61
author: "Lysica (FCD design session)"
summary: >
  Ship the `SessionStore` port + `CheckpointSink` adapter frozen by S4, plus
  two concrete implementations (FS-backed for `@method/bridge`, ctx.storage-
  backed for `@method/agent-runtime`), and the resume algorithm that survives
  container restarts mid-pact. Idempotent under at-least-once delivery via
  lease + fencing tokens. Per-turn checkpoint default, per-event opt-in.
audience: [method-team, cortex-team, agent-runtime-authors]
domains:
  - "@method/runtime/ports (new port file)"
  - "@method/runtime (CheckpointSink impl)"
  - "@method/bridge/domains/sessions (FS adapter)"
  - "@method/agent-runtime/adapters (Cortex adapter)"
  - "@method/pacta (consumer — ResumableMode wiring)"
  - "@method/methodts (consumer — strategy executor checkpointing)"
consumed_surfaces:
  - ".method/sessions/fcd-surface-session-store/decision.md (S4 — PRIMARY, frozen)"
  - ".method/sessions/fcd-surface-runtime-package-boundary/decision.md (S2 — port lives in @method/runtime)"
  - ".method/sessions/fcd-surface-cortex-service-adapters/decision.md (S3 — BudgetReservation issuer = ctx.llm)"
  - ".method/sessions/fcd-surface-conformance-testkit/decision.md (S8 — resume conformance fixture)"
produced_surfaces:
  - "SessionStore port (owned by @method/runtime, defined in S4)"
  - "CheckpointSink port (owned by @method/runtime, defined in S4)"
  - "Two adapter implementations: FsSessionStore, CortexSessionStore"
related_prds:
  - "PRD-057 (@method/runtime extraction — MUST land first so ports have a home)"
  - "PRD-058 (@method/agent-runtime — consumes CortexSessionStore)"
  - "PRD-059 (CortexLLMProvider — issues BudgetReservation handles)"
  - "PRD-062 (JobBackedExecutor — writes continuation envelope into checkpoint)"
  - "PRD-064 (CortexMethodologySource — shares ctx.storage per-app DB)"
  - "PRD-065 (CortexAgentConformance — testkit ships resume fixtures)"
  - "t1-cortex-1 PRD-064 (App Storage Service — ctx.storage backend)"
gates:
  - "G-SESSIONSTORE-PORT-PURITY (no backend types leak through port signatures)"
  - "G-SESSIONSTORE-BOUNDARY (consumers import only from @method/runtime/ports)"
  - "G-CHECKPOINTSINK-SINGLE-CONSTRUCTOR (only composition root instantiates)"
  - "G-RESUME-IDEMPOTENT (testkit conformance: duplicate resume returns same fencingToken)"
  - "G-SCHEMA-VERSION-GATED (adapter rejects unknown schemaVersion with typed error)"
  - "G-LEASE-FENCING (stale token → FENCED rejection — invariant test)"
---

# PRD-061 — `CortexSessionStore` + Checkpoint Resume Contract

## 1. Summary

Implements the **S4 surface** (SessionStore + CheckpointSink) frozen on
2026-04-14. Delivers:

1. **The port files** in `@method/runtime/ports/` — `session-store.ts`,
   `checkpoint-sink.ts`, `session-store-types.ts`, `session-store-errors.ts`.
   (Port grammar copied verbatim from S4 §4.)
2. **`CheckpointSink` default implementation** in `@method/runtime/sinks/` —
   the debounced event-bus adapter that writes checkpoints on session
   lifecycle events.
3. **`FsSessionStore`** — the JSONL+lockfile adapter living in
   `@method/bridge/domains/sessions/fs-session-store.ts`. Supersedes the
   existing `SessionCheckpointSink` writes; coexists with
   `SessionPersistenceStore` for the session index during migration.
4. **`CortexSessionStore`** — the MongoDB-via-`ctx.storage` adapter living
   in `@method/agent-runtime/adapters/cortex-session-store.ts`. Two
   collections per app (`method_session_snapshots`,
   `method_session_checkpoints`).
5. **The resume algorithm** described in S4 §6 — atomic load+lease,
   fingerprint verification, budget rehydration via
   `CortexLLMProvider.rehydrate()`, event replay to consumers (not to the
   agent), lease heartbeat.
6. **Conformance fixtures** — three resume scenarios shipped via
   `@method/pacta-testkit/conformance` (S8): mid-turn restart, stale-lease
   theft attempt, schema-version rejection.

PRD-061 does **not** ship the `JobBackedExecutor` (PRD-062), the per-AppId
cost-governor plumbing (PRD-057 scope), or the `CortexMethodologySource`
(PRD-064). It also does **not** fold `MemoryPort` into `SessionStore` — per
S4 D-2 they remain distinct ports.

---

## 2. Problem

Today, session persistence in method is:

- **Bridge-only.** `packages/bridge/src/domains/sessions/session-persistence.ts`
  writes JSONL to `.method/sessions/session-index.jsonl`. The sink at
  `packages/bridge/src/shared/event-bus/session-checkpoint-sink.ts` debounces
  session lifecycle events and calls `save(PersistedSession)`. Zero
  ctx.storage plumbing.
- **Flat.** `PersistedSession` carries status + counters but no checkpoint
  concept — no `eventCursor`, no `pendingBudget`, no `agentState`, no
  `nextAction`. Restart recovery is "did this session exist?" not "what
  was it doing when we crashed?"
- **Not lease-fenced.** Two bridge workers (if federated via cluster) could
  both act on the same session. No fencing token.
- **Not schema-versioned.** Silent drift on envelope change.
- **Unaware of budget reservations.** `ctx.llm.reserve()` handles have no
  place to live across a restart.

Meanwhile, Cortex demands:

- **Per-app MongoDB** (PRD-064 `ctx.storage`). No filesystem; connection pool
  scoped by `appId`; typed BSON; quota-enforced. The session data must live
  in the same `cortex_app_{appId}` DB as the tenant's other collections.
- **Container restart mid-pact.** Cortex runs tenant apps as Tier 2 services
  with horizontal scaling and container cycling. A pact that was halfway
  through a tool-heavy turn when the container died must resume in a different
  worker without re-charging the budget and without double-invoking tools.
- **At-least-once delivery via `ctx.jobs`** (PRD-071, implemented by
  PRD-062). SQS semantics — the same `method.pact.continue` job may fire
  twice. The store must be the idempotency boundary.
- **Bounded LLM budget per invocation.** Per S3, `ctx.llm` is the single
  budget authority; the `BudgetReservation` handle from a prior turn must be
  reachable on resume so the worker can decide rehydrate vs re-reserve.

Without S4, agent-runtime can't ship the incident-triage demo (April 21) or
the Twins flagship (Wave 1). S4 froze the grammar; PRD-061 builds the thing.

---

## 3. Constraints

From S4 and its sibling surfaces — non-negotiable:

- **C-1. Frozen port signatures (S4 §4).** `SessionStore` has exactly these
  10 public methods: `create`, `load`, `resume`, `releaseLease`,
  `renewLease`, `appendCheckpoint`, `loadCheckpoint`, `loadLatestCheckpoint`,
  `listCheckpoints`, `finalize`, `destroy`. Any addition requires a new
  `/fcd-surface` session. (Implementation counted 11; `destroy` is
  treated as part of `finalize`'s terminal-cleanup pair.)
- **C-2. Port lives in `@method/runtime`.** Per S2 §3.1, ports ship at
  `packages/runtime/src/ports/` and are re-exported from
  `@method/runtime/ports`. PRD-061 depends on PRD-057 completing the
  extraction; if PRD-057 is in-flight, port files can land under a compat
  shim in bridge temporarily.
- **C-3. Lease + fencing token is the only idempotency mechanism.** Default
  TTL 30 s, renewable. Stale tokens → `SessionStoreError{ code: 'FENCED' }`.
  No distributed consensus primitive introduced.
- **C-4. Per-turn checkpoint default, per-event opt-in (S4 D-3).** Every
  `agent.step()` writes exactly one checkpoint before side effects.
  `CheckpointSink.checkpointOnEvent(filter)` adds fine-grained writes but is
  off by default.
- **C-5. `SCHEMA_INCOMPATIBLE` is non-retryable (S4 D-10).** Adapter refuses
  future `schemaVersion`. No silent upgrade path. Migration is explicitly
  out of scope for v1 — a v2 schema requires a new FCD session and a
  dedicated migration PRD.
- **C-6. No backend types leak (S4 D-9).** Port signatures mention no
  `mongodb`, no `BSONValue`, no `Stats`, no file handles. Gate-checked.
- **C-7. `BudgetReservation.issuer = 'ctx.llm'` for CortexSessionStore**
  (per S3). `FsSessionStore` uses `issuer = 'bridge/cost-governor'`. The
  port persists opaquely — no semantic knowledge.
- **C-8. Event bus is `RuntimeEvent`, not `BridgeEvent`.** S2 renamed the
  type. PRD-061 types `CheckpointSink` against `RuntimeEvent` even if the
  rename lands after PRD-061 starts (bridge keeps a one-line alias).
- **C-9. Replay is to consumers, not to the agent.** S4 §6 step 4. The
  agent's own state is in `agentState`; bus replay only reaches re-registered
  consumers (reconnected WS clients, fresh channel subscribers).
- **C-10. Conformance fixture mandatory.** Per S8, the testkit ships three
  resume scenarios and every production adapter must pass them.

From delivery rules:

- **DR-03.** `@method/runtime` packages have zero transport dependencies.
- **DR-04.** Thin wrappers, no business logic in adapters beyond persistence
  protocol.
- **DR-05.** YAML parsing (if any, none expected here) via `js-yaml`.
- **DR-09.** Tests use real YAML fixtures — here, real Mongo (testcontainers)
  and real FS, not mocks.

From Cortex PRD-064 (app-storage):

- **C-11. No `$where`, `$function`, `$accumulator`, `$out`, `$merge`** in
  any query the Cortex adapter emits. `findOneAndUpdate` is **deferred in
  v1** of `AppStorage[F]` — see §9 Risks, we rely on an atomic alternative.
- **C-12. 1000-doc cap on `find`**; adapter must paginate
  `listCheckpoints(limit=10)` safely.
- **C-13. Quota-enforced.** Write that would exceed per-app storage quota
  returns `CortexQuotaError`; adapter maps to
  `SessionStoreError{ code: 'QUOTA_EXCEEDED' }`.

---

## 4. Success Criteria

Binary outcomes the Cortex team (and the conformance testkit) verify:

1. **Container-restart resume.** Start an agent under
   `@method/agent-runtime`; while the agent is mid-turn (between
   `agent.step()` boundaries), kill the container; cold-start a new worker
   on the same `sessionId`; the worker resumes from the last checkpoint,
   rehydrates (or re-reserves) the budget, replays post-checkpoint events
   to any reconnected consumer, and completes the turn. Verified by
   `conformance-fixture/resume-mid-turn`.
2. **At-least-once idempotency.** Fire a `method.pact.continue` SQS
   message twice with the same `sessionId`. The second delivery acquires
   `resume()` first (or receives `FENCED`), the first gets `FENCED` on its
   next `appendCheckpoint`. Exactly one side-effect chain runs. Verified
   via `conformance-fixture/stale-lease-theft`.
3. **No double-charge on resume.** The cost-governor records **one**
   `OBSERVATION_RECORDED` for the resumed turn, not two — because the
   resumed worker rehydrates the existing reservation handle when valid,
   and the stale worker's attempt to `appendCheckpoint` is FENCED before
   its `ctx.llm.complete` can double-settle. Verified by cost-governor
   integration test with a synthetic `ctx.llm` fixture.
4. **Replay hits consumers, not the agent.** A reconnecting WS client after
   a restart receives the events its cursor missed. The agent's own
   `step()` call returns identical tokens to the pre-restart turn. Verified
   by `conformance-fixture/consumer-replay-not-agent-replay`.
5. **Schema rejection is fatal and typed.** Hand-write a snapshot with
   `schemaVersion: 2` into the store. Adapter returns
   `SessionStoreError{ code: 'SCHEMA_INCOMPATIBLE', retryable: false }`
   on `load()`. Runtime must escalate (no automatic coerce). Verified by
   fixture.
6. **Gate assertions green** — G-SESSIONSTORE-PORT-PURITY,
   G-SESSIONSTORE-BOUNDARY, G-CHECKPOINTSINK-SINGLE-CONSTRUCTOR,
   G-RESUME-IDEMPOTENT, G-SCHEMA-VERSION-GATED, G-LEASE-FENCING — all pass
   in CI for both `@method/bridge` and `@method/agent-runtime` test runs.
7. **Bridge behavior unchanged at the user-visible level.** Existing bridge
   sessions continue to appear in the sessions dashboard; session index
   endpoints (`GET /api/sessions`) return the same shape. Checkpointing is
   transparent. Verified by bridge integration tests running pre- and
   post-PRD.

---

## 5. Scope

### In Scope

- Port files:
  - `packages/runtime/src/ports/session-store.ts` — interface + 10
    methods copied from S4 §4.1.
  - `packages/runtime/src/ports/checkpoint-sink.ts` — interface + options
    type copied from S4 §4.2.
  - `packages/runtime/src/ports/session-store-types.ts` —
    `SessionSnapshot`, `Checkpoint`, `CheckpointMeta`, `EventCursor`,
    `AgentStateBlob`, `BudgetReservation`, `NextAction`, `ResumeOptions`,
    `ResumeContext`, `PactRef`, `SessionStatus`. Copied from S4 §4.3.
  - `packages/runtime/src/ports/session-store-errors.ts` — 10-variant
    `SessionStoreErrorCode` string-literal union + `SessionStoreError`
    class + `isSessionStoreError` guard. Copied from S4 §4.4.
- Default sink:
  - `packages/runtime/src/sinks/checkpoint-sink-impl.ts` — debounced
    (200 ms) implementation with pluggable `captureSnapshot`, event-type
    filter, `checkpointOnEvent(filter)` override, `flush()` for shutdown,
    `dispose()` for teardown.
- FS adapter (`@method/bridge`):
  - `packages/bridge/src/domains/sessions/fs-session-store.ts` —
    `createFsSessionStore(opts)` returning `SessionStore`. Layout per S4
    §9.2 (`.method/sessions/<sessionId>/snapshot.json`,
    `checkpoints.jsonl`, `lease.json`, `lease.lock`,
    `blobs/<hash>.bin`). Atomic writes via tmp+rename.
  - Migration shim: existing `SessionPersistenceStore` keeps its
    `save(PersistedSession)` surface and is *fed* by `FsSessionStore`
    projecting the snapshot into the legacy shape, so the session
    dashboard keeps working. Removed in PRD-061+1 cleanup.
- Cortex adapter (`@method/agent-runtime`):
  - `packages/agent-runtime/src/adapters/cortex-session-store.ts` —
    `createCortexSessionStore(opts)` returning `SessionStore`.
  - Uses `ctx.storage.collection('method_session_snapshots')` and
    `ctx.storage.collection('method_session_checkpoints')`.
- Resume algorithm implementation:
  - `packages/runtime/src/sessions/resume.ts` — the 5-step algorithm from
    S4 §6, shared by both adapters (adapter-specific atomic primitives
    supplied via the port; the algorithm is adapter-agnostic).
- Wiring:
  - `packages/bridge/src/server-entry.ts` — wire `FsSessionStore` +
    register `CheckpointSink` on the existing `EventBus`. Retire the old
    `SessionCheckpointSink` once behavior parity is confirmed.
  - `packages/agent-runtime/src/bootstrap.ts` — accept a
    `SessionStoreFactory` in `createMethodAgent`'s options; default to
    `createCortexSessionStore({ ctx: args.ctx })` when `ctx.storage` is
    present.
- Conformance:
  - `packages/pacta-testkit/src/conformance/session-store/` — three
    fixtures (resume-mid-turn, stale-lease-theft,
    schema-version-rejection) runnable against any `SessionStore` impl.

### Out of Scope

- `JobBackedExecutor` (PRD-062). The resume contract knows how to persist
  a `nextAction = { kind: 'await-schedule', wakeAt }`, but actually
  enqueuing into `ctx.jobs` is PRD-062's responsibility.
- Per-AppId cost-governor scoping (lives in PRD-057's
  `createCostGovernor({ appId })`). This PRD only ensures the port
  persists the `BudgetReservation` handle opaquely.
- `CortexMethodologySource` over `ctx.storage` (PRD-064).
- `MemoryPort` (FactCard + CLS) adapters over `ctx.storage`. Separate
  concern; different collections; may share the same `ctx.storage`
  handle but different lifecycle.
- `CheckpointPort` (build-orchestrator) migration onto `SessionStore`.
  Called out in S4 §10 as future work — tracked separately, non-breaking
  because `CheckpointPort`'s caller surface is unchanged.
- `SessionStore` HTTP surface. Bridge does not expose session-store as an
  HTTP endpoint in v1; the bridge's existing session-browsing endpoints
  read the projected `SessionPersistenceStore` index.
- Multi-host lease coordination for FS adapter (documented single-host
  limitation, S4 §7).
- Compression, encryption at rest, or blob storage beyond the simple
  `blob-ref` escape hatch.
- Schema migration from v1 to v2. When v2 happens, a separate migration
  PRD ships a side-by-side reader that translates on read.

---

## 6. Architecture

### 6.1 Layer Placement

Per S2 (RuntimePackageBoundary) §1, §3.1, §9, §10:

```
L3   @method/runtime
       src/ports/session-store.ts          ← NEW (port, stable tier)
       src/ports/checkpoint-sink.ts        ← NEW
       src/ports/session-store-types.ts    ← NEW
       src/ports/session-store-errors.ts   ← NEW
       src/sinks/checkpoint-sink-impl.ts   ← NEW (default impl)
       src/sessions/resume.ts              ← NEW (adapter-agnostic algo)

L4   @method/bridge
       src/domains/sessions/fs-session-store.ts      ← NEW (FS adapter)

L3   @method/agent-runtime (PRD-058)
       src/adapters/cortex-session-store.ts          ← NEW (ctx.storage adapter)
```

**Port ownership:** `@method/runtime`. Both concrete adapters live in
their respective consumer packages, not in runtime. This follows the
"adapter = outbound concretization" idiom from S3.

**Why not put `CortexSessionStore` in `@method/runtime`?** Because
`@method/runtime` has zero Cortex-platform knowledge (§9 of S2). The
Cortex adapter imports `@t1/cortex-sdk` types, which are Cortex-platform
bindings. Those must stay in `@method/agent-runtime`.

**Why not put `FsSessionStore` in `@method/runtime`?** Because it needs
`NodeFileSystemProvider`, which stays in bridge (S2 §5.3). The port is
neutral; the FS adapter is a Node impl. If a non-bridge consumer ever
needs an FS adapter, we extract it. Today there's exactly one consumer.

### 6.2 Wiring (Composition Roots)

**Bridge (`packages/bridge/src/server-entry.ts`):**

```ts
import { createFsSessionStore } from './domains/sessions/fs-session-store.js';
import { createCheckpointSink } from '@method/runtime/sinks';

const sessionStore = createFsSessionStore({
  baseDir: projectRoot,
  fs: nodeFileSystemProvider,
  defaultLeaseTtlMs: 30_000,
  checkpointRingSize: 10,
  currentPid: process.pid,
});

const checkpointSink = createCheckpointSink({
  store: sessionStore,
  workerId: () => `bridge-${os.hostname()}-${process.pid}`,
  captureSnapshot: async (sessionId) => {
    const info = sessionPool.list().find(s => s.sessionId === sessionId);
    if (!info) return null;
    return {
      sessionId,
      eventCursor: eventBus.currentCursor(),
      agentState: { kind: 'inline', data: { transcriptTail: info.lastText } },
      pendingBudget: null, // bridge default: no LLM reservation
      nextAction: deriveNextAction(info),
    };
  },
});
eventBus.registerSink(checkpointSink);
```

**agent-runtime (`packages/agent-runtime/src/bootstrap.ts`):**

```ts
import { createCortexSessionStore } from './adapters/cortex-session-store.js';
import { createCheckpointSink } from '@method/runtime/sinks';

export function createMethodAgent({ ctx, pact, sessionStore: inject }: Opts) {
  const store = inject ?? createCortexSessionStore({
    ctx: { storage: ctx.storage },
    snapshotCollection: 'method_session_snapshots',
    checkpointCollection: 'method_session_checkpoints',
    defaultLeaseTtlMs: 30_000,
  });
  // ... agent event bus, checkpoint sink, etc.
}
```

### 6.3 Resume Algorithm (adapter-agnostic)

Copied from S4 §6 — the impl lives at `packages/runtime/src/sessions/resume.ts`:

```ts
export async function performResume(args: {
  store: SessionStore;
  sessionId: string;
  workerId: string;
  pact: ResolvedPact;
  budget: BudgetEnforcer;        // from pacta
  eventReader?: EventReader;     // optional, for replayHint
  leaseTtlMs?: number;
}): Promise<ResumeOutcome> {
  // 1. Load & lease (atomic via adapter)
  const rc = await args.store.resume(args.sessionId, args.workerId, {
    leaseTtlMs: args.leaseTtlMs ?? 30_000,
    requireFingerprint: true,
  });
  // 2. Fingerprint already verified by store; rc.snapshot is ours now.

  // 3. Rehydrate budget
  const freshBudget = await args.budget.rehydrateOrReserve(rc.checkpoint?.pendingBudget ?? null);

  // 4. Replay events to consumers (NOT to agent)
  if (args.eventReader && rc.checkpoint) {
    await args.eventReader.replay({
      filter: { sessionId: args.sessionId },
      sinceSequence: rc.checkpoint.eventCursor.sequence,
    });
  }

  // 5. Start lease heartbeat
  const heartbeat = startLeaseHeartbeat(args.store, args.sessionId, rc.fencingToken, rc.leaseExpiresAt);

  return {
    snapshot: rc.snapshot,
    checkpoint: rc.checkpoint,
    fencingToken: rc.fencingToken,
    nextAction: rc.checkpoint?.nextAction ?? { kind: 'await-prompt' },
    freshBudget,
    heartbeat,
  };
}
```

### 6.4 Data Model — Mongo Collection Design

**Database:** `cortex_app_{appId}` (owned by Cortex PRD-064; method does not
provision it — method only picks collection names inside it).

**Collection 1: `method_session_snapshots`**

One document per `sessionId`. Document shape = `SessionSnapshot` from
S4 §4.3 plus an internal `_lease` sub-document + `_updatedAtEpoch` for
TTL-backed index rotation:

```jsonc
{
  "_id": "ses_01HZY...",             // == sessionId (so single-doc atomic lease CAS works)
  "schemaVersion": 1,
  "sessionId": "ses_01HZY...",
  "scopeId": "app_incidents_bot",
  "pactRef": { "id": "...", "version": "1.0.0", "fingerprint": "sha256:..." },
  "status": "paused",
  "createdAt": "2026-04-14T18:22:01.003Z",
  "updatedAt": "2026-04-14T18:24:17.441Z",
  "latestCheckpointSequence": 7,
  "nickname": "triage-#98712",
  "parentSessionId": null,
  "depth": 1,
  "metadata": {},
  "_lease": {
    "workerId": "worker-03",
    "fencingToken": "ft_...",
    "acquiredAt": "2026-04-14T18:24:17.441Z",
    "expiresAt":  "2026-04-14T18:24:47.441Z"
  },
  "_updatedAtEpoch": 1760464040441    // for TTL, if we add one later
}
```

**Indexes** (declared in the agent-runtime tenant app's
`requires.storage.indexes` manifest block, installed on first use via
`ctx.storage.collection(...).createIndex(...)`):

| Collection | Fields | Unique | Direction | Purpose |
|---|---|---|---|---|
| `method_session_snapshots` | `{ sessionId: 1 }` | ✔️ | — | primary lookup (also `_id` alias) |
| `method_session_snapshots` | `{ scopeId: 1, updatedAt: -1 }` | — | `updatedAt` desc | per-app UI listing |
| `method_session_snapshots` | `{ status: 1, "_lease.expiresAt": 1 }` | — | — | lease-reaper scans (find expired leases of running sessions) |
| `method_session_checkpoints` | `{ sessionId: 1, sequence: -1 }` | ✔️ on (sessionId, sequence) | sequence desc | latest checkpoint lookup |
| `method_session_checkpoints` | `{ sessionId: 1, createdAt: -1 }` | — | — | `listCheckpoints` bounded queries |
| `method_session_checkpoints` | `{ _retireAt: 1 }` (TTL) | — | — | ring-retention expiry (24h buffer past ring size) |

**Collection 2: `method_session_checkpoints`**

One document per `(sessionId, sequence)` pair. Document shape =
`Checkpoint` from S4 §4.3. Oversized `agentState` spills to `blob-ref`
via Cortex blob service (blob writer injected — optional in v1;
blob-less adapter holds up to 16 KB inline and rejects larger with
`CORRUPT_SNAPSHOT` + diagnostic).

```jsonc
{
  "_id": { "sessionId": "ses_01HZY...", "sequence": 7 },
  "schemaVersion": 1,
  "sessionId": "ses_01HZY...",
  "sequence": 7,
  "createdAt": "2026-04-14T18:24:17.441Z",
  "eventCursor": { "sequence": 42871, "id": "evt_01HZY..." },
  "agentState": { "kind": "inline", "data": {} },
  "pendingBudget": { "handle": "rsv_...", "issuer": "ctx.llm", ... },
  "nextAction": { "kind": "continue-turn", "pendingToolCalls": ["tc_3"] },
  "note": "after tool fan-out",
  "_retireAt": "2026-04-21T18:24:17.441Z"       // checkpoint-ring retention
}
```

**Ring retention:** adapter tracks `latestCheckpointSequence`; on
`appendCheckpoint`, sets `_retireAt` on the checkpoint at
`sequence - ringSize` to `now + 24h` (TTL grace). Mongo TTL worker does
the delete. Default ringSize 10.

**Atomicity primitive:** lease CAS via `findOneAndUpdate` on the snapshot
doc with the filter:

```ts
{
  _id: sessionId,
  $or: [
    { _lease: null },
    { '_lease.expiresAt': { $lt: nowIso } },
    { '_lease.workerId': workerId },
  ],
}
```

…and `$set: { _lease: newLease, updatedAt: nowIso }`. Returns the updated
snapshot; null → `FENCED`. This is single-document atomic in MongoDB and
does **not** require `findOneAndUpdate` from the forbidden-op list — the
update is a plain `$set` with no aggregation pipeline.

`appendCheckpoint` is a two-step compound under the lease invariant:
(1) `insertOne` into `method_session_checkpoints` (rejects duplicate
`(sessionId, sequence)` via the unique index); (2) `updateOne` on snapshot
with filter `{ _id: sessionId, '_lease.fencingToken': token }` and
`$set: { latestCheckpointSequence: n, updatedAt: nowIso }`. Between the
two, a crash leaves an orphan checkpoint that the next resume will
observe and either accept (sequence > latestCheckpointSequence, treat as
committed) or ignore (sequence ≤ latestCheckpointSequence, leftover from
earlier attempt). The lease invariant prevents a concurrent writer from
racing step (2).

### 6.5 Data Model — FS Schema

Per S4 §9.2, layout under `<baseDir>/.method/sessions/<sessionId>/`:

```
snapshot.json           # atomic write via .tmp + rename; SessionSnapshot JSON
checkpoints.jsonl       # append-only; one Checkpoint per line; rotated at ringSize*2
checkpoints-<iso>.jsonl.gz  # archived rings (optional retention)
lease.json              # { workerId, pid, fencingToken, acquiredAt, expiresAt }
lease.lock              # sentinel from fs.open(..., 'wx'); deleted on release
blobs/<sha256>.bin      # for agentState kind: 'blob-ref'
```

**Atomicity primitives:**

- Lease acquisition: `fs.open(lease.lock, 'wx')` — fails if exists.
  On success, read `lease.json` (if any) for stale/expired check; rewrite
  with new owner.
- Stale lease reclaim: if `lease.lock` exists but `lease.json.expiresAt <
  now` OR `lease.json.pid` is not alive (probe via `process.kill(pid, 0)`
  on POSIX; WMI on Windows — reuse `bridge-tools` logic), the adapter
  unlinks `lease.lock` and retries once. Documented race: two processes
  racing to reclaim both pass the staleness check; the `wx` mode on the
  second `open` re-fails cleanly; only the winner proceeds.
- Checkpoint append: open `checkpoints.jsonl` with `a`, write one JSON
  line with trailing `\n`, `fsync` on close. The file is monotonic and
  the `sequence` field self-identifies; duplicate sequences are
  duplicates (rejected via a fresh load scan before append).
- Snapshot update: write to `snapshot.json.tmp`, `fsync`, `rename` over
  `snapshot.json`. POSIX-atomic; Windows-atomic under NTFS via
  `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`.

**Backup compat with existing `SessionPersistenceStore`:** during
migration, a projection callback inside `FsSessionStore.finalize` and
`FsSessionStore.appendCheckpoint` calls the legacy
`SessionPersistenceStore.save(PersistedSession)` with the fields needed
for the dashboard. Cleanup PR (PRD-061+1) removes the legacy index once
the dashboard reads from `loadAll` projecting from `FsSessionStore`.

---

## 7. Schema Versioning + Migration Policy

Per S4 D-10 and C-5:

- **v1 is the initial version.** Every envelope has `schemaVersion: 1`.
- **Additive changes within v1** (new optional fields) are allowed with a
  PR review — not a breaking change. Both adapters MUST tolerate unknown
  fields on read (ignore; do not copy forward to avoid accidentally
  validating client-side).
- **Breaking changes bump to v2** and require:
  1. A new `/fcd-surface` session that justifies the break and defines
     the v2 envelope.
  2. A dedicated migration PRD (call it PRD-061b) shipping a
     side-by-side reader that accepts v1 and v2, plus a background
     migrator task in each adapter.
  3. During the dual-version window, writes go v2 and reads accept
     either. Once all records are migrated, v1 support is dropped in a
     subsequent PR.
- **Adapter behavior on unknown `schemaVersion`:**
  `SessionStoreError{ code: 'SCHEMA_INCOMPATIBLE', retryable: false,
  message: 'Snapshot schemaVersion=2 unknown to adapter v1' }`. The
  runtime must escalate — no automatic coerce, no best-effort load.
- **Fingerprint mismatches** (pact drift) are handled separately via
  `FINGERPRINT_MISMATCH`. Runtime policy: default abort with escalation;
  a developer flag (never exposed to end users) can override.

---

## 8. Test Plan

Testing lives in two places. **Adapter-specific** tests live with the
adapter. **Shared conformance** tests live in the testkit and run against
each adapter.

### 8.1 Adapter-specific (in-package, vitest)

**`FsSessionStore`** (`packages/bridge/src/domains/sessions/fs-session-store.test.ts`):
- Atomic snapshot write: kill mid-write (`fs.writeFile` mock that throws
  after truncation), next load sees the old snapshot intact.
- Lease stale-PID reclaim on Windows + POSIX fixtures.
- Ring rotation at ringSize * 2; archived gz file presence.
- Blob-ref write to `blobs/<hash>.bin`; hash verification on read.

**`CortexSessionStore`** (`packages/agent-runtime/src/adapters/cortex-session-store.test.ts`):
- Uses `@method/agent-runtime/testing/ctx-storage-fixture` (a
  Mongo-memory-server or testcontainers harness — see §11).
- Lease CAS contention: 10 concurrent `resume(sessionId, workerId_i)` —
  exactly one succeeds, 9 receive `FENCED`.
- `appendCheckpoint` rejects stale fencing token after lease theft.
- Index presence verification (query `db.collection.getIndexes()`).
- Quota-exceeded path: fixture with a 1 MB quota, write > 1 MB, expect
  `QUOTA_EXCEEDED`.

### 8.2 Shared Conformance (`@method/pacta-testkit/conformance`)

Fixtures runnable by any `SessionStore` impl — the Cortex adapter and the
FS adapter both run them in CI. Fixture format follows S8's
`CortexAgentConformance` pattern:

1. **`resume-mid-turn`** — spawn a synthetic pact, advance 3 turns
   (3 checkpoints written), simulate "container death" by discarding
   the worker instance and creating a new one with the same `sessionId`.
   Assertions:
   - `resume()` returns the snapshot at sequence 3.
   - `fresh.fencingToken !== stale.fencingToken`.
   - Replaying events via `eventReader` delivers all events with
     `bus.sequence > checkpoint.eventCursor.sequence`.
2. **`stale-lease-theft`** — worker A acquires lease; worker B calls
   `resume()` inside the TTL window. Expect worker B gets `FENCED`.
   After TTL expires and worker A is silent, worker B's retry succeeds.
   Worker A's subsequent `appendCheckpoint` returns `FENCED`.
3. **`schema-version-rejection`** — hand-write a snapshot with
   `schemaVersion: 2`. `load()` / `resume()` return
   `SCHEMA_INCOMPATIBLE`; `retryable === false`.

Each fixture exports:

```ts
export const conformanceFixture: SessionStoreConformanceFixture = {
  name: 'resume-mid-turn',
  run: async (store: SessionStore) => { ...; return { passed: true } | { passed: false, reason } },
};
```

Consumers run them via `runSessionStoreConformance(store, [fixtures])`.

### 8.3 Integration

- **Bridge end-to-end:** spawn a `print` session, send 2 prompts, kill
  the bridge, restart, verify session appears in dashboard with correct
  `latestCheckpointSequence` and that `loadCheckpoint(2)` returns the
  expected `nextAction`.
- **agent-runtime end-to-end:** against Cortex's local dev stack
  (`mongo:7` from `cortex-app dev`), run the incident-triage pact
  fixture, simulate restart via worker-instance swap, verify total
  `ctx.llm.complete` calls = N (one per turn including the resumed one,
  not 2N).

### 8.4 Gate Tests

Added to `packages/runtime/src/architecture.test.ts`:

- **G-SESSIONSTORE-PORT-PURITY** — per S4 §12, port file matches no
  `/mongodb|bson|fs\.(readFile|writeFile|stat)/i`, and no bare `any`.
- **G-SESSIONSTORE-BOUNDARY** — adapters are not imported anywhere
  outside `server-entry.ts` / `bootstrap.ts` / the adapter file itself.
- **G-CHECKPOINTSINK-SINGLE-CONSTRUCTOR** — `new CheckpointSink(` / direct
  constructor matches only in the composition roots.
- **G-RESUME-IDEMPOTENT** — invariant: calling `resume(id, sameWorker)`
  twice returns the same `fencingToken` + `leaseExpiresAt` within the TTL.
- **G-SCHEMA-VERSION-GATED** — adapter write path rejects
  `schemaVersion !== 1` at compile time (TypeScript literal) and read
  path throws `SCHEMA_INCOMPATIBLE` at runtime.
- **G-LEASE-FENCING** — unit test: concurrent append with stale token
  fails; append with live token succeeds.

---

## 9. Risks

**R-1. Lease drift across restart.** If the worker crashes while holding a
lease, the lease persists until TTL. A fresh worker that starts
immediately must wait up to 30 s to acquire. Mitigation: shorter default
TTL (30 s picked as balance — longer hides bugs, shorter risks live-lock
under GC pauses). The heartbeat keeps the lease alive; missed heartbeats
drop it. Stretch: explicit `releaseLease` on graceful shutdown via
`process.on('SIGTERM')`.

**R-2. Mongo cost.** Per PRD-064 the tenant app pays for their DB. A
checkpoint per turn at 1 KB average = ~30 MB/month per active session.
For the incident-triage demo (bounded, short-lived sessions) negligible.
For Twins (long-running daily) it matters. Mitigation: ring size default
10 + TTL cleanup keeps steady-state size bounded. Configurable.

**R-3. Schema revision pain.** v1 → v2 is disruptive. Mitigation: v1 is
permissive on read (ignore unknown fields), strict on write (bump
`schemaVersion`). Future additive fields ship without a version bump.
The first breaking change triggers the migration PRD; we accept the cost.

**R-4. Cortex `findOneAndUpdate` forbidden-op risk.** PRD-064 §142-146
confirms `findOneAndUpdate` is **deferred in v1 of AppStorage[F]**.
This is the primitive my Mongo lease CAS depends on. Mitigation: use
`updateOne` with the conditional filter + read the result count. If 0,
the CAS failed; fall back to `findOne` to see why (FENCED vs NOT_FOUND).
This costs one extra read on the fail path — acceptable. Alternatively:
escalate to Cortex team (follow-up O-9, new) to include
`findOneAndUpdate` in Surface 12.7 Phase 2. **Action:** raise as a
comms to Cortex in the roadmap §8 open-questions — section 12 of this
PRD captures it.

**R-5. Event replay faithfulness.** Replaying events to consumers
requires an `EventReader` that can seek by `sequence`. Today the bridge's
`event-bus` has `query(filter)` but not efficient
`query({ filter, sinceSequence })`. Implementation PR must extend the
bus's internal ring buffer / persistence to support seek. Mitigation:
`replayHint` on `ResumeContext` is optional (S4 §4.3 `ResumeContext.replayHint?`);
if bus lacks seek, we skip replay and document the caveat.

**R-6. Concurrent bridge nodes.** FS adapter is single-host. If the
bridge is deployed across multiple hosts (cluster federation), two hosts
could both attempt to lease the same session via different filesystems.
Documented as single-host limitation; cluster federation pins sessions
to a host via `@method/cluster` routing.

**R-7. Blob-ref backend missing.** `CortexSessionStore` accepts
`blobRefWriter` but no blob service is frozen. v1 ships without blobs
(inline-only, 16 KB cap); the adapter throws `CORRUPT_SNAPSHOT` on
oversize. Most pacts fit. Long conversations will need blobs
(PRD-061+1 follow-up, or reuse Cortex's knowledge service).

**R-8. At-least-once order with SQS + lease.** `ctx.jobs`
`method.pact.continue` can deliver out of order. If message N+1 arrives
before N, worker processes N+1 first. Per S4 §6.4 the checkpoint's
`nextAction` is the source of truth for "what's next" — so an out-of-
order delivery sees the snapshot and proceeds from the actual latest
checkpoint, not from the message's embedded advice. Documented expectation.

---

## 10. Acceptance Gates

PRD-061 is complete when:

1. **All port files exist** at `packages/runtime/src/ports/session-store*.ts`
   matching S4 §4 verbatim (API-level equivalence; internal comments may
   expand).
2. **`CheckpointSink` default impl passes unit tests** — debounce,
   flush, dispose, per-event opt-in.
3. **`FsSessionStore` passes all three conformance fixtures + adapter-
   specific tests** on Linux + Windows CI runs.
4. **`CortexSessionStore` passes all three conformance fixtures + adapter-
   specific tests** against a Mongo testcontainer in CI.
5. **All six gate tests green** (G-SESSIONSTORE-PORT-PURITY,
   G-SESSIONSTORE-BOUNDARY, G-CHECKPOINTSINK-SINGLE-CONSTRUCTOR,
   G-RESUME-IDEMPOTENT, G-SCHEMA-VERSION-GATED, G-LEASE-FENCING).
6. **Bridge dashboard shows sessions unchanged** — manual smoke test
   plus a scripted integration test asserting the session index shape
   is stable.
7. **Incident-triage demo (pact fixture) survives a simulated restart**
   in the agent-runtime end-to-end test — one `ctx.llm.complete` call
   per turn, total budget reserved == total budget settled, audit log
   contains exactly one turn-completion entry per logical turn.
8. **Conformance testkit published** at `@method/pacta-testkit/conformance/session-store/`
   and documented in the S8 conformance README.
9. **PRD-057 dependency acknowledged** — either PRD-057 lands first
   (port files in `packages/runtime/src/ports/`) or PRD-061 lands with
   a compat shim that re-exports from `packages/bridge/src/ports/` and
   marks it for mechanical move in the next PR.

---

## 11. Open Questions (for follow-up, not blocking)

- **O-1. `findOneAndUpdate` in `AppStorage[F]` v2.** Raise to Cortex: the
  Mongo lease CAS is cleaner with `findOneAndUpdate`. Today `updateOne +
  findOne` double-round-trip on fail paths works. Escalate as a v2
  Surface 12.7 amendment if cost matters. See R-4.
- **O-2. `EventReader` seek-by-sequence.** PRD-057 should confirm the
  event bus exposes `query({ sinceSequence })`. If not, a small PR
  extends the in-memory ring buffer. See R-5.
- **O-3. Blob-ref backend.** Cortex has no blob service frozen. Method
  could ship an `FsBlobRefWriter` (writes to `blobs/<hash>.bin` via
  `FileSystemProvider`) for bridge; agent-runtime's default is a stub
  that throws `'blob-ref not supported in v1'`. Raise with Cortex
  whether `ctx.knowledge` or a future `ctx.blob` is the right home.
- **O-4. Tool-call idempotency contract.** S4 §7 passes `fencingToken`
  to tool invocation metadata and requires tools to deduplicate on
  `(fencingToken, toolCallId)`. This is a **tool-side** contract, not
  enforceable by the store. Document the contract in the conformance
  testkit and in PRD-058's cookbook.
- **O-5. Testcontainers vs Mongo-memory.** The testkit adapter fixture
  needs to decide. Leaning Mongo-memory-server for speed; if Cortex
  wants parity with production Mongo-7 features, switch. Noting for
  PRD-065.

---

## 12. Cross-Reference Index

| Ref | Location | Why it matters |
|---|---|---|
| S4 §4.1 | `fcd-surface-session-store/decision.md` | 10 `SessionStore` methods |
| S4 §4.2 | same | `CheckpointSink` interface |
| S4 §4.3 | same | Type definitions (SessionSnapshot, Checkpoint, etc.) |
| S4 §4.4 | same | Error taxonomy (10-variant union) |
| S4 §6 | same | Resume algorithm (5 steps) |
| S4 §7 | same | Idempotency & lease mechanism |
| S4 §9.1/9.2 | same | Adapter sketches (Cortex + FS) |
| S4 §12 | same | Gate assertion template |
| S2 §3.1 | `fcd-surface-runtime-package-boundary/decision.md` | Port exports under `@method/runtime/ports` |
| S2 §5 | same | What stays in bridge (FS adapter lives there) |
| S3 §2.1 | `fcd-surface-cortex-service-adapters/decision.md` | `BudgetReservation.issuer = 'ctx.llm'` |
| S8 | `fcd-surface-conformance-testkit/decision.md` | Fixture format + subpath `@method/pacta-testkit/conformance` |
| Cortex PRD-064 | `t1-cortex-1/docs/prds/064-app-storage-service.md` | `ctx.storage` API, forbidden ops, quota, index manifest |

---

## 13. Status

**Draft — design complete.** Ready for review. Implementation can begin
once PRD-057 has exported the port directory structure (or via compat
shim if PRD-057 is still in-flight). Sized **M**: ~2 weeks for one
engineer, ~1 week with parallel work on the two adapters.
