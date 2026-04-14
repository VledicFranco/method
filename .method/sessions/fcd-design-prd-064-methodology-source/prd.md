---
type: prd
title: "PRD-064: CortexMethodologySource + Admin UI Integration"
date: "2026-04-14"
status: draft
version: "0.1"
size: M
domains:
  - "@method/agent-runtime"        # new impl lives here
  - "@method/runtime"               # port extension owner (post PRD-057)
  - "@method/bridge"                # reference consumer + session-store listener
surfaces:
  - S7   # CortexMethodologySource + MethodologySource extension (frozen)
consumes:
  - S2   # RuntimePackageBoundary — port moves to @method/runtime/ports
  - S1   # MethodAgentPort — CortexCtx shape (storage + events facades)
related:
  - docs/roadmap-cortex-consumption.md §4.2 item 11
  - .method/sessions/fcd-surface-methodology-source/decision.md
  - .method/sessions/fcd-surface-runtime-package-boundary/decision.md
  - .method/sessions/fcd-surface-method-agent-port/decision.md
  - packages/bridge/src/ports/methodology-source.ts
  - packages/bridge/src/ports/stdlib-source.ts
  - packages/bridge/src/domains/methodology/store.ts
  - packages/bridge/src/domains/methodology/routes.ts
  - ../../t1-repos/t1-cortex-1/docs/prds/064-app-storage-service.md
  - ../../t1-repos/t1-cortex-1/docs/prds/072-events-service.md
blocks:
  - Group B5 (roadmap §5)
  - PlatformMethodologyApi (Cortex-side follow-on PRD)
depends_on:
  - PRD-057 (moves MethodologySource port to @method/runtime/ports)
  - PRD-058 (agent-runtime scaffold + CortexCtx shape)
---

# PRD-064 — CortexMethodologySource + Admin UI Integration

> Ships the Cortex-backed implementation of `MethodologySource` frozen in
> S7. Persists whole-document methodologies in `ctx.storage`, inherits from
> the bundled stdlib catalog via a `stdlib-plus-overrides` default policy,
> hot-reloads on the single declared `methodology.updated` event type, and
> exposes admin CRUD + validate + policy endpoints for Cortex-admin curation.

## 1. Summary

`CortexMethodologySource` is the second production implementation of the
`MethodologySource` port (first is `StdlibSource`). It lets each Cortex
tenant app of `category: agent` curate its own methodology set in its
per-app MongoDB (via `ctx.storage`, PRD-064-Cortex), pick its inheritance
mode against the bundled stdlib catalog, and receive hot-reload updates
when an admin edits a methodology through the Cortex platform admin UI.

The implementation is additive: the existing synchronous three-method read
contract is preserved as the hot path, and four optional lifecycle methods
(`init`, `reload`, `onChange`, `close`) are used by the Cortex source and
no-op'd by `StdlibSource`.

This PRD delivers three things in one package:

1. The `CortexMethodologySource` class and its companion types
   (`CortexMethodologySourceDeps`, `MethodologyDocument`, `MethodologyPolicy`,
   `CortexStoragePort`, `CortexEventsPort`).
2. Two Mongo collections (`methodologies`, `methodology_policy`) with
   declared indexes, queried through the generic `ctx.storage` collection API.
3. An admin API shape (methods on `CortexMethodologySource`) that the
   Cortex-side `PlatformMethodologyApi` route layer binds. The route layer
   itself ships in a follow-on Cortex PRD; this PRD ships the typed methods
   it will call.

Acceptance is measured on the agent-runtime side: a fixture `ctx.storage`
+ `ctx.events` harness demonstrates (a) `init()` resolves stdlib+overrides
correctly, (b) `upsert()` blocks invalid YAML at write time with compiled
gate reports, (c) `methodology.updated` events trigger targeted
`reload(id)` across simulated replicas.

## 2. Problem

Today the only `MethodologySource` implementation is `StdlibSource`, which
wraps the compiled `@method/methodts` stdlib catalog. That is a zero-I/O,
fixed, one-size-fits-all view. When method runs as a library inside a
Cortex tenant app, three properties break:

- **No per-app curation.** Every app sees the same bundled methodology set.
  The incidents-bot wants only `P-GH` + `P-INCIDENT`; the feature-dev agent
  wants only `P2-SD`. There is no way to scope, whitelist, pin, or override.
- **No persistence layer.** Cortex apps have no disk; state lives in their
  per-app MongoDB (PRD-064-Cortex `ctx.storage`). Bundled stdlib is
  read-only, compiled into the container image, and cannot be edited by
  a tenant-app admin without a redeploy.
- **No hot-reload.** A Cortex admin editing a methodology in the platform
  admin UI must see that change applied to running agent replicas without
  a container restart. PRD-072 Cortex events + a manifest-declared
  subscription is the only allowed fan-out channel.

Consequences if unsolved: no Cortex tenant app can meaningfully govern the
methodology its agents run under, so "autonomous feature development" and
"autonomous incident triage" (the April 21 demos) have to fake curation via
env vars or code edits — defeating the purpose of a methodology runtime.

## 3. Constraints

### C-1. Whole-document schema (non-negotiable)
Methodology YAML is persisted as **one document per methodologyId**, not
decomposed into step/predicate collections. Compilation gates G1-G6 run
over a complete `Method<S>`; decomposition would force in-memory
reassembly on every `getMethodology()` call and clashes with PRD-064
(Cortex) constraints: `find` is capped at 1000 docs, no transactions in
v1, no cursor iteration. Document size is 2-10 KB per methodology vs
Mongo's 16 MB limit — comfortable.

