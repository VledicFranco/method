---
type: co-design-record
surface: "CortexMethodologySource"
slug: fcd-surface-methodology-source
date: "2026-04-14"
owner: "@method/agent-runtime (new L3, PRD-058 / PRD-064 follow-on)"
producer: "@method/agent-runtime"
consumer: "@method/runtime (via frozen MethodologySource port) + Cortex admin UI (via PlatformMethodologyApi)"
direction: "agent-runtime ← Cortex ctx.storage (load) + agent-runtime ← ctx.events (invalidation) + admin-UI → agent-runtime (curation)"
status: frozen
mode: extension
related:
  - docs/roadmap-cortex-consumption.md §4.2 item 11
  - PRD-064 (implementation container)
  - PRD-058 (@method/agent-runtime)
  - .method/sessions/fcd-surface-runtime-package-boundary/decision.md §3.1, §14 Q3
  - packages/bridge/src/ports/methodology-source.ts (existing port)
  - packages/bridge/src/ports/stdlib-source.ts (existing stdlib impl)
  - docs/arch/methodology-source.md
  - ../../t1-repos/t1-cortex-1/docs/prds/064-app-storage-service.md (ctx.storage port)
  - ../../t1-repos/t1-cortex-1/docs/prds/072-events-service.md (ctx.events — manifest-only subscriptions)
---

# Co-Design Record — CortexMethodologySource

## 1. Context & Framing

Today the `MethodologySource` port (frozen, moves to `@method/runtime/ports` per
RuntimePackageBoundary FCD) has one production implementation: `StdlibSource`,
which wraps the compiled `@method/methodts` stdlib catalog. Zero I/O, zero
substitutability value beyond the port seam.

Cortex tenant apps break that world:

- **Per-app curation.** Each Cortex tenant app may bring its own curated set of
  methodologies (e.g. the incidents-bot exposes only `P-GH` + `P-INCIDENT`;
  the feature-dev agent exposes only `P2-SD`). Admins curate via the Cortex
  admin UI.
- **Persistence layer.** Curation state lives in the tenant app's per-app
  MongoDB (PRD-064 `ctx.storage`) — not on disk, not in the bundled registry.
- **Hot-reload.** An admin edits a methodology in the UI; the running agent
  runtime must pick it up without a redeploy.
- **Inheritance.** Most apps don't want to author methodologies from scratch —
  they want to **start from the stdlib catalog** (P0-META, P1-EXEC, P2-SD, …)
  and **override a subset** per-app.

This FCD extends `MethodologySource` with a curation/admin dimension and
defines a Cortex-backed implementation (`CortexMethodologySource`) plus the
admin-UI contract (`PlatformMethodologyApi`, follow-on PRD).

### Invariant: theory is the source of truth

Per `.method/project-card.yaml` DR-01/DR-02, registry YAML files are production
artifacts and the stdlib catalog is the source of truth for authored
methodologies. Per-app curation does **not** forge new methodologies out of
thin air — it **selects and overrides** already-compiled ones. A Cortex app
that wants a never-before-seen methodology must compile it through the
existing G1-G6 pipeline first (authoring lives outside this surface).

### Layer placement

```
L4   Cortex admin-UI (tenant-facing webapp)
     │
     │ HTTP ──→ PlatformMethodologyApi (new Cortex platform route)
     │
L3   @method/agent-runtime                ← NEW consumer
     │   CortexMethodologySource (impl of MethodologySource)
     │   ├─ reads  ctx.storage (PRD-064)
     │   ├─ listens ctx.events (PRD-072) — one declared type
     │   └─ falls back to bundled StdlibSource (inheritance)
     │
     │ implements
     ▼
L3   @method/runtime/ports                ← EXISTING frozen port (extended)
     MethodologySource
```

No cycle. `@method/runtime` stays zero-transport, zero-Cortex. The Cortex
binding happens entirely inside `@method/agent-runtime`.

---

## 2. Port Extension — `MethodologySource`

The existing three-method synchronous port is preserved as the **fast read
path**. Two additive extensions are frozen here:

1. **Lifecycle methods** (`init`, `reload`, `close`) — opt-in; default
   no-ops for `StdlibSource`.
