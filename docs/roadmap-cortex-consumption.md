---
title: "Method → T1 Cortex Consumption Roadmap"
status: draft
date: 2026-04-14
author: CTO
audience: [cto, method-team, cortex-team]
purpose: >
  Define what method must ship as a library so that t1-cortex can host autonomous
  agents that develop features and resolve incidents overnight, on top of the
  Cortex-as-OS platform (RFC-005).
related:
  - ../../t1-repos/t1-cortex-1/docs/rfcs/RFC-005-app-platform-service-library.md
  - ../../ov-t1/projects/t1-cortex/BRIEF.md
  - ../../ov-t1/projects/t1-cortex/STRATEGY.md
  - ../../ov-t1/projects/incidents-bot/BRIEF.md
  - ../../ov-t1/projects/ceo-autonomous-agent-demo/BRIEF.md
  - ../../ov-t1/comms/ceo-arturo/23-20260414-outbound-status-update-4-requests-working.md
---

# Method → T1 Cortex Consumption Roadmap

> Cortex-as-OS is the host. Tenant apps need a substrate to spawn, govern, and
> reason with autonomous agents — incident triage agents, feature-development
> agents, daily-twin agents. Method is that substrate. Today method ships as a
> standalone HTTP/MCP server. To be **consumable by Cortex tenant apps**, it
> must ship as a set of typed, embeddable libraries with a clean port surface
> over Cortex services (`ctx.llm`, `ctx.jobs`, `ctx.events`, `ctx.audit`,
> `ctx.storage`, `ctx.secrets`, `ctx.notify`, `ctx.schedule`).

---

## 1. The Two Demand Signals

Two demos on April 21 (CEO influencer visit) drive immediate scope:

