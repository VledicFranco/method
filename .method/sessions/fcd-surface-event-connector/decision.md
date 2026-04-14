---
type: co-design-record
surface: "CortexEventConnector"
slug: fcd-surface-event-connector
date: "2026-04-14"
owner: "@method/agent-runtime (L3, planned — PRD-058 / PRD-063)"
producer: "@method/runtime event bus (emits RuntimeEvent)"
consumer: "Cortex ctx.events service (PRD-072) — fanned out to subscribing apps"
direction: "runtime → cortex-events (unidirectional; connector does not pull from ctx.events)"
status: frozen
mode: new
related:
  - docs/roadmap-cortex-consumption.md §4.2 item 10
  - PRD-063 (implementation container)
  - .method/sessions/fcd-surface-runtime-package-boundary/decision.md  (RuntimeEvent rename)
  - .method/sessions/fcd-surface-cortex-service-adapters/decision.md   (CortexAuditMiddleware — complementary path)
  - t1-cortex-1/docs/prds/072-events-service.md
  - t1-cortex-1/docs/prds/065-audit-service.md
  - t1-cortex-1/docs/rfcs/RFC-005-app-platform-service-library.md §4
---

# Co-Design Record — CortexEventConnector

> Translate `@method/runtime` `RuntimeEvent` objects into Cortex `EventEnvelope`
> records on `ctx.events`, with manifest-declared topics, clearance-aware
> payloads, and explicit audit-vs-events split. Lives in `@method/agent-runtime`
> so the runtime core stays transport-free.

---

## 1. Context & Framing

### 1.1 Where this surface lives

```
  @method/runtime (L3, transport-free)
      ├── event-bus/  emits RuntimeEvent to EventSink / EventConnector
      │
      ▼ (via EventConnector interface, already exported from runtime/ports)
  @method/agent-runtime (L3, Cortex-facing)
      └── cortex/event-connector.ts   ←  CortexEventConnector (THIS SURFACE)
          │
          ▼ calls ctx.events.emit(topic, payload)
  Cortex ctx.events (platform service, PRD-072)
          │
          ▼ schema-validate → clearance-filter → SNS/SQS fan-out
  Subscribing Cortex apps (per manifest requires.events.on[])
```

`CortexEventConnector` implements `EventConnector` (already frozen in
runtime-package-boundary). It is **not** part of `@method/runtime` itself —
runtime has zero Cortex dependencies. The connector is an adapter shipped from
`@method/agent-runtime` and registered at the composition root of whatever
Cortex tenant app embeds the runtime.

### 1.2 Why "events" and "audit" are BOTH needed

Method emits high-volume operational telemetry (every tool use, every cycle,
every gate). Cortex has two orthogonal consumer shapes:

| Cortex service | Purpose | Retention | Consumers |
|---|---|---|---|
| `ctx.audit` (PRD-065) | Immutable compliance record | 90d+ | Security, billing, regulators |
| `ctx.events` (PRD-072) | Pub/sub reactive fan-out | Queue-lifetime (hours) | Other tenant apps that subscribe |

These are **different data shapes with different delivery contracts.** The
agent-runtime already has `CortexAuditMiddleware` (see
`fcd-surface-cortex-service-adapters`, Surface 2) writing every pacta
`AgentEvent` to `ctx.audit`. That covers the **per-agent-invocation**
compliance trail.

This surface adds the **event-stream** path: operational events that *other
apps want to react to*, routed through `ctx.events` where Cortex enforces the
manifest contract, schema validation, clearance filtering, and fan-out.

**The split is content-based, not duplicative** (§4).

### 1.3 Constraints from PRD-072

- **Manifest-only subscriptions.** The emitting app must declare every topic
  it emits in `cortex-app.yaml` under `requires.events.emit[]` with a JSON
  schema and field classifications. Runtime cannot dynamically invent topics.
- **Schema-validated emit.** Payload shape is checked by Cortex at publish
  time. Unknown fields or shape violations → `emit` rejects.
- **Clearance-filtered fan-out.** Fields annotated with `classificationLevel`
  above a subscriber's cap are **stripped by Cortex** before delivery. The
  connector does not do filtering — it **declares** classification.
