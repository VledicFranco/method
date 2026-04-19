---
type: prd
id: PRD-063
title: "CortexEventConnector — RuntimeEvent → ctx.events with back-pressure, clearance filtering, and manifest-declared topics"
date: "2026-04-14"
status: implemented (PR #181, merged 2026-04-15)
version: 0.1
size: S
domains: ["@methodts/agent-runtime", "@methodts/runtime (event bus, consumer of port)"]
surfaces:
  implements: ["S6 — CortexEventConnector"]
  consumes: ["S3 — CortexServiceAdapters (audit superset + adapter pattern)", "S2 — RuntimePackageBoundary (RuntimeEvent, EventConnector, EventBus)"]
  depends_on:
    - .method/sessions/fcd-surface-event-connector/decision.md  (frozen)
    - .method/sessions/fcd-surface-cortex-service-adapters/decision.md  (frozen)
    - .method/sessions/fcd-surface-runtime-package-boundary/decision.md  (frozen)
related:
  - docs/roadmap-cortex-consumption.md  (§4.2 item 10, §5 B4, §10 S6, §10 O8)
  - ../../t1-repos/t1-cortex-1/docs/prds/072-events-service.md
  - ../../t1-repos/t1-cortex-1/docs/prds/065-audit-service.md
  - ../../t1-repos/t1-cortex-1/docs/prds/069-quotas-and-backpressure.md
author: "Lysica (fcd-design, PO=Franco)"
---

# PRD-063 — CortexEventConnector

## Summary

Ship `CortexEventConnector` inside `@methodts/agent-runtime` — an `EventConnector`
(extending `EventSink`) that translates `@methodts/runtime` `RuntimeEvent`
emissions into Cortex `ctx.events` envelopes. The surface (`S6`) is frozen;
PRD-063 is a small, pure-library, implementation-only container. It builds
three cooperating pieces — connector + static topic registry + manifest-emit
generator — wired through a bounded in-memory buffer and a token-bucket rate
limiter, with fire-and-forget failure semantics and an audit-dual-write safety
net that preserves the `G-AUDIT-SUPERSET` invariant established by S3.

**Size:** S. No new surfaces. Implementation of a frozen surface across ~5
files + tests inside one domain.

---

## Problem

Today, `@methodts/runtime`'s Universal Event Bus (PRD 026) emits `RuntimeEvent`
objects to in-process sinks: WebSocketSink, PersistenceSink, ChannelSink,
GenesisSink, WebhookConnector. These sinks serve the **standalone bridge**.
They cannot reach **other Cortex tenant apps** — in a Cortex deployment, the
only way one app publishes reactive signal to another is through
`ctx.events.emit(topic, payload)` (PRD-072). Without a bridge between the
method runtime bus and `ctx.events`:

1. Cortex tenant apps cannot subscribe to method-originated operational
   signals (`method.session.started`, `method.strategy.gate.awaiting_approval`,
   `method.budget.warning`, `method.tool.used`, ...). The Autonomous Feature
   Development demo cannot route gate-approval prompts to a human-approval app,
   and the Incident Tracking demo cannot drive a Slack-posting app off the
   triage agent's lifecycle.
2. The "audit is the compliance superset" invariant from S3 is only half
   realized — audit captures per-agent-invocation events via
   `CortexAuditMiddleware`, but nothing publishes the *orchestration-level*
   stream (strategy / session / trigger / cost) that other apps must observe
   to be reactive.
3. The bridge's bespoke `WebhookConnector` is a single-URL HTTP POST sink
   with no schema validation, no clearance filtering, no manifest contract —
   unsuitable for the multi-subscriber, classified, quota-governed world of
   `ctx.events`.

Method needs a **connector** — symmetric to `CortexAuditMiddleware` on the
audit path — that materializes the **events path** with the discipline
Cortex enforces: manifest-declared topics, classified fields, bounded
rate, back-pressure, and fire-and-forget failure propagation.

---

## Constraints

### From frozen surfaces

- **S6 (frozen 2026-04-14).** The TypeScript surface in §2.2 of
  `fcd-surface-event-connector/decision.md` is verbatim. Changes require a
  new `/fcd-surface` session. Implementation must import `RuntimeEvent`,
  `EventConnector`, `ConnectorHealth`, `EventFilter` exclusively from
  `@methodts/runtime/ports` — never from `@methodts/bridge` or
  `@methodts/runtime/event-bus` internals.
- **S3 (frozen).** `CortexEventConnector` shares the
  `CortexServiceAdapter<CtxSlice, Config>` shape with `CortexLLMProvider`,
  `CortexAuditMiddleware`, `CortexTokenExchangeMiddleware`. Compose-time
  validation rejects a malformed connector at `createMethodAgent(...)`
  construction, not at first `emit`.
- **S2 (frozen).** `@methodts/runtime` exports `RuntimeEvent`, `EventBus`,
  `EventConnector`, `EventFilter` under the `/ports` subpath. PRD-063 does
  **not** modify the runtime package. The bridge and agent-runtime both
  depend on `@methodts/runtime`, and only agent-runtime depends on this
  connector.

### From Cortex PRDs

- **PRD-072 (`ctx.events`).** Manifest-only subscriptions: the tenant app
  must declare every emitted topic in `cortex-app.yaml` under
  `requires.events.emit[]` with a JSON schema and per-field classifications.
  No runtime wildcard subscriptions are allowed. Schema validation occurs
  server-side at `emit` time. Clearance-above-cap fields are stripped by
  Cortex before delivery — the connector **declares** classification, it
  does not **filter**. Payload ceiling: 256 KB (SNS hard limit).
- **PRD-069 (quotas).** 1000 emits/min/app default (~16.6/s). Connector
  default cap is **12/s** to leave ~25% headroom and absorb other
  same-app emitters without tripping 429.
- **PRD-065 (`ctx.audit`).** Audit is the compliance superset. Every
  RuntimeEvent type that maps to a Cortex events topic must also have a
  `CortexAuditMiddleware` mapping (gate `G-AUDIT-SUPERSET`). The
  implementation must hold this invariant as a compile-time check.

### From S6 §3.3 (mapping table)

- Events-path topics: **21** (enumerated in §"Topic Allowlist" below).
- Audit-only RuntimeEvent types: **~18** (high-frequency or internal churn —
  `agent.text`, `agent.thinking`, observations, project lifecycle,
  `session.state_changed`, internal bus telemetry). These must never hit
  `ctx.events`.
- Events-only RuntimeEvent types: **0**. Every events topic also audits
  (superset invariant).

### From S6 §2.2 (TypeScript surface)

- Exactly one class: `CortexEventConnector implements EventConnector`.
- Fire-and-forget: publish errors NEVER propagate to parent operation.
- Bounded in-memory buffer (default 500), survives transient latency but
  not process restarts. On restart, audit is the durable record.
- Topic whitelist (`config.allowedTopics`) must be a **subset** of
  `METHOD_TOPIC_REGISTRY`. Unlisted RuntimeEvent types are dropped locally
  with a single throttled `connector.topic_undeclared` event.

### Operational

- No new runtime deps (no ULID lib, no schema-validator, no retry lib).
  ULIDs are generated from the already-UUID `runtimeEvent.id`. Retry is
  hand-rolled exponential backoff matching `WebhookConnector` idioms.
- No changes to `@methodts/runtime` (out of scope — PRD-057 owns that package).

---

## Success Criteria

**Functional (unit + integration):**

1. **S1 — Round-trip mapping.** Given every `RuntimeEvent.type` in the 21
   mapped entries of `METHOD_TOPIC_REGISTRY`, the connector produces a
   Cortex envelope whose `eventType` matches the registry and whose
   `payload` passes the topic's JSON schema.
2. **S2 — Audit-only suppression.** Given any RuntimeEvent type in the ~18
   audit-only set (`agent.text`, `session.observation`, …), the connector
   drops it locally — **zero** `ctx.events.emit` calls.
3. **S3 — Topic allowlist enforcement.** With
   `allowedTopics = {'method.session.started'}`, emitting a
   `strategy.started` RuntimeEvent produces zero publishes and a single
   throttled `connector.topic_undeclared` local event.
4. **S4 — Fire-and-forget.** `ctx.events.emit` rejecting (any category)
   MUST NOT propagate an error to the producing agent; gate
   `G-EVENTS-FIRE-AND-FORGET` passes.
5. **S5 — Audit superset preserved.** Compile-time test walks
   `METHOD_TOPIC_REGISTRY.sourceEventTypes` and asserts every member has
   a matching entry in `CortexAuditMiddleware`'s mapping table; gate
   `G-AUDIT-SUPERSET` passes.

**Non-functional (load + observability):**

6. **N1 — Back-pressure thresholds.** With `maxEventsPerSecond: 12`,
   `bufferSize: 500`, and a synthetic burst of 2000 events/10s, the
   connector emits exactly one `connector.degraded` at ≥50%, optionally
   rearms at ≥90%, and emits exactly one `connector.recovered` when the
   buffer drains below 10%.
7. **N2 — Rate cap respected.** `ctx.events.emit` invocation rate never
   exceeds `maxEventsPerSecond * 1.2` over any 1-second window (matching
   `WebhookConnector` sliding-window tolerance).
8. **N3 — Disconnect drain.** `disconnect()` waits up to 5s for the
   buffer to drain; remaining events are logged + dropped, never blocked.
9. **N4 — Gate-approval payload size bound (O8).** With a synthetic
   strategy human-approval gate carrying a 50 KB `artifact_markdown`,
   the produced envelope is ≤ **32 KB** (default truncation threshold)
   and includes both `artifact_preview_markdown` (first N chars) and
   `artifact_ref` (opaque pointer the human-approval dashboard can dereference
   against the bridge or audit record). A measurement harness records
   P50/P95/P99 envelope sizes across the full fixture RuntimeEvent corpus
   and writes a report to `.method/retros/prd-063-envelope-sizes.json`
   for the S6 open-question O8.

**Integration (with S3 siblings):**

10. **I1 — Cortex adapter pattern parity.** The connector's factory signature
    and compose-time validation errors match `CortexLLMProvider` and
    `CortexAuditMiddleware`. `CortexAdapterComposeError` is thrown at
    `createMethodAgent` construction (not first invoke) when `ctx.events`
    is missing from the passed-in `CtxSlice`.
11. **I2 — EventBus registration.** When invoked by
    `createMethodAgent({ ctx: { events, audit, ... }, pact })`, the factory
    creates a `CortexEventConnector`, registers it via
    `eventBus.registerSink(connector)`, awaits `connector.connect()`, and
    tears down via `disconnect()` on agent teardown.

Each success criterion maps to a named test in §Tests.

---

## Scope

### In scope

1. **`packages/agent-runtime/src/cortex/event-connector.ts`** — the
   `CortexEventConnector` class implementing the frozen S6 §2.2 surface.
2. **`packages/agent-runtime/src/cortex/event-topic-registry.ts`** —
   the static `METHOD_TOPIC_REGISTRY` array: 21 `MethodTopicDescriptor`
   entries (topic, sourceEventTypes, schemaVersion, classifications,
   description), matching the §3.3 table of S6 verbatim.
3. **`packages/agent-runtime/src/cortex/event-envelope-mapper.ts`** —
   pure function `toEnvelope(runtimeEvent, registry, config) → Envelope | null`.
   Handles topic lookup, payload projection, ULID derivation from
   `runtimeEvent.id`, and `artifact_markdown` truncation (O8).
4. **`packages/agent-runtime/src/cortex/ctx-types.ts`** — re-export of
   `CortexEventsCtx` interface matching PRD-072 §5.2.
5. **Buffer + rate limiter** — small internal modules (`buffer.ts`,
   `rate-limiter.ts`) inside `packages/agent-runtime/src/cortex/internal/`.
   Algorithms mirror `WebhookConnector` idioms (sliding window, FIFO drop).
6. **`packages/agent-runtime/src/cortex/schemas/method/*.schema.json`** —
   shipped JSON Schemas for each of the 21 topics. Generated by hand in
   this PRD (drift-detection against `RuntimeEvent` types deferred to
   S6 open question O4).
7. **`packages/agent-runtime/src/cortex/generate-manifest-emit-section.ts`** —
   a helper consumed by tenant-app build scripts:
   `generateManifestEmitSection(registry, options?) → ManifestEmitSection`.
   Reads the registry, produces the `requires.events.emit[]` YAML block
   the tenant app concatenates into its `cortex-app.yaml`. Offered both
   as a programmatic API and a CLI entry (`npx @methodts/agent-runtime
   emit-section`).
8. **Compose-time wiring into `createMethodAgent`** — narrow addition to
   the factory: when `ctx.events` is present, construct and register the
   connector; when absent, skip (agent still runs). No new surface here
   — this is S1 internals.
9. **Audit dual-write** — when `auditPublishFailures: true` (default),
   permanent publish failures (schema-rejected, topic-unknown,
   buffer-drop) produce a synthetic `ctx.audit.event` with eventType
   `method.infrastructure.events_publish_failed` and the payload shape
   from S6 §4.3. Reuses the already-wired `ctx.audit` via
   `CortexAuditMiddleware`'s audit port.
10. **Tests** — unit tests for mapper, buffer, rate limiter, connector,
    envelope-size measurement; integration tests against a mock
    `CortexEventsCtx`; gate tests `G-CONNECTOR-RUNTIME-IMPORTS-ONLY`,
    `G-CONNECTOR-TOPIC-ALLOWLIST`, `G-EVENTS-FIRE-AND-FORGET`,
    `G-AUDIT-SUPERSET`.
11. **Envelope-size measurement report.** One-off harness + artifact
    (item N4 above) feeding open question O8.

### Out of scope (explicitly NOT in this PRD)

- **Schema generation from `RuntimeEvent` TypeScript types** (S6 O4).
  We ship hand-written JSON Schemas in v1; revisit if drift materializes.
- **Replay on reconnect** (S6 O2). Audit is the durable record — any
  ring-buffer replay design would require coordinating with PRD-062
  (`ctx.schedule` + checkpoints) and is explicitly deferred.
- **Subscriber introspection helper** (S6 O3). `listSubscribers(topic)` is
  not needed for Wave 1.
- **Modifying `@methodts/runtime`.** PRD-057 owns the runtime package. PRD-063
  is consumer-only. If S6 or PRD-063 discovers a needed runtime-port
  change, it raises an S2 revision, it does not patch runtime directly.
- **Modifying the bridge.** The bridge keeps its existing sinks
  (WebSocketSink, WebhookConnector, persistence). It does not gain a
  `CortexEventConnector` — it has no `ctx.events` to publish to.
- **Cortex-side changes.** Any Cortex-side concerns (rate-limiter tuning,
  tool-registry endpoint, service-account JWTs) are tracked as open
  questions on the roadmap, not in this PRD.

### Explicit non-goals

- **Multi-tenant isolation** — this connector emits for exactly one `appId`
  (single tenant per composition root). Multi-app-per-process is not a
  method concern (roadmap §9).
- **Exactly-once delivery** — `ctx.events` itself is at-least-once (PRD-072);
  the connector inherits that semantic. Downstream apps must be idempotent.
- **Schema evolution** — `schemaVersion` lives in the topic descriptor but
  v2 topics (`method.strategy.gate.awaiting_approval@v2`) are a future
  concern under PRD-072 §5.4.

---

## Domain Map

```
    ┌────────────────────────────────────────────────┐
    │  @methodts/runtime (L3, frozen S2 exports)        │
    │  - EventBus emits RuntimeEvent                  │
    │  - EventConnector port defined here             │
    └────────────────────────┬───────────────────────┘
                             │ (registers as sink at compose-time)
                             ▼
    ┌────────────────────────────────────────────────┐
    │  @methodts/agent-runtime (L3, Cortex-facing)      │
    │  createMethodAgent({ ctx, pact })               │
    │    ├─ CortexLLMProvider    ─┐                   │
    │    ├─ CortexAuditMiddleware ┼── S3 adapters     │
    │    ├─ CortexTokenExchangeMW ─┘                  │
    │    └─ CortexEventConnector  ←── THIS PRD (S6)   │
    └────────────────────────┬───────────────────────┘
                             │ ctx.events.emit(topic, payload)
                             ▼
    ┌────────────────────────────────────────────────┐
    │  Cortex ctx.events (PRD-072)                    │
    │    schema-validate → clearance-filter → fan-out │
    └────────────────────────────────────────────────┘
```

All cross-domain arrows are implemented by **frozen** surfaces:

| Arrow | Surface | Status |
|-------|---------|--------|
| runtime → agent-runtime (RuntimeEvent + EventConnector port) | S2 | frozen |
| agent-runtime → Cortex ctx.* (adapter pattern + CtxSlice) | S3 | frozen |
| agent-runtime → Cortex ctx.events (CortexEventConnector) | S6 | frozen |
| METHOD_TOPIC_REGISTRY → tenant app cortex-app.yaml (manifest emit section) | S6 §5.3 | frozen |

No new surfaces are introduced by PRD-063.

---

## Surfaces (Primary Deliverable — already frozen)

This PRD **implements** surfaces that are already frozen. It does not design
new ones.

| Surface | Status | Path |
|---------|--------|------|
| S6 — `CortexEventConnector` | frozen | `.method/sessions/fcd-surface-event-connector/decision.md` |
| S3 — `CortexServiceAdapters` (pattern + audit superset invariant) | frozen | `.method/sessions/fcd-surface-cortex-service-adapters/decision.md` |
| S2 — `RuntimePackageBoundary` (RuntimeEvent + EventConnector exports) | frozen | `.method/sessions/fcd-surface-runtime-package-boundary/decision.md` |
| S1 — `MethodAgentPort` (`createMethodAgent` factory) | frozen | `.method/sessions/fcd-surface-method-agent-port/decision.md` |

**Implementation invariant.** If implementation discovers that the frozen
surface is insufficient, it MUST raise a new `/fcd-surface` session — it
MUST NOT amend the surface unilaterally. This is ECD Rule 3.

---

## Architecture

### File layout (inside `packages/agent-runtime/`)

```
src/cortex/
  event-connector.ts              — CortexEventConnector class (S6 §2.2)
  event-topic-registry.ts         — METHOD_TOPIC_REGISTRY (21 entries)
  event-envelope-mapper.ts        — pure RuntimeEvent → Envelope projection
  generate-manifest-emit-section.ts  — tenant-app build helper
  ctx-types.ts                    — CortexEventsCtx, MethodTopicDescriptor
  schemas/method/                 — one JSON schema per topic (21 files)
    session-started.schema.json
    session-ended.schema.json
    ...
  internal/
    buffer.ts                     — bounded FIFO with degraded/recovered
                                    threshold callbacks (50%/90%/10%)
    rate-limiter.ts               — sliding-window token bucket (12/s default)
    publish-retry.ts              — exponential backoff over ctx.events.emit
    audit-dual-write.ts           — permanent-failure → ctx.audit fallback
src/cortex/__tests__/
  event-connector.test.ts         — unit + fire-and-forget integration
  event-envelope-mapper.test.ts   — 21 topic round-trips, truncation for O8
  buffer.test.ts                  — threshold transitions, drop-oldest
  rate-limiter.test.ts            — cap respected, burst tolerance
  generate-manifest-emit-section.test.ts
  gates.test.ts                   — G-CONNECTOR-*, G-AUDIT-SUPERSET
  envelope-sizes.measure.ts       — O8 harness (opt-in, not in default test run)
```

No module under `src/cortex/` may import from `@methodts/bridge`, nor from
any `@methodts/runtime/event-bus` internals. Only `@methodts/runtime/ports`
is permitted for runtime types.

### In-process bounded buffer (500 default)

Shape:

```typescript
interface Buffer<T> {
  push(item: T): { accepted: true } | { accepted: false; dropped: T };
  shift(): T | undefined;
  depth(): number;
  capacity(): number;
  onThresholdCrossed(cb: (ev: 'degraded-50' | 'degraded-90' | 'recovered-10') => void): void;
}
```

Semantics:

- FIFO, `push` returns `accepted: false` only when at capacity; on overflow
  the **oldest** item is evicted and returned as `dropped` — the emitter
  records `health.errorCount++` and does NOT emit
  `connector.publish_failed` per-event (noise amplification). A single
  `connector.degraded` is emitted on the first threshold crossing, re-armed
  at 90%. `connector.recovered` emits on the first drop below 10% after
  a prior degraded.
- Threshold edges are computed relative to `capacity`, not to absolute
  counts, so `bufferSize` can be retuned at compose-time without test
  churn.

### Rate limiter (12/s default, matching PRD-069 headroom)

Matches `WebhookConnector`'s sliding-window approach (deliberate symmetry):

```typescript
interface RateLimiter {
  tryAcquire(): boolean;          // true → go ahead and publish now
  waitTime(): number;             // ms until next token if not acquired
}
```

- Window = 1000ms rolling; tolerance up to 2× at window boundaries is
  acceptable (documented in S6 §4.4 and mirrored from `WebhookConnector`).
- When `tryAcquire()` returns false, the event goes to the buffer; a
  drain loop (every 50ms while buffer non-empty) retries.
- Default cap `maxEventsPerSecond: 12`; hard ceiling is PRD-069's 16.6/s
  per-app. Leaving ~25% headroom for other in-process emitters (other
  pacta middleware that might also publish to `ctx.events`).

### Topic allowlist (21 topics — from S6 §3.3)

These are the `METHOD_TOPIC_REGISTRY` entries. Groupings:

**Session lifecycle (4):**
- `method.session.started` (classification: `$.workdir` L1)
- `method.session.ended` (no classification — reason='killed' or 'crashed')
- `method.session.stale` (no classification)
- `method.session.error` (classification: `$.error.message` L1)
- `method.session.prompt.completed` (classification: `$.promptPreview` L1)

**Strategy lifecycle + gates (7):**
- `method.strategy.started` (classification: `$.strategyId` L0)
- `method.strategy.completed` (classification: `$.result.summary` L1)
- `method.strategy.failed` (classification: `$.error.message` L1)
- `method.strategy.gate` (result='passed' — no classification; merged with gate_failed)
- `method.strategy.gate` (result='failed' — classification: `$.reason` L1; same topic)
- `method.strategy.gate.awaiting_approval` (classification: `$.artifact_markdown` L2) — **largest payload risk, see O8**
- `method.strategy.gate.approval_response` (classification: `$.feedback` L1)

**Trigger + methodology (3):**
- `method.trigger.fired` (classification: `$.payload.*` L1)
- `method.methodology.step_started`
- `method.methodology.step_completed` (classification: `$.output` L2)

**Agent + tools (4):**
- `method.tool.used` (classification: `$.input.*` L2) — **reactive surface**
- `method.agent.error` (classification: `$.message` L1)
- `method.agent.completed` (classification: `$.usage.totalCostUsd` L1)
- `method.budget.warning` (classification: `$.resource`, `$.percentUsed` L0)
- `method.budget.exhausted`

**Cost + system health (3):**
- `method.cost.rate_limited`
- `method.cost.account_saturated`
- `method.cost.integrity_violation` (classification: `$.detail` L2)
- `method.system.bridge_state` (classification: `$.crashDetail` L2 only on crash)
- `method.system.recovery`

Count: **21 distinct topics**, matching S6 §3.3 exactly (two `gate`
entries share the topic `method.strategy.gate` with `result` discriminator;
`session.killed` and `session.dead` merge into `method.session.ended`).

### Back-pressure mechanism

```
RuntimeEvent arrives at connector.onEvent()
   │
   ▼
[ filter.match? ]──no──► drop silently
   │ yes
   ▼
[ topic lookup in registry ]──miss──► emit connector.topic_undeclared (throttled)
   │ hit
   ▼
[ allowedTopics.has(topic)? ]──no──► drop silently (already-throttled topic_undeclared)
   │ yes
   ▼
[ rateLimiter.tryAcquire() ]
   │
   ├─ yes ─► ctx.events.emit(topic, payload)
   │            │
   │            ├─ success: health.lastEventAt updated
   │            ├─ 4xx schema/topic: drop, emit connector.schema_rejected, audit-dual-write
   │            ├─ 4xx other:    same as schema
   │            └─ 5xx/429/timeout: backoff retry (up to maxRetries) → on exhaustion, buffer
   │
   └─ no ──► buffer.push(event)
                │
                ├─ accepted: drain loop picks up
                └─ dropped-oldest: health.errorCount++
                                   if crossed 50% / 90%:
                                     emit connector.degraded once
```

**Thresholds:**

| Threshold | Event emitted | Re-arm |
|-----------|---------------|--------|
| Buffer ≥ 50% of capacity | `connector.degraded` (warning) | once per occupancy cycle |
| Buffer ≥ 90% of capacity | `connector.degraded` (warning) | re-armed after drop below 50% |
| Buffer < 10% of capacity after a prior degraded | `connector.recovered` (info) | once per occupancy cycle |
| Individual event drop (buffer full) | nothing (noise amp avoided); `health.errorCount++` | — |

### Failure model (fire-and-forget + audit dual-write)

| Failure | Connector action | Parent operation impact |
|---------|------------------|-------------------------|
| ctx.events 429 (quota/rate) | Exponential backoff retry (baseMs, `maxRetries`); on exhaustion → buffer | None |
| ctx.events 5xx / timeout | Same as 429 | None |
| ctx.events 4xx schema-rejected | Drop, emit `connector.schema_rejected`; if `auditPublishFailures: true` (default), write to `ctx.audit` as `method.infrastructure.events_publish_failed` | None |
| ctx.events 4xx topic-unknown | Drop, emit `connector.topic_undeclared` (once per topic); audit-dual-write as above | None |
| Connector itself throws | Caught by bus dispatcher's `onError`; `health.errorCount++`; not propagated | None |
| Compose-time: `ctx.events` missing | `createMethodAgent` throws `CortexAdapterComposeError({ reason: 'missing_ctx_service', detail: { service: 'events' } })` | Agent fails to compose — NOT a runtime failure |

**Invariant:** the connector is observational infrastructure. The only path
to a failed agent invocation is pacta's own error handling. Publish errors
never fail the parent operation. Gate `G-EVENTS-FIRE-AND-FORGET` asserts this.

### Manifest integration (`generateManifestEmitSection`)

The registry is the **single source of truth** for the manifest's
`requires.events.emit[]`. Tenant apps never hand-author these entries —
they generate them at build time:

```typescript
// packages/agent-runtime/src/cortex/generate-manifest-emit-section.ts

export interface ManifestEmitEntry {
  type: string;          // the topic
  schema: string;        // relative path — tenant app copies schemas or references via node_modules
  classifications: Array<{ field: string; level: 0 | 1 | 2 | 3 }>;
  description?: string;
}

export interface ManifestEmitOptions {
  /** Filter to a subset of topics (intersection with allowedTopics). */
  topics?: ReadonlySet<string>;
  /** How tenant app references shipped schemas. Default: 'node_modules'. */
  schemaRefMode?: 'node_modules' | 'copied';
  /** Relative prefix for 'copied' mode (e.g. './schemas/method/'). */
  copiedSchemaPrefix?: string;
}

export function generateManifestEmitSection(
  registry: readonly MethodTopicDescriptor[] = METHOD_TOPIC_REGISTRY,
  options?: ManifestEmitOptions
): ManifestEmitEntry[];

// CLI entry: npx @methodts/agent-runtime emit-section [--topics=...] [--format=yaml|json]
// Writes to stdout. Tenant-app build scripts pipe into cortex-app.yaml.
```

This closes the loop between the topic registry and the manifest —
changes to the registry automatically propagate to the manifest on
the next tenant-app build. Drift is detectable via CI: tenant apps run
`generateManifestEmitSection`, diff against `cortex-app.yaml`'s emit
section, fail if mismatch.

---

## Per-Domain Architecture

### `@methodts/agent-runtime` (the only affected domain)

**Layer placement.** The cortex subtree (`src/cortex/`) sits at L3 —
library-shaped, transport-aware (it knows about `ctx.*` and HTTP-like
failure categories via its abstract `CortexEventsCtx` port), but
process-free.

**Internal structure.** See §Architecture file layout above.

**Port implementations.** Consumes:
- `RuntimeEvent`, `EventConnector`, `ConnectorHealth`, `EventFilter` from
  `@methodts/runtime/ports` (S2).
- `CortexEventsCtx` from local `ctx-types.ts` (a narrow slice of PRD-072).
- `CortexAuditCtx` re-used via `CortexAuditMiddleware`'s audit hook — the
  connector does not directly hold an audit port; it goes through the
  middleware's exposed `writeAudit(record)` helper to keep a single
  audit code path. (Small internal convenience; not a new surface.)

**Port consumption.** Injected at compose-time by `createMethodAgent`:

```typescript
// Inside createMethodAgent, roughly:
if (ctx.events) {
  const connector = new CortexEventConnector(
    { appId: ctx.appId, allowedTopics: resolvedAllowed, bufferSize: 500, maxEventsPerSecond: 12 },
    ctx.events,
    { writeAudit: ctx.audit ? (record) => cortexAudit.writeRecord(record) : undefined }
  );
  await connector.connect();
  eventBus.registerSink(connector);
  teardownSteps.push(() => connector.disconnect());
}
```

**Verification strategy.** See §Tests. Each of the 11 success criteria has a
named test.

**Migration path.** None — agent-runtime is a new package (PRD-058). No
backwards compatibility concerns yet.

### Gates

| Gate | Scope | Assertion |
|------|-------|-----------|
| `G-CONNECTOR-RUNTIME-IMPORTS-ONLY` | file-scope | `event-connector.ts` imports only from `@methodts/runtime/ports`, never from bridge or event-bus internals |
| `G-CONNECTOR-TOPIC-ALLOWLIST` | runtime | Envelope mapper throws on topic not in `METHOD_TOPIC_REGISTRY` |
| `G-EVENTS-FIRE-AND-FORGET` | integration | `ctx.events.emit` rejection does not propagate to pacta agent invocation |
| `G-AUDIT-SUPERSET` | cross-surface compile-time | Every `METHOD_TOPIC_REGISTRY.sourceEventTypes` member has a corresponding entry in `CortexAuditMiddleware`'s event→audit mapping |
| `G-PORT` | structural | `CortexEventConnector` implements `EventConnector` interface shape verbatim |
| `G-LAYER` | structural | `packages/agent-runtime/src/cortex/` imports only from L3-and-below (pacta, runtime, methodts) — no fastify, no pty, no Cortex-specific process deps |

All gates run under `npm --workspace=@methodts/agent-runtime test`.

---

## Tests

Structured around the 11 success criteria from §Success Criteria and the
gate assertions from §Gates.

### Unit tests

| Test | File | Maps to |
|------|------|---------|
| `mapper: every mapped RuntimeEvent type produces a valid envelope` (21 cases) | `event-envelope-mapper.test.ts` | S1 |
| `mapper: audit-only RuntimeEvent types return null` (~18 cases) | `event-envelope-mapper.test.ts` | S2 |
| `mapper: throws on unknown type` | `event-envelope-mapper.test.ts` | `G-CONNECTOR-TOPIC-ALLOWLIST` |
| `mapper: truncates artifact_markdown > 32KB and emits artifact_ref` | `event-envelope-mapper.test.ts` | N4 (O8) |
| `buffer: crosses 50% threshold emits degraded once` | `buffer.test.ts` | N1 |
| `buffer: re-arms at 90% after drop below 50%` | `buffer.test.ts` | N1 |
| `buffer: drops oldest on capacity; errorCount++` | `buffer.test.ts` | N1 |
| `buffer: recovered emits once on drop below 10%` | `buffer.test.ts` | N1 |
| `rate-limiter: cap enforced over 1s window` | `rate-limiter.test.ts` | N2 |
| `rate-limiter: burst up to 2x tolerated at boundaries` | `rate-limiter.test.ts` | N2 |
| `generateManifestEmitSection: returns 21 entries matching registry` | `generate-manifest-emit-section.test.ts` | S1 / manifest closure |
| `generateManifestEmitSection: honors topic subset option` | `generate-manifest-emit-section.test.ts` | S3 |

### Integration tests

| Test | File | Maps to |
|------|------|---------|
| `connector drops RuntimeEvent not in allowedTopics; emits throttled topic_undeclared` | `event-connector.test.ts` | S3 |
| `connector: ctx.events rejection does not throw to caller` | `event-connector.test.ts` | S4 |
| `connector: schema-rejected → connector.schema_rejected + audit dual-write` | `event-connector.test.ts` | Audit dual-write |
| `connector: 500+ event burst exercises back-pressure (degraded/recovered sequence)` | `event-connector.test.ts` | N1 |
| `connector: disconnect drains within 5s; remaining dropped + logged` | `event-connector.test.ts` | N3 |
| `createMethodAgent without ctx.events: no connector registered; emit path absent` | `compose.test.ts` | I1 |
| `createMethodAgent with ctx.events: connector registered; teardown called` | `compose.test.ts` | I2 |

### Gate tests

| Gate | File |
|------|------|
| `G-CONNECTOR-RUNTIME-IMPORTS-ONLY` | `gates.test.ts` |
| `G-CONNECTOR-TOPIC-ALLOWLIST` | `gates.test.ts` |
| `G-EVENTS-FIRE-AND-FORGET` | `gates.test.ts` |
| `G-AUDIT-SUPERSET` | `gates.test.ts` |

### O8 measurement harness

File: `envelope-sizes.measure.ts` (opt-in, not in default `npm test`).

- Loads a fixture corpus of ~500 RuntimeEvents (drawn from
  `experiments/log/` real runs + synthetic strategy human-approval gates
  with `artifact_markdown` ranging 1 KB → 1 MB).
- For each event, runs the mapper and measures the serialized envelope
  byte count.
- Produces `.method/retros/prd-063-envelope-sizes.json`:

```json
{
  "date": "2026-04-XX",
  "topics": [
    {
      "topic": "method.strategy.gate.awaiting_approval",
      "count": 47,
      "p50_bytes": 1843,
      "p95_bytes": 32000,
      "p99_bytes": 32000,
      "max_bytes": 32000,
      "truncated_count": 12,
      "truncation_threshold": 32768
    },
    ...
  ],
  "sns_limit_bytes": 262144,
  "max_envelope_bytes": 32123,
  "headroom_ratio": 0.12
}
```

- Feeds open question **O8** directly: confirms truncation threshold is
  sufficient and that no topic approaches the 256 KB SNS ceiling.

---

## Phase Plan

PRD-063 is **Size: S**. Two waves inside the one-domain lifecycle.
Wave 0 work is minimal — all cross-domain surfaces are already frozen.

### Wave 0 — Surfaces (≤ 1 day)

- **W0.1** Confirm `@methodts/runtime/ports` exports `RuntimeEvent`,
  `EventConnector`, `EventFilter`, `ConnectorHealth` per S2. (Should be
  true after PRD-057 ships — blocker if not.)
- **W0.2** Confirm `CortexAuditMiddleware` exposes `writeAudit(record)` or
  equivalent, usable from the connector for dual-write. (If not, add a
  small internal convenience method inside `@methodts/agent-runtime` — NOT
  a new surface.)
- **W0.3** Add `G-AUDIT-SUPERSET` gate test skeleton (empty — to be
  filled in Wave 1 once both mapping tables exist).

**Acceptance:** imports resolve, gate skeleton present, no new surfaces
added.

### Wave 1 — Implementation (2–3 days)

- **W1.1** `ctx-types.ts` — `CortexEventsCtx`, `MethodTopicDescriptor`.
- **W1.2** `event-topic-registry.ts` — 21 entries + JSON schema shells.
- **W1.3** `event-envelope-mapper.ts` — pure projection, truncation logic
  for O8.
- **W1.4** `internal/buffer.ts` + `internal/rate-limiter.ts`.
- **W1.5** `internal/publish-retry.ts` + `internal/audit-dual-write.ts`.
- **W1.6** `event-connector.ts` — assemble the above.
- **W1.7** `generate-manifest-emit-section.ts` + CLI entry.
- **W1.8** Full test suite (unit + integration + gates).
- **W1.9** Wire into `createMethodAgent` (conditional on `ctx.events`).
- **W1.10** Measurement harness + O8 report; attach to PRD-063 as
  `.method/retros/prd-063-envelope-sizes.json`.

**Acceptance:**
1. All 11 success criteria tests pass.
2. All 6 gates pass.
3. O8 measurement report produced; if `max_envelope_bytes > 200 KB` for
   any topic, flag to S6 owner for re-freeze.
4. `@methodts/agent-runtime` builds with zero new `@methodts/bridge` or
   `@methodts/runtime/event-bus` imports under `src/cortex/`.
5. `npm --workspace=@methodts/agent-runtime test` green.

### Dependency DAG

```
PRD-057 (runtime extraction) ──► PRD-058 (agent-runtime skeleton) ──┐
                                                                    ├─► PRD-063 Wave 1
PRD-059 (S3 adapters incl. CortexAuditMiddleware) ──────────────────┘
```

PRD-063 cannot start Wave 1 until PRDs 057 + 058 + 059 have each shipped
the surfaces listed in §Constraints. Wave 0 can begin once PRD-057 is in
review (confirms S2 exports).

---

## Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| R1 | **Gate-approval payload exceeds 32 KB truncation threshold** on real workloads — some orchestrator patterns concatenate multiple artifacts into one markdown (O8 from S6). | Medium | Medium — subscriber apps get truncated previews | N4 measurement harness runs *early* in Wave 1 (before connector assembly). If P99 > 32 KB, bump to 64 KB (still ≪ 256 KB SNS ceiling) and revisit with S6 owner. Ship `artifact_ref` pointer so full artifact is always retrievable via bridge or audit. |
| R2 | **`METHOD_TOPIC_REGISTRY` drifts from `RuntimeEvent` type definitions** — a new RuntimeEvent type is added in `@methodts/runtime` without a registry entry, going silently audit-only. | Medium | Low — silent events-path gap | Compile-time test (`gates.test.ts`) walks every `RuntimeEvent.type` literal (discoverable via exhaustive union check) and asserts either a registry entry OR an explicit allowlist of audit-only types. Fails CI on drift. S6 O4 (schema codegen) is a longer-term fix. |
| R3 | **Hand-written JSON Schemas drift from TypeScript payload types** — fields renamed in TS without schema update. | Medium | Medium — ctx.events 4xx schema-rejected in prod | Same as R2 — compile-time test materializes each topic's TS payload shape via a type-level helper and asserts JSON schema round-trip. Defer `zod-to-json-schema` codegen (S6 O4) unless drift materializes repeatedly. |
| R4 | **Rate limiter miscalibration** — 12/s too conservative (drops reactive signal) or too aggressive (trips PRD-069 429). | Low | Low | Measurement N2 + audit dual-write ensure no silent loss; retunable via config without a new surface session. |
| R5 | **Audit dual-write amplifies load** — every schema-rejected event writes to audit, which writes to Mongo, which may throttle. | Low | Low | Dual-write is permanent-failure-only (should be near-zero in steady state). Failures cluster around topic/schema mismatches caught at CI. Add circuit-breaker if field reports show volume. |
| R6 | **Compose-time validation false-positive** — tenant app legitimately runs without `ctx.events` (e.g., a non-reactive agent) and still loads agent-runtime. | Low | Medium — crashes on start | §Per-Domain Architecture specifies conditional wiring (`if (ctx.events) { … }`). Without `ctx.events`, the agent runs; connector is absent; audit path still covers. Test `createMethodAgent without ctx.events` verifies this. |
| R7 | **Drain on disconnect is too short** — 5s hard-coded, long flushes under contention lose events. | Low | Low (events are best-effort) | Audit is the durable record (G-AUDIT-SUPERSET). Surface tuning as future config if operators report loss. |
| R8 | **Schema version bumps break subscribers** — changing `schemaVersion` without dual-emit breaks `@v1` subscribers. | Low | High (tenant-facing) | Out of scope for this PRD — PRD-072 §5.4 owns the schema-evolution contract. PRD-063's registry ships v1 for all 21 topics; `@v2` becomes a new surface decision. |

**Top risk:** R1 (O8 payload size). Mitigated by running the measurement
harness early in Wave 1, not at the end.

---

## Open Questions (inherited from S6, owned by PRD-063 implementation)

| # | Source | Question | PRD-063 answer |
|---|--------|----------|----------------|
| O8 | S6 §8.1 | `method.strategy.gate.awaiting_approval` payload size risk | **Measure via N4 harness. Ship 32 KB truncation + `artifact_ref` pointer. Re-freeze S6 only if measurements demand.** |
| O2 | S6 §8.2 | Replay on reconnect | Deferred — audit is durable; Cortex subscribers have at-least-once from SQS. |
| O3 | S6 §8.3 | `listSubscribers(topic)` helper | Deferred — not needed for Wave 1. |
| O4 | S6 §8.4 | Schema generation from RuntimeEvent TS types | Deferred — hand-written schemas in v1; add codegen when drift pain appears. |
| O5 | S6 §8.5 | `method.cost.*` `accountId` classification | **Proposal: L1** (internal billing identifier). Flagged to Cortex security review during PRD-063 implementation; registry default is L1 pending confirmation. |

---

## Acceptance Gates

PRD-063 is accepted when:

1. **All 11 success criteria tests pass** (see §Tests) under
   `npm --workspace=@methodts/agent-runtime test`.
2. **All 6 gates pass** (G-CONNECTOR-RUNTIME-IMPORTS-ONLY,
   G-CONNECTOR-TOPIC-ALLOWLIST, G-EVENTS-FIRE-AND-FORGET,
   G-AUDIT-SUPERSET, G-PORT, G-LAYER).
3. **Envelope-size measurement report** `.method/retros/prd-063-envelope-sizes.json`
   is produced, attached, and confirms no topic exceeds 200 KB at P99
   (12 KB headroom below the 256 KB SNS ceiling). If any topic does,
   PRD-063 blocks on an S6 re-freeze session.
4. **Manifest emit section generator** `generateManifestEmitSection()`
   produces a YAML block that round-trips through `js-yaml` parse/dump
   and whose entries match `METHOD_TOPIC_REGISTRY` one-for-one.
5. **Cookbook entry added** to `docs/guides/` (PR-01 process
   compliance): "Wiring CortexEventConnector in a tenant app" — references
   `createMethodAgent`, shows compose-time `ctx.events` requirement, shows
   the `generateManifestEmitSection` build step.
6. **No new surfaces opened.** If implementation required a surface
   change, PRD-063 blocks and a new `/fcd-surface` session is opened.

---

## Notes

- **Composition symmetry:** `CortexEventConnector` completes the S3 adapter
  family (LLM, Audit, TokenExchange, Events). S4 (SessionStore, PRD-061)
  and S5 (JobBackedExecutor, PRD-062) are the last two adapters in the
  pattern. Once all five land, `@methodts/agent-runtime` is feature-complete
  for Group B of the roadmap checklist.
- **Audit is the compliance record; events is best-effort reactive.**
  This PRD holds that invariant on the events path. The runtime ring buffer
  + audit-dual-write + disconnect-drain each reinforce it. A crash before
  publish loses the event from `ctx.events` but never from `ctx.audit`.
- **Bridge is unaffected.** The bridge keeps WebSocketSink +
  WebhookConnector + PersistenceSink. It never gains a
  `CortexEventConnector` because it has no `ctx.events` to publish to.
  PRD-063 adds **zero** lines to `packages/bridge/`.
