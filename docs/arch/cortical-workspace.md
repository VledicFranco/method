# Cortical Workspace (S10 + S11)

## Responsibility

`packages/agent-runtime/src/cortex/cortical-workspace.ts` provides the shared coordination substrate for cognitive tenant apps (Monitor, Planner, Memory, ...). It is **not** a new runtime port — the substrate IS the set of `method.cortex.workspace.*` topics already in `METHOD_TOPIC_REGISTRY` (S6). This module publishes:

1. **`ModuleRole`** — typed role identifiers for the Wave 1 modules (`monitor`, `planner`, `memory`) plus forward-declared roles reserved for later waves (`reflector`, `critic`, `observer`, `reasoner`, `actor`, `evaluator`)
2. **`CORTICAL_WORKSPACE_TOPICS`** + role emit/subscribe tables (S10 §5.2.2 of PRD-068)
3. **`generateCortexCognitiveEmitSection(roles)`** — manifest helper that produces the `requires.events.{emit,on}` YAML/JSON for one or more cognitive roles in a tenant-app manifest
4. **`withCorticalWorkspaceMembership()`** — helper that performs the JOIN / HEARTBEAT / LEAVE handshake on behalf of a module agent (S11)

**Key constraints:**
- No new runtime port — reuses S6 `METHOD_TOPIC_REGISTRY` + CortexEventConnector
- Handshake is flat (no leader election); duplicate-role conflicts are operator-resolved
- Heartbeat cadence: 30s via `ScheduledPact` (S5); implicit LEAVE after 90s without re-emitting `module_online`
- Publish is best-effort — handshake events are tolerated to drop under back-pressure (30s heartbeat gives a second chance)
- Cognitive *behavior* validation is research-gated on RFC-006 R-26c rerun; the scaffolds are correct-by-construction for Cortex hosting independent of that outcome

## Surfaces

| Surface | Scope | Status | Defined in |
|---------|-------|--------|-----------|
| **S10** | Cortical Workspace Topic Spec — `method.cortex.workspace.*` topic family, schemas, role emit/subscribe tables, manifest helper | frozen | PRD-068 §5.2 |
| **S11** | Module Handshake Protocol — `module_online` JOIN, 30s HEARTBEAT, `module_offline` graceful LEAVE, 90s implicit LEAVE | frozen | PRD-068 §5.3 |

Both surfaces live inside PRD-068; neither has a separate `decision.md` file.

## Architecture

```
Cognitive tenant apps               @method/agent-runtime                Cortex ctx
─────────────────────               ─────────────────────                ───────────

┌─────────────────────┐             ┌───────────────────────────┐        ┌──────────┐
│ monitor (resumable) │──role pact─▶│                           │        │          │
└─────────────────────┘             │  cortical-workspace.ts    │─pub──▶ │ ctx.     │
                                    │                           │        │ events   │
┌─────────────────────┐             │  withCortical             │        │          │
│ planner (resumable) │──role pact─▶│    WorkspaceMembership()  │─sched─▶│ ctx.     │
└─────────────────────┘             │      join / tick / leave  │ 30s    │ schedule │
                                    │                           │        │          │
┌─────────────────────┐             │  generateCortex           │        │          │
│ memory  (persistent)│──role pact─▶│    CognitiveEmitSection() │        │          │
└─────────────────────┘             │      → manifest YAML      │        │          │
                                    │                           │        │          │
                                    │  CORTICAL_WORKSPACE_TOPICS│        │          │
                                    │  (filter of S6 registry)  │        │          │
                                    └───────────────────────────┘        └──────────┘
```

## Topic family — `method.cortex.workspace.*`

All topics are registered in `METHOD_TOPIC_REGISTRY` per S6. The workspace subset is selected by `CORTICAL_WORKSPACE_TOPICS` (read-only filter).

**Workspace-level (module-agnostic):**
- `module_online` — JOIN / HEARTBEAT (every role emits this)
- `module_offline` — LEAVE (every role emits this)
- `degraded` — fault/capacity signal (every role may emit)

**Monitor-owned:**
- `anomaly`, `confidence`

**Planner-owned:**
- `plan_updated`, `goal`

**Memory-owned:**
- `memory_recalled`, `memory_consolidated`