- **256 KB payload ceiling** (SNS hard limit).
- **1000 emits/min/app quota** (PRD-069) — the connector must respect
  back-pressure.

---

## 2. The Surface

### 2.1 Package location

```
packages/agent-runtime/
└── src/cortex/
    ├── event-connector.ts         ← THIS SURFACE
    ├── event-topic-registry.ts    ← static topic taxonomy + classifications
    ├── event-envelope-mapper.ts   ← RuntimeEvent → payload projection
    └── ctx-types.ts               ← CortexEventsCtx (re-exported)
```

### 2.2 TypeScript surface (frozen)

```typescript
// @method/agent-runtime/src/cortex/event-connector.ts

import type {
  EventConnector,
  ConnectorHealth,
  RuntimeEvent,
  EventFilter,
} from '@method/runtime/ports';
import type { CortexEventsCtx } from './ctx-types.js';

// ── Config ──────────────────────────────────────────────────────

export interface CortexEventConnectorConfig {
  /** The Cortex app id — for source attribution + audit symmetry. */
  appId: string;

  /**
   * Events this connector is allowed to translate. Must be a subset of the
   * topics declared in the tenant app's manifest `requires.events.emit[]`.
   * Undeclared RuntimeEvent types are dropped with a single
   * `connector.topic_undeclared` local-bus event (not throttled per-event).
   */
  allowedTopics: ReadonlySet<string>;  // e.g. new Set(['method.session.started', ...])

  /**
   * Optional local filter to narrow what the connector considers at all
   * (before topic mapping). Mirrors WebhookConnector's filter semantics.
   */
  filter?: EventFilter;

  /**
   * Bounded in-memory buffer for back-pressure (events awaiting publish
   * after a 429 / transient ctx.events failure). Default: 500.
   * When full, oldest events are dropped and `connector.degraded` is
   * emitted on the local bus.
   */
  bufferSize?: number;

  /**
   * Max publish attempts per event before dropping + logging failure.
   * Cortex ctx.events handles its own DLQ on the *subscriber* side;
   * the connector only retries transient publish errors. Default: 3.
   */
  maxRetries?: number;

  /**
   * Base delay for retry backoff (ms). Exponential: baseMs * 2^attempt.
   * Default: 1000.
   */
  retryBaseMs?: number;

  /**
   * Per-second rate cap on ctx.events.emit calls from this connector,
   * tuned below the PRD-069 per-app quota (1000/min = ~16/s). Default: 12.
   * Excess events are buffered (not dropped) up to bufferSize.
   */
  maxEventsPerSecond?: number;

  /**
   * Enable the "dual-write" safety net: if ctx.events.emit fails with a
   * non-retryable error (schema mismatch, topic unknown), still emit an
   * audit record via ctx.audit with reason code 'events_publish_failed'.
   * Default: true.
   */
  auditPublishFailures?: boolean;
}

// ── Connector ───────────────────────────────────────────────────

/**
 * CortexEventConnector — translates @method/runtime RuntimeEvent emissions
 * into Cortex ctx.events envelopes.
 *
 * Owner:    @method/agent-runtime
 * Producer: @method/runtime event bus (emits RuntimeEvent)
 * Consumer: Cortex ctx.events service (via CortexEventsCtx)
 * Status:   frozen — changes require a new /fcd-surface session
 *
 * Contract:
 *   - Implements EventConnector from @method/runtime/ports
 *   - Fire-and-forget: publish errors NEVER fail the producing domain
 *   - Bounded buffer + back-pressure → `connector.degraded` local event
 *   - Clearance classification is declared in the topic registry, not
 *     computed at runtime. Cortex enforces filtering.
 *   - Topic whitelist enforces manifest alignment; unlisted RuntimeEvent
 *     types are dropped locally.
 */
export class CortexEventConnector implements EventConnector {
  readonly name: string;            // e.g. 'cortex-events:<appId>'

  constructor(config: CortexEventConnectorConfig, eventsCtx: CortexEventsCtx);

  // EventConnector lifecycle
  connect(): Promise<void>;          // warms registry, verifies topics declared
  disconnect(): Promise<void>;       // flushes buffer (best-effort, bounded wait)
  health(): ConnectorHealth;         // connected + lastEventAt + errorCount

  // EventSink
  onEvent(event: RuntimeEvent): void;
  onError(error: Error, event: RuntimeEvent): void;

  /** Buffered events awaiting publish (for diagnostics). */
  bufferDepth(): number;
}

// ── Supporting types (re-exported from subpath) ────────────────

export interface CortexEventsCtx {
  /** PRD-072 §5.2 — ctx.events.emit signature. */
  emit(topic: string, payload: unknown): Promise<{ eventId: string; subscriberCount: number }>;
}

// ── Local-bus events emitted BY the connector (re-entry into runtime bus) ─

/**
 * The connector emits its own diagnostic events to the local runtime bus
 * under domain='system' — other sinks (Genesis, persistence) see them.
 *
 *   connector.degraded         (warning) — buffer threshold crossed; publish backlog growing
 *   connector.recovered        (info)    — buffer drained below threshold
 *   connector.topic_undeclared (warning) — RuntimeEvent type not in allowedTopics
 *   connector.publish_failed   (error)   — retry budget exhausted for an event
 *   connector.schema_rejected  (error)   — ctx.events returned 4xx schema validation error
 */
```