2. **Change notification** (`onChange`) — opt-in; `StdlibSource` never emits.

```typescript
// packages/runtime/src/ports/methodology-source.ts  (after PRD-057 move)

import type { CatalogMethodologyEntry } from '@method/methodts/stdlib';
import type { Method, Methodology } from '@method/methodts';

/**
 * Port interface for methodology data access.
 *
 * Core reads (list/getMethod/getMethodology) are SYNCHRONOUS — the hot
 * path on every runtime tick. Implementations MUST maintain an in-memory
 * cache; network I/O happens only in init/reload.
 *
 * Owner:     @method/runtime
 * Consumers: @method/bridge (via StdlibSource), @method/agent-runtime
 *            (via CortexMethodologySource), tests (via InMemorySource)
 * Co-designed: 2026-04-14
 */
export interface MethodologySource {
  // ── Core reads (unchanged; synchronous) ────────────────────────
  list(): CatalogMethodologyEntry[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMethod(methodologyId: string, methodId: string): Method<any> | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMethodology(methodologyId: string): Methodology<any> | undefined;

  // ── Lifecycle (optional; StdlibSource no-ops) ──────────────────
  /**
   * Hydrate the in-memory cache. Called once by the composition root
   * before the runtime serves requests. Stdlib: no-op.
   * Cortex:   reads ctx.storage, resolves stdlib inheritance, validates.
   */
  init?(): Promise<void>;

  /**
   * Force a full or targeted cache rebuild. Called by the webhook route
   * on admin edits, or by the ctx.events handler when a methodology is
   * mutated. If methodologyId is omitted, rebuild the whole cache.
   */
  reload?(methodologyId?: string): Promise<void>;

  /**
   * Subscribe to in-process invalidation events. Runtime consumers that
   * cache derived state (e.g. MethodologySessionStore) listen to this to
   * drop stale routing decisions. Returns an unsubscribe function.
   * StdlibSource never emits.
   */
  onChange?(listener: (change: MethodologyChange) => void): () => void;

  /** Release long-lived resources (DB connections, event subscriptions). */
  close?(): Promise<void>;
}

/** Payload delivered to onChange listeners. */
export type MethodologyChange =
  | { kind: 'added';    methodologyId: string; version: string }
  | { kind: 'updated';  methodologyId: string; version: string; previousVersion: string }
  | { kind: 'removed';  methodologyId: string }
  | { kind: 'reloaded'; reason: 'full' | 'bulk-admin-edit' };
```

**Minimality audit.** Every method justified by a concrete consumer path:

| Method | Consumer path |
|---|---|
| `list` | MCP `methodology_list` tool; admin UI's "installed methodologies" view via agent-runtime introspection endpoint. |
| `getMethod` | Runtime's step loader (`MethodologyRouter`). |
| `getMethodology` | Runtime's methodology start path; `compileMethod` verification on write (Cortex side). |
| `init` | Cortex composition root must hydrate before the first request. Stdlib no-ops. |
| `reload` | Admin UI edit → PlatformMethodologyApi → `source.reload(id)`. Also the fallback path if ctx.events is unavailable. |
| `onChange` | `MethodologySessionStore` drops cached routing decisions for a modified methodology. Without this, an in-flight session keeps running on stale definitions. |
| `close` | Graceful shutdown (Mongo pool release, SQS subscription close). |

`StdlibSource` adds trivial no-op stubs for all four optional methods.

---

## 3. `CortexMethodologySource` — TypeScript Surface