**Root tenant app:**
- `session_opened`, `session_closed` — emitted by the ROOT tenant app, NOT by cognitive modules. `root` is not a `ModuleRole` to prevent accidental deployment of a "root module" cognitive app

**Coordination key:** every payload carries a `traceId` — the same `traceId` that flows through the S5 `ContinuationEnvelope`. Modules filter workspace events by `traceId` to correlate on the same root user request.

## S11 handshake protocol

```
Tenant app lifecycle              Publishes                     Timing
───────────────────              ─────────                     ──────

createMethodAgent()       ──▶                                   (0 ms)
                                                                  │
handle.join()             ──pub──▶ method.cortex.workspace.     (at t=0)
                                    module_online                 │
                                      { moduleRole, appId,        │
                                        version, capabilities,    │
                                        at }                      │
                                                                  ▼
ScheduledPact tick        ──pub──▶ method.cortex.workspace.     (every 30s)
  (CORTICAL_WORKSPACE_                module_online                │
   HEARTBEAT_CRON)                    [same payload]               │
                                                                  ▼
agent.dispose()           ──pub──▶ method.cortex.workspace.     (at shutdown)
  → handle.leave()                   module_offline
                                      { reason: 'graceful' }

Peer view:                                                       ──────
  - Sees module_online → adds/refreshes membership entry
  - No heartbeat for 90s → implicit LEAVE (drop entry, emit
    local 'degraded' if consumer is depending on that module)
  - Sees module_offline with reason='role_duplicate' → operator
    intervention required (no forced eviction)
```

**Invariants:**
- `join()` and `leave()` are idempotent
- Both emit into `ctx.events.publish()` directly (bypassing the `CortexEventConnector` projection path — handshake events are first-class, not projected from RuntimeEvents)
- `leave()` attempts reason=`graceful` but tolerates publish failure (best-effort on dispose)
- No leader election: if two modules advertise the same role on different `appId`s, peers MAY emit `degraded { reason: 'role_duplicate' }` but neither is forced offline

## Wave 1 sample apps

Three tenant apps ship as skeletons in `samples/cortex-cognitive-*/`:

| Sample | Pact mode | Budget | Subscribes | Emits |
|--------|-----------|--------|-----------|-------|
| `cortex-cognitive-monitor/` | `resumable` | low (rule-based + small-LLM) | `workspace.state`, `workspace.plan_updated` | `workspace.anomaly`, `workspace.confidence` |
| `cortex-cognitive-planner/` | `resumable` | medium (reasoning LLM) | `workspace.state`, `workspace.anomaly`, `workspace.memory_recalled` | `workspace.plan_updated`, `workspace.goal` |
| `cortex-cognitive-memory/` | `persistent` | medium (storage-backed) | `workspace.memory_query`, `workspace.state` | `workspace.memory_recalled`, `workspace.memory_consolidated` |

Each sample pact declares a proper `SchemaDefinition<T>` for its output (Monitor → `MonitorReport`, Planner → `PlanUpdate`, Memory → `MemoryRecallOutput`) — hand-written `parse(raw) → SchemaResult<T>` validators, no external schema-library dependency.

## Open questions

- **Wave 2 Reflector** will share the persistent-mode + bounded-store pattern from Memory. The `MAX_ENTRIES_PER_KIND` and `CONSOLIDATION_ACTIVATION_FLOOR` constants should move from `agent.ts` into a shared config struct before the second persistent-mode app ships.
- **Monitor/Planner `reactToWorkspaceState` analogue** — PRD-068 §5.1 indicates both subscribe to `workspace.state` too, but only Memory got a state-reaction path in Wave 1. Wave 1.5 backfill candidate.
- **Observer ambient-UI app** — spec'd in PRD-068 §4.1 as "read-only on `method.cortex.workspace.*`". Implementation is PRD-079 / roadmap item 15; out of scope for this PR family.

## Related
- [event-bus.md](event-bus.md) — universal bridge event bus (S6 is the Cortex-side event connector built on top)
- [pacta.md](pacta.md) — pact contracts, pacta agent SDK
- [`packages/agent-runtime/src/cortex/event-topic-registry.ts`](../../packages/agent-runtime/src/cortex/event-topic-registry.ts) — `METHOD_TOPIC_REGISTRY` (S6)
- PRD-068 — `.method/sessions/fcd-design-prd-068-cognitive-modules/prd.md`