### C-2. Inheritance default = `stdlib-plus-overrides`
Three modes in the frozen contract: `stdlib-plus-overrides` (default),
`per-app-only`, `stdlib-read-only`. The default must be
`stdlib-plus-overrides` so new apps inherit the curated stdlib catalog
without authorial effort. Promotion (`stdlib-read-only` →
`stdlib-plus-overrides` → `per-app-only`) is allowed; demotion is
rejected in `setPolicy()` because in-flight sessions may hold references
to methodologies that demotion would drop.

### C-3. Single declared event type (PRD-072 invariant)
Per PRD-072 §2, runtime wildcard/arbitrary subscriptions are forbidden.
Subscriptions are **manifest-declared**. `CortexMethodologySource`
declares exactly one type for both `emit` and `on`:
`methodology.updated`. That manifest block is emitted by the agent-runtime
composition root helper (PRD-058 delivers the manifest-fragment codegen).

### C-4. Gate validation runs at WRITE time, not LOAD time
Writes block on G1-G6 failure (G5 warns only; G7 is async via `ctx.jobs`
and emits a second `methodology.updated` with the updated report). Load
path is intentionally fast and tolerant: a corrupt persisted doc is
logged + marked `deprecated` in memory + excluded from `list()`. The
registry-invariant (DR-01, no uncompiled methodology in production) is
upheld at the write boundary where an admin is synchronously waiting.

### C-5. No Cortex SDK coupling in the shared port
`MethodologySource` lives in `@method/runtime/ports` and must never import
from `@cortex/*`. All Cortex-specific types live on
`CortexMethodologySourceDeps` and two structural shims (`CortexStoragePort`,
`CortexEventsPort`) declared inside `@method/agent-runtime`. The Cortex
SDK is adapted to those shims at the agent-runtime composition root —
the runtime itself stays Cortex-agnostic.

### C-6. Theory is the source of truth (DR-01/DR-02)
Per-app curation **selects and overrides** already-compiled methodologies.
It does not forge new ones out of thin air. A Cortex app that wants a
never-before-seen methodology must compile it through the authoring
pipeline first (outside this surface). `upsert()` accepts raw YAML but
runs the same compilation gates the stdlib catalog does — anything that
does not compile is rejected.

### C-7. Collection names pass PRD-064 (Cortex) regex
`methodologies` and `methodology_policy` match
`^[A-Za-z][A-Za-z0-9_-]{0,63}$` and avoid the `system.` prefix.

### C-8. Admin-only methods are NOT on the base port
`upsert`, `remove`, `setPolicy`, `getPolicy`,
`getMethodologyDocument`, `validate`, `pinFromStdlib` exist only on
`CortexMethodologySource`. The base `MethodologySource` port is the
runtime read path; the admin API is a richer surface the admin UI
imports directly. Keeps the port minimal and preserves the single
production-invariant: runtime code does not write.

## 4. Success Criteria

1. **Hot-reload works on a live replica.** With a fixture `ctx.storage`
   and a fixture `ctx.events`, `upsert()` on replica A persists the doc,
   emits `methodology.updated`, and the subscription handler on replica B
   detects the version bump, calls `reload(id)`, and fires an `onChange`
   payload of kind `updated` within a single event-bus turnaround.
   Measured: `getMethodology(id).version` changes on both replicas after
   one round-trip.

2. **`stdlib-plus-overrides` resolves correctly.** Given a stdlib catalog
   containing `P2-SD@1.5.0` and a per-app doc overriding `P2-SD` with a
   custom YAML, `init()` + `list()` returns the custom YAML's parsed
   entry (not the stdlib one), and `getMethodology('P2-SD')` returns the
   parsed per-app `Methodology<any>`. A stdlib-only methodology (e.g.
   `P1-EXEC`) returns the stdlib entry. An `enabledMethodologies`
   whitelist filters the final list correctly.

3. **Admin CRUD + validate endpoints are covered.** The seven operations
   (`list`, `getMethodologyDocument`, `upsert`, `remove`, `validate`,
   `pinFromStdlib`, `setPolicy`/`getPolicy`) each have a unit test against
   a fixture `CortexStoragePort` that asserts (a) expected Mongo calls,
   (b) response shape, (c) error shape on invalid input (parse error,
   gate-fail, policy-demotion, delete-stdlib).

4. **Gate validation runs at WRITE, not LOAD.** A write with YAML that
   fails G4 (DAG acyclic) returns HTTP 422 with `compilationReport.gates`
   showing the fail. A load-time re-read of a persisted corrupt doc does
   NOT re-run G1-G5 — it trusts the stored `compilationReport` and only
   re-runs G6 (serializability) when `methodtsVersion` has shifted.

5. **Event-declaration gate passes.** The architecture test
   `G-METHODOLOGY-EVENT-DECLARED` (from the frozen surface, §11) passes —
   only `'methodology.updated'` is passed to `events.on` / `events.emit`.

6. **Port neutrality preserved.** `G-CORTEX-NO-SDK-LEAK` passes: no file
   under `packages/runtime/src/` references `@t1/cortex-sdk`,
   `ctx.storage`, or `ctx.events`.