```typescript
// packages/agent-runtime/src/methodology/cortex-methodology-source.ts

import type {
  MethodologySource,
  MethodologyChange,
} from '@method/runtime/ports';
import type { CatalogMethodologyEntry } from '@method/methodts/stdlib';
import type { Method, Methodology } from '@method/methodts';
import { StdlibSource } from '@method/runtime/ports';   // fallback/inheritance

/** Cortex platform ports the source needs. Injected at composition root. */
export interface CortexMethodologySourceDeps {
  /** PRD-064 storage for the `methodologies` and `methodology_policy` collections. */
  storage: CortexStoragePort;
  /** PRD-072 events — must have `methodology.updated` declared in manifest.requires.events.on[]. */
  events: CortexEventsPort;
  /** The tenant's appId — scopes storage and filters events. */
  appId: string;
  /**
   * Inheritance mode for this app. Default: 'stdlib-plus-overrides'.
   *   - 'stdlib-plus-overrides' : start from stdlib, per-app docs override by id.
   *   - 'per-app-only'          : stdlib is invisible; only per-app docs serve.
   *   - 'stdlib-read-only'      : per-app writes disallowed; fully delegates to stdlib.
   */
  inheritance?: 'stdlib-plus-overrides' | 'per-app-only' | 'stdlib-read-only';
  /** Logger; defaults to console. */
  logger?: Pick<Console, 'warn' | 'error' | 'info'>;
}

export class CortexMethodologySource implements MethodologySource {
  constructor(deps: CortexMethodologySourceDeps);

  // Core reads — synchronous, served from in-memory cache.
  list(): CatalogMethodologyEntry[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMethod(methodologyId: string, methodId: string): Method<any> | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMethodology(methodologyId: string): Methodology<any> | undefined;

  // Lifecycle.
  init(): Promise<void>;
  reload(methodologyId?: string): Promise<void>;
  onChange(listener: (c: MethodologyChange) => void): () => void;
  close(): Promise<void>;

  /**
   * Admin write path — exposed to PlatformMethodologyApi only (internal
   * runtime code uses the read-only MethodologySource surface).
   * Runs load-time gate validation (§6) before persisting.
   */
  upsert(doc: MethodologyDocumentInput): Promise<MethodologyDocument>;
  remove(methodologyId: string): Promise<void>;
  setPolicy(policy: MethodologyPolicy): Promise<void>;
  getPolicy(): Promise<MethodologyPolicy>;
}
```

### 3.1 — Cortex-side port shims (consumed, not produced here)

To keep `@method/agent-runtime` decoupled from Cortex SDK types, the surface
defines **minimal structural interfaces** over what it actually uses. The
Cortex SDK is adapted into these at the agent-runtime composition root.

```typescript
/** Subset of ctx.storage (PRD-064 §6.5) used by the methodology source. */
export interface CortexStoragePort {
  collection<T extends { [k: string]: unknown } = { [k: string]: unknown }>(
    name: string,
  ): {
    findOne(filter: Filter): Promise<T | null>;
    find(filter: Filter, options?: FindOptions): Promise<T[]>;
    insertOne(doc: T): Promise<{ insertedId: string }>;
    updateOne(filter: Filter, update: Update): Promise<UpdateOutcome>;
    deleteOne(filter: Filter): Promise<DeleteOutcome>;
    createIndex(spec: IndexSpec): Promise<{ name: string }>;
  };
}

/** Subset of ctx.events (PRD-072) — manifest-declared subscription only. */
export interface CortexEventsPort {
  /** Handler for the one declared event type; DLQ on throw. */
  on<P>(type: 'methodology.updated', handler: (envelope: EventEnvelope<P>) => Promise<void>): void;
  /** Emit (admin writes emit one of these; runtime does not). */
  emit<P>(type: 'methodology.updated', payload: P): Promise<void>;
}
```

Only the **two event types used by this surface** (`methodology.updated`)
are contracted; the full `ctx.events` shape is not redeclared.

---

## 4. Document Schema — Mongo Collections

Methodology YAMLs are 2-10 KB each; hundreds per app (roadmap §8 Q3). Stored
as **whole documents per methodology** (with an embedded method list), not
decomposed into step/predicate documents.

**Rationale for whole-document shape:**
- Compilation gates (G1-G6) run over a complete `Method<S>`. Decomposing would
  force an in-memory re-assembly before every `getMethodology()` call, and
  multi-document reads break PRD-064's minimal port (`find` is capped at 1000
  docs and has no transactions in v1).
- A 10 KB document is an order of magnitude below Mongo's 16 MB BSON limit
  and ~100× cheaper than a multi-doc fetch.
- Admin UI edits are methodology-scoped; a whole-doc write matches the user
  action.

### 4.1 — `methodologies` collection

