---
type: co-design-record
surface: "SessionStore + CheckpointSink"
slug: "session-store"
date: "2026-04-14"
owner: "@methodts/runtime"
producer: "@methodts/runtime (defines); @methodts/agent-runtime (Cortex impl), @methodts/bridge (FS impl) (implement)"
consumer: "@methodts/pacta executors, @methodts/methodts runtime, @methodts/bridge sessions/strategies domains"
direction: "runtime → agent-runtime/bridge (port); producers → sinks (events)"
status: frozen
mode: "new"
related:
  - docs/roadmap-cortex-consumption.md §4.1 item 5, §4.2 item 8 (PRD-061)
  - packages/pacta/src/ports/memory-port.ts
  - packages/bridge/src/domains/sessions/session-persistence.ts
  - packages/bridge/src/shared/event-bus/session-checkpoint-sink.ts
  - packages/bridge/src/ports/checkpoint.ts
  - packages/pacta/src/modes/execution-mode.ts
  - ../../t1-repos/t1-cortex-1/docs/prds/064-app-storage-service.md
  - ../../t1-repos/t1-cortex-1/.method/sessions/fcd-surface-12.7-app-storage-port/record.md
---

# Co-Design Record — `SessionStore` + `CheckpointSink` (S4)

> The persistence port for agent sessions and checkpoints. Owned by
> `@methodts/runtime`. Implemented either against Cortex `ctx.storage` (per-app
> MongoDB) in `@methodts/agent-runtime`, or against JSONL+FS in the bridge's
> existing persistence domain. The port must not leak backend semantics.

## 0. Decision Summary

| # | Decision |
|---|---|
| D-1 | **Split the surface.** `SessionStore` (state/checkpoint CRUD) and `CheckpointSink` (event-bus adapter that writes checkpoints) are separate ports with a single composition path. Splitting avoids a god-interface and keeps the event-bus coupling in a thin adapter. |
| D-2 | **Do NOT fold `MemoryPort` into `SessionStore`.** `MemoryPort` / `MemoryPortV2` / `MemoryPortV3` are **agent working-memory** (FactCards, CLS dual-store, notes) — episodic/semantic cognitive state. `SessionStore` is **process-level durability** (turn, status, budget reservation, event cursor). Different lifetimes, different consumers, different backing collections. Adapter may *compose* them (`CortexSessionStore` can use the same `ctx.storage` handle that `CortexMemoryPort` uses) but they remain distinct ports. |
| D-3 | **Checkpoint granularity = per-turn by default, per-event opt-in.** Every `agent.step()` (one prompt → one completion) MUST produce a durable checkpoint before side effects (tool calls, notify, audit) fire. Finer granularity is available via `CheckpointSink.checkpointOnEvent(filter)` for long tool-heavy turns but is not the default — per-event checkpointing at sub-turn granularity costs ≥ 1 extra Mongo write per event. |
| D-4 | **Checkpoints are append-only versioned snapshots**, not deltas. Each `checkpointId` is monotonic per `sessionId`. The store keeps the last N (default 10) and TTL-expires older. Replay requires only the latest, so deltas buy nothing. |
| D-5 | **Idempotency via lease + causal fencing.** `resume(sessionId)` acquires a short-lived lease (default 30s, renewable) and returns a `fencingToken` that the caller must pass to subsequent `appendCheckpoint()` calls. The store rejects appends with a stale token (`SessionStoreError.FENCED`). Two workers cannot both act on the same checkpoint. |
| D-6 | **Budget reservation is part of the checkpoint.** The checkpoint includes `pendingBudget: BudgetReservation` — the `ctx.llm.reserve()` handle (or local equivalent) that was active when the checkpoint was taken. On resume the worker MUST decide whether to `cancel()` the stale reservation and `reserve()` fresh, or `rehydrate()` the token if still valid. Policy lives in the runtime, the port just persists the handle. |
| D-7 | **Event-bus cursor per session is part of the checkpoint.** `eventCursor: { sequence: number; id: string }` identifies the last `BridgeEvent` consumed by or for the session. Replay semantics: on resume, the runtime replays all bus events with `sequence > eventCursor.sequence AND sessionId == this.sessionId` to any re-registered consumers before accepting new prompts. |
| D-8 | **Resume is a single transaction** at the port level: `loadSnapshot → acquireLease → return hydrated context`. The port implementation is responsible for atomicity (Mongo: single-doc upsert with `$setOnInsert` on lease owner; FS: lockfile + atomic rename). Callers never compose these operations themselves. |
| D-9 | **Port knows nothing about Mongo, JSONL, or filesystems.** Implementations are free to use bulk writes, indexes, change streams — the port contract is backend-neutral. Forbidden: any operator-specific type (`BSONValue`, `Stats`, file handles) in the port signatures. |
| D-10 | **Schema versioning is explicit.** Every persisted envelope carries `schemaVersion: 1`. Adapters refuse to read a snapshot with a future `schemaVersion` (`SessionStoreError.SCHEMA_INCOMPATIBLE`). Migration is out of scope — this is how we catch silent drift at port boundaries. |
| D-11 | **Error taxonomy is a discriminated union, not subclasses.** The port defines `SessionStoreErrorCode` as a string literal union; implementations throw `SessionStoreError` instances with a `code` field. Error codes survive serialization across the HTTP boundary to a Cortex app. |
| D-12 | **`@methodts/pacta`'s `ResumableMode` is the user-facing trigger.** `pact.mode = { type: 'resumable', sessionId }` causes the runtime to look up the session via `SessionStore.load(sessionId)` on every invocation. If absent → fresh start. If present → resume algorithm runs. |