### 2.3 Topic registry (static, compile-time)

```typescript
// @method/agent-runtime/src/cortex/event-topic-registry.ts

import type { EventFieldClassification } from './ctx-types.js';

/**
 * One entry per Cortex topic the method runtime can emit. This is the single
 * source of truth the tenant app's manifest generator reads to produce
 * `requires.events.emit[]` at build time.
 */
export interface MethodTopicDescriptor {
  /** Cortex topic name (dotted, namespaced under 'method.'). */
  topic: string;
  /** Which RuntimeEvent `type` values project into this topic. */
  sourceEventTypes: readonly string[];
  /** Semver of the payload schema. */
  schemaVersion: number;
  /** JSONPath classifications (applied by Cortex at fan-out). */
  classifications: readonly EventFieldClassification[];
  /** Human description (for manifest docs + admin UI). */
  description: string;
}

export const METHOD_TOPIC_REGISTRY: readonly MethodTopicDescriptor[];
```

---

## 3. RuntimeEvent → Cortex Envelope Mapping

### 3.1 Envelope construction

Given a `RuntimeEvent`, the connector builds a Cortex publish payload:

| Cortex field (PRD-072 `EventEnvelope`) | Value derived from |
|---|---|
| `eventId` | ULID — generated by the connector **locally** from `runtimeEvent.id` (already UUID); kept so Cortex can dedupe on retries |
| `eventType` (topic) | Looked up via `METHOD_TOPIC_REGISTRY` keyed by `runtimeEvent.type` |
| `emitterAppId` | `config.appId` |
| `emittedAt` | `runtimeEvent.timestamp` (preserved — do NOT resample) |
| `emittedBy` | user sub from scoped token IF present in ctx; else `service:${appId}` |
| `payload` | Projection — see §3.3 |
| `schemaVersion` | From topic descriptor |

Fields Cortex assigns: `receiptHandle`, `filteredFields` (per-subscriber).

### 3.2 Audit-vs-events split — explicit mapping

**Rule:** a RuntimeEvent goes to `ctx.events` if and only if it describes an
operational fact that another tenant app might reasonably *react to*. Per-turn
agent internals (`agent.text`, `agent.thinking`, `agent.tool_result` bodies)
stay on the audit path because they are (a) volume-dominant, (b) not
actionable for other apps, and (c) already covered by PRD-065's automatic
platform-call audit.

### 3.3 Full mapping table

Columns: `RuntimeEvent.{domain,type}` → Cortex `topic` (or `—` if events-path
is suppressed). **Audit column** marks whether the same RuntimeEvent is also
captured by `CortexAuditMiddleware`; "agent events" emitted by pacta go to
audit via the middleware's hook, not re-translated here.