```typescript
// Types (TypeScript view — Scala side binds via BSON round-trip).
export interface MethodologyDocument {
  _id: string;                          // == methodologyId, e.g. "P2-SD"
  methodologyId: string;                // redundant with _id; convenience
  version: string;                      // semver — bumps on every admin write
  source: 'stdlib-pinned' | 'per-app';  // stdlib-pinned = frozen snapshot of stdlib entry
  parent?: {                            // only when source === 'stdlib-pinned'
    methodologyId: string;              // usually equal to methodologyId
    stdlibVersion: string;              // stdlib catalog version at pin time
  };
  status: 'compiled' | 'draft' | 'deprecated';
  // Full YAML payload — the exact text the admin edited, so round-trip
  // preserves comments and ordering. Compilation runs against the parsed
  // view at write time; the parsed view is cached separately in memory,
  // not persisted (avoids double-source-of-truth).
  yaml: string;
  // Extracted metadata — duplicated for cheap list() queries without a parse.
  metadata: {
    name: string;
    description: string;
    methods: Array<{
      methodId: string;
      name: string;
      description: string;
      stepCount: number;
      status: 'compiled' | 'draft';
      version: string;
    }>;
  };
  // Last compilation report. Persisted so admin UI shows gate status without
  // re-running gates on every view.
  compilationReport: {
    overall: 'compiled' | 'failed' | 'needs_review';
    gates: Array<{ gate: string; status: 'pass' | 'fail' | 'needs_review'; details: string }>;
    compiledAt: string;               // ISO-8601
    methodtsVersion: string;          // pin of @method/methodts at compile time
  };
  // Audit fields (Cortex standard).
  createdAt: string;
  createdBy: string;                    // userId from ctx.audit
  updatedAt: string;
  updatedBy: string;
}

export interface MethodologyDocumentInput {
  methodologyId: string;
  yaml: string;                         // only input the admin provides
  // source/version/compilationReport/metadata all derived server-side.
}
```

**Indexes (declared in manifest `requires.storage.indexes`):**

```yaml
- collection: methodologies
  fields: [ { name: methodologyId, direction: Asc } ]
  unique: true
  name: idx_methodology_id
- collection: methodologies
  fields: [ { name: status, direction: Asc } ]
  name: idx_status
```

### 4.2 — `methodology_policy` collection (per-app singleton)

One document per app, keyed on a fixed `_id: "policy"`:

```typescript
export interface MethodologyPolicy {
  _id: 'policy';
  inheritance: 'stdlib-plus-overrides' | 'per-app-only' | 'stdlib-read-only';
  // Whitelist: when present, only these methodologyIds are visible to the app.
  // Applied AFTER merging stdlib + per-app. Empty array === deny all; omit key
  // to allow all.
  enabledMethodologies?: string[];
  // Route hints — seed data for MethodologyRouter (§7).
  defaultMethodologyId?: string;
  roleToMethodology?: Record<string, string>; // role id → methodologyId
  stdlibPin?: string;                          // exact stdlib catalog version
  updatedAt: string;
  updatedBy: string;
}
```

**Why a separate collection?** Isolating policy from per-methodology docs lets
admin UI fetch the whole policy in one `findOne({ _id: 'policy' })` and
atomically update it; mixing it with methodology docs would need a transaction
(not available in PRD-064 v1).

### 4.3 — Collection-name conventions

Both names (`methodologies`, `methodology_policy`) pass PRD-064's
`CollectionName` regex (`^[A-Za-z][A-Za-z0-9_-]{0,63}$`) and avoid the
`system.` prefix.

---

## 5. Hot-Reload Contract

Two complementary triggers drive cache invalidation — **explicit `reload()`
on admin writes** (fast, in-process) and **`ctx.events` subscription** (for
multi-replica fan-out).

### 5.1 — Trigger path (authoritative)