## 5. Scope

### In Scope

- **`CortexMethodologySource` class** in `packages/agent-runtime/src/methodology/cortex-methodology-source.ts`
  implementing `MethodologySource` plus the seven admin methods.
- **Structural port shims** (`CortexStoragePort`, `CortexEventsPort`) in the
  same package, module-local — they avoid importing the full Cortex SDK.
- **Two collections** with declared indexes:
  - `methodologies` (one doc per methodologyId, `_id == methodologyId`,
    indexes on `methodologyId` unique + `status`)
  - `methodology_policy` (singleton, `_id == "policy"`)
- **In-memory cache** that mirrors the persisted set, hydrated by `init()`.
  Synchronous reads (`list`/`getMethod`/`getMethodology`) serve from cache.
- **Hot-reload dual path**: synchronous in-process cache update on the
  writing replica + `ctx.events.emit('methodology.updated')` fan-out +
  subscription handler on every replica that calls `reload(id)` on
  version advance.
- **Inheritance resolver** with three modes: `stdlib-plus-overrides`
  (default), `per-app-only`, `stdlib-read-only`.
- **Compilation pipeline binding**: reuse `@method/methodts` compile/parse
  primitives to run G1-G6 at write time. Persist the resulting
  `compilationReport` on every doc.
- **Admin methods** on the class (callable from the Cortex-side
  `PlatformMethodologyApi` route layer): `upsert`, `remove`,
  `getMethodologyDocument`, `validate`, `pinFromStdlib`, `setPolicy`,
  `getPolicy`.
- **No-op lifecycle stubs on `StdlibSource`** (and `InMemorySource`) so
  consumers can uniformly call `init?.()`, `reload?.()`, etc.
- **Architecture gate tests** from S7 §11 added to
  `packages/agent-runtime/src/architecture.test.ts` and
  `packages/runtime/src/architecture.test.ts`.
- **Bridge-side `MethodologySessionStore` wiring**: subscribe to
  `onChange?.()` to drop stale routing decisions on per-methodology update
  (no mid-run session mutation — snapshot semantics preserved).

### Out of Scope

- **The Cortex-side HTTP route layer** (`PlatformMethodologyApi`). Ships
  as a follow-on PRD in `t1-cortex-1`. This PRD stops at typed methods on
  `CortexMethodologySource` that route handlers will bind verbatim.
- **Field-level methodology override** (e.g. override one method of
  `P2-SD` without re-authoring the whole doc). Explicitly deferred per
  S7 §10.2 Q3. Revisited if admin demand materializes; requires its own
  FCD for nested-override semantics.
- **G7 async feedback loop UX.** G7 (tests) runs via `ctx.jobs` post-write
  and emits a second `methodology.updated` with the updated
  `compilationReport`. The admin UI UX for rendering the delayed result
  is a Cortex admin-UI concern, flagged for the follow-on PRD.
- **Registry write-through.** A Cortex admin edit does NOT propagate back
  to the method monorepo registry. Stdlib authoring flows through the
  method project's governance methodology (P0-META); Cortex is a
  curation-only consumer.
- **Methodology provenance / signing.** Out of scope; the
  `compilationReport.methodtsVersion` pin is the only provenance marker.
- **Cross-app methodology sharing** (App A curates → App B imports).
  Out of scope; each app owns its own `methodologies` collection.
- **Policy-versioned migrations.** `MethodologyPolicy` is a singleton
  overwrite. If schema changes, admin sees the new shape; no migration
  tooling v1.
- **Stdlib catalog diffing/UI.** `pinFromStdlib` just snapshots current
  YAML. Detecting stdlib drift and surfacing it in UI is a follow-on.

## 6. Architecture

### 6.1 Layer Placement & Package Distribution

```
L4   Cortex admin UI (Cortex tenant webapp)           — not in this PRD
     │
     │ HTTPS ──→ PlatformMethodologyApi routes        — follow-on Cortex PRD
     │
L3   @method/agent-runtime                            — THIS PRD
     │   methodology/
     │     cortex-methodology-source.ts
     │     types.ts                                   — MethodologyDocument etc.
     │     cortex-storage-port.ts                     — structural shim
     │     cortex-events-port.ts                      — structural shim
     │     inheritance-resolver.ts                    — stdlib + overrides merge
     │     gate-runner.ts                             — methodts G1-G6 wrapper
     │   architecture.test.ts                         — S7 gates
     │
     │ implements (import type)
     ▼
L3   @method/runtime/ports                            — PRD-057 (dependency)
     │   methodology-source.ts                        — extended (optional lifecycle)
     │   stdlib-source.ts                             — gains no-op stubs
     │   in-memory-source.ts                          — gains controllable onChange
     ▼
L2   @method/methodts                                 — reused verbatim
         compile/parse primitives, Method<S>, Methodology<S>, Gate
```

The Cortex binding stays entirely inside `@method/agent-runtime`.
`@method/runtime` is transport-free and Cortex-free.

### 6.2 Dual-Path Hot Reload

The writing replica updates its cache synchronously in `upsert()` BEFORE
emitting, so the admin's next API call sees the edit immediately. Other
replicas pick it up via the `methodology.updated` subscription handler.
The handler is idempotent: it drops envelopes whose
`envelope.version <= cache[id].version`, which tolerates PRD-072's
at-least-once delivery and SNS fan-out race where the originating
replica's emit-and-subscribe loop races with its own synchronous write.