---

## 1. Surface Name

`SessionStore` (state/checkpoint CRUD) + `CheckpointSink` (event-bus adapter).

**Why two names, not one:** per D-1 above. A single `SessionStore` with an `onEvent` method would couple it to the event bus and force every implementation to care about `BridgeEvent`. The sink is a *sink* — a thin transform from events to store calls. The store is the store.

## 2. Scope

**What flows (`SessionStore`):**
- `SessionSnapshot` — session state + pending budget + event cursor + opaque runtime state (agent)
- `Checkpoint` — append-only versioned snapshots per session
- Lease tokens (for idempotency)

**What flows (`CheckpointSink`):**
- `BridgeEvent` → `SessionStore.appendCheckpoint` (filtered by event type)

**Direction:**
- `SessionStore`: runtime ↔ adapter (bidirectional CRUD)
- `CheckpointSink`: event-bus → store (unidirectional)

**Frequency:**
- Session CRUD: 1–10 / minute at steady state, bursty on pact start/resume
- Checkpoint append: 1 / agent turn (default); up to 1 / bus event (if opted in)
- Replay queries: only on resume (cold path)

**Cardinality:**
- One `SessionStore` per app/container
- One `CheckpointSink` per bus
- Many sessions per store
- Many checkpoints per session (bounded ring)

## 3. Ownership

**Owner:** `@methodts/runtime` — defines the ports and the canonical `SessionSnapshot` / `Checkpoint` types.

**Producers (implementations):**
- `@methodts/agent-runtime` → `CortexSessionStore` (over `ctx.storage`)
- `@methodts/bridge` → `FsSessionStore` (over JSONL + `FileSystemProvider`); wraps the existing `SessionPersistenceStore` + extends it with checkpoint/lease semantics.

**Consumers:**
- `@methodts/pacta`: composition engine calls `SessionStore` at `ResumableMode` entry/exit.
- `@methodts/methodts`: strategy executor's `CheckpointPort` consumer migrates onto `SessionStore` (deprecating `CheckpointPort`, or wrapping it).
- `@methodts/bridge`: `domains/sessions` owns one `FsSessionStore`; `domains/strategies` uses another (or the same, keyed by `sessionKind`).
- `CheckpointSink` is registered by the composition root against `EventBus.registerSink(sink)`.

---

## 4. Port Interfaces

### 4.1 `SessionStore` — persistence port