```
Admin UI
   │ PATCH /v1/platform/methodologies/:id    (PlatformMethodologyApi)
   ▼
Cortex API route handler
   │ 1. resolve caller → appId
   │ 2. delegate to CortexMethodologySource.upsert(input)
   │       a. parse YAML (js-yaml)
   │       b. run load-time gates (§6): G1 parse + G3 roles + G4 DAG
   │          + G6 serializability. Reject on fail.
   │       c. ctx.storage.collection('methodologies').updateOne({ _id }, { $set: doc })
   │       d. bump version
   │       e. ctx.events.emit('methodology.updated', { appId, methodologyId, version })
   │ 3. respond 200 + new doc
   ▼
Cortex SNS/SQS fan-out to every running replica of the agent app
   │
   ▼
CortexMethodologySource.#onMethodologyUpdated(envelope)    (ctx.events subscription)
   │ if envelope.appId !== this.appId  → drop
   │ if envelope.version <= cache[id].version → drop (stale retry, PRD-072 at-least-once)
   │ this.reload(envelope.methodologyId)                      (re-read from storage)
   │ emit MethodologyChange { kind: 'updated', ... } via onChange()
   ▼
Runtime consumers (MethodologySessionStore, active sessions)
   │ drop cached routing; in-flight sessions finish on old version (no mid-run swap)
```

### 5.2 — Why both? Why not just `emit` and let the replica that issued the
write pick it up on its own fan-out?

- The originating replica **also** subscribes to `methodology.updated`, so the
  admin write and the cache refresh happen in the same replica via the same
  code path — no write-then-read race. But it would be non-deterministic to
  wait up to PRD-072 SQS latency (~seconds) before the admin sees their edit
  applied in their next API call.
- The `upsert()` implementation therefore **also** updates its own in-process
  cache synchronously before emitting — the emit propagates to **other**
  replicas. The subscription handler is idempotent by version check (§5.1).

### 5.3 — Why not `ctx.events.subscribe('methodology.*')`?

Not allowed. PRD-072 §2 forbids wildcard/runtime subscriptions —
**subscriptions must be manifest-declared**. The agent app declares exactly
one event type:

```yaml
# agent-runtime-using app's manifest
requires:
  events:
    emit:
      - type: methodology.updated
        schema: ./schemas/methodology-updated.schema.json
        classifications: []   # methodology IDs are non-sensitive metadata
    on:
      - type: methodology.updated
```

### 5.4 — No-events fallback

If the app doesn't declare the `on` subscription (e.g. single-replica dev
setup), `CortexMethodologySource` still works — explicit `reload()` on
admin-write keeps the writing replica consistent. Multi-replica setups
**MUST** declare the subscription; there is no cross-replica polling in v1.

### 5.5 — In-flight session semantics

Runtime steps are snapshots. `MethodologyChange` listeners (typically
`MethodologySessionStore`) **drop routing caches** but **do not mutate
in-flight session state**. A session started on v1.2 finishes on v1.2. The
next `methodology_start` picks v1.3.

---

## 6. Gate Validation Timing

Methodology YAML must pass the methodts compilation pipeline (G1-G6). Splitting
the work between write time (admin-facing, strict, blocking) and load time
(startup, tolerant, logs-only) balances UX and safety.

| Gate | Write time (admin upsert) | Load time (init / reload) |
|---|---|---|
| **Parse** (`js-yaml` + `parseMethodology`) | **BLOCK** — reject with `METHODOLOGY_PARSE_ERROR` 400. | **SKIP** entry with `warn` — already validated at write. |
| **G1 Domain** (signature + axioms) | **BLOCK** — return `compilationReport.gates[G1].status: fail` + HTTP 422 if admin disabled soft-fail. | Log + mark entry `status: deprecated`. |
| **G2 Objective** (structural) | **BLOCK** (cheap). | **SKIP**. |
| **G3 Roles** (coverage) | **BLOCK**. | **SKIP**. |
| **G4 DAG** (acyclic + composable) | **BLOCK**. | **SKIP** (stored report trusted). |
| **G5 Guidance review** | **WARN** (admin can override; status = `needs_review`). | **SKIP**. |
| **G6 Serializability** | **BLOCK**. | **SKIP**. |
| **G7 Tests** (async) | **ASYNC** — scheduled via `ctx.jobs` post-write (PRD-071); non-blocking. Report back via `methodology.updated` emit with new version. | **SKIP**. |

**Rationale.** Writes are the safe place to block — admin is synchronously
waiting, and the registry invariant (DR-01: no un-compiled methodology in
production) demands it. Startup must be **fast and tolerant**: a corrupt
entry should not crash the agent runtime; it should be logged, marked
deprecated in memory, and excluded from `list()` until an admin re-upserts.