```
Admin UI
   │ PATCH /v1/platform/methodologies/:id
   ▼
[Cortex route handler, follow-on PRD]
   │
   ▼
CortexMethodologySource.upsert(input)
   ├─ 1. parse YAML (js-yaml)
   ├─ 2. runWriteTimeGates(parsed): G1, G2, G3, G4, G5, G6
   │     fail → throw ConfigurationError(422) with compilationReport
   ├─ 3. storage.collection('methodologies').updateOne({ _id }, { $set: doc })
   ├─ 4. BUMP version (server-generated semver-ish)
   ├─ 5. cache[id] = { parsed, doc, version }  // SYNC — this replica is current
   ├─ 6. notify local onChange listeners       // MethodologySessionStore drops routing
   └─ 7. events.emit('methodology.updated', { appId, methodologyId, version })
                 │
                 ▼ (SNS fan-out — seconds)
   [Every other replica] ctx.events handler fires:
       if envelope.appId !== this.appId → drop
       if envelope.version <= cache[id]?.version → drop     (idempotency)
       else → reload(envelope.methodologyId):
             read doc from storage
             parse YAML
             cache[id] = { parsed, doc, version }
             notify local onChange listeners
```

`MethodologyChange` emissions carry `{ kind: 'updated', methodologyId,
version, previousVersion }`. Consumers that cached routing decisions
(`MethodologySessionStore` in the bridge, any future routing-cache in
agent-runtime) drop those caches synchronously in the listener callback.

#### In-flight session semantics