| RuntimeEvent type | Cortex topic (ctx.events) | Classification | Audit also? | Rationale |
|---|---|---|---|---|
| `session.spawned` | `method.session.started` | `$.workdir` L1 | yes | Other apps may want to know the agent is live |
| `session.prompt.completed` | `method.session.prompt.completed` | `$.promptPreview` L1 | yes | Reactive: can trigger follow-on flows |
| `session.killed` | `method.session.ended` | — | yes | Lifecycle milestone |
| `session.dead` | `method.session.ended` (reason='crashed') | — | yes | Merged into single lifecycle topic |
| `session.state_changed` | — | — | no | Internal state churn — events-path noise |
| `session.stale` | `method.session.stale` | — | yes | Supervisory; an operator app may react |
| `session.observation`, `session.observation.idle` | — | — | no | High-frequency PTY churn |
| `session.error` | `method.session.error` | `$.error.message` L1 | yes | Errors other apps can escalate |
| `strategy.started` | `method.strategy.started` | `$.strategyId` L0 | yes | DAG kickoff — orchestrators want this |
| `strategy.completed` | `method.strategy.completed` | `$.result.summary` L1 | yes | Terminal milestone |
| `strategy.failed` | `method.strategy.failed` | `$.error.message` L1 | yes | Terminal milestone |
| `strategy.gate_passed` | `method.strategy.gate` (result='passed') | — | yes | Observable gate event |
| `strategy.gate_failed` | `method.strategy.gate` (result='failed') | `$.reason` L1 | yes | Observable gate event |
| `strategy.gate.awaiting_approval` | `method.strategy.gate.awaiting_approval` | `$.artifact_markdown` L2 | yes | **Triggers human-approval apps** — primary events use-case |
| `strategy.gate.approval_response` | `method.strategy.gate.approval_response` | `$.feedback` L1 | yes | Closes the loop |
| `trigger.fired` | `method.trigger.fired` | `$.payload.*` L1 | yes | Enables app-to-app event chaining |
| `trigger.disabled` / `trigger.enabled` | — | — | yes | Config churn, audit-only |
| `project.discovered` / `project.updated` | — | — | no | Bridge-host concern, not relevant to Cortex peers |
| `methodology.step_started` | `method.methodology.step_started` | — | yes | Long-running observable |
| `methodology.step_completed` | `method.methodology.step_completed` | `$.output` L2 | yes | Reactive checkpoint |
| `agent.started` | — | — | yes | Covered by CortexAuditMiddleware + `method.session.started` already |
| `agent.text` / `agent.thinking` | — | — | yes (elidable) | Audit-only, high volume |
| `agent.tool_use` | `method.tool.used` | `$.input.*` L2 | yes | **Reactive surface** — tool observability apps can subscribe |
| `agent.tool_result` | — | — | yes | Output bodies too large for events; audit captures size indicator |
| `agent.budget_warning` | `method.budget.warning` | `$.resource`, `$.percentUsed` L0 | yes | **Reactive surface** — ops apps act on 80%/95% |
| `agent.budget_exhausted` | `method.budget.exhausted` | — | yes | Terminal budget event |
| `agent.error` | `method.agent.error` | `$.message` L1 | yes | Reactive error routing |
| `agent.completed` | `method.agent.completed` | `$.usage.totalCostUsd` L1 | yes | Terminal pacta event — **distinct from `method.session.ended`**: one pacta invocation may nest inside a longer session |
| `cost.rate_limited` | `method.cost.rate_limited` | — | yes | Saturation signal for ops apps |
| `cost.account_saturated` | `method.cost.account_saturated` | — | yes | Cross-app billing relevance |
| `cost.integrity_violation` | `method.cost.integrity_violation` | `$.detail` L2 | yes | Security-sensitive |
| `cost.observation_recorded`, `cost.estimate_emitted`, `cost.slot_leaked` | — | — | yes | Internal governor telemetry, audit-only |
| `system.bridge_starting` / `_ready` / `_stopping` / `_crash` | `method.system.bridge_state` | `$.crashDetail` L2 (only on crash) | yes | Cross-app awareness of runtime health |
| `system.bus_stats` / `system.bus_error` / `system.sink_overflow` | — | — | yes | Internal bus telemetry |
| `system.recovery_started` / `_completed` | `method.system.recovery` | — | yes | Observable startup milestone |

**Events topics total:** 21. **Audit-only RuntimeEvent types:** ~18 (mostly
high-frequency or internal churn). **Events-only:** 0 — every event published
to ctx.events is **also** audit-logged, because audit is the compliance
record. Events-path is strictly a *subset* of audit-path, projected into
Cortex's pub/sub shape.