**methodts pin.** `compilationReport.methodtsVersion` is stored on every doc.
At load time, if the pinned version differs from the runtime's current
`@method/methodts` version, the entry is **re-parsed and G6-rechecked**
(cheap round-trip), but G1-G5 are trusted. A major methodts version bump
triggers a full re-compile (operator action, not automatic).

---

## 7. Inheritance Model — Stdlib + Per-App Overrides

Three `inheritance` modes on `MethodologyPolicy`:

### 7.1 — `stdlib-plus-overrides` (default)

On `init()`:

1. `stdlibBase = new StdlibSource()` (the same catalog bundled today).
2. `perAppDocs = ctx.storage.collection('methodologies').find({})`.
3. Build the in-memory cache as:
   ```
   for each m in stdlibBase.list():            cache[m.id] = { source: 'stdlib', entry: m }
   for each d in perAppDocs:
     if d.source === 'per-app':                cache[d.methodologyId] = { source: 'per-app', doc: d }
     if d.source === 'stdlib-pinned':
        if d.parent.stdlibVersion !== currentStdlib.version:
           log warn "stdlib pin drift"; cache[d.methodologyId] = { source: 'pinned', doc: d }
        else:                                  cache already points at stdlib — pin is a no-op
   ```
4. Apply `enabledMethodologies` whitelist as a final filter on the cache.

**Override semantics.** Per-app docs **shadow** stdlib entries by `methodologyId`.
There is **no field-level merging** in v1 (e.g. per-app overriding one method
of `P2-SD`). If an app wants to customize one method of P2-SD, it pins the
whole P2-SD (`source: 'stdlib-pinned'`) and edits it as a unit. Field-level
inheritance is explicitly deferred (§10 Q4).

### 7.2 — `per-app-only`

`stdlibBase` is not consulted. The cache contains only per-app docs. Useful
for apps that want full authorial control and don't trust the stdlib to be
stable under their feet.

### 7.3 — `stdlib-read-only`

`CortexMethodologySource` degenerates to a pass-through wrapper around
`StdlibSource`. `upsert()` / `remove()` throw `POLICY_READ_ONLY`. The
`methodologies` collection is empty. `ctx.events` subscription is still
attached for completeness (policy changes emit too) but no methodology events
are expected.

**Default choice.** Cortex admin picks mode at app install time and may
promote `stdlib-read-only` → `stdlib-plus-overrides` → `per-app-only` but
not demote (demotion risks dropping methodologies in use by running
sessions). Enforced in `setPolicy()`.

### 7.4 — Pin semantics

A `stdlib-pinned` doc with `parent.stdlibVersion === currentStdlib.version`
is a **no-op guard** — it documents "I agreed to stdlib v1.5.0 of P2-SD" so
that a future stdlib bump to v1.6.0 causes a visible drift warning instead
of silent behavior change. The doc's `yaml` field is the snapshot of the
stdlib YAML at pin time; if drift is detected, the pinned YAML is preferred
(the app froze its behavior).

---

## 8. `MethodologyRouter` — Stays Port, Gains Tenant-Scoped Hints

`MethodologyRouter` (existing; decides which methodology applies to
`(step, role, projectCard)`) is **unchanged in shape**. The Cortex-backed
variant simply consults `MethodologyPolicy.roleToMethodology` /
`defaultMethodologyId` as seed data:

```typescript
export interface MethodologyRouter {
  route(ctx: RoutingContext): RoutingDecision;
}

export interface RoutingContext {
  step?: string;
  role?: string;
  projectCard?: ProjectCard;
  /** NEW (optional) — when the source is policy-aware, pass the policy. */
  policy?: MethodologyPolicy;
}
```

`CortexMethodologySource` exposes `getPolicy()`; the agent-runtime composition
root wires the policy into the router. Stdlib case: policy = `undefined`;
router uses its existing default logic. **No breaking change.**

---

## 9. Admin API Outline — `PlatformMethodologyApi` (Follow-on PRD)

Sketched here for contract completeness; the detailed Cortex-side PRD is
separate (lives in the t1-cortex repo, not this one).