```typescript
// packages/runtime/src/ports/session-store.ts

/**
 * SessionStore — persistence port for agent sessions and checkpoints.
 *
 * Owner: @methodts/runtime
 * Consumers: @methodts/pacta (ResumableMode), @methodts/methodts (strategy executor),
 *            @methodts/bridge (sessions + strategies domains), @methodts/agent-runtime
 * Producers: FsSessionStore (bridge JSONL+FS), CortexSessionStore (ctx.storage)
 * Direction: runtime ↔ adapter (CRUD + lease)
 * Co-designed: 2026-04-14 (FCD surface session `fcd-surface-session-store`)
 *
 * Contract invariants:
 *   I-1  load(sessionId) is idempotent; it never mutates state.
 *   I-2  resume(sessionId, workerId) acquires a lease; concurrent callers receive
 *        FENCED from that point until the lease expires or is released.
 *   I-3  appendCheckpoint rejects stale fencing tokens with FENCED.
 *   I-4  Checkpoints for a given session are totally ordered by `sequence`.
 *   I-5  The store never blocks emit of bus events — CheckpointSink is async.
 *   I-6  Implementations must not leak backend-specific types through this port.
 */
export interface SessionStore {
  // ── Session lifecycle ─────────────────────────────────────────

  /** Create a new session record. Throws DUPLICATE if sessionId exists. */
  create(snapshot: SessionSnapshot): Promise<void>;

  /** Load the latest snapshot or null. Pure read; no lease. */
  load(sessionId: string): Promise<SessionSnapshot | null>;

  /**
   * Resume a session. Atomically:
   *   (1) loads the latest snapshot + latest checkpoint,
   *   (2) acquires a lease owned by `workerId`,
   *   (3) returns a ResumeContext carrying a fencingToken.
   *
   * Idempotency: if a live lease is held by a different worker,
   * throws `SessionStoreError` with code=FENCED.
   *
   * If the caller's lease is still valid (same workerId), this is a no-op
   * re-fetch and the existing token is returned.
   */
  resume(sessionId: string, workerId: string, opts?: ResumeOptions): Promise<ResumeContext>;

  /** Release a lease early. Idempotent. */
  releaseLease(sessionId: string, fencingToken: string): Promise<void>;

  /**
   * Renew a lease before it expires. Throws FENCED if stolen.
   * Returns the new expiry timestamp.
   */
  renewLease(sessionId: string, fencingToken: string, ttlMs?: number): Promise<string>;

  // ── Checkpoint lifecycle ──────────────────────────────────────

  /**
   * Append a new checkpoint. Must carry a valid fencingToken from an
   * active lease held by this worker. Rejects stale tokens with FENCED.
   * Updates the snapshot's `latestCheckpointSequence` atomically.
   */
  appendCheckpoint(
    sessionId: string,
    checkpoint: Checkpoint,
    fencingToken: string,
  ): Promise<void>;

  /** Load a specific checkpoint or null. */
  loadCheckpoint(sessionId: string, sequence: number): Promise<Checkpoint | null>;

  /** Load the latest checkpoint or null. */
  loadLatestCheckpoint(sessionId: string): Promise<Checkpoint | null>;

  /**
   * List checkpoints for a session (most-recent first).
   * Bounded by `limit`; default 10.
   */
  listCheckpoints(sessionId: string, limit?: number): Promise<CheckpointMeta[]>;

  // ── Cleanup ───────────────────────────────────────────────────

  /**
   * Mark a session terminal. Sets status=dead/completed/failed, persists the
   * final snapshot, releases any held lease. Checkpoint ring is retained per
   * the store's retention policy.
   */
  finalize(sessionId: string, status: SessionStatus, reason?: string): Promise<void>;

  /** Remove a session and all its checkpoints. Irreversible. */
  destroy(sessionId: string): Promise<void>;
}
```

### 4.2 `CheckpointSink` — event-bus adapter

```typescript
// packages/runtime/src/ports/checkpoint-sink.ts

import type { BridgeEvent, EventSink, EventFilter } from '@methodts/bridge/ports/event-bus';
// (in practice re-exported from @methodts/runtime/ports/event-bus once the bus moves)

/**
 * CheckpointSink — adapts session-scoped BridgeEvents into SessionStore
 * checkpoint writes. Registered on the EventBus by the composition root.
 *
 * Replaces (and subsumes) bridge's current SessionCheckpointSink. The two
 * differences:
 *   1. writes go to SessionStore.appendCheckpoint, not save(PersistedSession)
 *   2. supports per-event opt-in via additional filters (D-3)
 *
 * Owner: @methodts/runtime
 * Producer: composition root (bridge server-entry, agent-runtime bootstrap)
 * Consumer: EventBus (via registerSink)
 */
export interface CheckpointSink extends EventSink {
  readonly name: 'session-checkpoint';

  /**
   * Subscribe to an additional per-event filter. Every event matching this
   * filter triggers an immediate checkpoint (bypasses the per-turn debouncer).
   * Use sparingly — each match is at least one store write.
   */
  checkpointOnEvent(filter: EventFilter): void;

  /**
   * Flush any debounced pending checkpoints. Call on shutdown and before
   * resume handoff.
   */
  flush(): Promise<void>;

  /** Pending debounce count (for tests / health). */
  readonly pendingCount: number;

  /** Release timers and in-flight state. */
  dispose(): void;
}

export interface CheckpointSinkOptions {
  store: SessionStore;
  /** Resolves current worker identity for fencing tokens. */
  workerId: () => string;
  /**
   * Builds the snapshot payload from a session id at checkpoint time.
   * Kept as a callback so the sink does not know about the session pool,
   * the strategy executor, or the agent runtime internals.
   */
  captureSnapshot: (sessionId: string) => Promise<Omit<Checkpoint, 'sequence' | 'createdAt' | 'schemaVersion'> | null>;
  /** Debounce window (ms). Default 200. */
  debounceMs?: number;
  /** Which event types cause a checkpoint. Default: SESSION_LIFECYCLE_TYPES. */
  defaultEventTypes?: string[];
}
```

### 4.3 Supporting types

