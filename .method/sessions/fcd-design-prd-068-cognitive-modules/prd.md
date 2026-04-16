---
type: prd
id: PRD-068
title: "Cognitive Modules as Cortex Tenant Apps"
date: "2026-04-14"
status: implemented-partial (PR #187 — Wave 1 skeleton only; cognitive validation gated on RFC-006 R-26c rerun)
version: 0.1
size: L
domains:
  - "@method/agent-runtime"
  - "@method/pacta (cognitive/)"
  - "@method/runtime (event-bus, continuation)"
  - "Cortex ctx.events (PRD-072)"
  - "Cortex ctx.jobs + ctx.schedule (PRD-071 / PRD-075)"
  - "Cortex manifest/registry (RFC-005 §10.2)"
consumes_surfaces:
  - S1 (MethodAgentPort — `createMethodAgent` factory)
  - S5 (JobBackedExecutor + ContinuationEnvelope — cross-worker pact lifecycle)
  - S6 (CortexEventConnector — runtime → ctx.events translator, METHOD_TOPIC_REGISTRY)
  - (indirect) S3 (CortexLLMProvider — per-module budget enforcement)
  - (indirect) S4 (SessionStore + CheckpointSink — per-module resumable state)
new_surfaces_introduced:
  - S10 (CorticalWorkspaceTopicSpec — `method.cortex.workspace.*` topic family)
  - S11 (ModuleHandshakeProtocol — JOIN / HEARTBEAT / LEAVE on the workspace topic)
group: C (Wave 3+ — post-Twins Wave 1, post-demo)
experiment_dependencies:
  - exp-cognitive-baseline (R-04, R-05, R-07 complete; R-20..R-26c memory+planner)
  - exp-slm-composition Phase 4 (autonomous module compilation) — Gate PASS required
  - RFC 003 Phase 1 (partitions) — required only if topic payload > single-partition coherent
---

# PRD-068 — Cognitive Modules as Cortex Tenant Apps

## 0. Executive Summary

Ship method's canonical cognitive modules (Monitor, Planner, Critic, Observer,
Reflector, Memory) as **standalone Cortex tenant apps** of `category: agent`.
Instead of composing in one process via pacta's algebra, N cognitive modules
run as N peer Cortex apps, each built on `@method/agent-runtime`
(`createMethodAgent`), each with its own budget, audit trail, and lifecycle —
and they coordinate by reading and writing a shared **cortical-workspace topic
family** on `ctx.events`.

This is the shipping vehicle for the "emergent multi-agent" demo: not one
orchestrator spawning sub-agents, but peer agents in a workspace that
cooperate through event-mediated state. It is **not a research PRD** — it
consumes research outputs from `experiments/exp-cognitive-baseline/` and
composes them over frozen Cortex surfaces (S1 + S5 + S6).

Primary demo target: **one of the four Digital Twins flagship flows**,
identified in §5 below. First shippable pair: **Monitor + Planner** as two
Cortex apps exchanging goal-and-constraint state over `method.cortex.workspace.*`.

## 1. Problem

### 1.1 The reconciliation

Cognitive composition as implemented today (`packages/pacta/src/cognitive/`,
PRD 030) is **in-process**. One pacta process runs the algebra; modules share
a typed `Workspace` object via direct memory reads/writes; composition
operators (`>>`, `|`, `<|>`, `▷`) are higher-order functions on values in the
same address space. The eight canonical modules (Monitor, Planner, Reflector,
Observer, Memory, Reasoner, Actor, Evaluator) live as `.ts` files next to
each other and touch a shared `Workspace` instance directly.

Cortex's tenant-app model is the opposite: every `category: agent` app is an
**isolated Tier 2 service** with its own container, its own budget
(`ctx.llm`), its own audit attribution (`ctx.audit`), its own memory
(`ctx.storage`), and communicates with peer apps *only* through
`ctx.events` (pub/sub) and, for durable coordination, `ctx.jobs` + audit.
Tenant apps **cannot share process memory**. They cannot import each other.
They cannot call each other as functions. The entire substrate is message-passing.