| Endpoint | Purpose | Port method |
|---|---|---|
| `GET  /v1/platform/methodologies` | List all (per-app + stdlib-visible). Response includes `source`, `version`, gate summary. | `source.list()` + shallow gate-report embed |
| `GET  /v1/platform/methodologies/:id` | Full doc (YAML + metadata + compilationReport). | `source.getMethodologyDocument(id)` (extension — see §9.1) |
| `PUT  /v1/platform/methodologies/:id` | Upsert YAML. Runs write-time gates; returns compilation report. | `source.upsert(input)` |
| `DELETE /v1/platform/methodologies/:id` | Remove per-app override. stdlib entries cannot be deleted (returns 403). | `source.remove(id)` |
| `POST /v1/platform/methodologies/:id/validate` | Dry-run: run gates, return report, DO NOT persist. | `source.validate(input)` (extension — see §9.1) |
| `POST /v1/platform/methodologies/:id/pin` | Create a `stdlib-pinned` snapshot from the current stdlib entry. | `source.pinFromStdlib(id)` (extension) |
| `GET  /v1/platform/methodologies/policy` | Fetch policy. | `source.getPolicy()` |
| `PUT  /v1/platform/methodologies/policy` | Update policy (inheritance, whitelist, routing hints). | `source.setPolicy(policy)` |

### 9.1 — Admin-only extensions to `CortexMethodologySource`

These methods exist **only on the Cortex implementation** (not on the base
`MethodologySource` port — they are admin concerns, not runtime concerns):

```typescript
// NOT on MethodologySource — specific to CortexMethodologySource.
getMethodologyDocument(id: string): Promise<MethodologyDocument | null>;
validate(input: MethodologyDocumentInput): Promise<CompilationReport>;
pinFromStdlib(methodologyId: string): Promise<MethodologyDocument>;
```

This keeps the runtime port minimal while giving the admin UI a rich surface.
Admin UI imports `CortexMethodologySource` directly; runtime code imports the
`MethodologySource` port only.

### 9.2 — Authorization

PRD-064 scopes storage to `appId` via JWT. PlatformMethodologyApi **additionally**
requires `methodology:read` or `methodology:write` scope. Routine session
callers never get `:write` — that scope is granted only to the admin UI's
OAuth client.

---

## 10. Agreement & Open Questions

### 10.1 — Frozen (2026-04-14)

- `MethodologySource` extension with optional `init`/`reload`/`onChange`/`close`.
- `MethodologyChange` union type.
- `CortexMethodologySource` constructor deps + 11 methods (3 core, 4 lifecycle, 4 admin).
- `CortexStoragePort` / `CortexEventsPort` structural shims (avoid Cortex SDK coupling).
- `MethodologyDocument` / `MethodologyPolicy` Mongo schemas + indexes.
- Hot-reload: dual path (explicit `reload()` + ctx.events subscription to `methodology.updated`).
- Inheritance modes: `stdlib-plus-overrides` (default) / `per-app-only` / `stdlib-read-only`.
- Gate timing table (§6).
- Admin API sketch (§9) — the detailed Cortex route-level PRD is a follow-on.

### 10.2 — Open questions (flag for PRD-064 implementation)

1. **G7 async feedback loop.** How does the admin UI display G7 test results that
   arrive via `ctx.jobs` 30s after the write? Suggestion: emit
   `methodology.updated` a second time with updated `compilationReport`. Flag
   for the admin UI PRD.
2. **Multi-tenant stdlib drift.** Tenant A pins P2-SD@1.5.0, tenant B pins
   P2-SD@1.6.0. Each runs in its own app container with its own bundled
   stdlib. **Decision:** stdlib version IS the container version; method's
   monorepo ships one version. Drift only happens across app upgrades, not
   within a running fleet.
3. **Method-level override.** Explicitly deferred (§7.1). Revisit if admin
   feedback wants it — likely via a nested `overrides: { methodId: yaml }`
   field on stdlib-pinned docs. Needs its own FCD.