```typescript
// packages/runtime/src/ports/session-store-types.ts

export type SessionStatus =
  | 'initializing'
  | 'running'
  | 'idle'
  | 'paused'      // lease held, waiting for event / human
  | 'suspended'   // no lease, waiting for JobQueue reinvocation
  | 'completed'
  | 'failed'
  | 'dead';

export interface SessionSnapshot {
  /** Envelope version. Current: 1. */
  readonly schemaVersion: 1;
  readonly sessionId: string;
  /** Stable id — appId in Cortex, workdir in bridge. */
  readonly scopeId: string;
  readonly pactRef: PactRef;
  readonly status: SessionStatus;
  readonly createdAt: string;   // ISO 8601
  readonly updatedAt: string;   // ISO 8601
  /** Sequence of the latest appended checkpoint, or null if none. */
  readonly latestCheckpointSequence: number | null;
  /** Human-readable nickname (optional; for UI). */
  readonly nickname?: string;
  /** Parent session for chained agents. */
  readonly parentSessionId?: string;
  /** Depth in the delegation chain; bridge + pacta both enforce caps here. */
  readonly depth: number;
  /** Free-form per-adapter metadata — opaque to consumers. */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Opaque reference to the pact that produced this session. Adapters store
 * verbatim; consumers re-inflate via a PactRegistry lookup.
 */
export interface PactRef {
  readonly id: string;
  readonly version: string;
  /** Hash of the resolved pact document — detects drift on resume. */
  readonly fingerprint: string;
}

export interface Checkpoint {
  readonly schemaVersion: 1;
  /** Monotonic per-session. Starts at 1. */
  readonly sequence: number;
  readonly sessionId: string;
  readonly createdAt: string;
  /**
   * Last event consumed/produced for this session. On resume, the runtime
   * replays any bus events with sequence > this.sequence.
   */
  readonly eventCursor: EventCursor;
  /**
   * Agent-runtime-opaque state: transcript tail, scratchpad handle, tool call
   * chain, etc. Schema is owned by whoever emits it — the store is a black box.
   */
  readonly agentState: AgentStateBlob;
  /**
   * Snapshot of budget reservation at time of checkpoint. Opaque handle plus
   * the fields the runtime needs to decide rehydrate vs re-reserve on resume.
   */
  readonly pendingBudget: BudgetReservation | null;
  /** Next action the runtime should take on resume. Advisory. */
  readonly nextAction: NextAction;
  /** Optional reason string. */
  readonly note?: string;
}

export interface CheckpointMeta {
  readonly sequence: number;
  readonly createdAt: string;
  readonly note?: string;
  readonly nextAction: NextAction;
}

export interface EventCursor {
  /** Monotonic bus sequence at time of checkpoint. */
  readonly sequence: number;
  /** Event id at cursor position (for exact-match verification). */
  readonly id: string;
}

/**
 * Opaque blob from the agent's perspective. The adapter stores it; the
 * runtime parses it. Large blobs (>16KB recommended threshold) should be
 * written to an external blob ref instead — the adapter decides.
 */
export type AgentStateBlob =
  | { readonly kind: 'inline'; readonly data: Record<string, unknown> }
  | { readonly kind: 'blob-ref'; readonly ref: string; readonly sizeBytes: number };

export interface BudgetReservation {
  /** Opaque handle issued by ctx.llm.reserve() or local BudgetEnforcer. */
  readonly handle: string;
  /** ISO 8601 — when the reservation expires if not consumed. */
  readonly expiresAt: string;
  /** Reservation amounts (USD + tokens) for fresh-reserve path. */
  readonly amount: { readonly usd: number; readonly tokens: number };
  /** Issuer tag — 'ctx.llm' | 'bridge/cost-governor' | ... */
  readonly issuer: string;
}

export type NextAction =
  | { readonly kind: 'await-prompt' }
  | { readonly kind: 'continue-turn'; readonly pendingToolCalls?: string[] }
  | { readonly kind: 'await-human-approval'; readonly gateId: string }
  | { readonly kind: 'await-schedule'; readonly wakeAt: string }
  | { readonly kind: 'terminal'; readonly status: SessionStatus };

export interface ResumeOptions {
  /** Requested lease TTL in ms. Store may clamp. Default 30_000. */
  readonly leaseTtlMs?: number;
  /** If true, require the pact fingerprint to match. Default true. */
  readonly requireFingerprint?: boolean;
}

export interface ResumeContext {
  readonly snapshot: SessionSnapshot;
  readonly checkpoint: Checkpoint | null;   // null for fresh sessions
  readonly fencingToken: string;
  readonly leaseExpiresAt: string;
  /**
   * Events the runtime is expected to replay (bus sequence > cursor).
   * The store does not own event storage — this field is populated only if
   * an EventReader was wired at store construction; otherwise undefined and
   * the caller is responsible for replay coordination.
   */
  readonly replayHint?: { readonly fromSequence: number; readonly fromEventId: string };
}
```