**The reconciliation problem:** today's in-process cognitive algebra assumes
shared memory and synchronous composition. Cortex assumes isolated processes
and asynchronous events. A direct port would either (a) collapse all modules
back into one tenant app (defeating the isolation point — same budget, same
blast radius, same tenancy) or (b) naively fan out every workspace mutation
as an event (quickly exceeding PRD-069's 1000 emits/min/app quota and
PRD-072's 256 KB payload ceiling).

Neither works. The question this PRD answers: **what is the shape of
cognitive composition in a message-passing, budget-isolated, tenant-per-module
world — and which subset of modules benefit from being separate apps at
all?**

### 1.2 Why the "emergent multi-agent" framing matters for demos

The Twins flagship and the CEO demo narrative both want *visible*
multi-agent behavior — not a pacta process that internally calls eight
functions, but N agent cards in the Cortex admin UI, each with its own token
spend, each posting to an audit trail, each observable as a distinct
participant in a reasoning process. That visibility is only possible if the
modules are actual tenant apps. In-process composition, no matter how
elegant, is invisible to Cortex's observability surface.

### 1.3 Empirical grounding

Research under `experiments/exp-cognitive-baseline/` has validated:

- **R-04 (MonitorV2):** 11× detection improvement on subtle miscalibration (E3) vs baseline — Monitor is a high-value standalone module.
- **R-05 (PriorityAttend):** 27.3% token savings from workspace partitioning — workspace/eviction behavior is non-trivial and worth owning as a dedicated app.
- **R-07 (maximal composition):** All patterns active degrades performance (22% vs 75%). **Selective activation** is mandatory. Tenant-app-per-module naturally enforces opt-in selectivity (the tenant manifest decides which modules are deployed).
- **RFC 003 Phase 1 (partitions):** constraint-partition + task-partition + operational-partition each need different retention. Maps cleanly onto separate topics-or-apps with different schemas.

The research does not yet support "all 8 modules as apps" — only **Monitor**,
**Planner**, and **Memory** have empirical justification for tenant-level
isolation as of 2026-04-14. This PRD scopes Wave 1 to those three; the
Critic/Observer/Reflector extensions are explicitly deferred pending the
listed experiments in §10.

## 2. Constraints

### 2.1 Hard platform constraints (from Cortex RFC-005 + PRDs 068/071/072/075)

1. **Category = agent, Tier = 2 (service) per module.** Each cognitive module ships as its own tenant app. No exceptions. A module-bundle app (N modules in one container) is explicitly out of scope — it would re-collapse the isolation that justifies this PRD.
2. **No direct module-to-module calls.** Modules cannot call each other's HTTP endpoints, cannot import each other's packages, cannot share code beyond `@method/agent-runtime` + `@method/pacta` library code.
3. **State sharing ONLY via `ctx.events` topics.** The cortical workspace is a topic family, not a shared database. `ctx.storage` is *per-app* and private. If two modules need to see the same fact, that fact flows through a topic.
4. **Budget isolation per module.** `ctx.llm` budget is per-AppId. There is no cross-module budget pool. Total system budget = sum of per-module budgets, with no rebalancing at runtime.
5. **Audit per module.** Every module's decisions emit to *its own* `ctx.audit` record. There is no unified "cognitive trace" audit — audit is per-app by design.
6. **Manifest-declared topics.** Every module that emits to the cortical workspace must declare the topic under `requires.events.emit[]`; every subscriber must declare under `requires.events.on[]`. No dynamic topics, no runtime wildcards (PRD-072).
7. **Continuation envelope is the cross-worker protocol (S5).** Long-running modules (Reflector doing consolidation, Planner doing plan-rewrite under pressure) MUST suspend via `method.pact.continue` and MUST NOT hold threads across `ctx.events` waits.
8. **Token-exchange depth ≤ 2 (RFC-005 §4.1.5).** A Planner app invoked by a user agent cannot spawn a Monitor sub-agent — the Monitor is already a peer tenant app, not a delegated sub-agent. The "peer" pattern naturally stays at depth 1 because every module acts under the original user token via `ctx.auth.exchangeForAgent`.
9. **256 KB per `ctx.events` payload.** Workspace snapshots must be summary-sized; full reasoning traces go to per-app `ctx.storage` with a pointer reference.
10. **1000 emits/min/app quota (PRD-069).** Each module's participation in the workspace must respect this. The handshake + heartbeat cadence (§4) is deliberately slow to leave headroom for actual state events.

### 2.2 Method-side constraints

1. **Built on frozen surfaces.** No new `@method/agent-runtime` or `@method/runtime` surfaces invented here. The two NEW surfaces introduced (S10 workspace topic spec, S11 handshake protocol) live *on top of* `CortexEventConnector` (S6) using `METHOD_TOPIC_REGISTRY` — they are topic-family specifications, not new runtime ports.
2. **Each module = one `Pact` instance.** The module's cognitive function (Monitor, Planner, etc.) is expressed as the module's pact — same shape `@method/agent-runtime` already handles. No special "cognitive tenant app" runtime. This keeps the blast radius of the PRD small.
3. **No regression for in-process cognitive composition.** `packages/pacta/src/cognitive/` continues to work standalone. This PRD adds a *deployment target*, not a replacement. Bridge-based use keeps in-process composition; Cortex-hosted use gets tenant-app-per-module.
4. **Observer role unchanged.** The cortical workspace is observer-compatible — an ambient-UI app (roadmap item 15, PRD 025 Genesis) can subscribe to `method.cortex.workspace.*` to render the reasoning in real time without participating. This is essential for debugging and the demo.

### 2.3 Anti-constraints (what we explicitly forbid)

- **No shared `@method/cognitive-workspace` singleton.** No library that holds state across module processes. Every bit of shared state is an event payload.
- **No `POST /cognitive/reason` RPC.** Modules do not expose HTTP endpoints to each other. All coordination is pub/sub.
- **No "lead module" pattern.** No module owns the cycle; any module can stall and the system must degrade gracefully (§6 failure modes).
- **No synchronous workspace reads.** A module that needs the latest workspace snapshot reads it from its own local shadow (built from events it subscribed to), not by querying a peer.

## 3. Success Criteria

### 3.1 Binary demo gate (Wave 1 — the shippable milestone)

- [ ] **G-PAIR-LIVE:** Two Cortex tenant apps (Monitor + Planner) deployed from `samples/cortex-cognitive-monitor/` and `samples/cortex-cognitive-planner/` templates, both `category: agent`, both consuming `@method/agent-runtime`.
- [ ] **G-WORKSPACE-EXCHANGE:** Monitor emits `method.cortex.workspace.state` with anomaly flags; Planner subscribes, re-plans, emits `method.cortex.workspace.plan_updated`; Monitor subscribes to that in turn. Round-trip visible in both apps' audit logs and in `ctx.events` fan-out telemetry.
- [ ] **G-BUDGET-ISOLATION:** `ctx.llm` budget ledger shows two separate reservations (one per AppId) with independent spend totals. Starving one module's budget does NOT block the other (degraded operation per §6).
- [ ] **G-HANDSHAKE:** Both apps advertise presence via `method.cortex.workspace.module_online`; either app independently observes the other's JOIN within 10s of deploy.
- [ ] **G-OBSERVER-VIEW:** A third (non-participating) ambient-UI app subscribes to `method.cortex.workspace.*` and renders the Monitor↔Planner exchange in a timeline. This is the **human-visible demo artifact**.

### 3.2 Quantitative targets (Twins flagship readiness)

- [ ] **Round-trip latency:** p50 `method.cortex.workspace.state` → `method.cortex.workspace.plan_updated` ≤ 3s; p95 ≤ 8s. Faster than this competes with ctx.events fan-out overhead; slower breaks the perception of "live reasoning."
- [ ] **Cost overhead vs in-process baseline:** ≤ 1.8× per completed reasoning cycle when measured on the same pact (the tenant-app-per-module overhead is the cost of isolation and must be paid, but must not be catastrophic). This target is loose because the comparison is apples-to-oranges — in-process skips all audit/events serialization.
- [ ] **Graceful degradation:** On Monitor app outage, Planner continues in "unmonitored" mode (emits `method.cortex.workspace.degraded` warning) rather than halting. On Planner outage, Monitor flags stalled-plan anomaly and the agent escalates to human via `ctx.notify` (per tenant app wiring).

### 3.3 Non-gate success signals

- Selected Digital Twins flow demonstrates at least one "aha" moment where event-mediated coordination catches a failure the in-process version missed. This is the **emergent** claim; if absent, the PRD ships the vehicle but validates only the mechanical side.

## 4. Scope

### 4.1 In scope (Wave 1)

1. **Three tenant-app templates** under `samples/cortex-cognitive-*/`:
   - `samples/cortex-cognitive-monitor/` — consumes `MonitorV2` module behavior from `packages/pacta/src/cognitive/modules/monitor-v2.ts`, wraps in a pact, ships as a Cortex agent app.
   - `samples/cortex-cognitive-planner/` — consumes `planner.ts`, same treatment.
   - `samples/cortex-cognitive-memory/` — consumes `memory-module-v3.ts` + `in-memory-dual-store.ts`; ships with `ctx.storage`-backed episodic/semantic store.
2. **S10 — Cortical Workspace Topic Spec.** A topic family under `method.cortex.workspace.*` added to `METHOD_TOPIC_REGISTRY` (owned by `@method/agent-runtime`, per S6). Schemas + JSONPath classifications shipped. Manifest-generation helper `generateCortexCognitiveEmitSection(modules: ModuleRole[])` produces the `requires.events.{emit,on}` block.
3. **S11 — Module Handshake Protocol.** A lightweight `JOIN / HEARTBEAT / LEAVE` sub-protocol over `method.cortex.workspace.module_online` and `method.cortex.workspace.module_offline` topics. 30s heartbeat; 90s implicit LEAVE if heartbeats stop.
4. **Session linkage via S5.** Every module's pact runs in `resumable` mode and uses the `ContinuationEnvelope` for cross-worker continuity. The envelope's `traceId` is the **coordination key** (§5.2) — all modules reacting to the same root user request share the `traceId` and use it as a cortical-workspace event filter.
5. **Budget isolation decision** (§6): fixed per-module budgets, no rebalancing.
6. **Observer/debug app spec** (not implementation): the topic family is designed to be observable by an ambient-UI tenant app; actual app is PRD-079 / roadmap item 15, out of scope here.
7. **Demo flow selection** (§5): Digital Twins flow #2 ("daily twin report generation") chosen as first target per §5 rationale.

### 4.2 Out of scope (explicitly)

- **All 8 cognitive modules as apps.** Only 3 in Wave 1 (Monitor, Planner, Memory). The Reflector app is Wave 2; Critic/Observer/Reasoner/Actor/Evaluator are Wave 3+ or deferred indefinitely pending demand signal.
- **Module-to-module direct invocation.** Even if Cortex PRD-080 (App-to-App Dependencies) becomes available, this PRD does NOT use it. Cognitive coordination stays events-only to preserve the "emergent" property. PRD-067 covers inter-app strategy invocation separately.
- **In-process composition replacement.** The bridge use case and `packages/pacta/src/cognitive/` keep working. This PRD is additive.
- **Cognitive cycle orchestration across apps.** RFC 001's 8-phase cycle is NOT serialized across the apps. Each app runs its own local cycle gated by events it sees. There is no distributed "cycle step" synchronization. If future research requires it, that's a new PRD.
- **Cross-module budget rebalancing.** No `ctx.llm.reallocate` dance. If Monitor runs out of budget, Monitor degrades; Planner is untouched.
- **Cortical workspace as a database.** No `GET /workspace/state` endpoint. The workspace is the event history; each module maintains its own shadow.
- **Observer-write access.** The ambient-UI app is read-only on `method.cortex.workspace.*`. Writing would make it a participant, which changes the protocol.
- **Auto-scaling module fleets.** One instance per tenant app; scaling is Cortex-platform territory and out of scope for method.

### 4.3 Target flow — which of the four Digital Twins flagship flows?

The Twins flagship (per `../ov-t1/projects/t1-cortex/STRATEGY.md` / BRIEF.md) comprises four flows:

| # | Flow | Benefit from emergent multi-agent | Fit |
|---|------|-----------------------------------|-----|
| 1 | Morning KPI ingest + anomaly detection | Anomaly detection is literally MonitorV2's specialty — running Monitor as a separate app with its own budget means anomaly detection keeps running even if the planner app is down. Moderate fit. | ★★★☆☆ |
| 2 | **Daily twin report generation** | Strong fit: the report orchestrator needs plan+monitor+memory active. Visible in the UI because each module's contribution appears in the report with attribution. Demo-friendly. | ★★★★★ |
| 3 | Commission dispatch (CTO co-pilot flow) | Benefits if multiple specialized Planner modules coexist, but that's a Wave 3+ multi-planner setup. Too rich for Wave 1. | ★★☆☆☆ |
| 4 | End-of-day consolidation | Reflector-heavy; Reflector is Wave 2. Skip for Wave 1. | ★★☆☆☆ |

**Decision:** **Flow #2 (Daily twin report generation)** is the Wave 1 target.
Rationale: three module roles are each naturally distinct in a report
(Monitor = "what changed today", Planner = "what to highlight",
Memory = "what we said yesterday"). The output is inherently multi-voice,
which is the emergent multi-agent story we want to tell. Demo artifact is
the report itself — easy to show.

## 5. Architecture

### 5.1 Module → tenant-app mapping (Wave 1)

| Module (today, in-process) | Tenant app (new) | Cortex manifest category | Pact shape | Primary input (subscribes) | Primary output (emits) | Budget posture |
|---|---|---|---|---|---|---|
| `cognitive/modules/monitor-v2.ts` | `samples/cortex-cognitive-monitor/` | `agent`, Tier 2 | `resumable` pact that runs a detection loop per workspace update | `method.cortex.workspace.state` (task progress, tool results, artifacts), `method.cortex.workspace.plan_updated` | `method.cortex.workspace.anomaly`, `method.cortex.workspace.confidence` | Low ceiling (rule-based + small-LLM — should be the cheapest module) |
| `cognitive/modules/planner.ts` | `samples/cortex-cognitive-planner/` | `agent`, Tier 2 | `resumable` pact that runs plan-revision on anomaly | `method.cortex.workspace.state`, `method.cortex.workspace.anomaly`, `method.cortex.workspace.memory_recalled` | `method.cortex.workspace.plan_updated`, `method.cortex.workspace.goal` | Medium ceiling (reasoning LLM; biggest single-turn cost) |
| `cognitive/memory-module-v3.ts` + `in-memory-dual-store.ts` | `samples/cortex-cognitive-memory/` | `agent`, Tier 2 | `persistent` pact (long-lived; retrieval + write API over events); `ctx.storage`-backed episodic/semantic store | `method.cortex.workspace.memory_query`, `method.cortex.workspace.state` (to consolidate) | `method.cortex.workspace.memory_recalled`, `method.cortex.workspace.memory_consolidated` | Medium ceiling (storage-backed; occasional LLM for consolidation) |

**Note on Memory's persistent mode.** Memory is different from Monitor and
Planner: it is a long-lived service, not a cycle participant. Its pact runs
indefinitely, reacting to query events and consolidation triggers. This aligns
with pacta's `PersistentMode` (already in pacta types). Both other modules use
`ResumableMode` — they suspend between workspace updates and resume via the
continuation envelope.

### 5.2 Cortical Workspace Topic Spec (S10)

The topic family `method.cortex.workspace.*` is the substrate. All topics are
added to `METHOD_TOPIC_REGISTRY` in `@method/agent-runtime` per S6.

#### 5.2.1 Coordination key: `traceId`

Every topic payload carries a `traceId` — the **same** `traceId` that flows
through the `ContinuationEnvelope` (S5 §2.1). This is the binding that makes
modules coordinate on **one user's reasoning episode**:

- The root tenant app (the one the user actually invoked — e.g., the Twin
  report generator) initiates a workspace session by emitting
  `method.cortex.workspace.session_opened` with a fresh `traceId`.
- All cognitive modules subscribe and filter their event handlers on
  `traceId`. A module ignores events for traceIds it has never seen unless
  the event is a `session_opened`.
- When the root app emits `method.cortex.workspace.session_closed` (task
  complete), modules flush their shadows for that `traceId`.

This makes the workspace **session-scoped, not app-scoped**. Multiple
workspace sessions can run concurrently across the same three modules.

#### 5.2.2 Topic catalog (Wave 1)

All topics share a common envelope; payloads vary. `schemaVersion: 1` on all.

| Topic | Emitter roles | Consumer roles | Payload summary | Classification |
|---|---|---|---|---|
| `method.cortex.workspace.session_opened` | root app | all modules | `{ traceId, taskDescription, goalStatement, constraints[], userSub }` | `$.taskDescription` L1, `$.goalStatement` L1 |
| `method.cortex.workspace.session_closed` | root app | all modules | `{ traceId, status, summary }` | `$.summary` L1 |
| `method.cortex.workspace.state` | root app + Planner (when new observations) | Monitor, Memory | `{ traceId, stateSnapshot: WorkspaceSnapshotV1, snapshotRef?: StorageRef }` | `$.stateSnapshot.*` L1 |
| `method.cortex.workspace.anomaly` | Monitor | Planner, root app | `{ traceId, kind: 'conflict'|'drift'|'stall'|'constraint_violation', severity, detail, confidence }` | `$.detail` L1 |
| `method.cortex.workspace.confidence` | Monitor | Planner | `{ traceId, scalar, source }` | L0 |
| `method.cortex.workspace.plan_updated` | Planner | Monitor, Memory, root app | `{ traceId, planSummary, changedSteps[], rationaleRef?: StorageRef }` | `$.planSummary` L1, `$.changedSteps[*]` L1 |
| `method.cortex.workspace.goal` | Planner | Monitor, Memory | `{ traceId, goalId, statement, parentGoalId? }` | `$.statement` L1 |
| `method.cortex.workspace.memory_query` | Planner, root app | Memory | `{ traceId, queryKind: 'episodic'|'semantic', key, k }` | L0 |
| `method.cortex.workspace.memory_recalled` | Memory | Planner, root app | `{ traceId, queryKind, entries[], citationRefs[] }` | `$.entries[*]` L2 |
| `method.cortex.workspace.memory_consolidated` | Memory | (observable) | `{ traceId, consolidationKind, writtenCount }` | L0 |
| `method.cortex.workspace.module_online` | any module | all | `{ moduleRole, appId, version, capabilities[] }` | L0 |
| `method.cortex.workspace.module_offline` | any module (LWT-ish via LEAVE), or root app inference | all | `{ moduleRole, appId, reason }` | L0 |
| `method.cortex.workspace.degraded` | any module | root app, observer | `{ traceId, moduleRole, reason, fallback }` | L0 |

**Payload discipline — large artifacts live in storage, not events.** The
`stateSnapshot`, `rationaleRef`, and `citationRefs` fields are deliberately
summary-only or *refs* to objects in the emitter's `ctx.storage`. When a
consumer needs the full artifact, it performs a **storage-read via a
dedicated method.cortex.workspace.artifact_request/response topic pair**
(deferred to Wave 2 if the Wave 1 summary sizes stay under 32 KB).

Rationale: 256 KB SNS ceiling (S6 §1.3) + 1000 emits/min quota. Inlining
full reasoning traces would blow both budgets in minutes on a single pact.

#### 5.2.3 Subscription manifests

A cognitive module's Cortex manifest under `requires.events` follows a
**role-based pattern**:

```yaml
# samples/cortex-cognitive-planner/cortex-app.yaml (excerpt)
requires:
  events:
    # Generated via generateCortexCognitiveEmitSection(['planner'])
    emit:
      - type: method.cortex.workspace.plan_updated
        schema: ./schemas/method/cortex/workspace-plan-updated.schema.json
      - type: method.cortex.workspace.goal
        schema: ./schemas/method/cortex/workspace-goal.schema.json
      - type: method.cortex.workspace.memory_query
        schema: ./schemas/method/cortex/workspace-memory-query.schema.json
      - type: method.cortex.workspace.module_online
        schema: ./schemas/method/cortex/workspace-module-online.schema.json
      - type: method.cortex.workspace.module_offline
        schema: ./schemas/method/cortex/workspace-module-offline.schema.json
      - type: method.cortex.workspace.degraded
        schema: ./schemas/method/cortex/workspace-degraded.schema.json
    on:
      - type: method.cortex.workspace.session_opened
      - type: method.cortex.workspace.session_closed
      - type: method.cortex.workspace.state
      - type: method.cortex.workspace.anomaly
      - type: method.cortex.workspace.confidence
      - type: method.cortex.workspace.memory_recalled
      - type: method.cortex.workspace.module_online
      - type: method.cortex.workspace.module_offline
```

### 5.3 Module Handshake Protocol (S11)

JOIN / HEARTBEAT / LEAVE over `module_online` / `module_offline`:

1. **JOIN.** On `createMethodAgent({ ctx, pact: <module-pact> })` composition:
   the agent-runtime wiring (new helper — `withCorticalWorkspaceMembership(options)`)
   emits one `method.cortex.workspace.module_online` event with
   `{ moduleRole, appId, version, capabilities }`. This is fire-and-forget.
2. **HEARTBEAT.** A scheduled pact continuation every 30s (via `ctx.schedule`
   per S5 + roadmap B3 `CortexScheduledPact`) re-emits `module_online` with
   the same fields. Other modules debounce duplicates on `appId`.
3. **LEAVE.** Two paths:
   - Graceful: on `dispose()`, emit `module_offline` with `reason: 'graceful'`.
   - Implicit: if a module does not re-emit `module_online` for 90s, peers
     treat it as offline. (Cortex does not provide LWT; implicit inference
     is the substitute.)
4. **Observer role.** The ambient-UI app subscribes to `module_online` /
   `module_offline` and maintains a live roster. Not a protocol requirement
   — a consumer of it.

The handshake is **flat — no leader election.** Any module may go offline
and the remaining modules adjust their fallback logic independently
(§6 degradation).

### 5.4 Session linkage to S5

Each module is a `resumable` pact (Memory is `persistent`). The
`ContinuationEnvelope.traceId` (S5 §2.1) is identical to the
`method.cortex.workspace.*.traceId`. This double-duty of the field is
intentional: it means a stuck module that has suspended to `ctx.jobs` and a
module that is actively processing workspace events are referring to the
same reasoning episode by the same id. A debugger can join logs on `traceId`
across:

- `@method/agent-runtime` pact lifecycle events (audit)
- `method.cortex.workspace.*` coordination events (ctx.events)
- `method.pact.continue` job payloads (ctx.jobs)

**Root-app session ownership.** The root tenant app owns the `traceId`. It
mints the id on task receipt, emits `session_opened`, and is responsible for
emitting `session_closed`. Cognitive modules never mint their own traceIds
(doing so is a bug — would create orphan workspace sessions).

## 6. Budget Isolation & Failure Modes

### 6.1 Budget isolation decision — **fixed per-module, no rebalancing**

The options considered:

- **A. Fixed per-module budget (chosen).** Each tenant app's manifest declares its `ctx.llm` budget. No runtime reallocation. Total system budget = sum. If a module exhausts its budget, it emits `method.cortex.workspace.degraded` and stops participating; peers adapt.
- **B. Shared workspace budget.** A single budget pool allocated across modules via coordination events. **Rejected** — violates Constraint 2.1.4 (`ctx.llm` is per-AppId in PRD-068-cortex) and adds a distributed-ledger problem that solves nothing Cortex doesn't already solve per-app.
- **C. Predictive cross-module budget via Planner.** Planner watches peer budget telemetry and preemptively throttles. **Rejected for Wave 1** — introduces coupling and requires budget-report topics that blow the quota budget of their own. Revisit if A fails.

**Rationale.** The demo value is *visible independent spending per module*.
Cortex's admin UI shows per-AppId spend cards; "Monitor: $0.42 today,
Planner: $1.18, Memory: $0.03" is the artifact. Shared budget would collapse
that view.

**Consequences** (acknowledged, not hidden):

- Suboptimal use of total system budget. The Planner might be budget-constrained while the Monitor has headroom. That's fine — it's correct isolation behavior. If a module chronically exhausts budget, that's a *tenant-configuration signal* for the operator to raise that module's ceiling, not for runtime rebalancing.
- `G-BUDGET-SINGLE-AUTHORITY` gate from S3 applies to each module independently — each app's pacta `budgetEnforcer` runs in `predictive` mode over `ctx.llm` as the authoritative ceiling.

### 6.2 Failure modes

| Scenario | Detected by | System behavior |
|---|---|---|
| Monitor app crashed | Planner's `module_offline` subscriber sees no heartbeat for 90s | Planner emits `method.cortex.workspace.degraded { reason: 'no_monitor' }`. Planner runs without anomaly input; increases its own self-check stringency. Observer app flags degradation. |
| Planner budget exhausted | Planner's pacta `budgetEnforcer` fires `BudgetExhaustedError`; agent emits `method.cortex.workspace.degraded { reason: 'budget_exhausted', moduleRole: 'planner' }` | Root app receives the degraded event via its subscription and escalates to human via `ctx.notify`. Session does NOT auto-close — root app decides. |
| Memory app slow (consolidation stuck) | Planner's `memory_query` emitted; no `memory_recalled` response within 10s | Planner proceeds with cached shadow or fresh reasoning; emits `degraded { reason: 'memory_timeout' }`. Memory continues consolidation; late response is tolerated (consumer drops on traceId close). |
| `ctx.events` 429 quota | CortexEventConnector back-pressure (S6 §4.1) | Per S6 contract: fire-and-forget; buffered or dropped with `connector.degraded`. Parent pact does NOT fail. The cortical workspace accepts eventual consistency. |
| Duplicate event delivery (at-least-once SQS) | Consumers key on `(traceId, eventId)` in their shadow | Idempotent handlers required. `eventId` is already part of the Cortex envelope per S6 §3.1. |
| Split-brain (network partition) | Heartbeat timeouts on both sides | Both sides mark each other offline. When partition heals, heartbeats resume, both re-mark online. Any state that diverged during partition is reconciled by the Planner (whose output topic is the authoritative plan). This is eventual consistency by design; no consensus protocol. |

**Guiding invariant:** *the workspace is best-effort reactive substrate; the
durable record is each module's per-app audit.* If the events path is
degraded, the audit path preserves post-hoc reconstructability. This
inherits directly from S6's audit-superset gate (G-AUDIT-SUPERSET).

## 7. Observability

### 7.1 Who collates events for debugging?

**Ambient-UI observer app (read-only, not in Wave 1 implementation).**
The existing bridge `genesis` domain (PRD 025) is the in-process analogue —
a 30s-batched ambient summary of agent activity. The Cortex-hosted analogue
is a Tier 3 webapp tenant app that subscribes to `method.cortex.workspace.*`
(all topics, read-only) and maintains:

- A roster view (from handshake topics): which modules are online right now
- A timeline view (keyed on `traceId`): what events fired in what order during a reasoning episode
- An anomaly stream: real-time `method.cortex.workspace.anomaly` feed
- Per-module budget cards: joins `ctx.llm` per-AppId telemetry with workspace participation

This app is **not implemented in PRD-068** — it's declared as the
observability consumer target and the topic spec is designed to be
friendly to it. Actual implementation is a downstream PRD (candidate:
PRD-079 extension or roadmap item 15).

### 7.2 Audit per module

Every module's `@method/agent-runtime` instance emits to its own `ctx.audit`
record per CortexAuditMiddleware (frozen in S3). The audit events are:

- Per-invocation pacta lifecycle (`method.agent.*` audit eventTypes)
- Cortical-workspace emissions (via S6's audit-superset: every event emitted
  to `ctx.events` is also written to audit)
- Budget and error events

To reconstruct a full reasoning episode offline: query `ctx.audit` across
the 3 AppIds filtered on a shared `traceId`. Every step is present in
exactly one app's audit; the composition is the union.

### 7.3 Metrics

Each module exposes (via Cortex's standard Tier 2 observability):

- `cortical.handshake.join_count`, `leave_count`
- `cortical.events.emitted_total{topic}`, `received_total{topic}`
- `cortical.degradation_events_total{reason}`
- `cortical.round_trip_seconds{from_topic, to_topic}` (for G-PAIR-LIVE SLO)

These are Cortex metrics, not new method metrics — `@method/agent-runtime`
uses Cortex's standard `ctx.metrics` (or equivalent) via S3-family adapters.

## 8. Risks

### 8.1 High — mitigations required before Wave 1 ship

- **R1. Topic payload cost.** Every `state` emission carries a workspace snapshot. If snapshots trend large (> 32 KB), we blow SNS limits and drive up `ctx.events` costs fast. **Mitigation:** snapshots are summary-only by schema; full data lives in `ctx.storage` referenced by `snapshotRef`. Measure in integration test; cap at 32 KB inline.
- **R2. Event ordering.** `ctx.events` does not guarantee ordering (PRD-072). A `plan_updated` could arrive before its antecedent `anomaly` at a subscriber. **Mitigation:** every event carries an emitter-local monotonic counter under `meta.localSeq`; consumers buffer and reorder up to a 2s window per `(traceId, emitterAppId)`. Late events past the window are applied anyway with a `out_of_order: true` flag for the observer.
- **R3. Demo fragility.** A live demo over ctx.events is harder to rehearse than an in-process demo. **Mitigation:** PRD-065 conformance testkit (S8) adds a `cortical-pair` fixture that exercises the Monitor↔Planner round-trip deterministically in mock mode; the live demo is the integration environment run of the same fixture.

### 8.2 Medium

- **R4. Module role duplication.** Two Monitor apps accidentally deployed to the same tenant = duplicate anomalies + confusion. **Mitigation:** handshake protocol lets peers detect two `module_online` with different `appId` but same `moduleRole`; emits `degraded { reason: 'role_duplicate' }`. Not auto-corrected — flagged for operator.
- **R5. Memory app is a special case** (persistent mode, storage-backed, long-lived). Restart semantics for a persistent pact are less battle-tested than resumable. **Mitigation:** Memory app's storage schema is versioned; restart replays nothing — it rebuilds state lazily from `ctx.storage` on the first query event.
- **R6. Budget starvation cascade.** If Monitor runs out of budget and degrades, Planner loses anomaly input and may burn through its own budget re-reasoning. **Mitigation:** Planner's degraded-mode path explicitly increases internal self-check without calling more tools; measured in integration. If it cascades in practice, revisit as Wave 2.

### 8.3 Low / acknowledged

- **R7. Workspace session leaks.** If the root app crashes without emitting `session_closed`, module shadows keep the traceId forever. **Mitigation:** 1-hour TTL on per-traceId shadow state in each module.
- **R8. Classification audit.** Payload field classifications (L0/L1/L2) in the topic spec are a first-pass guess. **Mitigation:** PRD-063 gate G-AUDIT-SUPERSET surfaces misclassifications; Cortex security review before Wave 1 ship.

## 9. Acceptance Gates

### Gate A — Surface & Topic Spec (pre-implementation)

- [ ] **G-S10-REGISTRY:** `method.cortex.workspace.*` topic family added to `METHOD_TOPIC_REGISTRY` with schemas for all topics in §5.2.2. Unit test asserts each topic's sourceEventType mapping is present.
- [ ] **G-S10-CLASSIFICATION:** Every field in every payload has a classification entry or is documented as L0 (public).
- [ ] **G-S11-HANDSHAKE-DEFINED:** `JOIN/HEARTBEAT/LEAVE` protocol documented in code comments on `withCorticalWorkspaceMembership()` helper; unit test covers 30s heartbeat cadence with mock scheduler.
- [ ] **G-MANIFEST-GEN:** `generateCortexCognitiveEmitSection(['monitor'])` produces the exact emit+on block the monitor template ships (golden-file test).

### Gate B — Template & Isolation

- [ ] **G-TEMPLATE-MONITOR:** `samples/cortex-cognitive-monitor/` builds, deploys to Cortex dev stack, emits its `module_online` event on boot.
- [ ] **G-TEMPLATE-PLANNER:** same for `samples/cortex-cognitive-planner/`.
- [ ] **G-TEMPLATE-MEMORY:** same for `samples/cortex-cognitive-memory/`; storage keys are per-app namespaced.
- [ ] **G-BUDGET-ISOLATION (quantitative):** three distinct reservations visible in Cortex `ctx.llm` ledger under three AppIds; starving one app does not affect others (integration test under S8 conformance suite).

### Gate C — Pair Exchange

- [ ] **G-PAIR-LIVE:** Integration test (conformance-testkit extension) deploys Monitor + Planner, opens a session, injects a simulated anomaly observation, asserts Planner emits `plan_updated` within latency SLO. Measured: p50 and p95 vs success criteria §3.2.
- [ ] **G-GRACEFUL-DEGRADE:** Disable Monitor mid-session; Planner emits `degraded{no_monitor}`; test passes if Planner reaches a plan within 3× normal time.

### Gate D — Observability

- [ ] **G-TRACE-JOIN:** Given a single traceId, unioning the three apps' audit streams reconstructs the reasoning episode with no events lost (audit path is durable, events path may be lossy).
- [ ] **G-TOPIC-SCHEMA-DRIFT:** CI gate — topic registry schemas match sample manifests; any drift fails the build.

### Gate E — Demo target

- [ ] **G-TWIN-REPORT-DEMO:** The Daily twin report generation flow produces a report whose Monitor/Planner/Memory contributions are each attributable to the issuing AppId, with visible in-report attribution. Demo artifact captured as a screenshot + a cortex audit query.

## 10. Dependencies on Experiment Findings

This PRD is deliberately downstream of active research. Unblocking signals:

| # | Dependency | Experiment / artifact | Current state (2026-04-14) | Blocking? |
|---|---|---|---|---|
| D1 | MonitorV2 is a net-positive isolated behavior | `experiments/exp-metacognitive-error/` (R-04) | PASS on E3 (11×); mixed on E1/E2/E4 | NOT blocking Wave 1 (Monitor as app is still a win for demo visibility even if its detection is domain-limited) |
| D2 | PriorityAttend / workspace partitioning empirically helps | `experiments/exp-workspace-efficiency/` (R-05) | PASS (27.3% token savings) | NOT blocking — informs Memory app's internal shadow structure |
| D3 | Full cognitive composition is not maximally additive | `experiments/exp-advanced-patterns/` (R-07) | FAIL for maximal; selective activation required | **BLOCKING the "all 8 modules as apps" expansion** but NOT Wave 1 (3 modules only) |
| D4 | Memory + Planner combination outperforms flat | `experiments/exp-cognitive-baseline/` RFC 006 research arc (R-20..R-26c per MEMORY.md index) | R-26c rerun pending credits per `project_rfc006_status.md` | **BLOCKING G-TWIN-REPORT-DEMO** — if Memory+Planner doesn't beat flat in research, the Twin flow has no narrative |
| D5 | RFC 003 partition pattern is viable for the Memory app's storage schema | `experiments/exp-cognitive-baseline/` T04 pin-flag validated; full partition deferred | Phase 0 (pin flag) PASS; Phase 1 partitions deferred pending empirical trigger | NOT blocking Wave 1 (Memory app can ship with flat dual-store v3 behavior); revisit if Wave 1 shows partition value |
| D6 | Autonomous SLM compilation can back cheap module calls (cost target R6) | `experiments/exp-slm-composition/` Phase 4 | Phase 4 DONE — 99% semantic accuracy | NOT blocking Wave 1 (can use cheap frontier tier via `ctx.llm`); enables Wave 2 cost reduction |
| D7 | RFC 006 "best 50%" / T02-exceeds-flat replication on live traces | RFC 006 status per MEMORY.md | Pending R-26c rerun | NOT blocking Wave 1 ship; blocking "cognitive apps beat flat" marketing claim |

**Bottom line:** **D4 is the one experiment that gates the chosen demo
flow.** Wave 1 mechanical success (gates A–D) does not depend on D4;
demo success (gate E) does. If R-26c rerun fails, re-scope demo to a
narrower assertion ("independent observability of per-module spend during
a Twin report") rather than "cognitive apps produce a better report than
a flat agent."

## 11. Phase Plan

### Wave 0 — Surfaces & Registry (this PRD's contribution to the shared fabric)

1. Add `method.cortex.workspace.*` topics to `METHOD_TOPIC_REGISTRY` in `@method/agent-runtime` (consumes S6).
2. Ship JSON schemas for each topic under `packages/agent-runtime/schemas/method/cortex/`.
3. Define `ModuleRole` + `CorticalWorkspaceMembership` helper in `@method/agent-runtime/src/cortex/cortical-workspace.ts`.
4. Define `generateCortexCognitiveEmitSection(roles)` manifest-generation helper.
5. Add Gate A assertions to `packages/agent-runtime/src/gates/gates.test.ts`.

**Dependency:** S6 frozen (yes). **Deliverable:** two published schemas +
helper ship with the next `@method/agent-runtime` minor bump.

### Wave 1a — Monitor tenant app template

`samples/cortex-cognitive-monitor/` — uses `createMethodAgent`, pacta `MonitorV2`
behavior wrapped in a pact, emits+subscribes per §5.2.3, handshake via
`withCorticalWorkspaceMembership`. Ships with `cortex-app.yaml`.

### Wave 1b — Planner tenant app template (parallelizable with 1a)

`samples/cortex-cognitive-planner/` — analogous. Deeper integration: the
Planner pact is the one that primarily consumes `anomaly` and emits
`plan_updated`.

### Wave 1c — Memory tenant app template (after 1a/1b to reuse scaffolding)

`samples/cortex-cognitive-memory/` — persistent mode; `ctx.storage`-backed
dual-store. Longer-running app with scheduled consolidation via
`CortexScheduledPact` (S5).

### Wave 1d — Pair-exchange integration test

Extends `@method/pacta-testkit/conformance` (S8) with a `cortical-pair` fixture
that deploys Monitor + Planner to Cortex dev stack and validates Gate C.

### Wave 1e — Daily Twin Report flow hookup

The root tenant app for Flow #2 is NOT owned by this PRD (it lives in
`t1-repos/t1-cortex-1`); this PRD ships the modules it composes with. The
integration milestone is external.

### Wave 2 (post-ship) — follow-ups

- Reflector tenant app template (requires `persistent` pact patterns validated in Memory).
- Observer/ambient-UI tenant app (webapp Tier 3).
- Revisit: budget rebalancing (if R6 cascades empirically).
- Revisit: `workspace.artifact_request/response` topic pair if 32 KB cap becomes painful.

### Wave 3 (deferred — requires new PRDs)

- Critic / Observer / Reasoner / Actor / Evaluator as apps (pending D3 selective-activation research).
- Multi-Planner coexistence (Flow #3 scenario).
- Distributed cognitive cycle synchronization, if demand emerges.

## 12. Judgment Calls (flagged for review)

- **Memory as persistent pact, not resumable.** Means Memory runs in a long-lived process-at-a-time pattern. Alternative: short resumable invocations per query. Chose persistent because `ctx.storage`-backed consolidation is stateful and the shadow-free query pattern is cheaper. Revisit if Cortex persistent-tier churn is high.
- **Handshake over topics, not a Cortex primitive.** If Cortex ever provides native "tenant roster by category" service, the handshake protocol collapses. Worth raising with Cortex team as an O-item.
- **Root-app owns `traceId` minting.** Alternative: first module to see a task mints. Chose root-app because it's the only participant guaranteed to exist (modules may be absent without failing the task).
- **Budget is per-app with no redistribution.** Committed. Revisit only if G-BUDGET-ISOLATION fails to produce demo-legible per-module spend cards.
- **Demo target is Flow #2, not Flow #1.** Flow #1 is more Monitor-centric (safer if Planner is weak) but less visibly multi-agent. Chose #2 for the "N visible voices" story. If demo rehearsal reveals #2 is too demanding, fall back to #1 as Plan B.

---

## Appendix A — Cross-References

- **Frozen surfaces consumed:** S1 (`method-agent-port/decision.md`), S5 (`job-backed-executor/decision.md`), S6 (`event-connector/decision.md`). Indirectly: S3 (adapters), S4 (session store).
- **Research:** `experiments/exp-cognitive-baseline/`, `experiments/exp-metacognitive-error/`, `experiments/exp-workspace-efficiency/`, `experiments/exp-advanced-patterns/`, `experiments/exp-slm-composition/`.
- **Theory:** `docs/rfcs/001-cognitive-composition.md`, `docs/rfcs/003-cortical-workspace-composition.md`, `docs/rfcs/006-*` (per MEMORY.md).
- **Twins flagship:** `../ov-t1/projects/t1-cortex/STRATEGY.md`, `BRIEF.md`.
- **In-process reference implementation:** `packages/pacta/src/cognitive/` (stays as-is).
- **Related PRDs:** PRD-058 (agent-runtime), PRD-063 (event-connector), PRD-062 (job-backed executor), PRD-067 (multi-app strategy — different pattern, direct invocation rather than emergent).