4. **Registry write-through.** Method's bundled stdlib vs. Cortex per-app is
   intentionally **one-way** (stdlib → per-app). A Cortex admin edit does NOT
   propagate back to the method monorepo. Authoring flows through the
   governance methodology (P0-META) outside Cortex; Cortex curates only.
5. **Policy vs MethodologyRouter placement.** Router currently lives in
   `@method/runtime`. Policy lives in `@method/agent-runtime` (Cortex-coupled).
   The `policy?: MethodologyPolicy` field on `RoutingContext` keeps the router
   oblivious but requires agent-runtime to pass it. Acceptable; no change.

### 10.3 — Changes require

A new `/fcd-surface` session. The extension to `MethodologySource` is additive
(optional methods), so existing consumers (`StdlibSource`, `InMemorySource`)
remain compatible without edits.

---

## 11. Gate Assertions

To add to `packages/agent-runtime/src/architecture.test.ts` (created by
PRD-058) and `packages/runtime/src/architecture.test.ts` (created by PRD-057).

```typescript
// G-METHODOLOGY-SOURCE-CORE-SYNC (new; runtime)
it('MethodologySource core reads are synchronous', () => {
  const src = readFileSync('packages/runtime/src/ports/methodology-source.ts', 'utf-8');
  // list/getMethod/getMethodology must NOT return Promise.
  expect(src).not.toMatch(/list\(\)[^;]*Promise/);
  expect(src).not.toMatch(/getMethod\([^)]*\)[^;]*Promise/);
  expect(src).not.toMatch(/getMethodology\([^)]*\)[^;]*Promise/);
});

// G-CORTEX-NO-SDK-LEAK (new; agent-runtime)
it('CortexMethodologySource does not leak Cortex SDK types into MethodologySource port', () => {
  const forbidden = ['@t1/cortex-sdk', 'ctx.storage', 'ctx.events'];
  const violations = scanPackageImports('packages/runtime/src', forbidden);
  expect(violations).toEqual([]);
});

// G-METHODOLOGY-EVENT-DECLARED (new; agent-runtime)
it('CortexMethodologySource subscribes only to declared event types', () => {
  const src = readFileSync(
    'packages/agent-runtime/src/methodology/cortex-methodology-source.ts',
    'utf-8',
  );
  // Only 'methodology.updated' may be passed to events.on / emit.
  const calls = [...src.matchAll(/events\.(on|emit)\(\s*['"]([^'"]+)['"]/g)];
  calls.forEach(([, , type]) => expect(type).toBe('methodology.updated'));
});

// G-DOC-SCHEMA-COLLECTION-NAMES (new; agent-runtime)
it('Mongo collection names pass PRD-064 CollectionName regex', () => {
  const names = ['methodologies', 'methodology_policy'];
  const regex = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
  names.forEach((n) => {
    expect(n).toMatch(regex);
    expect(n.startsWith('system.')).toBe(false);
  });
});
```

---

## 12. Producer & Consumer Mapping

**Producer** (implements the port):
- `CortexMethodologySource` in `@method/agent-runtime` (PRD-058 / PRD-064).
- `StdlibSource` in `@method/runtime/ports` (existing; gains no-op lifecycle stubs).
- `InMemorySource` in `@method/runtime/ports` (existing; gains controllable `onChange`).

**Consumer** (depends on the port):
- `MethodologySessionStore` in `@method/bridge/domains/methodology/` — subscribes
  to `onChange` to drop stale routing caches.
- MCP handlers in `@method/mcp` — `methodology_list`, `methodology_get_routing`,
  `methodology_load`, etc. (all currently via bridge; equivalent routes in the
  Cortex-hosted agent runtime).
- Runtime step loader — unchanged; reads via `getMethod`.
- Admin UI (out-of-tree; Cortex tenant webapp) — via `PlatformMethodologyApi`.

Wiring: agent-runtime composition root instantiates `new CortexMethodologySource({
storage, events, appId, inheritance })` and injects into downstream.

---

## 13. Status

**Frozen.** Surface is ready for PRD-064 to break ground. Depends on PRD-057
(runtime extraction, which moves the base `MethodologySource` port) and PRD-058
(`@method/agent-runtime` package scaffold). Five open questions in §10.2 are
scoped to PRD-064 implementation — none block the contract freeze.