### 3.4 Topic naming convention

```
method.<runtime-domain>.<event-verb>[.<qualifier>]
      └────┬─────┘ └─────┬─────┘ └────┬────┘
           │             │            │
           │             │            └─ optional (e.g. 'awaiting_approval')
           │             └──────────────── present tense or past participle ('started', 'gate', 'ended')
           └────────────────────────────── from RuntimeEvent.domain
```

Rules:
1. **Always prefixed `method.`** — the tenant app may emit topics from other
   sources; this namespace prevents collisions and makes subscriber intent
   unambiguous.
2. **Use the runtime domain as the second segment.** Not the bridge package
   name. Not the class name. This maps 1:1 to `RuntimeEvent.domain`.
3. **Verbs in final segment are stable.** Renaming a topic is a
   breaking change → requires parallel emission + a new `@v2` topic
   (PRD-072 §5.4 schema-evolution contract).
4. **Qualifiers use underscores**, separators use dots. `awaiting_approval`
   not `awaitingApproval`, and never `awaiting.approval`.
5. **Classifications live in the topic descriptor**, not in the topic name
   — the name is for routing, clearance is for filtering.

This convention deliberately **rhymes with PRD-065's audit eventType**
(`method.agent.*`) from Surface 2, so a human reading both audit logs and
event subscriptions sees a coherent taxonomy:

| Shape | Example |
|---|---|
| Audit eventType (PRD-065) | `method.agent.tool_use` |
| Events topic (PRD-072) | `method.tool.used` |