| Demo | Method requirement |
|---|---|
| **3.1 Autonomous Incident Tracking** (Iñaki's bot + Cortex agents that triage in the incident channel) | A library a Lambda or Cortex tenant app can import to spawn an agent with a bounded pact (budget, scope, output schema), stream events back, and post into Slack via `ctx.notify`. |
| **3.2 Autonomous Feature Development** | A library a Cortex tenant app can use to run an end-to-end PRD → co-design → implement → review → PR loop, with the agent operating under a Cortex-issued scoped token, budget tracked through `ctx.llm`, and audit through `ctx.audit`. |

Beyond demos, the strategic anchor is BRIEF.md §"Cortex como plataforma": the
**Digital Twins** flagship and **autonomous-implementation strategy**
(`ov-t1/projects/t1-cortex/STRATEGY.md`) need the same substrate, just with
different pacts and longer horizons.

## 2. Cortex's Position on Agents

From RFC-005 §10.2 + §4.1.5:

- A tenant app of category **`agent`** is a Tier 2 (service) app: long-running,
  needs storage + events + LLM. Cortex provisions everything via the manifest.
- Agents act on behalf of users via **RFC 8693 token exchange** — the agent's
  service-account JWT is exchanged for a user-scoped delegated token. Max
  delegation depth is 2 in Wave 0 (user → agent → optional sub-agent).
- LLM access is **mandatory through `ctx.llm`** (PRD-068) with atomic
  budget enforcement. Direct provider keys are forbidden.
- Jobs (`ctx.jobs`, PRD-071) and Scheduling (`ctx.schedule`, PRD-075) are the
  substrate for "overnight" autonomy.
- Audit (`ctx.audit`, PRD-065) is the immutable record every agent decision
  must produce.

**Implication for method:** any agent runtime method ships into Cortex must
*not* hold its own LLM keys, *not* manage its own auth, *not* provision its
own queue. It must compose over `ctx.*`. The contract method enforces (the
**pact**) is the right shape — what's missing is the wiring to Cortex services.

## 3. What Method Has Today (asset inventory)

| Package | What it is | Cortex-readiness |
|---|---|---|
| `@methodts/pacta` | Modular Agent SDK — typed pacts (mode, budget, output, scope, reasoning, context), composition engine, reference agents (code/research/review), middleware (budget enforcer, output validator), reasoning strategies (ReAct, Reflexion, FewShot), context managers (compaction, note-taking, subagent delegation). **L3, library-shaped, zero process deps.** | **High** — already a library. The pact contract maps cleanly onto Cortex's bounded-execution model. Needs: provider that uses `ctx.llm`, audit emitter, AppId-scoped budget plumbing. |
| `@methodts/pacta-provider-claude-cli` | Spawns `claude --print/--resume` as the agent backend. | **Low** — assumes local Claude CLI binary. Cortex deployment needs an HTTP-based provider that goes through `ctx.llm`, OR a sidecar pattern. |
| `@methodts/pacta-provider-anthropic` | Direct Anthropic SDK provider. | **Medium** — works, but bypasses `ctx.llm` budget. Wrap to route through `ctx.llm`. |
| `@methodts/methodts` | Typed Methodology SDK — predicates, steps, methods, methodologies, gates, runtime, strategy controller, prebuilt strategies, ClaudeHeadless provider. **L2, library-shaped, exported via subpath.** | **High** — already a library. The DAG executor and gates are exactly what an "autonomous feature development" pact needs. |
| `@methodts/cluster` | Cluster protocol, membership, routing — transport-agnostic. **L3, zero `@methodts/*` deps.** | **High** — pure library. Useful for federating method nodes across Cortex tenant apps. |
| `@methodts/mcp` | Thin MCP adapter wrapping `@methodts/methodts`. | **Medium** — usable as a Cortex `mcp-tool` tier app, but currently entangled with the bridge's discovery model. Needs a Cortex transport. |
| `@methodts/fca-index` | FCA component indexer. | **Independent** — can ship as a stateless utility tenant app. Already split (see PRD-053/054). |
| `@methodts/bridge` | L4 application — Fastify HTTP server, PTY pool, strategy executor, federation sink, event bus, project discovery. **`packages/bridge/src/index.ts` exports `{}`** — bridge is a runnable, not a library. | **Process-only** — Cortex tenant apps can't `npm install` the bridge. Either (a) extract its domains as libraries, or (b) run the bridge as a separate Cortex-managed service that tenant apps call via HTTP. The strategy executor + cognitive sink + event bus + cost governor are the "engine" that needs to be exposed. |
| `@methodts/method-ctl` | CLI for cluster management. | **N/A** — operator tool, not a runtime dependency. |
| `@methodts/smoke-test` | Layer-aware E2E suite + browser UI. | **N/A** — internal validation. |

**Summary:** the L2/L3 packages (`pacta`, `methodts`, `cluster`, `fca-index`)
are already library-shaped. The L4 bridge is the gap — it owns the stateful
behavior agents need (session pool, strategy executor, event persistence,
cost governance) but only exposes it via HTTP and only spawns local PTY
sessions.

## 4. What Cortex Actually Needs from Method

Distilled from RFC-005, the Twins flagship, the incidents-bot brief, and the
proven 13-hour Slack marathon (the existence proof of what we're operationalizing):

### 4.1 Hard requirements (must ship to host any agent demo)

1. **A `@methodts/agent-runtime` library** (new package) — what an agent tenant app actually imports. Wraps `@methodts/pacta` + provider + middleware so a Cortex app can write:
   ```ts
   const agent = createMethodAgent({ ctx, pact: incidentTriagePact });
   const result = await agent.invoke({ prompt, sessionId, parentToken });
   ```
   …and have budget enforcement, audit emission, scoped tokens, and event streaming wired automatically over `ctx.*`.

2. **A `CortexLLMProvider`** (new) — `AgentProvider` that calls `ctx.llm.complete({ tier, prompt, ... })` instead of holding provider keys. Inherits budget, retries, tier routing, and the mandatory `onBudgetWarning/Critical/Exceeded` handlers from PRD-068. Replaces `pacta-provider-anthropic` for production Cortex apps.

3. **Token-exchange aware invocation** — a `pacta` middleware that exchanges the parent user token for an agent-scoped token (RFC 8693 per RFC-005 §4.1.5), passes it to provider calls, and re-exchanges for sub-agents up to the depth cap.

4. **Audit emitter middleware** — for every `AgentEvent`, emit a `ctx.audit.event()` with app/user/tier/cost/decision. PRD-065 schema.

5. **A persistent session/checkpoint port that backs onto `ctx.storage`** — the bridge currently writes JSONL to disk; in Cortex it must use the per-app MongoDB (PRD-064). The `MemoryPort` and session checkpoint sink need a Mongo adapter behind a `SessionStore` port.

6. **A `JobQueue`-backed scheduler for long-running pacts** — the bridge's `cron` triggers and strategy executor today run in-process. In Cortex, "overnight" means the runtime hands off to `ctx.jobs` + `ctx.schedule`. Need a `JobBackedExecutor` that enqueues pact continuations.

7. **A library-mode bridge** — minimum: extract `domains/strategies/strategy-executor.ts`, `domains/sessions/cognitive-provider.ts`, `domains/cost-governor/`, and `shared/event-bus/` into a new `@methodts/runtime` package the bridge itself depends on. Cortex tenant apps then depend on `@methodts/runtime`, not `@methodts/bridge`.

### 4.2 Soft requirements (needed for "autonomous overnight" pacts to be production-grade)

8. **Resumable execution** — pacta already has `ResumableMode`; a Cortex-backed resume must rehydrate from `ctx.storage` checkpoints, replay events from `ctx.events` since last checkpoint, and respect a fresh budget reservation from `ctx.llm`.

9. **Cost governance per AppId** — current `domains/cost-governor/` tracks bridge-wide cost; in Cortex it must report per `AppId` so PRD-068 enforces budget at the call site, and method's budget enforcer becomes a *predictive* check before the actual `ctx.llm` reservation.

10. **Event bus → Cortex events translator** — the Universal Event Bus (PRD 026) emits `BridgeEvent` objects today. A `CortexEventConnector` (extending the existing `EventConnector` interface) must translate to Cortex's `ctx.events` topology with clearance filtering (RFC-005 §4 + PRD-072).

11. **Methodology source over `ctx.storage`** — the `MethodologySource` port (already exists at `packages/bridge/src/ports/methodology-source.ts`) needs a Cortex-backed implementation: methodologies live as documents in the tenant app's per-app DB so a Cortex admin can curate them per app/role.

12. **MCP transport to Cortex tool registry** — `@methodts/mcp` currently registers via the bridge. For a Cortex-hosted methodology agent, tools need to register via `POST /v1/platform/apps/:id/tools` (PRD-043) so Cortex enforces operation-grammar authorization.

### 4.3 Stretch (Wave 2+)

13. **Multi-app strategy execution** — strategy DAGs that span Cortex apps (incident bot triggers feature-dev agent in another app). Depends on PRD-080 (App-to-App Dependencies, currently `🔜 deferred`).

14. **Cognitive composition over Cortex services** — RFC 001 cognitive modules (Monitor, Planner, etc.) running as Cortex agents, sharing state via `ctx.events`. This is the "emergent multi-agent" demo.

15. **Genesis ambient UI as a Cortex app** — the bridge's genesis domain (PRD 025) is already an "ambient agent" pattern; reskinning it as a Cortex Tier 3 webapp gives leaders a unified view of agent activity across tenant apps.

## 5. Feature-Completeness Checklist

This is the binary checklist Cortex teams will run to declare "method is consumable as a library." Group A is required for the April 21 demos. Group B is required for the Twins flagship Wave 1. Group C is everything else.

### Group A — April 21 demo readiness (next ~4 weeks)

- [ ] **A1.** Carve out `@methodts/runtime` package containing strategy executor, cognitive provider, cost governor (per-AppId), event bus + sinks. Bridge depends on it.
- [ ] **A2.** Carve out `@methodts/agent-runtime` package — the public, embeddable API for Cortex tenant apps. Wraps `@methodts/pacta` + sane defaults + ports for `ctx.*`.
- [ ] **A3.** Implement `CortexLLMProvider` (AgentProvider that calls `ctx.llm.complete/structured/embed`). Validates `requires.llm` + budget handler presence at composition time.
- [ ] **A4.** Implement `CortexAuditMiddleware` (AgentEvent → `ctx.audit.event()`).
- [ ] **A5.** Implement `CortexTokenExchangeMiddleware` (RFC 8693, depth ≤ 2).
- [ ] **A6.** Document a "minimal Cortex agent app" cookbook entry and a working sample app (`samples/cortex-incident-triage-agent/`) that consumes `@methodts/agent-runtime` end-to-end against Cortex's local mock server.
- [ ] **A7.** Define and freeze the `MethodAgentPort` co-design with Cortex (analogous to Cortex's RFC-005 Wave 0 surfaces). Single doc: `/co-design/method-agent-port.md`. Surface advocate review.
- [ ] **A8.** Smoke-test invocation against `t1-cortex-1` dev stack — agent runs, budget reserved, audit logged, event in `#sistema-incidencias` posted via `ctx.notify`.

### Group B — Twins flagship Wave 1 readiness (next ~8 weeks)

- [ ] **B1.** `CortexSessionStore` adapter — pacta `MemoryPort` + bridge session checkpoints persisted to `ctx.storage` (per-app Mongo).
- [ ] **B2.** `JobBackedExecutor` — strategy executor that enqueues continuations to `ctx.jobs` (PRD-071), with handler registration that pulls the next pact step.
- [ ] **B3.** `CortexScheduledPact` helper — wraps a pact in a `ctx.schedule` cron registration (PRD-075). Required for the 9am twin reports.
- [ ] **B4.** `CortexEventConnector` — bridge `EventBus` events → Cortex `ctx.events`, clearance-filtered.
- [ ] **B5.** `CortexMethodologySource` — methodologies stored in per-app DB, hot-reloadable via Cortex admin UI.
- [ ] **B6.** Resume-on-restart contract — when a Cortex container restarts mid-pact, the next worker resumes from the last checkpoint without losing budget reservation context.
- [ ] **B7.** Cost-governor reports per-AppId; budget enforcer becomes a predictive pre-check before the real `ctx.llm` reservation (no double-charge, no race).
- [ ] **B8.** Conformance test suite (`@methodts/pacta-testkit` extension) that any Cortex-targeted agent app can run to assert it satisfies the `MethodAgentPort` contract.
- [ ] **B9.** Migration guide for the existing `@methodts/bridge` STRATEGY.md autonomous loop in `t1-cortex-1` to use `@methodts/runtime` directly (no separate bridge process needed inside Cortex).

### Group C — Production hardening + multi-agent (next ~12+ weeks)

- [ ] **C1.** MCP transport adapter that registers methodology tools through Cortex's `POST /v1/platform/apps/:id/tools` (PRD-043) with operation-grammar authz.
- [ ] **C2.** Multi-app strategy execution — pacts that invoke other apps' operations via app-to-app dependencies (depends on PRD-080).
- [ ] **C3.** Cognitive composition modules (RFC 001 / RFC 003) shipped as Cortex tenant apps, sharing state through `ctx.events`.
- [ ] **C4.** Genesis-style ambient UI as a Tier 3 Cortex webapp (PRD-079 design system).
- [ ] **C5.** SLM-backed providers for cheap reasoning steps inside pacts (RFC 002 / RFC 005 in method).
- [ ] **C6.** Security review + threat model for the agent runtime as a tenant.
- [ ] **C7.** Removal of all direct provider-key code paths from production Cortex agent apps (deprecate `pacta-provider-anthropic` for Cortex consumption; keep as test-only).

## 6. Suggested Method PRDs to Open

These are the implementation containers — drafts only, sized per FCA partition:

| PRD # | Title | Group | Size |
|---|---|---|---|
| `057` | `@methodts/runtime` package extraction (strategy executor + cognitive provider + cost governor + event bus) | A | L |
| `058` | `@methodts/agent-runtime` package — Cortex-targeted public API | A | M |
| `059` | `CortexLLMProvider` + `CortexAuditMiddleware` + `CortexTokenExchangeMiddleware` | A | M |
| `060` | `MethodAgentPort` co-design (with Cortex) | A | S |
| `061` | `CortexSessionStore` + checkpoint resume contract | B | M |
| `062` | `JobBackedExecutor` + `CortexScheduledPact` | B | M |
| `063` | `CortexEventConnector` + clearance filtering | B | S |
| `064` | `CortexMethodologySource` + admin UI integration | B | M |
| `065` | Pacta conformance testkit for Cortex tenant apps | B | S |
| `066` | MCP transport for Cortex `POST /v1/platform/apps/:id/tools` | C | M |
| `067` | Multi-app strategy execution (pending PRD-080) | C | L |
| `068` | Cognitive modules as Cortex tenant apps | C | L |

## 7. Roadmap (Phased)

```
Phase 1 — Library carve-out                    Apr 14 – May 12 (4 wk)
  PRDs 057, 058, 060
  Outcome: t1-cortex tenant apps can `npm install @methodts/agent-runtime`

Phase 2 — Cortex service wiring                Apr 28 – May 26 (4 wk, overlaps)
  PRDs 059
  Outcome: an agent invocation flows through ctx.llm + ctx.audit
  Demo gate: Apr 21 incident-triage agent posts to #sistema-incidencias
  via ctx.notify, with budget enforced and audit trail visible.

Phase 3 — Persistence + scheduling             May 12 – Jun 16 (5 wk)
  PRDs 061, 062, 063
  Outcome: agents survive container restarts; "overnight" pacts run via
  ctx.jobs + ctx.schedule. Twins Wave 1 is unblocked from method's side.

Phase 4 — Methodology hosting + conformance    Jun 2 – Jun 30 (4 wk)
  PRDs 064, 065
  Outcome: methodologies are per-app curated content; new tenant apps
  can self-certify against the conformance suite.

Phase 5 — MCP + multi-app + cognitive          Jul 1 – Sep 1 (8 wk)
  PRDs 066, 067, 068
  Outcome: full ecosystem — method-backed agents can call each other,
  cognitive modules ship as first-class tenant apps. Aligned with Cortex
  Wave 4-5 (FCA codegen + app-to-app deps).
```

## 8. Open Questions for Cortex Team

1. **Token-exchange depth** — RFC-005 §4.1.5 caps Wave 0 at depth 2. Does method's `subagentDelegator` middleware need an explicit depth check, or does the platform reject excess exchanges?
2. **Budget pre-reservation semantics** — PRD-068 §2 says check-and-reserve is atomic. Should method's budget enforcer be advisory (predictive only) or perform a soft reservation via a dedicated `ctx.llm.reserve()` API?
3. **Per-app methodology storage** — does PRD-064 (`ctx.storage`) handle large structured documents (methodology YAMLs are ~2-10KB each, hundreds per app), or do we need a dedicated knowledge-tier path?
4. **Tool registration timing** — methodologies define dynamic tool sets per role/step. Does Cortex's `POST /v1/platform/apps/:id/tools` (PRD-043) support runtime updates without redeploy, or is it deploy-time only?
5. **Cluster federation** — `@methodts/cluster` enables cross-instance event relay. Is there a Cortex pattern for app-to-app messaging that subsumes this, or do we keep cluster as method-internal?

## 9. Non-Goals

- **Don't fork the runtime.** Cortex consumption must use the same `@methodts/pacta` + `@methodts/methodts` packages as the standalone bridge. Divergence kills the registry-as-source-of-truth invariant from `.method/project-card.yaml`.
- **Don't reimplement Cortex services in method.** No method-level identity, knowledge, or jobs implementations meant for production. Method's defaults remain local-only and exist for the standalone bridge use case.
- **Don't promise multi-tenant isolation inside method.** Cortex provides per-app isolation; method runs as one library inside one app's container. If a tenant app needs to host multiple agents, that's a method composition concern, not a method tenancy concern.

## 10. Frozen Surfaces (FCD Co-Design Outcomes — 2026-04-14)

Nine surfaces were co-designed in parallel via `/fcd-surface` sessions. Eight
frozen, one needs-follow-up pending Cortex clarification.

> Ratification materials live in `co-design/` — see `co-design/CHANGES.md` for
> the amendment process and `co-design/method-agent-port.md` for the first
> bilateral signoff (S1, PRD-060).

| ID | Surface | Producer ↔ Consumer | Status | Decision file |
|----|---------|---------------------|--------|---------------|
| **S1** | `MethodAgentPort` | `@methodts/agent-runtime` ↔ Cortex tenant app | ✔️ frozen | `.method/sessions/fcd-surface-method-agent-port/decision.md` |
| **S2** | `RuntimePackageBoundary` | `@methodts/bridge` ↔ `@methodts/runtime` (new) | ✔️ frozen | `.method/sessions/fcd-surface-runtime-package-boundary/decision.md` |
| **S3** | `CortexServiceAdapters` (LLM + Audit + TokenExchange) | `@methodts/agent-runtime` ↔ `ctx.{llm,audit,auth}` | ✔️ frozen | `.method/sessions/fcd-surface-cortex-service-adapters/decision.md` |
| **S4** | `SessionStore` + `CheckpointSink` (resume) | `@methodts/runtime` ↔ `ctx.storage` / FS | ✔️ frozen | `.method/sessions/fcd-surface-session-store/decision.md` |
| **S5** | `JobBackedExecutor` + `ScheduledPact` | `@methodts/runtime` ↔ `ctx.{jobs,schedule}` | ✔️ frozen | `.method/sessions/fcd-surface-job-backed-executor/decision.md` |
| **S6** | `CortexEventConnector` | `@methodts/runtime` ↔ `ctx.events` | ✔️ frozen | `.method/sessions/fcd-surface-event-connector/decision.md` |
| **S7** | `CortexMethodologySource` | `@methodts/agent-runtime` ↔ `ctx.storage` + `@methodts/methodts` | ✔️ frozen | `.method/sessions/fcd-surface-methodology-source/decision.md` |
| **S8** | `CortexAgentConformance` testkit | `@methodts/pacta-testkit/conformance` ↔ Cortex agent apps | ✔️ frozen | `.method/sessions/fcd-surface-conformance-testkit/decision.md` |
| **S9** | `MCPCortexTransport` (tool registration) | `@methodts/mcp` ↔ Cortex tool registry | ⏸️ needs-follow-up | `.method/sessions/fcd-surface-mcp-cortex-transport/decision.md` |

### Key cross-surface decisions

- **`createMethodAgent({ ctx, pact, onEvent? })`** is the single public factory (S1). `pacta` is a peer dep; tenant app brings one version. `events()` and `onEvent` are mutually exclusive.
- **`@methodts/pacta-provider-cortex` is its own package** (S1+S3) — preserves the `pacta-provider-*` family naming, keeps `@methodts/agent-runtime` thin.
- **`BridgeEvent` → `RuntimeEvent`** rename (S2). One-line type alias retained in bridge during migration.
- **`@methodts/runtime` subpath exports** (S2): `/strategy`, `/sessions`, `/event-bus`, `/cost-governor`, `/ports`, `/config`. Bridge keeps Fastify routes, PTY factory, project discovery, Tailscale adapters, `method-ctl`.
- **`SessionProviderFactory` port** introduced (S2) so the session pool can host PTY-spawned (bridge) and Cortex-LLM-driven (agent-runtime) sessions through the same abstraction.
- **Budget single authority = `ctx.llm`** (S3). Pacta's `budgetEnforcer` gains a `mode: 'authoritative' | 'predictive'` option; predictive when provider declares `capabilities().budgetEnforcement === 'native'`. Turns + duration stay authoritative in pacta. Gate `G-BUDGET-SINGLE-AUTHORITY`.
- **Token-exchange depth check** lives in `CortexTokenExchangeMiddleware.exchangeForSubAgent` (S3), throws `CortexDelegationDepthExceededError` at depth ≥ 2.
- **Audit is the superset** (S6): every event-connector topic also writes to audit (gate `G-AUDIT-SUPERSET`). Audit-only events (~18 high-frequency: `agent.text/thinking`, observations, project events) never hit `ctx.events`.
- **SessionStore split from CheckpointSink** (S4) — persistence port doesn't depend on `RuntimeEvent`. 10 methods (`create`, `load`, `resume`, `releaseLease`, `renewLease`, `appendCheckpoint`, `loadCheckpoint`, `loadLatestCheckpoint`, `listCheckpoints`, `finalize`, `destroy`). Lease (~30s) + fencing token = idempotency.
- **Continuation envelope** (S5): `(version, sessionId, turnIndex, checkpointRef, budgetRef, nextAction, pactKey, tokenContext, traceId)`. Budget carry-over default = `batched-held` (single `ctx.llm.reserve(maxCostUsd)` at pact start, settled per turn). One handler per app for `method.pact.continue`.
- **Methodology hot-reload via single declared event type** `methodology.updated` (S7) — Cortex PRD-072 forbids runtime wildcard subscriptions. `MethodologySource` extended additively with optional `init/reload/onChange/close`.
- **Conformance testkit ships as `@methodts/pacta-testkit/conformance` subpath** (S8), not a new package. Self-certification in v1; Cortex reads a signed `ComplianceReport.json` artifact. Three v1 fixtures: incident-triage, feature-dev-commission, daily-report.

### Open follow-ups raised by surfaces

| # | Question | Surface | Owner |
|---|----------|---------|-------|
| O1 | `ctx.llm.reserve()` / `settle()` API shape — needed for `batched-held` budget carry-over | S5 | Cortex (extend PRD-068 / 12.3) |
| O2 | Streaming through `ctx.llm` — currently deferred to PRD-068 Wave 7 | S3 | Cortex |
| O3 | `thinkingBudgetTokens` + `temperature` pass-through — needs `extra` field on `CompletionRequest` | S3 | Cortex |
| O4 | Field-level methodology override (vs whole-document shadowing) | S7 | Method (defer) |
| O5 | Runtime tool registration via `POST /v1/platform/apps/:id/tools` — endpoint legacy; actual API is `AppRegistryRepo.updateCallback` per RFC-005 Appendix D.4. Need new `spec.methodology.{pool,toolRegistration}` block in manifest. | S9 | Cortex (PRD-043 extension or new PRD) |
| O6 | `CortexCtx.auth.issueServiceToken(scope)` — service-account JWTs for platform-capability actions like tool registration. Additive amendment to S1. | S9 | Cortex |
| O7 | DELETE verb for tool deregistration when methodology removed | S9 | Cortex |
| O8 | Large payload risk on `method.strategy.gate.awaiting_approval` topic (artifact_markdown can be MB-sized) | S6 | Method (PRD-063 measurement) |

### Updated PRD scope notes (from surfaces)

- **PRD-057** carries the `BridgeEvent → RuntimeEvent` rename + `SessionProviderFactory` port introduction + `createCostGovernorDomain` decoupling from Fastify.
- **PRD-058** ships `createMethodAgent` + `CortexCtx` type imports + `MethodAgent` handle + opaque `Resumption` token.
- **PRD-059** adds the `mode: 'authoritative' | 'predictive'` option to pacta's `budgetEnforcer` (minor, backward-compatible).
- **PRD-061** uses lease+fencing for atomic resume; documents both the FS adapter (bridge default) and `ctx.storage` adapter (agent-runtime default).
- **PRD-062** ships `JobBackedExecutor` with three budget strategies (`fresh-per-continuation`, `batched-held` default, `predictive-prereserve`), explicitly marks DLQ visibility contract.
- **PRD-063** must measure event-bus payload sizes for gate-approval topic; needs to enforce manifest-emit-section generation.
- **PRD-064** introduces a separate `methodology_policy` singleton document; admin-only API methods stay on `CortexMethodologySource` (not on base port).
- **PRD-065** is a `@methodts/pacta-testkit/conformance` subpath, not a new package.
- **PRD-066** is **blocked** until Cortex resolves O5/O6/O7. Solo can ship the methodts→Cortex mapping table + the v1 fallback (Model A: deploy-time only manifest registration).

## 11. PRD Design Outcomes (FCD — 2026-04-14)

Twelve PRDs drafted in parallel via `/fcd-design` sessions. Each PRD references
its frozen surfaces by `decision.md` path and inherits their gates.

| PRD | Title | Size | Status | Design artifact |
|-----|-------|------|--------|-----------------|
| **057** | `@methodts/runtime` extraction | L | draft | `.method/sessions/fcd-design-prd-057-method-runtime/prd.md` |
| **058** | `@methodts/agent-runtime` public API | M | draft | `.method/sessions/fcd-design-prd-058-method-agent-runtime/prd.md` |
| **059** | `CortexLLMProvider` + Audit + TokenExchange adapters | M | draft | `.method/sessions/fcd-design-prd-059-cortex-adapters/prd.md` |
| **060** | `MethodAgentPort` bilateral ratification | S | draft | `.method/sessions/fcd-design-prd-060-method-agent-port/prd.md` |
| **061** | `CortexSessionStore` + checkpoint resume | M | ✔️ implemented (#182) | `.method/sessions/fcd-design-prd-061-session-store/prd.md` |
| **062** | `JobBackedExecutor` + `ScheduledPact` | M | ✔️ implemented-partial (#186) — Wave 1 only; Wave 2 `batched-held` blocked on Cortex O1 | `.method/sessions/fcd-design-prd-062-job-backed-executor/prd.md` |
| **063** | `CortexEventConnector` | S | ✔️ implemented (#181) | `.method/sessions/fcd-design-prd-063-event-connector/prd.md` |
| **064** | `CortexMethodologySource` + admin API | M | ✔️ implemented (#183) | `.method/sessions/fcd-design-prd-064-methodology-source/prd.md` |
| **065** | Conformance testkit | S | ✔️ implemented (#184) | `.method/sessions/fcd-design-prd-065-conformance-testkit/prd.md` |
| **066** | MCP Cortex transport | M | ✔️ implemented-partial (#185) — Track A only; Track B blocked on Cortex O5/O6/O7 | `.method/sessions/fcd-design-prd-066-mcp-cortex-transport/prd.md` |
| **067** | Multi-app strategy execution | L | ✔️ implemented-partial (#188) — Track A simulator only; real `CortexCrossAppInvoker` blocked on Cortex PRD-080 | `.method/sessions/fcd-design-prd-067-multi-app-strategy/prd.md` |
| **068** | Cognitive modules as tenant apps | L | ✔️ implemented-partial (#187) — Wave 1 skeleton only; cognitive validation gated on RFC-006 R-26c | `.method/sessions/fcd-design-prd-068-cognitive-modules/prd.md` |

### Highlights and commission counts

- **PRD-057** — 7 commissions (C1 ports move → C2 strategy / C3 event-bus / C4 cost-governor / C5 sessions [highest risk] / C6 config → C7 cleanup + gate activation). Recommends serialising C2–C6 to avoid `server-entry.ts` conflicts.
- **PRD-058** — middleware order (outer→inner): TokenExchange → Audit → BudgetEnforcer(predictive) → OutputValidator → Reasoning → CortexLLMProvider. Ships `samples/cortex-incident-triage-agent/` with end-to-end + resumption tests.
- **PRD-059** — 5 waves, `effort → tier` mapping (`low→fast`, `medium→balanced`, `high→powerful`), pacta `budgetEnforcer` gains optional trailing `mode` param (backward-compatible).
- **PRD-060** — 6 ratification artifacts; RACI inline in `CHANGES.md`; CODEOWNERS over frozen surfaces; mandatory SC-0 readthrough.
- **PRD-061** — 2 Mongo collections (`method_session_snapshots`, `method_session_checkpoints`); 30s lease + 128-bit fencing token; `updateOne`+read-back CAS (PRD-064 doesn't ship `findOneAndUpdate` v1).
- **PRD-062** — **Wave 1 ships `fresh-per-continuation` only** (batched-held blocked on Cortex O1). Gate `G-DLQ-SINGLE-EMIT` enforces two-path dedup. `InProcessExecutor` deferred to Wave 3.
- **PRD-063** — 21 events topics confirmed; token-bucket @ 12/s (25% below PRD-069 quota); 32 KB envelope truncation + `artifact_ref`; early O8 measurement harness gates on P99 > 200 KB.
- **PRD-064** — Whole-doc Mongo storage; admin methods live on `CortexMethodologySource` only (new `G-RUNTIME-NO-ADMIN-IMPORT` gate); single `methodology.updated` event type with `payload.kind` discriminator (PRD-072 forbids wildcards).
- **PRD-065** — Subpath ship (`@methodts/pacta-testkit/conformance`); Ed25519 signed `ComplianceReport.json`; optional peer dep on `@methodts/agent-runtime`; stub sample-app fixture as fallback if PRD-058 slips.
- **PRD-066** — **Two-track PRD**: Track A (mapping fn + surface + Model-A deploy-time manifest) ships now; Track B (dynamic registration + DELETE + `authzTemplate`) blocked on Cortex O5/O6/O7. Model A is real-ship default, not a degraded mode.
- **PRD-067** — `CrossAppInvoker` port in `@methodts/runtime` + `CortexCrossAppInvoker` adapter; 13 assumptions on PRD-080; **token-depth conflict flagged** (S3's depth-2 cap can block `user→agent→cross-app→sub-agent` chains — default mitigation is re-compose as siblings); `InProcessCrossAppInvoker` simulator Wave 0/1 so demos don't gate on PRD-080.
- **PRD-068** — Wave 1 = 3 modules (Monitor, Planner, Memory) as separate Cortex tenant apps; new `method.cortex.workspace.*` topic family keyed by `traceId`; fixed per-module budget isolation (no rebalancing); only R-26c rerun blocks demo target (Twins Flow #2); 5 modules deferred to Waves 2-3+.

### Cross-PRD dependency graph

```
PRD-060 (ratify S1) ─┐
                     ├──→ PRD-057 (runtime) ──→ PRD-058 (agent-runtime) ──┬──→ PRD-063 (events)
                     │                          ↑                        ├──→ PRD-064 (methodology)
PRD-059 (adapters) ──┘                          │                        ├──→ PRD-065 (conformance)
                                                │                        └──→ PRD-066 (MCP)
PRD-061 (session-store) ──────────────────────────→ PRD-062 (jobs) ───────→ PRD-067 (cross-app)
                                                                          └──→ PRD-068 (cognitive)
```

### Escalations to Cortex team

Aggregated from PRD design findings. All non-blocking for Group A demos, but
each one caps what Method can ship without Cortex action:

| # | Question | Blocks | PRDs impacted |
|---|----------|--------|---------------|
| O1 | `ctx.llm.reserve()` / `settle()` API shape | `batched-held` budget carry-over | PRD-062 Wave 2 |
| O2 | Streaming through `ctx.llm` | agent streaming UX | PRD-059 v2 |
| O3 | `extra` field on `CompletionRequest` for `thinkingBudgetTokens`, `temperature` | advanced reasoning params | PRD-059 v2 |
| O5 | Runtime tool registration endpoint (`publishMethodology`) | dynamic methodology tools | PRD-066 Track B |
| O6 | `ctx.auth.issueServiceToken(scope)` | any service-account action from method | PRD-066 Track B; Cortex cognitive apps |
| O7 | DELETE verb on tool registry | tool deregistration on methodology removal | PRD-066 Track B |
| O8 | Gate-approval topic payload size (measured under PRD-063) | max safe payload before Method introduces out-of-band storage | PRD-063 (method measures, decides) |
| O9 | Token-exchange depth cap 2 vs 3 | `user→agent→cross-app→sub-agent` chains | PRD-067 |
| O10 | PRD-080 (app-to-app deps) shape | cross-app strategy execution | PRD-067 |
| O11 | Cortex-native peer discovery primitive | cognitive module handshake | PRD-068 |

## 12. Next Action

**Implementation can begin.** Recommended sequencing:

1. **Unblock path (April 21 demos):** PRD-060 ratification (async with Cortex) → PRD-057 → PRD-059 → PRD-058 + PRD-063 + PRD-065 in parallel → `samples/cortex-incident-triage-agent/` running against mock Cortex. Target: 2026-05-12.
2. **Twins Wave 1 path:** PRD-061 → PRD-062 (Wave 1 = fresh-per-continuation) → PRD-064. Target: 2026-06-16.
3. **Cortex-team escalations in parallel:** file issues in `t1-cortex-1` for O1, O5, O6, O7 so Track B of PRD-066 and Wave 2 of PRD-062 can unblock without re-design.
4. **Forward-looking (do not start implementation):** PRD-067 (blocked on PRD-080), PRD-068 (gated on R-26c). Keep designs current; re-open when dependencies resolve.

All 9 surfaces frozen, 12 PRDs drafted, 27 FCD sessions recorded under `.method/sessions/`. Ready for commission dispatch.
