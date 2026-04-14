---
type: prd
id: PRD-057
title: "@method/runtime package extraction"
date: "2026-04-14"
status: draft
version: 0.1.0
size: L
owner: method-core
domains:
  - packages/bridge (L4, existing)
  - packages/runtime (L3, NEW)
  - packages/methodts (L2, unchanged — downstream dep only)
  - packages/pacta (L3, unchanged — downstream dep only)
surfaces_consumed:
  - ".method/sessions/fcd-surface-runtime-package-boundary/decision.md"      # S2 — THE surface this PRD implements
  - ".method/sessions/fcd-surface-method-agent-port/decision.md"             # S1 — downstream consumer constraint
  - ".method/sessions/fcd-surface-cortex-service-adapters/decision.md"       # S3 — downstream consumer constraint
surfaces_produced: []   # No NEW surfaces. PRD implements S2 verbatim.
related:
  - docs/roadmap-cortex-consumption.md §3 (asset inventory), §4.1 item 7, §6 (PRD #057), §10 S2, §10 "Updated PRD scope notes"
  - docs/fractal-component-architecture/ (FCA principles)
  - PRD-058 (@method/agent-runtime — depends on this PRD's output)
  - PRD-059 (Cortex provider/middleware — depends on this PRD's output)
blocks: PRD-058, PRD-059, PRD-061, PRD-062, PRD-063, PRD-064
---

# PRD-057 — `@method/runtime` Package Extraction

## 1. Summary

Extract the **engine-grade, transport-free abstractions** currently living
inside `@method/bridge` (L4 Fastify process) into a new **L3 library package
`@method/runtime`**. `@method/bridge` becomes a thin composition root that
depends on `@method/runtime`; the forthcoming `@method/agent-runtime`
(PRD-058, Cortex-facing) also depends on it. The public API, module map,
rename (`BridgeEvent` → `RuntimeEvent`), per-AppId cost-governor hook, and
`SessionProviderFactory` port are already **frozen** by
S2 (`.method/sessions/fcd-surface-runtime-package-boundary/decision.md`).
This PRD is an **implementation specification** — it designs TO S2, does not
renegotiate S2, and decomposes the mechanical file moves + rename + new ports
into an ordered set of commissions that each maintain a green build.

Size: **L** per roadmap §6. No new cross-domain surfaces are produced —
the S2 co-design record is authoritative. Net lines of code added should be
near zero (moves + barrel exports + one port introduction + one rename).

---

## 2. Problem

From roadmap §3 (asset inventory): *"The L4 bridge is the gap — it owns the
stateful behavior agents need (session pool, strategy executor, event
persistence, cost governance) but only exposes it via HTTP and only spawns
local PTY sessions."* `packages/bridge/src/index.ts` literally exports
`export {};` — the bridge is a runnable, not a library. A Cortex tenant app
cannot `npm install @method/bridge` and call `StrategyExecutor`.

From S2 §1 (context): The same engine pieces must be reusable by two
consumers with radically different deployment shapes:

1. **`@method/bridge`** — Fastify process, local PTY spawning, Tailscale
   cluster federation, filesystem-backed project discovery. Keeps
   everything it owns today; stops owning the engine internals.
2. **`@method/agent-runtime`** (new, PRD-058) — pure library, Cortex-hosted,
   no process concerns, no PTY, no Fastify, routes LLM through `ctx.llm`.

Today these two consumers cannot coexist because the engine is entangled
with bridge-specific transport, PTY spawning, and discovery. Extraction is
the unblock.

**Secondary problem:** The current cost governor factory
(`createCostGovernorDomain`) takes a Fastify `app` for route registration
(see `packages/bridge/src/domains/cost-governor/index.ts` line 58 — the
factory result exposes `registerRoutes(app: FastifyInstance)`). That is a
transport-layer leak an L3 library cannot carry.

---

## 3. Constraints

1. **FCA layering — non-negotiable.** `@method/runtime` is **L3**. It must
   not import from `fastify`, `@fastify/*`, `ws`, `node-pty`, `express`, or
   any cluster/Tailscale/HTTP transport. Violations are bugs per FCA P3.
2. **No back-references.** `@method/runtime` must not import from
   `@method/bridge` or any path resolving into `packages/bridge/**`.
3. **S2 freeze respected.** The public API, file map, rename, and port
   surfaces in `.method/sessions/fcd-surface-runtime-package-boundary/decision.md`
   §§2–6 are **frozen**. This PRD may not renegotiate them. The six S2 open
   questions (decision.md §14) are scoped to PRD-057 *implementation
   details* and are resolved inline below (§10).
4. **`BridgeEvent` → `RuntimeEvent` rename (S2 §4).** One-line type alias
   `export type BridgeEvent = RuntimeEvent` stays in bridge during the
   migration window; all new code uses `RuntimeEvent`. Event **type strings**
   (e.g., `"session.spawned"`, `"strategy.gate_failed"`) are unchanged.
5. **`SessionProviderFactory` port introduction (S2 §6).** The session pool
   must accept an injected factory; bridge owns the PTY factory, agent-runtime
   will own the Cortex factory. The pool itself stays in runtime.
6. **`createCostGovernor` decoupled from Fastify (S2 §3.5).** The new factory
   returns primitives only. Bridge gets a new thin `domains/cost-governor/routes.ts`
   wrapper that imports the primitives and wires Fastify. This is a breaking
   change *for bridge internals only* — no external API change.
7. **Per-AppId hook on cost governor (S2 §3.5, §8).** `createCostGovernor`
   accepts optional `appId?: AppId`. When absent, behaves bit-identically to
   today's `createCostGovernorDomain`. When present, slots scoped by
   `{accountId, appId}`, events carry `payload.appId`. This is the *only*
   semantic change; everything else is pure relocation.
8. **Green-build invariant.** Every PR in this PRD's sequence must leave
   `npm run build` and `npm test` green (per project card DR-01/02 discipline).
   No big-bang merges.
9. **Registry/theory untouched.** This PRD does not modify `registry/`,
   `theory/`, `.method/project-card.yaml`, or any methodology YAML. It is
   purely package-level refactoring.
10. **Downstream consumer shapes are pre-committed.**
    - PRD-058 will import `{ StrategyExecutor, InMemoryEventBus, createPool,
      createCognitiveSession, createCostGovernor, ... }` from the subpaths
      defined in S2 §§3.1–3.6. Any deviation from that list breaks PRD-058.
    - PRD-059 will inject a Cortex-backed `SessionProviderFactory` and a
      Cortex-backed `AgentProvider`. The `SessionProviderFactory` shape
      frozen in S2 §6 is the contract.

---

## 4. Success Criteria

Binary, testable. Each row has an automatable check.

| # | Criterion | Test |
|---|-----------|------|
| SC-1 | New package `@method/runtime` exists at `packages/runtime/` with the exact subpath export map from S2 §2 (strategy/sessions/event-bus/cost-governor/ports/config) plus a barrel `index.ts`. | `npm --workspace=@method/runtime run build` succeeds; `ls packages/runtime/src/{strategy,sessions,event-bus,cost-governor,ports,config}/index.ts` returns all six. |
| SC-2 | `@method/runtime` has zero transport dependencies. | Gate **G-RUNTIME-ZERO-TRANSPORT** (S2 §11): scan forbids `fastify`, `@fastify/`, `ws`, `node-pty`, `express` inside `packages/runtime/src`. |
| SC-3 | `@method/runtime` never imports from `@method/bridge`. | Gate **G-RUNTIME-NO-BRIDGE-BACKREF** (S2 §11). |
| SC-4 | Bridge's cross-domain imports of engine internals all go through `@method/runtime` subpaths, not relative paths into moved dirs. | Gate **G-BRIDGE-USES-RUNTIME-PORTS** (S2 §11); grep for forbidden patterns in `packages/bridge/src/{domains,shared}`. |
| SC-5 | `BridgeEvent` → `RuntimeEvent` rename complete. Exactly one type alias `export type BridgeEvent = RuntimeEvent` remains, inside `packages/bridge/src/ports/event-bus.ts`. `RuntimeEventInput` and `RuntimeRateGovernor` renames applied. | Grep `BridgeEvent` in repo returns ≤ 1 declaration site + doc references; alias file present. |
| SC-6 | Event `type` strings unchanged across extraction. | Snapshot test: set of emitted `event.type` values before extraction == after, verified by `packages/runtime/src/architecture.test.ts` reading a frozen manifest. |
| SC-7 | `SessionProviderFactory` port exists at `packages/runtime/src/ports/session-pool.ts` with shape frozen in S2 §6. Bridge provides a concrete factory (new file `packages/bridge/src/domains/sessions/factory.ts`) that produces PTY/print/cognitive sessions exactly as today. | Type check passes; bridge `createPool()` call in `server-entry.ts` passes the new factory; existing `pool.test.ts` suite green. |
| SC-8 | `createCostGovernor({ appId?, eventBus, fileSystem, config })` exported from `@method/runtime/cost-governor`; no longer returns `registerRoutes`. Bridge has new `packages/bridge/src/domains/cost-governor/routes.ts` that consumes primitives and wires Fastify. When `appId` omitted, runtime behavior is bit-identical to today. | New unit test `cost-governor-app-id.test.ts` confirms slot keying and event payload difference; existing `observations-store.test.ts`, `rate-governor-impl.test.ts`, etc., green without modification. |
| SC-9 | `packages/bridge/src/index.ts` still exports `{}`; `packages/bridge/src/server-entry.ts` wires everything exactly as before (ports injected, domains registered). Fastify, PTY, cluster, genesis, triggers, projects, build, method-ctl, WebSocketSink, NodeFileSystemProvider, JsYamlLoader remain in bridge (S2 §5). | Bridge boots and passes smoke tests: `npm run bridge:test` → `npm --workspace=@method/smoke-test run smoke`. |
| SC-10 | `npm run build` + `npm test` at repo root pass on a fresh clone. Smoke-test suite (`@method/smoke-test`) passes in mock mode. | CI green. |
| SC-11 | No methodology registry files, `.method/project-card.yaml`, schema files, or `theory/` files modified. | `git diff --stat master..HEAD -- registry/ theory/ .method/project-card.yaml` empty. |
| SC-12 | `CognitiveSink` runtime export renamed to `CognitiveEventBusSink` (per S2 §14 Q6 open question resolution — resolved below in §10). Bridge aliases the old name during migration. | Grep + type check. |

**Done = all 12 pass.** No partial acceptance.

---

## 5. Scope

### 5.1 In-scope (exact module list from S2 §2)

Extracted and relocated under `packages/runtime/src/`:

- **strategy/** ← 11 files from `packages/bridge/src/domains/strategies/`:
  `strategy-executor.ts`, `context-load-executor.ts`, `gates.ts`,
  `artifact-store.ts`, `sub-strategy-source.ts`,
  `human-approval-resolver.ts`, `retro-writer.ts`, `retro-generator.ts`,
  `strategy-parser.ts`, `pacta-strategy.ts`, `types.ts`.
  (Note: `BridgeSubStrategySource` renamed to `FsSubStrategySource`;
  `BridgeHumanApprovalResolver` renamed to `EventBusHumanApprovalResolver`
  per S2 §3.2.)
- **sessions/** ← 12 files from `packages/bridge/src/domains/sessions/`:
  `pool.ts`, `print-session.ts`, `cognitive-provider.ts`,
  `cognitive-modules.ts`, `cognitive-sink.ts` (class renamed to
  `CognitiveEventBusSink`), `channels.ts`, `diagnostics.ts`,
  `scope-hook.ts`, `spawn-queue.ts`, `auto-retro.ts`,
  `bridge-tools.ts` (renamed to `runtime-tools.ts`), `types.ts`.
- **event-bus/** ← 8 files from `packages/bridge/src/shared/event-bus/`:
  `in-memory-event-bus.ts`, `persistence-sink.ts`, `channel-sink.ts`,
  `genesis-sink.ts`, `webhook-connector.ts`, `session-checkpoint-sink.ts`,
  `agent-event-adapter.ts`, `adapters.ts`.
- **cost-governor/** ← 10 files from `packages/bridge/src/domains/cost-governor/`:
  `observations-store.ts`, `cost-oracle-impl.ts`, `rate-governor-impl.ts`,
  `token-bucket.ts`, `backpressure-queue.ts`, `estimator.ts`,
  `percentile.ts`, `signature-builder.ts`, `cost-events.ts`, `config.ts`.
  The `index.ts` is **rewritten** as the new factory.
- **ports/** ← 14 port interfaces from `packages/bridge/src/ports/`:
  `event-bus.ts` (with `BridgeEvent` → `RuntimeEvent` rename),
  `session-pool.ts` (extended with `SessionProviderFactory` per S2 §6),
  `cost-oracle.ts`, `rate-governor.ts` (with `BridgeRateGovernor` →
  `RuntimeRateGovernor` rename), `historical-observations.ts`,
  `checkpoint.ts`, `conversation.ts`, `projection.ts`,
  `projection-store.ts`, `event-reader.ts`, `event-rotator.ts`,
  `file-system.ts` (**interface only**; Node impl stays in bridge),
  `yaml-loader.ts` (**interface only**; js-yaml impl stays in bridge),
  `methodology-source.ts`, `native-session-discovery.ts`
  (**interface only**; Node impl stays in bridge),
  `in-memory-source.ts` (promoted from bridge per S2 §5.3 decision).
- **config/** ← 3 Zod schemas:
  `sessions-config.ts` (from `domains/sessions/config.ts`),
  `strategies-config.ts` (from `domains/strategies/config.ts`),
  `cost-governor-config.ts` (from `domains/cost-governor/config.ts`).

Also in-scope:

- The `BridgeEvent` → `RuntimeEvent` rename (S2 §4) + `RuntimeEventInput` +
  `RuntimeRateGovernor` renames.
- `SessionProviderFactory` port introduction (S2 §6).
- `createCostGovernor` factory (S2 §3.5) — new signature, no Fastify dep,
  optional `appId`.
- Bridge-side shims:
  - New `packages/bridge/src/domains/sessions/factory.ts` — PTY + print +
    cognitive session factory implementing `SessionProviderFactory`.
  - New `packages/bridge/src/domains/cost-governor/routes.ts` — Fastify
    route registration that consumes the runtime primitives. (File name
    already exists today; will be rewritten to import from runtime.)
  - `packages/bridge/src/shared/event-bus/websocket-sink.ts` stays — uses
    `EventSink` interface imported from `@method/runtime/ports`.
- New `packages/runtime/src/architecture.test.ts` with the four gate tests
  from S2 §11.
- Updates to `tsconfig*.json`, root `package.json` workspaces entry, and
  the bridge's `package.json` to add `@method/runtime` dependency.

### 5.2 Explicitly out-of-scope

- **No Cortex adapters.** `CortexLLMProvider`, `CortexAuditMiddleware`,
  `CortexTokenExchangeMiddleware`, any `ctx.*`-aware code — all PRD-059.
- **No `@method/agent-runtime` package.** That's PRD-058; depends on this
  PRD's output but is separate.
- **No methodology source Cortex backend.** PRD-064.
- **No session store / checkpoint Cortex backend.** PRD-061.
- **No `JobBackedExecutor`.** PRD-062.
- **No `CortexEventConnector`.** PRD-063.
- **No MCP Cortex transport.** PRD-066.
- **No changes to bridge HTTP routes.** Every `registerXxxRoutes(app)`
  function stays where it is.
- **No `StdlibSource` relocation.** S2 §5.3 decides it stays in bridge;
  PRD-064 will replace with `CortexMethodologySource` in agent-runtime.
- **No cluster changes.** `@method/cluster` and `domains/cluster/*` stay
  bridge-scoped (S2 §5.4).
- **No genesis / triggers / projects / build / tokens / experiments /
  methodology / registry changes.** All stay in bridge per S2 §5.5.
- **No pacta or methodts changes.** They're downstream deps, not edited.
- **No registry / theory / project-card changes.**
- **No smoke-test rewrites** beyond updating import paths where smoke-test
  reaches into bridge internals (if any — grep will tell).

---

## 6. Architecture Sketch (FCA Partitioning)

### 6.1 Dependency graph after extraction (from S2 §10, authoritative)

```
           ┌─────────────────────────────────────────────┐
L4         │  @method/bridge                             │
           │  Fastify, PTY, cluster, genesis, triggers,  │
           │  projects, build, method-ctl, tokens,       │
           │  experiments, methodology store, registry,  │
           │  WebSocketSink, NodeFileSystemProvider,     │
           │  JsYamlLoader, StdlibSource,                │
           │  PTY+print+cognitive SessionProviderFactory │
           └────────────────────┬────────────────────────┘
                                │ depends on
                                ▼
┌──────────────────────────────────────────────────────────────┐
L3         @method/runtime                 (NEW — this PRD)
           strategy/   sessions/   event-bus/
           cost-governor/   ports/   config/
           + top-level barrel index.ts
└──────────┬────────────────────────────────────┬──────────────┘
           │                                    │
           ▼                                    ▼
  ┌────────────────┐                    ┌────────────────┐
L2│ @method/methodts│                  L3│ @method/pacta   │
  │ (unchanged)    │                    │ (unchanged)     │
  └────────────────┘                    └────────────────┘

           ┌─────────────────────────────────────────────┐
L3         │ @method/agent-runtime  (planned — PRD-058)  │
           │ depends on @method/runtime + @method/pacta  │
           │ + Cortex platform types (structural)        │
           └─────────────────────────────────────────────┘
```

No cycles. `@method/runtime` has **zero** transport deps. S2 §10 §11 gates
enforce this structurally.

### 6.2 Runtime package internal structure (from S2 §2)

```
packages/runtime/
├── package.json                     name: @method/runtime
│                                    deps: @method/methodts, @method/pacta,
│                                          @method/types, zod, js-yaml
│                                          (NOTE: js-yaml is fine — it's a
│                                          transport-free parser. Only the
│                                          YamlLoader *adapter* stays in
│                                          bridge; the *utility* is library-safe.)
│                                    peerDeps: none
│                                    NO fastify, NO @fastify/*, NO ws, NO node-pty
├── tsconfig.json                    extends root config
├── src/
│   ├── index.ts                     barrel — re-exports the hot-path symbols
│   ├── architecture.test.ts         G-RUNTIME-* gates
│   ├── strategy/
│   │   ├── index.ts
│   │   └── (11 files per S2 §2)
│   ├── sessions/
│   │   ├── index.ts
│   │   └── (12 files per S2 §2; cognitive-sink.ts exports CognitiveEventBusSink)
│   ├── event-bus/
│   │   ├── index.ts
│   │   └── (8 files per S2 §2; NO websocket-sink.ts — stays in bridge)
│   ├── cost-governor/
│   │   ├── index.ts                 NEW createCostGovernor factory
│   │   └── (10 files per S2 §2)
│   ├── ports/
│   │   ├── index.ts                 re-exports all ports
│   │   └── (14 port files per S2 §2)
│   └── config/
│       ├── index.ts
│       └── (3 Zod schemas per S2 §2)
```

### 6.3 Port locations (S2 §§3.1, 5.3, 6)

All **interfaces** (types) move to `@method/runtime/ports`. Concrete
**Node/OS-bound implementations** stay in `@method/bridge`:

| Port | Interface location | Impl location |
|------|-------------------|---------------|
| `EventBus`, `EventSink`, `EventConnector` | `@method/runtime/ports` | `InMemoryEventBus` in runtime; `WebSocketSink` in bridge |
| `SessionPool`, `SessionProviderFactory` | `@method/runtime/ports` | `createPool()` in runtime; PTY/print/cognitive factory in bridge |
| `CostOracle`, `RuntimeRateGovernor`, `HistoricalObservations` | `@method/runtime/ports` | Impls in runtime (pure logic, no OS deps beyond `js-yaml` for config parsing and `fs` via injected `FileSystemProvider`) |
| `FileSystemProvider` | `@method/runtime/ports` | `NodeFileSystemProvider` in bridge |
| `YamlLoader` | `@method/runtime/ports` | `JsYamlLoader` in bridge |
| `NativeSessionDiscovery` | `@method/runtime/ports` | Node impl in bridge |
| `MethodologySource` | `@method/runtime/ports` | `StdlibSource` in bridge (S2 §5.3) |
| `CheckpointPort` | `@method/runtime/ports` | FS-backed impl in bridge (S2 §14 Q1) |
| `ConversationPort`, `Projection`, `ProjectionStore`, `EventReader`, `EventRotator` | `@method/runtime/ports` | FS-backed impls in bridge (build orchestrator) |

The **rule:** an interface is in runtime iff at least one of {bridge,
agent-runtime} needs it AND it has no OS/transport dependency. An
implementation is in runtime iff it's pure logic with injected OS ports.
Everything OS/transport-bound stays in bridge (and gets a parallel Cortex
impl in agent-runtime later via PRD-061/062/063/064).

### 6.4 Bridge shrink map (S2 §5)

What bridge **keeps** (unchanged in scope, changed in imports only):

- All `src/**/routes.ts` files (all `registerXxxRoutes(app)` functions).
- `shared/websocket/hub.ts`, `shared/websocket/route.ts`, `shared/frontend-route.ts`.
- `shared/event-bus/websocket-sink.ts` (stays — Fastify WS dep).
- `Fastify` instance construction in `server-entry.ts`.
- `domains/sessions/pty-session*`, `session-persistence.ts`,
  `transcript-reader.ts`, `transcript-route.ts`, `worktree-*`.
- `startup-recovery.ts`, `ports/native-session-discovery.ts` Node impl.
- `ports/file-system.ts` (Node impl), `ports/yaml-loader.ts` (js-yaml impl),
  `ports/stdlib-source.ts`.
- All of `domains/projects/*`, `domains/cluster/*`, `domains/genesis/*`,
  `domains/triggers/*`, `domains/methodology/*`, `domains/registry/*`,
  `domains/experiments/*`, `domains/build/*`, `domains/tokens/*`.
- New files added in bridge: `domains/sessions/factory.ts` (PTY factory),
  `domains/cost-governor/routes.ts` (rewritten to consume runtime primitives).

What bridge **loses**:

- `domains/strategies/` engine logic (routes + config stay; executor + adapters move).
- `domains/sessions/` pool/channels/cognitive/diagnostics (routes + PTY +
  persistence + transcript stay; pool + providers + channels + diagnostics
  + scope-hook + cognitive move to runtime).
- `domains/cost-governor/` logic (routes stay — rewritten; observations +
  oracle + rate-governor + config move to runtime).
- `shared/event-bus/` sinks (websocket-sink stays; everything else moves).
- Most of `ports/` (interfaces move to runtime; concrete Node impls stay).

---

## 7. Surfaces Consumed / Produced

### 7.1 Consumed (frozen — do not modify here)

| ID | Surface | Source | Role |
|----|---------|--------|------|
| **S2** | `RuntimePackageBoundary` | `.method/sessions/fcd-surface-runtime-package-boundary/decision.md` | **THE specification.** All S2 decisions (§§2–6) are binding. S2 §§11, 14 define the gate tests and open-question resolutions. |
| **S1** | `MethodAgentPort` | `.method/sessions/fcd-surface-method-agent-port/decision.md` | Downstream consumer constraint. PRD-058 will import from the subpaths this PRD creates; the export list must match what S1 expects (`createAgent` composition uses `AgentProvider`, `AgentEvent`, `Pact` from pacta — runtime must keep exporting matching shapes). Not touched here; referenced for verification only. |
| **S3** | `CortexServiceAdapters` | `.method/sessions/fcd-surface-cortex-service-adapters/decision.md` | Downstream consumer constraint. PRD-059 will wire a Cortex-backed `SessionProviderFactory` + `AgentProvider` through the factory port this PRD introduces. The `SessionProviderFactory` shape frozen in S2 §6 is the single contract point. |

### 7.2 Produced

**None.** This PRD produces no new cross-domain surfaces. It implements
S2 and does not extend it. If implementation reveals that S2 is wrong, the
correct response is: **stop PRD-057, file a new `/fcd-surface` session to
amend S2, then resume** (per FCD Rule: surfaces are frozen; architecture
serves surfaces).

---

## 8. Implementation Phases — Commission Decomposition

The work decomposes into **7 commissions**, ordered so each PR keeps the
monorepo green. Each commission is scoped to one logical concern and sized
for a single agent + single PR.

### Wave 0 — Surface groundwork (commission 1)

**C1. `runtime-scaffold-and-ports-move`** (S, ~1 day)
> Create `packages/runtime/` scaffold + move port *interfaces* only +
> introduce `SessionProviderFactory` + rename `BridgeEvent → RuntimeEvent`.

- Create `packages/runtime/{package.json, tsconfig.json, src/index.ts,
  src/architecture.test.ts}`.
- Add `@method/runtime` to root `package.json` workspaces.
- Move the 14 port interface files from `packages/bridge/src/ports/` into
  `packages/runtime/src/ports/` per S2 §5.3 (type-only; keep Node impls
  in bridge and have them import interfaces from `@method/runtime/ports`).
- Apply the `BridgeEvent` → `RuntimeEvent`, `BridgeEventInput` →
  `RuntimeEventInput`, `BridgeRateGovernor` → `RuntimeRateGovernor`
  renames. Add type alias `export type BridgeEvent = RuntimeEvent` in
  `packages/bridge/src/ports/event-bus.ts` (now a shim).
- Extend `session-pool.ts` port with `SessionProviderFactory` and
  `SessionProviderOptions` per S2 §6.
- Add `@method/runtime` dep to `packages/bridge/package.json`.
- Bridge's existing port imports (relative paths into `./ports/*.js`)
  continue to work because the Node impl files in bridge are kept — they
  now `import type { ... } from '@method/runtime/ports'` at the top.
- Add gates G-RUNTIME-ZERO-TRANSPORT, G-RUNTIME-NO-BRIDGE-BACKREF,
  G-RUNTIME-EVENT-TYPE-NEUTRAL in `packages/runtime/src/architecture.test.ts`.
  G-BRIDGE-USES-RUNTIME-PORTS stays disabled (xit) until C7.

**Acceptance:** build + all existing tests green; runtime package
has gates passing; no consumer import paths have changed yet.

### Wave 1 — Strategy subpath (commission 2)

**C2. `runtime-strategy-subpath`** (S, ~1 day)
> Move the 11 strategy files + rename `BridgeSubStrategySource` →
> `FsSubStrategySource` and `BridgeHumanApprovalResolver` →
> `EventBusHumanApprovalResolver`; expose `@method/runtime/strategy` subpath
> exports per S2 §3.2.

- Create `packages/runtime/src/strategy/{index.ts, ...11 files...}`.
- Delete moved files from `packages/bridge/src/domains/strategies/` **except**
  `config.ts` (stays in bridge; bridge re-exports runtime's config), `routes.ts`
  (stays), `*.test.ts` (move with their subjects).
- Bridge's `server-entry.ts` changes `import { StrategyExecutor } from
  './domains/strategies/strategy-executor.js'` → `import { StrategyExecutor }
  from '@method/runtime/strategy'`.
- Bridge's `domains/build/` (which consumes `StrategyExecutor`) likewise
  updated.
- Bridge adds a **temporary shim** `packages/bridge/src/domains/strategies/compat.ts`
  that re-exports moved symbols, used only if any in-tree import got missed.
  Delete shim in C7.

**Acceptance:** build + all tests green; bridge consumes strategy from
runtime; S2 §3.2 export list asserted by a new test in
`packages/runtime/src/strategy/index.test.ts`.

### Wave 1 — Event bus subpath (commission 3)

**C3. `runtime-event-bus-subpath`** (S, ~1 day)
> Move the 8 event-bus files (everything EXCEPT `websocket-sink.ts`); expose
> `@method/runtime/event-bus` per S2 §3.4.

- Create `packages/runtime/src/event-bus/{index.ts, ...8 files...}`.
- Delete moved files from `packages/bridge/src/shared/event-bus/`.
- Keep `websocket-sink.ts` in bridge; update its imports to pull `EventSink`
  and sibling types from `@method/runtime/ports` + `@method/runtime/event-bus`
  re-exports.
- Bridge's `server-entry.ts` + domain files updated to import from
  `@method/runtime/event-bus`.
- `SessionCheckpointSink` — audit `PersistedSessionInput` type (S2 §14 Q2)
  and generalize any bridge-session-persistence-specific fields. Any field
  that remains bridge-specific stays typed as `Record<string, unknown>` in
  runtime and is narrowed by the bridge adapter.

**Acceptance:** build + tests green; `websocket-sink.ts` lives on only in
bridge; gate G-RUNTIME-ZERO-TRANSPORT still green.

### Wave 1 — Cost governor subpath (commission 4)

**C4. `runtime-cost-governor-subpath`** (M, ~1.5 days)
> Move the 10 cost-governor files + rewrite `index.ts` as the new
> `createCostGovernor` factory (no Fastify) + introduce the optional
> `appId?` hook. Ship new `packages/bridge/src/domains/cost-governor/routes.ts`
> consuming the runtime primitives.

- Create `packages/runtime/src/cost-governor/{index.ts, ...10 files...}`.
- `index.ts` exports `createCostGovernor` (renamed from
  `createCostGovernorDomain`) per S2 §3.5; result type is `CostGovernor`
  (no `registerRoutes`). Accepts optional `appId?: AppId` per S2 §8.
- When `appId` present:
  - Slots keyed by `${accountId}:${appId}` in `SingleAccountRateGovernor`.
  - All emitted cost events carry `payload.appId`.
  - `utilization(appId?)` filter added.
  - Token bucket `weeklyCap` applied per `(accountId, appId)` tuple.
  - When absent, behavior is bit-identical to today (verified by
    replaying `observations-store.test.ts` and `rate-governor-impl.test.ts`
    against the moved files without edits).
- Rewrite `packages/bridge/src/domains/cost-governor/routes.ts` to import
  the primitives (`oracle`, `rateGovernor`, `observations`) from the
  runtime factory result and register Fastify routes (unchanged HTTP API).
- Add new unit test `packages/runtime/src/cost-governor/cost-governor-app-id.test.ts`
  asserting slot keying and event payload differences between no-appId and
  with-appId modes.
- Bridge's `server-entry.ts` updated: `createCostGovernorDomain(...)` call →
  `createCostGovernor({ eventBus, fileSystem, config })` (no `appId` in
  bridge); subsequent `.registerRoutes(app)` call replaced with a direct
  `registerCostGovernorRoutes(app, governor)` import from the new
  bridge-side routes file.

**Acceptance:** build + tests green; cost-governor HTTP API unchanged;
new per-AppId test passes; `G-RUNTIME-ZERO-TRANSPORT` green.

### Wave 1 — Sessions subpath + SessionProviderFactory wiring (commission 5)

**C5. `runtime-sessions-subpath`** (M, ~2 days, highest risk — see §12)
> Move the 12 session files + wire the `SessionProviderFactory` port through
> `createPool()` + relocate bridge's PTY spawn behavior into a new bridge
> factory file.

- Create `packages/runtime/src/sessions/{index.ts, ...12 files...}`.
  - Rename `cognitive-sink.ts` exported class `CognitiveSink` →
    `CognitiveEventBusSink` (S2 §14 Q6 resolution).
  - Rename `bridge-tools.ts` file → `runtime-tools.ts`.
- Refactor `pool.ts` `createPool()`: accept `providerFactory:
  SessionProviderFactory` in its options bag; all internal spawn call
  sites delegate to the factory. Pool continues to own lifecycle,
  queueing, diagnostics, channels, chain bookkeeping.
- Create new `packages/bridge/src/domains/sessions/factory.ts`:
  - Exports `createBridgeSessionProviderFactory({ claudeCliProvider,
    pacta, workdir, ... })` that returns a `SessionProviderFactory`.
  - `createSession({ mode, ...opts })` dispatches to
    `createPrintSession()` from runtime for `mode === 'print'` and
    `createCognitiveSession()` for `mode === 'cognitive-agent'`.
- Bridge's `server-entry.ts` line 9 `createPool(...)` call extended with
  `providerFactory: createBridgeSessionProviderFactory(...)`.
- `bridge-tools.ts` → `runtime-tools.ts` rename: update bridge's
  `domains/sessions/routes.ts` + any other consumer.
- Bridge keeps `pty-session*` files untouched (the factory uses them);
  `session-persistence.ts` and `transcript-*` files untouched.
- Bridge emits `CognitiveSink` (old name) alias from a bridge shim file
  so any remaining in-tree import resolves until C7 cleanup.

**Acceptance:** build + tests green; `pool.test.ts` passes unchanged
(it injects a test factory); bridge boots with PTY sessions working
end-to-end; smoke-test live mode optional but recommended.

### Wave 1 — Config subpath (commission 6)

**C6. `runtime-config-subpath`** (S, ~0.5 day)
> Move the 3 Zod config schemas + expose `@method/runtime/config` per S2 §3.6.

- Move `packages/bridge/src/domains/sessions/config.ts` →
  `packages/runtime/src/config/sessions-config.ts`.
- Move `packages/bridge/src/domains/strategies/config.ts` →
  `packages/runtime/src/config/strategies-config.ts`.
- Move `packages/bridge/src/domains/cost-governor/config.ts` →
  `packages/runtime/src/config/cost-governor-config.ts`.
- Bridge's `server-entry.ts` + domain files update imports.
- `.env` loading (which is bridge-level) remains in bridge; runtime config
  is env-only at the schema level (no `.env` file read inside runtime).

**Acceptance:** build + tests green; config schemas import-clean from
both bridge and (eventually) agent-runtime.

### Wave 2 — Final cleanup + gate activation (commission 7)

**C7. `runtime-cleanup-and-gate-activation`** (S, ~0.5 day)
> Delete migration shims, activate `G-BRIDGE-USES-RUNTIME-PORTS`, write
> event-type snapshot test, finalize the barrel.

- Delete `packages/bridge/src/domains/strategies/compat.ts` (from C2) and
  any `CognitiveSink` alias shim (from C5).
- Activate `G-BRIDGE-USES-RUNTIME-PORTS` gate in
  `packages/bridge/src/architecture.test.ts` (S2 §11) — was `xit`, now `it`.
- Add event-type snapshot: `packages/runtime/src/event-bus/event-types.snapshot.test.ts`
  that reads a committed JSON list of known event `type` strings and
  asserts the union emitted by all runtime sinks matches. **Blocks SC-6.**
- Finalize `packages/runtime/src/index.ts` barrel: re-export the hot-path
  symbols per S2 §2 "Top-level barrel" note.
- Delete the `BridgeEvent` type alias iff possible (deferred — recommend
  keeping until PRD-058 ships so bridge-internal code doesn't churn twice;
  the alias has zero runtime cost).
- Run full smoke-test suite (`npm --workspace=@method/smoke-test run smoke`)
  to confirm SC-9/SC-10.

**Acceptance:** all 12 success criteria green; PR merges as the closing
PR of PRD-057.

### 8.1 Commission DAG

```
C1 (scaffold + ports + rename)
  └─► C2 (strategy)         ─┐
  └─► C3 (event-bus)         ├─► C7 (cleanup + gate activation)
  └─► C4 (cost-governor)    ─┤
  └─► C5 (sessions)         ─┤
  └─► C6 (config)           ─┘
```

C1 must merge first. C2–C6 are **parallelizable** if agents are careful
with `server-entry.ts` merge conflicts — recommend serializing C2→C3→C4→C5→C6
in practice (each touches server-entry) to avoid conflicts. C7 last.

Estimated total: **~7 working days** for a single agent; ~4 days with
parallel C3/C4/C6 while C2/C5 run serially.

---

## 9. Test Strategy (FCA P4: Independent Verifiability)

### 9.1 Runtime tests must run without bridge

`packages/runtime/` must have its own test runner entry such that
`npm --workspace=@method/runtime test` passes **without** `packages/bridge/`
built. This is FCA P4 ("Verify independently"). Concretely:

- All moved tests keep running with no edits where possible. Tests that
  imported bridge-specific things (e.g., `@method/bridge/...` or relative
  paths to bridge Node impls) must be rewritten to use in-package
  fixtures or injected fakes.
- `pool.test.ts` injects a test `SessionProviderFactory` that returns
  mock `PtySession` objects (no real PTY). Already how
  `packages/bridge/src/domains/sessions/pool.test.ts` is structured today —
  confirm during C5.
- `strategy-executor.test.ts` injects fake `SubStrategySource`,
  `HumanApprovalResolver`, `ContextLoadExecutor`. Already true today.
- `cost-governor` tests use the same in-memory `FileSystemProvider`
  fake they use now.

### 9.2 Gate tests (S2 §11, authoritative)

| Gate | Runs in | What it enforces |
|------|---------|------------------|
| G-RUNTIME-ZERO-TRANSPORT | `packages/runtime/src/architecture.test.ts` | No `fastify`, `@fastify/`, `ws`, `node-pty`, `express` under `packages/runtime/src`. |
| G-RUNTIME-NO-BRIDGE-BACKREF | `packages/runtime/src/architecture.test.ts` | No import of `@method/bridge` or `../../bridge/` from runtime. |
| G-BRIDGE-USES-RUNTIME-PORTS | `packages/bridge/src/architecture.test.ts` (existing file) | Bridge cross-domain imports of `strategy-executor`, `in-memory-event-bus`, `observations-store`, `cost-oracle-impl`, `rate-governor-impl` go through `@method/runtime/*`, not relative paths. |
| G-RUNTIME-EVENT-TYPE-NEUTRAL | `packages/runtime/src/architecture.test.ts` | `EventDomain` union keeps the `(string & {})` escape hatch. |
| G-EVENT-TYPE-SNAPSHOT (new, supports SC-6) | `packages/runtime/src/event-bus/event-types.snapshot.test.ts` | Set of emitted event `type` strings matches a committed manifest. Any addition is a deliberate update. |
| G-COSTGOV-APP-ID (new, supports SC-8) | `packages/runtime/src/cost-governor/cost-governor-app-id.test.ts` | With-appId vs no-appId modes produce the structural differences documented in S2 §8. |

### 9.3 Integration tests

- Bridge boots under `npm run bridge:test` (port 3457, isolated state)
  successfully after each commission.
- `@method/smoke-test`'s registry-gate suite passes (`npm --workspace=@method/smoke-test test`).
- Playwright mock smoke (`npm --workspace=@method/smoke-test run smoke`) passes
  after C7.
- Live smoke optional but recommended for C5 (session spawning).

### 9.4 No-regression bar

**No existing test is modified beyond import-path changes.** If a test's
body must change to pass, flag it — that's a behavioral regression
signal, which in an "extract without changing behavior" PRD means
something is wrong. (Exception: the `CognitiveSink` rename requires
import-path changes *and* identifier-rename changes; those are expected.)

---

## 10. Migration Plan for In-Tree Imports (S2 §7)

Every bridge-internal import of a moved symbol follows the pattern S2 §7
documents. Execution is phased across commissions:

### 10.1 Per-commission migration sweep

Each commission (C2–C6) performs, for its subpath:

1. **Find call sites.** Grep:
   - `from ['"]\.\.\/\.\.\/domains\/strategies\/strategy-executor`
   - `from ['"]\.\.\/\.\.\/shared\/event-bus\/in-memory-event-bus`
   - `from ['"]\.\.\/\.\.\/domains\/cost-governor\/(observations-store|cost-oracle-impl|rate-governor-impl)`
   - `from ['"]\.\.\/\.\.\/domains\/sessions\/(pool|print-session|cognitive-provider|cognitive-modules|cognitive-sink|channels|diagnostics|scope-hook|spawn-queue|auto-retro|bridge-tools)`
2. **Rewrite.** Replace with `@method/runtime/{strategy,event-bus,cost-governor,sessions}`.
3. **Preserve type-only imports.** Where bridge code uses `import type {...}`,
   keep it `import type` (runtime type imports cost nothing at runtime).
4. **Atomic PR.** The commission's PR includes both the move and the
   rewrite, so there's never a broken state in `master`.

### 10.2 Compat shim policy (S2 §7 "Strategy")

- C2 may introduce `packages/bridge/src/domains/strategies/compat.ts`
  re-exporting runtime symbols, used only if the sweep missed an import.
  **Delete in C7.**
- C5 may introduce a `CognitiveSink` alias shim for the same reason. **Delete in C7.**
- No other commissions need shims because the grep sweep is exhaustive.

### 10.3 Gate activation timing

`G-BRIDGE-USES-RUNTIME-PORTS` is **disabled (xit)** during C2–C6 so that
in-flight commissions can land incrementally. It is **activated (it)** in
C7, at which point the gate enforces that no forbidden relative-path
import has crept back in.

### 10.4 Rename rollout (S2 §4)

Per S2 §4, `BridgeEvent` → `RuntimeEvent` applies everywhere **except**
the one compatibility alias in `packages/bridge/src/ports/event-bus.ts`.
The rename is done in C1 (new file in runtime) and the bridge's event-bus
port file becomes a thin shim: `export type { RuntimeEvent as BridgeEvent,
RuntimeEventInput as BridgeEventInput } from '@method/runtime/ports';`.
Decision on deleting the alias is deferred to post-PRD-058 to avoid
churning downstream code twice.

### 10.5 Runtime type exports for downstream PRDs (S1, S3)

PRD-058 and PRD-059 will import from `@method/runtime` via the exact
subpaths S2 §§3.1–3.6 freeze. No action needed in this PRD beyond
conforming to the list. A smoke import-test in
`packages/runtime/src/architecture.test.ts` verifies every symbol S2
lists is actually exported (prevents silent deletion).

---

## 11. S2 Open-Question Resolutions (decision.md §14)

S2 flagged 6 open questions as "scoped to PRD-057 implementation." Each is
resolved here:

| # | S2 Question | Resolution in this PRD |
|---|-------------|------------------------|
| Q1 | `CheckpointPort` placement — move the interface, FS impl stays? | **Confirm:** Interface in `@method/runtime/ports/checkpoint.ts`. FS-backed impl stays in `packages/bridge/src/domains/build/`. Cortex-backed impl will arrive in PRD-061. (C1 scope.) |
| Q2 | `SessionCheckpointSink` + `PersistedSessionInput` bridge-shape leak | **Fix in C3:** Audit `PersistedSessionInput` during the event-bus move. Any bridge-specific field is generalized to `Record<string, unknown>` with the type narrowed by the bridge adapter at sink construction. Document the audit outcome in the C3 PR description. |
| Q3 | `StdlibSource` placement | **Confirm:** Stays in bridge per S2 §5.3. PRD-064 replaces with `CortexMethodologySource` in agent-runtime. No action this PRD. |
| Q4 | `@method/cluster` status | **Confirm:** No runtime dep on `@method/cluster`. Cluster stays bridge-only. (Already true today; simply don't add it.) |
| Q5 | `registerRoutes` removal breaking change | **Execute in C4:** New `createCostGovernor` returns no `registerRoutes`. Bridge gets a new `domains/cost-governor/routes.ts` wrapper. Documented in migration section. |
| Q6 | `CognitiveSink` export name collision | **Rename to `CognitiveEventBusSink`** (leaning from S2 §14 accepted). Bridge aliases old name during migration; alias removed in C7. Executed in C5. |

No remaining open questions from S2. Any new question that arises during
implementation escalates to a `/fcd-surface` amendment session — **does
not silently change the frozen surface**.

---

## 12. Risks + Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | **Session pool refactor breaks bridge** (C5 is the highest-risk commission — pool touches PTY, cognitive, channels, diagnostics, scope hook at once). | Medium | High | Test-driven: run `pool.test.ts` after every incremental edit. Run `npm run bridge:test` + a manual PTY spawn before merge. Keep the old `pool.ts` in a branch commit so revert is a cherry-pick. |
| R2 | **Event-type string drift** during the rename. | Low | Medium | C7 ships `event-types.snapshot.test.ts` committing the full union. Any unnoticed string edit fails CI. |
| R3 | **Cost-governor per-AppId hook regresses the no-appId path** (bridge's normal case). | Low | High | `observations-store.test.ts`, `rate-governor-impl.test.ts`, `token-bucket.test.ts` all run unchanged in C4. New app-id tests are **additive**, not replacements. |
| R4 | **`SessionCheckpointSink` bridge-shape leak** (S2 §14 Q2 — `PersistedSessionInput` has bridge-session-persistence fields). | Medium | Medium | C3 explicitly audits the type. If bridge-specific fields can't be generalized without breaking the sink, the `PersistedSessionInput` type is narrowed in runtime to `Record<string, unknown>` + the bridge wrapper supplies a typed adapter. Document in C3 PR. |
| R5 | **`server-entry.ts` merge conflicts** when C2–C6 run in parallel. | High | Low | Serialize C2→C3→C4→C5→C6 in practice. The total added wall-time (~5 days serial vs ~3 parallel) is worth the conflict avoidance. |
| R6 | **Smoke-test suite reaches into bridge internals** that moved. | Medium | Medium | Grep smoke-test at the start of C1 for any import of bridge engine internals. If any exist, add to C2–C6 scope per subpath. If smoke-test imports stay bridge-shaped (via bridge's public surface), no action needed. |
| R7 | **Cognitive sink rename breaks experiments/** (domains/experiments consumes `CognitiveSink`). | Low | Low | Bridge alias shim in C5 covers the gap until C7 cleanup. Experiments domain updates its import in the same PR as C5. |
| R8 | **Runtime js-yaml dep is a hidden transport?** | Very Low | Low | js-yaml is a pure parser, no network/OS beyond file reading the caller supplies. Classified as transport-free. |
| R9 | **Bridge `FileSystemProvider` injection has to cross package boundary** now that the port is in runtime. | Low | Low | Runtime's port is an interface only. Bridge's `NodeFileSystemProvider` implements the interface and is injected at bridge's composition root into runtime factories (same pattern as today, just across a package). |
| R10 | **Downstream PRD-058 discovers a needed runtime export that wasn't extracted.** | Medium | Low | If such a need arises, PRD-058 files an addendum to S2 via `/fcd-surface` amendment, and this PRD (or a follow-up PRD-057.1) moves the additional symbol. This PRD ships the S2-locked set; speculative extras are out of scope. |
| R11 | **Developer confusion between `@method/methodts`'s `StrategyRuntime` class and `@method/runtime` package.** | Medium | Low | S2 §1 already documented this. Keep the class name `StrategyExecutor` (not `Runtime`); README in `packages/runtime/` disambiguates. Add a one-line note in root CLAUDE.md's Layer Stack section (already lists `@method/runtime` as L3). |

---

## 13. Acceptance Gates

### 13.1 Gate check per S2 §11 (must all pass)

- [ ] **G-RUNTIME-ZERO-TRANSPORT** — S2 §11. Test added in C1; must be green at every commission merge.
- [ ] **G-RUNTIME-NO-BRIDGE-BACKREF** — S2 §11. Added C1; green at every merge.
- [ ] **G-BRIDGE-USES-RUNTIME-PORTS** — S2 §11. Disabled C1–C6; **activated in C7**; green from C7 onward.
- [ ] **G-RUNTIME-EVENT-TYPE-NEUTRAL** — S2 §11. Added C1; green at every merge.

### 13.2 New gates introduced by this PRD

- [ ] **G-EVENT-TYPE-SNAPSHOT** — supports SC-6. Added C7; green from C7.
- [ ] **G-COSTGOV-APP-ID** — supports SC-8. Added C4; green from C4.

### 13.3 Success-criteria gates (SC-1 through SC-12)

All 12 success criteria from §4 are binary checks. The closing PR (C7)
must verify each. Sample-check automation in `.method/sessions/fcd-design-prd-057-method-runtime/`
(optional helper script) can be added during C7 if helpful.

### 13.4 Downstream unblock confirmation

This PRD's closing PR should note:

- PRD-058 (`@method/agent-runtime`) is unblocked: can `npm install
  @method/runtime` and consume `{ StrategyExecutor, InMemoryEventBus,
  createPool, createCognitiveSession, createCostGovernor }` per the S1 /
  S3 expectations.
- PRD-059 (Cortex provider + middleware) is unblocked: can inject a
  Cortex-backed `SessionProviderFactory` through the runtime's pool and
  an `appId` into `createCostGovernor`.
- PRDs 061 / 062 / 063 / 064 are unblocked for their respective adapter
  work against the now-exposed runtime ports.

### 13.5 Definition of Done

- All 12 success criteria in §4 green.
- All 6 gates in §13.1 + §13.2 green.
- `npm run build` + `npm test` at repo root green on a fresh clone.
- `npm run bridge:test` + smoke tests green.
- S2 open questions (§11) all marked resolved in C7 PR description.
- Roadmap §5 item **A1** checked off.
- Migration retro written to `.method/retros/retro-2026-MM-DD-NNN.yaml`
  per project card PR-03.

---

## 14. References

- S2 freeze: `.method/sessions/fcd-surface-runtime-package-boundary/decision.md`
  (binding — primary specification input)
- S1: `.method/sessions/fcd-surface-method-agent-port/decision.md`
- S3: `.method/sessions/fcd-surface-cortex-service-adapters/decision.md`
- Roadmap: `docs/roadmap-cortex-consumption.md` §§3, 4.1, 5-A1, 6, 10 (S2 row), "Updated PRD scope notes"
- FCA: `docs/fractal-component-architecture/` (layer stack discipline)
- Project card: `.method/project-card.yaml` (DR-01, DR-02, DR-12, PR-03)
- Bridge today: `packages/bridge/src/{server-entry.ts, index.ts,
  domains/{strategies,sessions,cost-governor}/, shared/event-bus/, ports/}`
- Existing cost-governor factory shape (to be rewritten):
  `packages/bridge/src/domains/cost-governor/index.ts`
- Existing pool + provider dispatch (to be refactored to factory):
  `packages/bridge/src/domains/sessions/pool.ts`

---

## 15. Status

**Draft.** Ready for review. On approval, enter `/fcd-plan` for wave
decomposition (already largely done in §8) and hand off commissions
C1–C7 to `/fcd-commission` agents in the order C1 → C2/C3/C4/C5/C6
(serialized in practice to avoid `server-entry.ts` conflicts) → C7.

No surface changes expected during implementation. If implementation
reveals S2 needs amendment, halt this PRD and open a `/fcd-surface`
amendment session — per FCD Rule 5, architecture serves surfaces.