Runtime steps are snapshots. A session started on methodology v1.2
finishes on v1.2 even if v1.3 arrives mid-run — the step loader read
the entire method into session state at start. Listeners drop only the
**routing-decision cache** (the "which methodology applies to this
role/step/projectCard" answer), not the in-flight session's step state.

### 6.3 Inheritance Resolution Algorithm

Invoked at `init()` and on every full `reload()` (no methodologyId);
incremental for targeted `reload(id)`.

```
function resolveCache():
    policy = storage.collection('methodology_policy').findOne({ _id: 'policy' })
           ?? { inheritance: 'stdlib-plus-overrides' }
    cache = new Map<methodologyId, CacheEntry>()

    # Layer 1: stdlib base (skipped in per-app-only mode)
    if policy.inheritance != 'per-app-only':
        for entry in stdlibSource.list():
            cache.set(entry.id, {
                source: 'stdlib',
                stdlibEntry: entry,
                version: stdlibSource.version,
            })

    # Layer 2: per-app docs (skipped in stdlib-read-only mode)
    if policy.inheritance != 'stdlib-read-only':
        docs = storage.collection('methodologies').find({})
        for doc in docs:
            parsed = parseMethodology(doc.yaml)   # always re-parse on load
            if doc.source == 'per-app':
                # shadow stdlib (if present)
                cache.set(doc.methodologyId, {
                    source: 'per-app',
                    doc: doc,
                    parsed: parsed,
                    version: doc.version,
                })
            elif doc.source == 'stdlib-pinned':
                stdlibVer = stdlibSource.version
                if doc.parent.stdlibVersion != stdlibVer:
                    log.warn('stdlib pin drift', methodologyId, pinVer, stdlibVer)
                    # pinned YAML is authoritative (app froze its behavior)
                    cache.set(doc.methodologyId, {
                        source: 'pinned-drifted',
                        doc: doc,
                        parsed: parsed,
                        version: doc.version,
                    })
                else:
                    # pin is a no-op guard — keep stdlib entry
                    cache.set(doc.methodologyId, {
                        source: 'pinned-current',
                        doc: doc,
                        parsed: parsed,
                        version: doc.version,
                    })

    # Layer 3: whitelist filter (applied AFTER merge)
    if policy.enabledMethodologies is not null:
        allowed = Set(policy.enabledMethodologies)
        for id in cache.keys():
            if id not in allowed:
                cache.delete(id)

    return cache
```

Complexity: O(stdlib_size + perAppDocs + cacheSize) — all three are in
the hundreds, bounded by admin UI UX. Runs at startup + policy change +
occasional full reload. Per-doc reload touches only one cache entry.

### 6.4 Session Store Integration (Bridge Side)

`packages/bridge/src/domains/methodology/store.ts` already receives the
`MethodologySource` via constructor. Adding a listener at composition
time is one line:

```ts
// in server-entry.ts composition
methodologySource.onChange?.((change) => {
  methodologySessionStore.onMethodologyChange(change);
});
```

`MethodologySessionStore.onMethodologyChange(change)` iterates its
routing cache and invalidates entries keyed on `change.methodologyId`.
This PRD adds the method + wiring; the `Bridge` side continues to use
`StdlibSource` (which never emits), so the listener is a no-op in the
bridge-only deployment. It exists to support Cortex deployments where
the bridge session store is wired to `CortexMethodologySource`.

### 6.5 Composition-Root Wiring

```ts
// in packages/agent-runtime/src/composition.ts (sketched, belongs to PRD-058)
const storage = adaptCortexStorage(ctx.storage);     // structural shim
const events  = adaptCortexEvents(ctx.events);       // structural shim

const methodologySource = new CortexMethodologySource({
  storage,
  events,
  appId: ctx.app.id,
  inheritance: 'stdlib-plus-overrides',              // default
  logger: ctx.log,
});

await methodologySource.init();                      // blocks first request

// downstream runtime consumers receive methodologySource through DI as
// plain MethodologySource — they don't know about Cortex.
```

The adapters are trivial — `ctx.storage.collection<T>(name)` already
returns a MongoDB-like collection. The shim exists only to decouple
type imports.

## 7. Mongo Collection Design

### 7.1 `methodologies` collection

Per-app Mongo database `cortex_app_{appId}` (provisioning handled by
PRD-064 Cortex).

```typescript
interface MethodologyDocument {
  _id: string;                          // == methodologyId (e.g. "P2-SD")
  methodologyId: string;                // duplicated from _id; convenience
  version: string;                      // semver-ish, bumps on every upsert
  source: 'stdlib-pinned' | 'per-app';  // selection discriminator
  parent?: {                            // only when source === 'stdlib-pinned'
    methodologyId: string;              // normally === methodologyId
    stdlibVersion: string;              // stdlib catalog version at pin time
  };
  status: 'compiled' | 'draft' | 'deprecated';
  yaml: string;                         // full YAML text (preserves comments)
  metadata: {                           // extracted at compile; cheap list()
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
  compilationReport: {
    overall: 'compiled' | 'failed' | 'needs_review';
    gates: Array<{
      gate: 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6' | 'G7';
      status: 'pass' | 'fail' | 'needs_review' | 'pending';
      details: string;
    }>;
    compiledAt: string;                 // ISO-8601
    methodtsVersion: string;            // pin of @method/methodts at compile
  };
  createdAt: string;
  createdBy: string;                    // userId from Cortex auth
  updatedAt: string;
  updatedBy: string;
}
```

#### Declared indexes (`requires.storage.indexes` in the agent app's manifest)

```yaml
- collection: methodologies
  fields: [ { name: methodologyId, direction: Asc } ]
  unique: true
  name: idx_methodology_id
- collection: methodologies
  fields: [ { name: status, direction: Asc } ]
  name: idx_status
```

`_id == methodologyId` guarantees `findOne({ _id })` lookup without a
secondary index hit; the explicit unique index on `methodologyId` is a
belt-and-suspenders defense in case future queries need the field name.

### 7.2 `methodology_policy` collection (singleton)

```typescript
interface MethodologyPolicy {
  _id: 'policy';                        // fixed singleton id
  inheritance: 'stdlib-plus-overrides'
             | 'per-app-only'
             | 'stdlib-read-only';
  enabledMethodologies?: string[];      // whitelist; undefined = allow all
  defaultMethodologyId?: string;        // router seed
  roleToMethodology?: Record<string, string>;  // role → methodologyId
  stdlibPin?: string;                   // exact stdlib catalog version lock
  updatedAt: string;
  updatedBy: string;
}
```

No additional indexes; `findOne({ _id: 'policy' })` uses the primary
index.

### 7.3 Why separate collections?

Isolating policy from per-methodology docs lets the admin UI
(a) fetch the entire policy in one `findOne`, (b) update it atomically
without touching methodology docs, and (c) avoid needing Mongo
transactions (unavailable in PRD-064 v1). Combining would require a
multi-doc write pattern that the port does not support.

## 8. Gate-Validation Timing

| Gate | Name | Write time (upsert / validate) | Load time (init / reload) |
|------|------|--------------------------------|---------------------------|
| Parse | js-yaml + `parseMethodology` | **BLOCK** — 400 `METHODOLOGY_PARSE_ERROR` | **SKIP**; entry already validated. Corrupt persisted doc (impossible except manual Mongo edit) → log + mark `deprecated` + exclude from `list()`. |
| G1   | Domain (signature + axioms) | **BLOCK** — 422 with gate report | Trusted from `compilationReport`. |
| G2   | Objective (structural) | **BLOCK** (cheap). | Trusted. |
| G3   | Roles (coverage) | **BLOCK**. | Trusted. |
| G4   | DAG (acyclic + composable) | **BLOCK**. | Trusted. |
| G5   | Guidance review | **WARN** — admin can override; `status = needs_review`. | Trusted. |
| G6   | Serializability | **BLOCK**. | **Re-run** if `compilationReport.methodtsVersion` != current (cheap round-trip). |
| G7   | Tests (async) | **SCHEDULED** via `ctx.jobs` post-write. Non-blocking. Report updated via second `methodology.updated` emit. | **SKIP**. |

### Rationale

Writes are the safe place to block: the admin is synchronously waiting,
and DR-01 ("no uncompiled methodology in production") demands it. Startup
must stay fast — seconds per methodology × hundreds of methodologies ×
replica count on every deploy would be unacceptable. Trusting the
stored `compilationReport` is safe because the write path is the only
persistence route and it blocked.

### methodts-version-pin rule

`compilationReport.methodtsVersion` is stored on every doc. If a runtime
start detects a pin mismatch:

- **G6 re-run** (serializability) is cheap and catches the most common
  schema-level drift. If it passes, the entry serves as-is; if it fails,
  mark `deprecated`.
- **Major version bump on methodts** triggers a full re-compile pass —
  an operator action executed via a `validate` call per methodology from
  the admin UI, not an implicit reload. Prevents silent behavior change.

## 9. Admin API Outline

Methods on `CortexMethodologySource`. The Cortex-side follow-on PRD
binds them to HTTP routes under `/v1/platform/methodologies/*`.

| Endpoint (Cortex-side) | Purpose | Method signature |
|------------------------|---------|------------------|
| `GET  /v1/platform/methodologies` | List methodologies visible under current policy. Each entry: `{ methodologyId, version, source, status, gateSummary }`. | `list(): CatalogMethodologyEntry[]` (port) + `listDocuments(): Promise<MethodologyDocumentSummary[]>` (admin) |
| `GET  /v1/platform/methodologies/:id` | Full doc: YAML + metadata + compilationReport. | `getMethodologyDocument(id: string): Promise<MethodologyDocument \| null>` |
| `PUT  /v1/platform/methodologies/:id` | Upsert YAML; blocks on gates; returns new doc. | `upsert(input: MethodologyDocumentInput): Promise<MethodologyDocument>` |
| `DELETE /v1/platform/methodologies/:id` | Remove per-app override. 403 on stdlib-only entry. | `remove(id: string): Promise<void>` |
| `POST /v1/platform/methodologies/:id/validate` | Dry-run: run gates, return report, DO NOT persist. | `validate(input: MethodologyDocumentInput): Promise<CompilationReport>` |
| `POST /v1/platform/methodologies/:id/pin` | Create a `stdlib-pinned` snapshot of current stdlib entry. | `pinFromStdlib(methodologyId: string): Promise<MethodologyDocument>` |
| `GET  /v1/platform/methodologies/policy` | Fetch policy singleton. | `getPolicy(): Promise<MethodologyPolicy>` |
| `PUT  /v1/platform/methodologies/policy` | Update policy. **Promotion-only** for `inheritance` field. | `setPolicy(policy: MethodologyPolicy): Promise<MethodologyPolicy>` |

### 9.1 Governance: `setPolicy` promotion-only rule

`setPolicy` rejects demotions because in-flight runtime sessions may hold
references to methodologies that demotion would drop, and policy changes
apply globally (not per-session). Allowed transitions:

```
stdlib-read-only  →  stdlib-plus-overrides   (OK: adds per-app layer)
stdlib-read-only  →  per-app-only            (rejected: drops stdlib layer)
stdlib-plus-overrides → per-app-only         (rejected: drops stdlib layer)
stdlib-plus-overrides → stdlib-read-only     (rejected: drops per-app layer)
per-app-only      →  any                     (rejected: drops per-app layer)
```

Error code: `POLICY_DEMOTION_REJECTED` with the attempted transition in
the error details. Admin workaround: uninstall + reinstall the app with
the new policy (explicit, auditable).

### 9.2 Authorization

PRD-064 (Cortex) scopes all `ctx.storage` ops to the caller's `appId`
via JWT. `PlatformMethodologyApi` additionally requires scope
`methodology:read` or `methodology:write`. Routine session callers never
get `:write`; that scope is granted only to the admin UI's OAuth client.
Enforcement lives in the Cortex route layer, not in
`CortexMethodologySource` — the class trusts its caller.

### 9.3 Deletion semantics on stdlib entries

`remove(id)` on a methodologyId that has no per-app doc (i.e., only
visible via stdlib) returns `STDLIB_ENTRY_NOT_REMOVABLE` (403). Removing
a `stdlib-pinned` doc succeeds and reverts the app to the live stdlib
entry.

## 10. Per-Domain Architecture

### 10.1 `@method/runtime/ports` (port extension, via PRD-057)

Files changed:
- `methodology-source.ts` — add four optional lifecycle methods +
  `MethodologyChange` union (verbatim from S7 §2).
- `stdlib-source.ts` — add no-op `init` / `reload` / `onChange` / `close`
  stubs.
- `in-memory-source.ts` (if moved per S2 §5.3) — add controllable
  `onChange` trigger for tests.

No breaking change. All existing consumers compile unchanged.

Gates: `G-METHODOLOGY-SOURCE-CORE-SYNC` (S7 §11) enforces that the
three core reads remain synchronous.

### 10.2 `@method/agent-runtime` (new impl)

Directory layout:

```
packages/agent-runtime/src/methodology/
  cortex-methodology-source.ts     — the class
  types.ts                          — MethodologyDocument, MethodologyPolicy, CompilationReport
  cortex-storage-port.ts            — structural shim for ctx.storage subset
  cortex-events-port.ts             — structural shim for ctx.events subset
  inheritance-resolver.ts           — resolveCache() algorithm (§6.3)
  gate-runner.ts                    — write-time G1-G6 orchestration over @method/methodts
  cortex-methodology-source.test.ts — unit tests (fixture ports)
  inheritance-resolver.test.ts
```

Gates: `G-CORTEX-NO-SDK-LEAK`, `G-METHODOLOGY-EVENT-DECLARED`,
`G-DOC-SCHEMA-COLLECTION-NAMES` (all from S7 §11) live in
`packages/agent-runtime/src/architecture.test.ts`.

Tests use fixture implementations of `CortexStoragePort` and
`CortexEventsPort` — no Mongo, no SNS. The conformance testkit
(PRD-065) subsumes a real-Mongo smoke test later.

### 10.3 `@method/bridge` (consumer wiring)

`domains/methodology/store.ts`: add
`onMethodologyChange(change: MethodologyChange): void` that drops the
routing-decision cache keyed on `change.methodologyId`.

`server-entry.ts`: subscribe once at composition.

No routes change; the bridge continues to mount its existing REST routes
unchanged. Bridge remains on `StdlibSource` until a future bridge-in-Cortex
deployment wires `CortexMethodologySource`.

## 11. Migration Path

Additive release. No breaking changes.

1. **After PRD-057 lands** (port extension):
   - `StdlibSource` / `InMemorySource` get no-op lifecycle stubs.
   - Bridge `MethodologySessionStore` adds `onMethodologyChange` (no-op path).
2. **PRD-064 lands** in two sub-waves inside `@method/agent-runtime`:
   - Wave A: types + shims + `CortexMethodologySource` class + in-memory
     test coverage with fixture ports.
   - Wave B: architecture gates + integration test against a fixture
     `ctx.storage` implementation exercising the full `methodology.updated`
     round-trip.
3. **Sample app** (`samples/cortex-incident-triage-agent/`, roadmap A6):
   declares the `methodology.updated` emit+on subscription in its
   manifest and consumes `CortexMethodologySource` via `createMethodAgent`
   composition.

No version-coordinated cross-repo work: Cortex-side
`PlatformMethodologyApi` routes ship on the Cortex team's timeline and
call this PRD's methods verbatim when they do.

## 12. Risks

### R-1. Methodology drift across replicas
**Risk:** If the `methodology.updated` subscription fails on replica B
(DLQ after 4 retries), replica B serves a stale methodology while
replica A serves the new one. Active-session behavior depends on which
replica handled which turn.

**Mitigation:**
- Session affinity at the pool level (sessions stick to their starting
  replica for their duration) — already the default in
  `@method/runtime/sessions`.
- DLQ monitoring on the `methodology.updated` subscription. Flag for the
  follow-on Cortex admin UI PRD to surface DLQ counts.
- Bounded: the drift window closes on the next successful delivery or
  on an explicit `reload()` from the admin UI (a single admin action
  re-emits).

### R-2. Admin-only method exposure
**Risk:** `CortexMethodologySource` exposes write methods (`upsert`,
`remove`, etc.) that the runtime path must never call. A careless
downstream consumer could import the class and call `upsert` from a
session step.

**Mitigation:**
- Composition-root convention: the class is instantiated once at the
  agent-runtime composition root and exposed to runtime code ONLY as
  `MethodologySource` (port typed). The admin API layer imports the
  concrete class.
- Architecture gate `G-RUNTIME-NO-ADMIN-IMPORT` (new, this PRD): no file
  under `packages/agent-runtime/src/` except `methodology/` and `admin/`
  (if added) imports `CortexMethodologySource` as a value.

### R-3. Large methodology documents bypass the 16 MB Mongo limit
**Risk:** Theoretically a pathologically large methodology could exceed
16 MB. Current corpus is 2-10 KB per doc; headroom is ~1500×.

**Mitigation:**
- Pre-write size check in `upsert()`: reject with
  `METHODOLOGY_TOO_LARGE` over a 1 MB soft cap. Raises an operational
  alarm; 1 MB is already an order of magnitude over observed maxima.

### R-4. Stdlib catalog-version drift between replicas
**Risk:** Rolling deployments can briefly have replicas on different
bundled stdlib versions. A `stdlib-pinned` doc targets one version but
sees a drift warning on the mismatched replica.

**Mitigation:**
- Per S7 §10.2 Q2, stdlib version is the container version. Rolling
  deploys briefly see drift warnings; this is a log-level event, not a
  behavioral one (pinned YAML is authoritative). Acceptable.

### R-5. G7 test runs hold open budget
**Risk:** Async G7 jobs enqueued to `ctx.jobs` consume LLM budget via
whatever testing provider they use. If G7 fails catastrophically on
every upsert, budget burns fast.

**Mitigation:**
- G7 scope is out of this PRD (`scheduled`, not implemented here).
- Flag for follow-on: G7 job should call `ctx.llm` with a dedicated
  `testing` tier + low per-run cap (≤ $0.10 default).

### R-6. Admin UI needs to display G7 async results
**Risk:** Admin UX: user uploads YAML, sees 200 OK with compilationReport
showing G7 `pending`, 30s later G7 completes. How does the UI learn?

**Mitigation:**
- Out of scope here; flagged for the Cortex-side follow-on PRD. Same
  emit channel (`methodology.updated` with updated `compilationReport`)
  is the obvious mechanism.

## 13. Acceptance Gates

All gates must be green before merging the PR that ships this PRD.

### 13.1 Test gates

| Gate | Scope | Description |
|------|-------|-------------|
| **AC-1** | agent-runtime | `CortexMethodologySource.init()` resolves `stdlib-plus-overrides` correctly against a fixture stdlib (2 methodologies) + per-app docs (1 override + 1 new). |
| **AC-2** | agent-runtime | `upsert()` blocks invalid YAML at write time with compilationReport gates showing the failing gate. |
| **AC-3** | agent-runtime | `reload(id)` updates the cache idempotently (duplicate events dropped by version check). |
| **AC-4** | agent-runtime | `onChange` fires on both the writing replica (sync) and subscribing replicas (via event fixture). |
| **AC-5** | agent-runtime | `setPolicy` rejects demotion with `POLICY_DEMOTION_REJECTED`. |
| **AC-6** | agent-runtime | `pinFromStdlib` creates a `stdlib-pinned` doc whose YAML matches the stdlib entry at pin time. |
| **AC-7** | agent-runtime | `remove()` on stdlib-only entry returns `STDLIB_ENTRY_NOT_REMOVABLE`. |
| **AC-8** | agent-runtime | `validate()` runs gates without persisting (storage mock shows zero writes). |
| **AC-9** | bridge | `MethodologySessionStore.onMethodologyChange` drops the routing-decision cache keyed on methodologyId. |
| **AC-10** | runtime | `StdlibSource` no-op lifecycle stubs: `init()` / `reload()` resolve, `onChange()` returns a no-op unsubscribe. |

### 13.2 Architecture gates

All four from S7 §11 added to `architecture.test.ts`:

- **G-METHODOLOGY-SOURCE-CORE-SYNC** (runtime) — three core reads stay sync.
- **G-CORTEX-NO-SDK-LEAK** (agent-runtime) — no `@t1/cortex-sdk` / `ctx.storage` / `ctx.events` under `packages/runtime/src/`.
- **G-METHODOLOGY-EVENT-DECLARED** (agent-runtime) — only `'methodology.updated'` passed to `events.on` / `events.emit`.
- **G-DOC-SCHEMA-COLLECTION-NAMES** (agent-runtime) — `methodologies` / `methodology_policy` match PRD-064-Cortex regex.

Plus one new gate introduced here:

- **G-RUNTIME-NO-ADMIN-IMPORT** (agent-runtime) — only files under
  `packages/agent-runtime/src/methodology/` or `packages/agent-runtime/src/admin/`
  may import `CortexMethodologySource` as a value. Runtime paths must
  import the `MethodologySource` port only.

### 13.3 Definition of Done

- All AC-* + G-* gates green in CI.
- Three sample methodology YAMLs (valid, gate-fail, parse-error) shipped
  as test fixtures in `packages/agent-runtime/test-fixtures/methodologies/`.
- Docs update: a new `docs/arch/cortex-methodology-source.md` summarizing
  inheritance modes, hot-reload flow, and the promotion-only policy rule.
  (Size: ~1 page; satisfies DR-12 horizontal pattern.)
- Conformance fixture added to PRD-065 testkit (scoped to that PRD, but
  flagged as follow-up in this PRD's handoff note).

## 14. Judgment Calls

1. **Admin methods on the concrete class, not on the port.** S7 §9.1
   already freezes this; restating for implementers: `upsert`/`remove`/
   `validate`/`pinFromStdlib`/`setPolicy`/`getPolicy`/`getMethodologyDocument`
   are NOT on `MethodologySource`. Runtime code must import the port
   type only. The architecture gate `G-RUNTIME-NO-ADMIN-IMPORT`
   enforces this.

2. **Whole-document schema over decomposed.** Choosing BSON whole-doc
   over per-step collections. Rationale: PRD-064-Cortex has no
   transactions, `find` capped at 1000, no cursors. Whole-doc matches
   admin UX (edit methodology YAML as one artifact). Deferred the
   hypothetical future optimization of "load only metadata, lazy-parse
   YAML on getMethodology" — current corpus makes it unnecessary.

3. **Policy promotion-only.** Rejects demotions at the class level
   instead of flagging and continuing. Demotion drops methodologies;
   running sessions may rely on them. This is strictly safer than
   emitting a deprecation warning and eventually surprising the admin
   with a mid-production session failure.

4. **Re-run G6 on methodts-version mismatch, trust G1-G5.** G6 is
   cheap (serializability round-trip); G1-G5 are expensive. This is
   a deliberate load-time/write-time split; the methodts version pin
   is the trust anchor.

5. **Dual-path hot reload (sync on writer + event fan-out).** Chose
   sync update + emit over "emit-only, rely on fan-out". The latter
   would block the admin API call on SNS/SQS latency (seconds),
   producing a confusing UX where the admin's next read returns stale
   data. Sync update is idempotent against the fan-out by version check.

6. **Single declared event type (`methodology.updated`).** Collapses
   added/updated/removed/reloaded into one event type with a
   discriminator on `envelope.payload.kind`. PRD-072 forbids wildcard
   subscriptions; declaring one type is strictly simpler than
   declaring four.

7. **Keep `StdlibSource` in `@method/runtime/ports`**, not in
   `@method/agent-runtime`. `StdlibSource` is the inheritance base for
   `CortexMethodologySource` — agent-runtime needs to import it. S2
   (RuntimePackageBoundary) moves it; this PRD consumes it as a
   dependency.

8. **No field-level override in v1.** Per S7 §10.2 Q3. Admins who want
   to override one method of `P2-SD` pin the whole `P2-SD` and edit.
   Field-level merging is a future FCD when admin UX demand is
   validated.

## 15. Status & Handoff

- **Status:** draft. Reviewers: Method team (pacta maintainers),
  Cortex team (PRD-072 and PRD-064 owners).
- **Depends on:** PRD-057 (port move, `@method/runtime` package), PRD-058
  (`@method/agent-runtime` scaffold + `CortexCtx` shape).
- **Blocks:** Cortex-side `PlatformMethodologyApi` routes PRD (follow-on);
  PRD-065 conformance fixture for methodology curation.
- **Surface contract:** S7 frozen on 2026-04-14 at
  `.method/sessions/fcd-surface-methodology-source/decision.md`. Any
  change to the contract requires a new `/fcd-surface` session.