### 4.4 Error model

```typescript
// packages/runtime/src/ports/session-store-errors.ts

export type SessionStoreErrorCode =
  | 'NOT_FOUND'              // no such session / checkpoint
  | 'DUPLICATE'              // create() collision
  | 'FENCED'                 // stale fencing token / lease stolen
  | 'LEASE_EXPIRED'          // lease TTL passed before renew
  | 'SCHEMA_INCOMPATIBLE'    // snapshot.schemaVersion unknown to adapter
  | 'FINGERPRINT_MISMATCH'   // pact drifted since last checkpoint
  | 'QUOTA_EXCEEDED'         // adapter-specific (Mongo quota, disk full)
  | 'BACKEND_UNAVAILABLE'    // transient — caller should retry with backoff
  | 'CORRUPT_SNAPSHOT'       // failed integrity check (hash / JSON parse)
  | 'INTERNAL';              // unknown; implementers must be specific when possible

export class SessionStoreError extends Error {
  readonly code: SessionStoreErrorCode;
  readonly sessionId?: string;
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(code: SessionStoreErrorCode, message: string, opts: {
    sessionId?: string;
    retryable?: boolean;
    cause?: unknown;
  } = {}) {
    super(message);
    this.name = 'SessionStoreError';
    this.code = code;
    this.sessionId = opts.sessionId;
    this.retryable = opts.retryable ?? (code === 'BACKEND_UNAVAILABLE');
    this.cause = opts.cause;
  }
}

/** Type guard for catch blocks that cross the HTTP boundary. */
export function isSessionStoreError(e: unknown): e is SessionStoreError {
  return e instanceof Error && (e as SessionStoreError).name === 'SessionStoreError'
    && typeof (e as SessionStoreError).code === 'string';
}
```

---

## 5. Checkpoint Schema (persisted envelope)

Backend-neutral JSON. Adapters may store as BSON (Cortex) or JSONL line (bridge).

```jsonc
// Snapshot envelope
{
  "schemaVersion": 1,
  "sessionId": "ses_01HZY...",
  "scopeId": "app_incidents_bot",            // appId in Cortex, workdir path in bridge
  "pactRef": { "id": "incident-triage", "version": "1.0.0", "fingerprint": "sha256:..." },
  "status": "paused",
  "createdAt": "2026-04-14T18:22:01.003Z",
  "updatedAt": "2026-04-14T18:24:17.441Z",
  "latestCheckpointSequence": 7,
  "nickname": "triage-#98712",
  "parentSessionId": null,
  "depth": 1,
  "metadata": { "workerId": "worker-03" },   // adapter-scoped; not part of contract
  "_lease": {                                 // adapter-internal; not on SessionSnapshot type
    "workerId": "worker-03",
    "fencingToken": "ft_...",
    "acquiredAt": "2026-04-14T18:24:17.441Z",
    "expiresAt":  "2026-04-14T18:24:47.441Z"
  }
}

// Checkpoint envelope (one per sequence)
{
  "schemaVersion": 1,
  "sessionId": "ses_01HZY...",
  "sequence": 7,
  "createdAt": "2026-04-14T18:24:17.441Z",
  "eventCursor": { "sequence": 42871, "id": "evt_01HZY..." },
  "agentState": { "kind": "inline", "data": { "transcriptTail": "...", "toolChain": [] } },
  "pendingBudget": {
    "handle": "rsv_...",
    "expiresAt": "2026-04-14T18:29:17.441Z",
    "amount": { "usd": 0.12, "tokens": 8000 },
    "issuer": "ctx.llm"
  },
  "nextAction": { "kind": "continue-turn", "pendingToolCalls": ["tc_3"] },
  "note": "after tool fan-out"
}
```

**Versioning rule:** `schemaVersion` is bumped only for breaking changes. Additive fields remain on v1 but MUST be optional. Future v2 requires a new FCD-surface session and a migration path adapter.

---

## 6. Resume Algorithm

Given `sessionId` and `workerId`, on `ResumableMode` entry:

1. **Load & lease.** Call `store.resume(sessionId, workerId)`. Adapter atomically:
   - Reads the session snapshot. If absent → throw `NOT_FOUND` (caller falls back to `create()` for a fresh start).
   - Reads the latest checkpoint.
   - If an active lease exists with a different `workerId` and not expired → throw `FENCED`.
   - Else writes a new lease `{ workerId, fencingToken, expiresAt }` via an atomic upsert keyed on `(sessionId, current leaseVersion)`. Returns `ResumeContext`.