The naming diverges intentionally — audit records are past-tense per-agent
facts (`agent.tool_use` = "the agent performed a tool_use event"); events
are past-participle cross-app facts (`tool.used` = "a tool was used, you
can react now"). This separation prevents accidental consumer confusion
between the two services.

---

## 4. Back-Pressure & Failure Contract

### 4.1 Back-pressure

```
RuntimeEvent arrives
       ↓
   onEvent()
       ↓
   [filter + topic lookup + allowedTopics check]
       ↓
   rate limiter check  ──────→  if over rate: push to buffer
       ↓                                ↓
   ctx.events.emit()            buffer has space?
       ↓                         ├─ yes → wait for next tick, drain
   success? → done               └─ no  → drop oldest, emit
                                           `connector.degraded`
                                           on local bus (once per
                                           threshold transition, not
                                           per event)
```

**Thresholds** (baked into default config):
- Buffer >= 50% capacity → `connector.degraded` (warning, once)
- Buffer >= 90% capacity → `connector.degraded` (warning, re-armed)
- Buffer drains below 10% → `connector.recovered` (info)
- Individual event drop when buffer full → NOT emitted per-event (would
  amplify the problem); counted into `health().errorCount`

**The buffer is in-process.** It survives transient latency spikes, not
process restarts. This is consistent with ctx.events at-least-once semantics:
if the process crashes before publish, the event is lost from the events
path but still captured on the audit path (§3.3: every events-topic RE also
audits). Audit is the durable record; events is best-effort reactive.

### 4.2 Failure modes

| Failure | Category | Connector action | Parent-operation effect |
|---|---|---|---|
| ctx.events 429 (quota/rate) | Transient | Backoff + retry up to `maxRetries`; if exhausted, buffer | None (fire-and-forget) |
| ctx.events 5xx | Transient | Backoff + retry; if exhausted, buffer + emit `connector.publish_failed` | None |
| ctx.events 4xx schema-rejected | Permanent | Drop event, emit `connector.schema_rejected` (error) on local bus; optionally audit-log via `auditPublishFailures` | None — but schema mismatch is a *build* bug: topic descriptor and ctx.events registry disagree. Should fail CI before hitting prod. |
| ctx.events 4xx topic-unknown | Permanent | Drop event, emit `connector.topic_undeclared` (warning) on local bus; one-time per topic | None |
| Network timeout | Transient | Same as 5xx |
| `ctx.events` missing from CortexEventsCtx | Compose-time | `createMethodAgent` throws `CortexAdapterComposeError { reason: 'missing_ctx_service', detail: { service: 'events' } }` | Agent fails to compose — not a runtime failure |
| Connector itself throws in onEvent | Bug | Caught by bus dispatcher's `onError`; counted into `errorCount`; no propagation | None |

**Invariant: publish errors never fail the parent operation.** The only path
to a failed agent invocation is pacta's own error handling. The connector is
observational infrastructure.

### 4.3 Dual-path safety net

When `config.auditPublishFailures: true` (default), every permanent publish
failure (schema-rejected, topic-unknown, buffer-drop) emits a synthetic audit
record:

```json
{
  "eventType": "method.infrastructure.events_publish_failed",
  "payload": {
    "topic": "method.tool.used",
    "reason": "schema_rejected",
    "runtimeEventId": "uuid...",
    "retryCount": 3,
    "detail": "..."
  },
  "severity": "warning"
}
```

This ensures the compliance path (audit) always has a record of events-path
degradation. Useful for forensics and for detecting topic/manifest drift in
production.

### 4.4 Resource bounds summary

| Resource | Bound | Consequence of hitting it |
|---|---|---|
| In-memory buffer | `bufferSize` events (default 500) | Drop oldest, emit `connector.degraded` |
| Events per second | `maxEventsPerSecond` (default 12) | Buffer (not drop) |
| Publish retries | `maxRetries` (default 3) | Drop + `connector.publish_failed` |
| Disconnect drain wait | 5s (hard-coded) | Remaining buffered events logged + dropped |
| Per-app quota (PRD-069) | 1000 emits/min | Cortex returns 429 → retry path |

---

## 5. Producer & Consumer Mapping

### 5.1 Producer
- **Domain:** `@method/runtime` (already exists, PRD-057)
- **Emission site:** `RuntimeEvent` objects published to any `EventBus` bound
  in the tenant app's composition root.
- **No code changes in runtime** for this surface. The connector is
  registered via `eventBus.registerSink(cortexEventConnector)` in
  agent-runtime's factory.

### 5.2 Consumer
- **Package:** `@method/agent-runtime` (planned — PRD-058)
- **File:** `packages/agent-runtime/src/cortex/event-connector.ts` (new)
- **Wiring:** Created by `createMethodAgent` when `ctx.events` is present
  in the passed-in Cortex ctx. Registered on the injected `EventBus` via
  `registerSink`. Disconnected on agent teardown.
- **Not wired into `@method/bridge`.** The standalone bridge keeps using
  WebSocketSink + WebhookConnector — it does not have a `ctx.events` to
  publish to. PRD-063 must NOT add a bridge dependency on `ctx.events`.

### 5.3 Manifest contract (co-design output)

Every Cortex tenant app consuming `@method/agent-runtime` must include, in
its `cortex-app.yaml`, an `emit[]` entry for every topic it wants to enable:

```yaml
requires:
  events:
    emit:
      - type: method.session.started
        schema: ./schemas/method/session-started.schema.json  # shipped by agent-runtime
        classifications:
          - { field: "$.workdir", level: 1 }
      - type: method.strategy.gate.awaiting_approval
        schema: ./schemas/method/strategy-gate-awaiting-approval.schema.json
        classifications:
          - { field: "$.artifact_markdown", level: 2 }
      # ... etc, per METHOD_TOPIC_REGISTRY
```

`@method/agent-runtime` ships the schemas and a helper
`generateManifestEmitSection()` that tenant apps invoke at build time to keep
their manifest aligned with the registry. **This closes the loop between
the static topic registry and the manifest** — the topic registry IS the
manifest source of truth.

---

## 6. Gate Assertions

### G-CONNECTOR-RUNTIME-IMPORTS-ONLY (new)
```typescript
it('CortexEventConnector imports only from @method/runtime/ports', () => {
  const src = readFileSync(
    'packages/agent-runtime/src/cortex/event-connector.ts',
    'utf-8'
  );
  // Must import RuntimeEvent etc. from runtime/ports, never from bridge or runtime internals
  expect(src).not.toMatch(/from\s+['"]@method\/bridge/);
  expect(src).not.toMatch(/from\s+['"]@method\/runtime\/event-bus/);
  // OK: @method/runtime/ports only
});
```

### G-CONNECTOR-TOPIC-ALLOWLIST (new)
```typescript
it('every topic emitted by CortexEventConnector is in METHOD_TOPIC_REGISTRY', () => {
  // Runtime assertion inside the connector: during onEvent, if a topic is
  // resolved that is not in METHOD_TOPIC_REGISTRY, throw at compose-time.
  // Test verifies the mapping function throws on unknown topic.
  const mapper = createEnvelopeMapper(METHOD_TOPIC_REGISTRY);
  expect(() => mapper.toTopic({ ...fakeRuntimeEvent, type: 'bogus.unknown' }))
    .toThrow(/no topic descriptor/);
});
```

### G-EVENTS-FIRE-AND-FORGET (new)
```typescript
it('ctx.events.emit rejection does not propagate to parent agent invoke', async () => {
  const agent = createMethodAgent({ ctx: ctxWithFailingEvents, pact });
  const result = await agent.invoke({ prompt: 'hi', ... });
  expect(result.status).toBe('ok');   // NOT 'error' — events failure is contained
});
```

### G-AUDIT-SUPERSET (new; cross-surface)
```typescript
it('every RuntimeEvent type mapped to a Cortex topic is ALSO audit-captured', () => {
  // For each entry in METHOD_TOPIC_REGISTRY.sourceEventTypes, assert that
  // CortexAuditMiddleware has a mapping for that RuntimeEvent → audit eventType.
  for (const desc of METHOD_TOPIC_REGISTRY) {
    for (const runtimeType of desc.sourceEventTypes) {
      expect(AUDIT_MAPPING[runtimeType]).toBeDefined();
    }
  }
});
```

---

## 7. Status

**Frozen** 2026-04-14.

- PRD-063 implementation MUST hold the §2.2 TypeScript surface verbatim.
- Changes to §3.3 topic mapping (add/remove topics or reclassify fields):
  new `/fcd-surface` session; coordinate with tenant app manifest updates.
- Back-pressure thresholds in §4 are tunable via config without new session;
  algorithm changes require session.

## 8. Open Questions (scoped to PRD-063 implementation)

1. **Should `method.strategy.gate.awaiting_approval` carry the full
   `artifact_markdown` (potentially > 50 KB) or a summary?** Raw markdown may
   clash with the 256 KB SNS ceiling. Proposal: truncate to 32 KB in the
   events payload and include a pointer/ID; full artifact stays in the
   human-approval dashboard (bridge-side) + audit. Defer to implementation
   measurements.

2. **Replay on reconnect.** If the connector restarts, should it re-emit
   events from the runtime bus ring-buffer that occurred during the gap?
   Current answer: no — the bus ring is in-process, audit has the durable
   copy, Cortex subscribers have at-least-once delivery from their own
   SQS queue. Revisit if a demand signal emerges.

3. **Per-subscriber observability.** Cortex provides
   `GET /v1/admin/events/:type/subscribers` — should the agent-runtime
   surface a helper (`eventConnector.listSubscribers(topic)`) for operator
   introspection? Deferred — not needed for Wave 1.

4. **Schema generation.** Should topic schemas be *generated* from
   `RuntimeEvent` TypeScript types (e.g., via `zod-to-json-schema`)? Would
   prevent drift but adds a codegen step. Defer until we see actual drift
   pain in PRD-063 implementation.

5. **`method.cost.*` classification.** Cost events contain `accountId` and
   `appId` — does `accountId` require classification? Proposal: L1 (internal
   billing identifier). PRD-063 should confirm with Cortex security review.

---

## 9. Agreement

- **Surface:** `CortexEventConnector`
- **Frozen:** 2026-04-14
- **Changes require:** new `/fcd-surface` session (topic mapping, failure
  contract, or TS surface). Config defaults tunable without session.
- **Implementation container:** PRD-063.
- **Dependent surfaces:**
  - `fcd-surface-cortex-service-adapters` (audit path — complementary)
  - `fcd-surface-runtime-package-boundary` (RuntimeEvent export, EventConnector interface)
- **Both sides** (method runtime producer, Cortex ctx.events consumer) now
  have a frozen contract and can implement independently. The manifest +
  topic registry are the coordination.