2. **Verify fingerprint.** If `opts.requireFingerprint !== false` and `snapshot.pactRef.fingerprint !== currentPact.fingerprint` → throw `FINGERPRINT_MISMATCH`. Runtime policy decides whether to cancel (safe), coerce (with audit), or escalate.
3. **Rehydrate budget.** Pass `checkpoint.pendingBudget` to the runtime's `BudgetEnforcer`:
   - If `expiresAt > now + safetyMargin` and issuer reachable → **rehydrate**: reuse the handle.
   - Else → **cancel** old reservation (best-effort), then `ctx.llm.reserve(amount)` to obtain a fresh handle. Update next checkpoint with the new handle.
4. **Replay events.** Starting at `checkpoint.eventCursor.sequence + 1`, replay bus events matching `{ sessionId }` into any consumers the runtime has re-registered (e.g., reconnected WS client). Uses `EventBus.query(filter, { since: cursor.id })`. This is replay to *consumers*, not to the agent — the agent's own state is in `agentState`.
5. **Start lease heartbeat.** Schedule `renewLease(sessionId, fencingToken)` at `leaseTtlMs / 3`. Every checkpoint write refreshes the lease implicitly. If renewal fails with `FENCED` → the runtime immediately aborts the current turn and surfaces the error.

On successful resume, the runtime dispatches `snapshot.nextAction`:
- `await-prompt` → accept the next prompt.
- `continue-turn` → replay `pendingToolCalls` (idempotency is the tool's responsibility; runtime MUST pass `fencingToken` to tool metadata so duplicate invocations can be detected).
- `await-human-approval` → re-emit `strategy.gate.awaiting_approval` to the bus with the stored gateId.
- `await-schedule` → no-op; `ctx.jobs` re-invokes at `wakeAt`.
- `terminal` → release lease, no-op.

---

## 7. Idempotency & Lease Mechanism

**Primary invariant:** At most one worker holds an active lease on a session at any instant.

**Mechanism:**
- **Fencing token:** random 128-bit string issued at lease acquisition.
- **Atomic acquisition:** adapter's responsibility. In Mongo: `findOneAndUpdate` with a filter `{ _id: sessionId, $or: [ { _lease: null }, { '_lease.expiresAt': { $lt: now } }, { '_lease.workerId': workerId } ] }` and `$set` of the new lease. In FS: lockfile via `fs.open(..., 'wx')` + lease JSON; PID-based stale detection via `kill -0` / equivalent.
- **All mutating calls check the token.** `appendCheckpoint`, `renewLease`, `releaseLease`, `finalize` all require `fencingToken` and reject stale/mismatched tokens with `FENCED`.
- **Tool-call idempotency:** tools invoked during a resumed turn receive the `fencingToken` as part of their invocation metadata. Side-effecting tools (notify, audit, external API) MUST persist a mark keyed on `(fencingToken, toolCallId)` before execution and short-circuit on replay. This is a *contract with tools*, not enforced by the port — the port guarantees at most one active worker; tools guarantee at most once per invocation id.
- **No distributed consensus required.** The Cortex adapter leans on Mongo's single-document atomicity. The FS adapter is single-host only (documented limitation; federated bridge nodes use `@methodts/cluster` for session pinning).

**Failure modes:**
- Worker crashes holding a lease → lease expires after `leaseTtlMs`; next `resume()` acquires cleanly.
- Network partition during a tool call → the tool's idempotency mark prevents double side-effect; resume replays the pending call; tool sees the mark and short-circuits.
- Two workers issued by a buggy scheduler → the second `resume()` returns `FENCED`; scheduler must back off.

---

## 8. Error Model (summary)

| Code | Retryable | Typical caller action |
|---|---|---|
| `NOT_FOUND` | no | fall back to `create()` or surface to user |
| `DUPLICATE` | no | UUID collision — regenerate or escalate |
| `FENCED` | no | abort this worker; let the other finish |
| `LEASE_EXPIRED` | yes | re-call `resume()` to reacquire |
| `SCHEMA_INCOMPATIBLE` | no | operator intervention — runtime must refuse to continue |
| `FINGERPRINT_MISMATCH` | no | policy decision; default = abort with escalation |
| `QUOTA_EXCEEDED` | no | surface to tenant app; may require PRD-069 quota raise |
| `BACKEND_UNAVAILABLE` | yes | exponential backoff (adapter may itself retry first) |
| `CORRUPT_SNAPSHOT` | no | operator intervention; consider demoting session to dead |
| `INTERNAL` | no | log + escalate |

HTTP boundary mapping: `FENCED`/`LEASE_EXPIRED` → 409; `NOT_FOUND` → 404; `QUOTA_EXCEEDED` → 402; `BACKEND_UNAVAILABLE` → 503; `SCHEMA_INCOMPATIBLE` → 412; others → 500.

---

## 9. Adapter Sketches (signatures only)

### 9.1 `CortexSessionStore` (@methodts/agent-runtime)

Backed by `ctx.storage` per PRD-064. Two collections per app: `session_snapshots` and `session_checkpoints`.

```typescript
// packages/agent-runtime/src/adapters/cortex-session-store.ts

import type { CortexContext } from '@t1/cortex-sdk';   // ctx.storage.collection(...)
import type {
  SessionStore, SessionSnapshot, Checkpoint, CheckpointMeta,
  ResumeContext, ResumeOptions, SessionStatus,
} from '@methodts/runtime/ports/session-store';

export interface CortexSessionStoreOptions {
  readonly ctx: Pick<CortexContext, 'storage'>;
  readonly snapshotCollection?: string;     // default 'method_session_snapshots'
  readonly checkpointCollection?: string;   // default 'method_session_checkpoints'
  readonly checkpointRingSize?: number;     // default 10
  readonly defaultLeaseTtlMs?: number;      // default 30_000
  /** Optional blob sink for oversized agent state. */
  readonly blobRefWriter?: (sessionId: string, payload: unknown) => Promise<string>;
}

export declare function createCortexSessionStore(
  opts: CortexSessionStoreOptions,
): SessionStore;

/**
 * Index declarations (manifest-level, PRD-064 §6.3):
 *   method_session_snapshots: [{ fields: ['sessionId'], unique: true }]
 *   method_session_checkpoints: [
 *     { fields: ['sessionId', 'sequence'], unique: true },
 *     { fields: ['sessionId', 'createdAt'], direction: -1 },
 *   ]
 * Quota: bounded by PRD-069 app quota. Ring retention via TTL on _retireAt.
 */
```

Atomicity: single-doc `findOneAndUpdate` on snapshot for lease CAS. Checkpoint append is a two-step compound: insert into checkpoints, then update `snapshot.latestCheckpointSequence` — acceptable because concurrent appends are impossible under the lease invariant.

### 9.2 `FsSessionStore` (@methodts/bridge / existing persistence)

Thin wrapper over the existing `SessionPersistenceStore` + new per-session checkpoint JSONL. Lives at `.method/sessions/<sessionId>/`:
- `snapshot.json` (atomic write via `.tmp` + rename)
- `checkpoints.jsonl` (append-only, one line per checkpoint)
- `lease.json` (acquired via `fs.open('.lease.lock', 'wx')` + PID stamp)

```typescript
// packages/bridge/src/domains/sessions/fs-session-store.ts

import type { FileSystemProvider } from '../../ports/file-system.js';
import type { SessionStore } from '@methodts/runtime/ports/session-store';

export interface FsSessionStoreOptions {
  readonly baseDir: string;                 // e.g., <projectRoot>/.method
  readonly fs: FileSystemProvider;
  readonly checkpointRingSize?: number;     // default 10
  readonly defaultLeaseTtlMs?: number;      // default 30_000
  /** For stale-lease detection. Defaults to process.pid. */
  readonly currentPid?: number;
  /** Optional clock for tests. */
  readonly now?: () => Date;
}

export declare function createFsSessionStore(
  opts: FsSessionStoreOptions,
): SessionStore;

/**
 * Layout (per session):
 *   .method/sessions/<sessionId>/
 *     snapshot.json          # latest snapshot (atomic)
 *     checkpoints.jsonl      # append-only ring (rotated at ringSize × 2)
 *     lease.json             # { workerId, pid, fencingToken, expiresAt }
 *     lease.lock             # fs.open(..., 'wx') sentinel
 *     blobs/<hash>.bin       # optional, if AgentStateBlob.kind === 'blob-ref'
 *
 * Retention: checkpoints.jsonl is rotated once length exceeds ringSize*2; oldest
 * half copied to checkpoints-<ISO>.jsonl.gz (or dropped if !retain).
 */
```

Migration: existing `SessionPersistenceStore` stays in place for non-checkpoint session index data. `FsSessionStore` supersedes `SessionCheckpointSink`'s writes. The two coexist during Phase 3 of PRD-061 migration; the `SessionPersistenceStore.save(PersistedSession)` path becomes a derived projection of `FsSessionStore`'s snapshot for backward compat.

---

## 10. Relation to Existing Infrastructure

| Existing | Relation to `SessionStore` |
|---|---|
| `packages/pacta/src/ports/memory-port.ts` (`MemoryPort` v1/v2/v3) | **Separate port.** Agent working memory (FactCards, CLS). Not folded in — D-2. Adapters may share a Mongo connection but types remain distinct. |
| `packages/bridge/src/domains/sessions/session-persistence.ts` (`SessionPersistenceStore`) | **Partially superseded.** The session *index* stays; the per-session checkpointing moves into `FsSessionStore`. Bridge UI continues to read the index. |
| `packages/bridge/src/shared/event-bus/session-checkpoint-sink.ts` (`SessionCheckpointSink`) | **Superseded** by the new `CheckpointSink` port implementation. Existing debounce semantics are preserved. |
| `packages/bridge/src/ports/checkpoint.ts` (`CheckpointPort` — Build Orchestrator) | **Overlap, kept for now.** `CheckpointPort` is a higher-level, pipeline-specific port (PipelineCheckpoint, Phase enum). It will be re-implemented *on top of* `SessionStore` in PRD-062; the Build Orchestrator's caller surface does not change. |
| `packages/pacta/src/modes/execution-mode.ts` (`ResumableMode`) | **Trigger.** `pact.mode = { type: 'resumable', sessionId }` is what causes a runtime to call `SessionStore.resume()`. No change to the mode type. |
| `@methodts/bridge` event bus (`EventBus` in `packages/bridge/src/ports/event-bus.ts`) | **Dependency.** `CheckpointSink` is an `EventSink`. Event bus must move (or be re-exported) to `@methodts/runtime` as part of PRD-057. |

---

## 11. Producer / Consumer Map

**Producer (owner, types):** `@methodts/runtime`
- `packages/runtime/src/ports/session-store.ts` (planned — post PRD-057 extraction)
- `packages/runtime/src/ports/checkpoint-sink.ts`
- `packages/runtime/src/ports/session-store-types.ts`
- `packages/runtime/src/ports/session-store-errors.ts`

**Producers (implementations):**
- `@methodts/agent-runtime` → `packages/agent-runtime/src/adapters/cortex-session-store.ts` (CortexSessionStore)
- `@methodts/bridge` → `packages/bridge/src/domains/sessions/fs-session-store.ts` (FsSessionStore)
- `@methodts/runtime` → `packages/runtime/src/sinks/checkpoint-sink-impl.ts` (default CheckpointSink)

**Consumers:**
- `@methodts/pacta` composition engine — at `ResumableMode` entry/exit and after every `step()`.
- `@methodts/methodts` strategy executor — checkpointing between strategy phases (migrates from `CheckpointPort`).
- `@methodts/bridge` composition root — wires `FsSessionStore` + registers `CheckpointSink` on the bus.
- `@methodts/agent-runtime` composition root — wires `CortexSessionStore` + registers `CheckpointSink`.

Wiring pattern: constructor injection from the composition root; no package imports the adapter directly.

---

## 12. Gate Assertion

```typescript
// In architecture.test.ts — SessionStore co-design assertion

describe('G-BOUNDARY / G-PORT — SessionStore', () => {
  it('consumers import SessionStore only from @methodts/runtime ports', () => {
    const violations = scanImports(
      ['packages/pacta/src', 'packages/methodts/src', 'packages/bridge/src', 'packages/agent-runtime/src'],
      // disallow: direct imports of the concrete adapters from non-composition-root files
      /from ['"].*(fs-session-store|cortex-session-store)(\.js)?['"]/,
      { except: ['server-entry.ts', 'agent-runtime/src/bootstrap.ts', 'fs-session-store.ts', 'cortex-session-store.ts'] },
    );
    expect(violations).toEqual([]);
  });

  it('SessionStore port file contains no backend-specific types', () => {
    const src = readFileSync('packages/runtime/src/ports/session-store.ts', 'utf-8');
    expect(src).not.toMatch(/mongodb|bson|fs\.(readFile|writeFile|stat)/i);
    expect(src).not.toMatch(/\bany\b(?![a-zA-Z_])/);
  });

  it('CheckpointSink is registered via EventBus.registerSink, never constructed in domain code', () => {
    const violations = scanImports(
      ['packages/pacta/src', 'packages/methodts/src', 'packages/bridge/src/domains'],
      /new\s+CheckpointSink\(/,
      { except: [] },
    );
    expect(violations).toEqual([]);
  });
});
```

---

## 13. Agreement

- **Frozen:** 2026-04-14
- **Changes require:** a new `/fcd-surface` session (additive) or a breaking-change co-design with migration plan
- **Related PRD:** 061 (`CortexSessionStore` + checkpoint resume contract) — this record is the port grammar 061 implements.
- **Depends on (sibling surfaces):** `MethodAgentPort` (fcd-surface-method-agent-port), `@methodts/runtime` package boundary (fcd-surface-runtime-package-boundary), Cortex `AppStorage` Surface 12.7 (already frozen).
