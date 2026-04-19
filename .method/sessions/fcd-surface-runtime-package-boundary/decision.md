---
type: co-design-record
surface: "RuntimePackageBoundary"
slug: fcd-surface-runtime-package-boundary
date: "2026-04-14"
owner: "@methodts/runtime (new L3 package, extracted from @methodts/bridge)"
producer: "@methodts/runtime"
consumer: "@methodts/bridge (L4 process) + @methodts/agent-runtime (L3 Cortex-facing library, planned PRD-058)"
direction: "runtime → bridge, runtime → agent-runtime (unidirectional — runtime exports, consumers import)"
status: frozen
mode: new
related:
  - docs/roadmap-cortex-consumption.md §4.1 item 7
  - PRD-057 (implementation container)
  - PRD-058 (@methodts/agent-runtime)
  - .method/sessions/fcd-surface-method-agent-port/
  - .method/sessions/fcd-design-runtime-consolidation/
---

# Co-Design Record — RuntimePackageBoundary

## 1. Context & Framing

Today `@methodts/bridge` is a Fastify **process** (L4). Its `src/index.ts` exports
`{}` — the bridge is not a library. However, inside the bridge live several
**engine-grade, transport-free abstractions** that must be reusable by both:

1. The existing process (`@methodts/bridge`).
2. The forthcoming Cortex-facing library (`@methodts/agent-runtime`, PRD-058).

This FCD extracts those engine pieces into a new **L3 package `@methodts/runtime`**
(transport-free, library-shaped) and freezes the public API that both downstream
consumers will import.

### Layer placement

```
L4   @methodts/bridge          — Fastify HTTP server, PTY, CLI, discovery, cluster adapters
     @methodts/agent-runtime   — (new, PRD-058) Cortex-targeted embeddable agent (also L3 actually; see §9)
L3   @methodts/runtime         — (NEW) strategy executor, session pool, event bus, cost governor,
                                checkpoint port, cognitive provider/sink, config schemas
     @methodts/pacta           — modular agent SDK (already L3)
     @methodts/mcp             — protocol adapter (already L3)
L2   @methodts/methodts        — domain extensions (DAG executor, stdlib catalog)
     @methodts/testkit         — testing framework
```

`@methodts/runtime` sits *above* `@methodts/methodts` and `@methodts/pacta`, *below*
any transport or process concern. **Zero** dependencies on `fastify`,
`@fastify/websocket`, `node-pty`, Tailscale, or any HTTP client.

### Name check

`@methodts/runtime` reads clean and is unambiguous inside the workspace. The
only collision risk is conceptual: `@methodts/methodts` already exports a
"StrategyRuntime" class. Mitigation: namespace the new package's top-level
export under `runtime/*` subpaths, and keep the class name
`StrategyExecutor` (matching current code) rather than renaming to
`Runtime`. **No rename needed.** Alternative name considered: `@methodts/engine`
(rejected — "engine" is already overloaded in the cognitive composition
module; would create semantic conflict with `packages/pacta/src/cognitive/engine/`).

---

## 2. Package Public API — Tree of Exports

Package root: `packages/runtime/`.
Manifest: `@methodts/runtime` with `exports` map using subpath pattern (matches
`@methodts/methodts` conventions — one conceptual surface per subpath).

```
@methodts/runtime/
├── package.json                     (no fastify, no node-pty, no ws deps)
├── src/
│   ├── index.ts                     — barrel: re-exports all subpaths below
│   │
│   ├── strategy/                    [subpath: @methodts/runtime/strategy]
│   │   ├── index.ts                 — StrategyExecutor, config, types
│   │   ├── strategy-executor.ts     ← moved from bridge/domains/strategies/
│   │   ├── context-load-executor.ts ← moved
│   │   ├── gates.ts                 ← moved
│   │   ├── artifact-store.ts        ← moved
│   │   ├── sub-strategy-source.ts   ← moved (BridgeSubStrategySource → FsSubStrategySource)
│   │   ├── human-approval-resolver.ts ← moved (renamed EventBusHumanApprovalResolver)
│   │   ├── retro-writer.ts          ← moved
│   │   ├── retro-generator.ts       ← moved
│   │   ├── strategy-parser.ts       ← moved
│   │   ├── pacta-strategy.ts        ← moved
│   │   └── types.ts                 ← moved
│   │
│   ├── sessions/                    [subpath: @methodts/runtime/sessions]
│   │   ├── index.ts                 — SessionPool port + factory + cognitive provider
│   │   ├── pool.ts                  ← moved from bridge/domains/sessions/pool.ts
│   │   │                               (PTY code paths STAY in bridge — see §5.2)
│   │   ├── print-session.ts         ← moved (pacta-backed, no PTY)
│   │   ├── cognitive-provider.ts    ← moved
│   │   ├── cognitive-modules.ts     ← moved
│   │   ├── cognitive-sink.ts        ← moved
│   │   ├── channels.ts              ← moved
│   │   ├── diagnostics.ts           ← moved
│   │   ├── scope-hook.ts            ← moved
│   │   ├── spawn-queue.ts           ← moved
│   │   ├── auto-retro.ts            ← moved
│   │   ├── bridge-tools.ts          ← moved, renamed runtime-tools.ts
│   │   └── types.ts                 ← moved
│   │
│   ├── event-bus/                   [subpath: @methodts/runtime/event-bus]
│   │   ├── index.ts                 — EventBus port + sinks
│   │   ├── in-memory-event-bus.ts   ← moved from bridge/shared/event-bus/
│   │   ├── persistence-sink.ts      ← moved
│   │   ├── channel-sink.ts          ← moved
│   │   ├── genesis-sink.ts          ← moved
│   │   ├── webhook-connector.ts     ← moved
│   │   ├── session-checkpoint-sink.ts ← moved
│   │   ├── agent-event-adapter.ts   ← moved
│   │   └── adapters.ts              ← moved
│   │
│   ├── cost-governor/               [subpath: @methodts/runtime/cost-governor]
│   │   ├── index.ts                 — CostGovernor domain factory + ports
│   │   ├── observations-store.ts    ← moved
│   │   ├── cost-oracle-impl.ts      ← moved
│   │   ├── rate-governor-impl.ts    ← moved
│   │   ├── token-bucket.ts          ← moved
│   │   ├── backpressure-queue.ts    ← moved
│   │   ├── estimator.ts             ← moved
│   │   ├── percentile.ts            ← moved
│   │   ├── signature-builder.ts     ← moved
│   │   ├── cost-events.ts           ← moved
│   │   └── config.ts                ← moved (Zod schema)
│   │
│   ├── ports/                       [subpath: @methodts/runtime/ports]
│   │   ├── index.ts                 — ALL port interfaces (public types)
│   │   ├── event-bus.ts             ← moved (BridgeEvent → RuntimeEvent, see §4)
│   │   ├── session-pool.ts          ← moved
│   │   ├── cost-oracle.ts           ← moved
│   │   ├── rate-governor.ts         ← moved
│   │   ├── historical-observations.ts ← moved
│   │   ├── checkpoint.ts            ← moved
│   │   ├── conversation.ts          ← moved
│   │   ├── projection.ts            ← moved
│   │   ├── projection-store.ts      ← moved
│   │   ├── event-reader.ts          ← moved
│   │   ├── event-rotator.ts         ← moved
│   │   ├── file-system.ts           ← INTERFACE ONLY moved; Node impl stays in bridge
│   │   ├── yaml-loader.ts           ← INTERFACE ONLY moved; js-yaml impl stays in bridge
│   │   ├── methodology-source.ts    ← moved (port)
│   │   └── native-session-discovery.ts ← INTERFACE ONLY (Node impl stays in bridge)
│   │
│   └── config/                      [subpath: @methodts/runtime/config]
│       ├── index.ts                 — unified config Zod schemas
│       ├── sessions-config.ts       ← moved (CognitiveSessionConfig, SessionsConfig)
│       ├── strategies-config.ts     ← moved (StrategyExecutorConfig)
│       └── cost-governor-config.ts  ← moved
```

### Top-level barrel `index.ts`

Re-exports the most commonly used symbols from each subpath so consumers can
`import { StrategyExecutor, InMemoryEventBus, createCostGovernor } from '@methodts/runtime'`
for the fast path, while still being able to deep-import from subpaths for
advanced use.

---

## 3. Frozen Public Exports (named, by subpath)

### 3.1 `@methodts/runtime/ports`

**Stability tier: STABLE** — changes require a new FCD session.

```typescript
// Event bus port + unified event schema
export type {
  EventBus,
  EventSink,
  EventConnector,
  EventFilter,
  EventSubscription,
  ConnectorHealth,
  RuntimeEvent,           // RENAMED from BridgeEvent — neutral identity (§4)
  RuntimeEventInput,      // RENAMED from BridgeEventInput
  EventDomain,
  EventSeverity,
  StrategyGateAwaitingApprovalPayload,
  StrategyGateApprovalResponsePayload,
};

// Session pool port
export type {
  SessionPool,
  SessionStatusInfo,
  SessionBudget,
  SessionChainInfo,
  WorktreeInfo,
  SessionMode,
  IsolationMode,
  WorktreeAction,
  SessionSnapshot,
  StreamEvent,
};

// Cost governor ports
export type {
  CostOracle,
  NodeEstimate,
  StrategyEstimate,
  RuntimeRateGovernor,    // RENAMED from BridgeRateGovernor
  HistoricalObservations,
  Observation,
  AppendToken,
};
export { createAppendToken };

// Checkpoint port (build orchestrator)
export type {
  CheckpointPort,
  PipelineCheckpoint,
  PipelineCheckpointSummary,
  Phase,
  FeatureSpec,
  TestableAssertion,
  ConversationMessage,
};

// Conversation port
export type {
  ConversationPort,
  AgentMessage,
  HumanMessage,
  GateDecision,
  GateType,
  SkillRequest,
  StructuredCard,
};
export { GATE_ACTIONS };

// Projection persistence ports
export type { Projection, ProjectionStore, StartResult, EventReader, EventRotator, RotateOptions, RotateResult };

// Methodology source port (interface only; StdlibSource stays in runtime)
export type { MethodologySource };

// Infrastructure ports — INTERFACES ONLY; Node impls stay in bridge
export type { FileSystemProvider, DirEntry, FileStat };
export type { YamlLoader };
export type { NativeSessionDiscovery, NativeSessionInfo };
```

### 3.2 `@methodts/runtime/strategy`

**Stability tier: STABLE** (centerpiece — both consumers depend on this).

```typescript
export { StrategyExecutor } from './strategy-executor.js';
export type {
  NodeStatus,
  NodeResult,
  OversightEvent,
  ExecutionStateSnapshot,
  ExecutionState,              // alias of ExecutionStateSnapshot
  StrategyExecutionResult,
  StrategyExecutorConfig,
  SubStrategySource,
  HumanApprovalResolver,
  ContextLoadExecutor,
  SemanticNodeExecutor,
} from './types.js';

// Reusable adapter implementations (opt-in — consumers can roll their own)
export { FsSubStrategySource } from './sub-strategy-source.js';
export { EventBusHumanApprovalResolver } from './human-approval-resolver.js';

// Retro machinery
export { writeRetro, generateRetro } from './retro-writer.js';

// Strategy DAG parser (pass-through; actual parser lives in methodts)
export { parseStrategyYaml } from './strategy-parser.js';
export type { StrategyDAG, StrategyNode, MethodologyNodeConfig };
```

`StrategyExecutor` stays a **thin wrapper** over `@methodts/methodts`
`DagStrategyExecutor` — it is NOT a god-object. Its constructor takes injected
ports (AgentProvider, SubStrategySource, HumanApprovalResolver,
ContextLoadExecutor), exposing **composition points, not implementation**.

### 3.3 `@methodts/runtime/sessions`

**Stability tier: STABLE for pool/provider interface; EXPERIMENTAL for cognitive module internals.**

```typescript
// Pool factory
export { createPool } from './pool.js';
export type {
  CreatePoolOptions,
  SessionPool,              // re-exported from ports for convenience
  PoolStats,
  SessionSnapshot,
} from './pool.js';

// Print session (pacta-backed, no PTY — safe for both bridge and agent-runtime)
export { createPrintSession } from './print-session.js';
export type { PtySession, PrintMetadata, SessionStatus, StreamChunkCallback, PactaSessionParams };

// Cognitive agent — PUBLIC (the #1 Cortex enabler)
export { createCognitiveSession } from './cognitive-provider.js';
export type { CognitiveSessionConfig, CognitiveSessionOptions };

// Cognitive modules (registrable factories — opt-in composition)
export {
  createBridgeReasonerActorModule as createReasonerActorModule,
  createBridgeMonitorModule as createMonitorModule,
} from './cognitive-modules.js';
export type { BridgeReasonerActorMonitoring, BridgeMonitorControl };

// Cognitive sink — adapter from pacta CognitiveEvent → runtime EventBus
export { CognitiveSink } from './cognitive-sink.js';
export type { CognitiveEventContext };

// Channels + diagnostics (support infrastructure for multi-agent flows)
export { createSessionChannels } from './channels.js';
export type { SessionChannels };
export { DiagnosticsTracker } from './diagnostics.js';
export type { SessionDiagnostics };

// Scope enforcement
export { installScopeHook } from './scope-hook.js';
```

**Provider abstraction:** `createPool` accepts an injected `providerFactory`
(type `SessionProviderFactory`) so bridge can pass its PTY-spawning factory
(lives in bridge) and agent-runtime can pass its Cortex-`ctx.llm`-backed factory.
See §6 for the exact shape.

### 3.4 `@methodts/runtime/event-bus`

**Stability tier: STABLE.**

```typescript
export { InMemoryEventBus } from './in-memory-event-bus.js';
export type { InMemoryEventBusOptions, BusStats };

export { PersistenceSink } from './persistence-sink.js';
export type { PersistenceSinkOptions };

export { ChannelSink, getChannelTarget } from './channel-sink.js';
export type { ChannelSinkOptions };

export { GenesisSink } from './genesis-sink.js';
export type { GenesisSinkOptions, GenesisPromptCallback };

export { WebhookConnector } from './webhook-connector.js';
export type { WebhookConnectorOptions };

export { SessionCheckpointSink } from './session-checkpoint-sink.js';
export type { SessionCheckpointSinkOptions, PersistedSessionInput };

export { createAgentEventAdapter } from './agent-event-adapter.js';
export { toChannelMessage, toAllEventsWrapper } from './adapters.js';
```

**Explicitly NOT exported:** `WebSocketSink`. It depends on `@fastify/websocket`
and lives in the bridge. Bridge imports the `EventSink` interface from
`@methodts/runtime/ports` and implements it locally (see §5.1).

### 3.5 `@methodts/runtime/cost-governor`

**Stability tier: STABLE for factory + ports; EXPERIMENTAL for internal stores.**

Per-AppId scoping (§8) is baked in from day one.

```typescript
export { createCostGovernor } from './index.js';     // RENAMED from createCostGovernorDomain
export type { CreateCostGovernorOptions, CostGovernor };

// Ports (re-exported for convenience)
export type { CostOracle, RuntimeRateGovernor, HistoricalObservations };

// Concrete implementations (consumers can also roll their own)
export { HistogramCostOracle } from './cost-oracle-impl.js';
export { SingleAccountRateGovernor } from './rate-governor-impl.js';
export { ObservationsStore } from './observations-store.js';
export { TokenBucket } from './token-bucket.js';
export { BackpressureQueue } from './backpressure-queue.js';

// Estimation + signatures
export { estimateStrategy, heuristicEstimate } from './estimator.js';
export { buildSignature, signatureKey, inputSizeBucket } from './signature-builder.js';

// Event emitters (domain producers)
export {
  emitObservationRecorded,
  emitRateLimited,
  emitEstimateEmitted,
  emitSlotLeaked,
  emitAccountSaturated,
  emitIntegrityViolation,
  emitObservationsCorrupted,
} from './cost-events.js';
export type { CostEventType };

// Config
export { CostGovernorConfigSchema, loadCostGovernorConfig };
export type { CostGovernorConfig };
```

`createCostGovernor` accepts an optional `appId: AppId` option — when present,
all emitted events carry the `appId` in payload and rate-governor slots are
scoped by `{accountId, appId}` rather than just `accountId`. This is the
**upstream hook for Cortex PRD-068 per-tenant budget**.

Additionally, the factory result no longer exposes `registerRoutes` (that's
Fastify-specific and stays in bridge). Instead it exposes primitives; bridge's
new `domains/cost-governor/routes.ts` thin shim imports the primitives and
wires them to Fastify.

### 3.6 `@methodts/runtime/config`

**Stability tier: STABLE.**

```typescript
export { SessionsConfigSchema, loadSessionsConfig } from './sessions-config.js';
export type { SessionsConfig };

export { StrategiesConfigSchema, loadStrategiesConfig } from './strategies-config.js';
export type { StrategiesConfig, StrategyExecutorConfig };

export { CostGovernorConfigSchema, loadCostGovernorConfig };
export type { CostGovernorConfig };
```

All schemas are Zod-based, env-var-backed, and free of Node-specific
filesystem assumptions (env-only by default; bridge overlays with
`.env` loading).

---

## 4. Rename: `BridgeEvent` → `RuntimeEvent`

This is the only semantic rename the extraction requires. Every domain
currently emits `BridgeEvent` — but once the bus lives in `@methodts/runtime`
and is used by non-bridge consumers (agent-runtime, future SLM server,
Cortex tenant apps), the name lies.

- Type renames: `BridgeEvent` → `RuntimeEvent`, `BridgeEventInput` → `RuntimeEventInput`, `BridgeRateGovernor` → `RuntimeRateGovernor`.
- `source` field convention documented: `"bridge/<domain>/<component>"` for bridge-emitted events, `"runtime/<subpath>/<component>"` for runtime-internal events, `"agent-runtime/<component>"` for agent-runtime.
- Event `type` strings (`"session.spawned"`, `"strategy.gate_failed"`, etc.) are **unchanged** — these are the stable wire format.
- The bridge provides a type alias `export type BridgeEvent = RuntimeEvent` in its own `ports/event-bus.ts` shim during the migration window (see §10) so downstream in-tree bridge code does not break in one PR.

---

## 5. What Stays in `@methodts/bridge` (L4)

Strict L4 responsibilities — anything the process owns, any transport, any
host-OS coupling. The bridge remains a runnable; its `index.ts` continues to
export `{}`.

### 5.1 Transport & HTTP
- All `src/**/routes.ts` files — every `registerXxxRoutes(app)` function stays in bridge.
- `shared/websocket/hub.ts`, `shared/websocket/route.ts`, `shared/frontend-route.ts`.
- `shared/event-bus/websocket-sink.ts` (depends on WsHub, which depends on Fastify WS).
- `Fastify` instance construction in `server-entry.ts`.

### 5.2 PTY & native-OS concerns
- `domains/sessions/pty-session*` (any remaining PTY code — the `PtySession`
  *interface* is part of runtime, but any `node-pty`-based implementation stays here).
- `domains/sessions/session-persistence.ts` (file-based JSONL; moves later to
  a ports-backed alternative when checkpoint store is Cortex-agnostic).
- `domains/sessions/transcript-reader.ts`, `transcript-route.ts` (FS-based transcript browser).
- `domains/sessions/worktree-*` (git worktree interactions — shell-out to `git`).
- `startup-recovery.ts`, `ports/native-session-discovery.ts` Node implementation.

### 5.3 File-backed / OS-backed port implementations
- `ports/file-system.ts`: interface moves to runtime; `NodeFileSystemProvider` stays in bridge.
- `ports/yaml-loader.ts`: interface moves to runtime; `JsYamlLoader` stays in bridge.
- `ports/stdlib-source.ts`: stays in bridge (wraps `@methodts/methodts` stdlib; trivially re-locatable but no consumer benefit).
- `ports/in-memory-source.ts`: can move to `@methodts/runtime/ports` if the smoke-test suite wants it. **Decision: move.**

### 5.4 Project discovery + cluster
- All of `domains/projects/*` — file-based project discovery via scanning
  `C:/Users/atfm0/Repositories/` is inherently a host-OS concern.
- All of `domains/cluster/*` — Tailscale discovery, HTTP-based membership,
  federation sink. Bridge-specific (cluster peers are bridges).
- `@methodts/cluster` (the protocol library) continues to be consumed by bridge only.

### 5.5 Domain-level process orchestration
- `domains/genesis/*` — spawner that calls `pool.create` with a PTY session.
  Genesis-as-ambient-UI is a bridge concern; the `GenesisSink` and its prompt
  callback live in runtime but the actual spawn-of-Genesis belongs to bridge.
- `domains/triggers/*` — file-system watchers, webhook routes, cron — all process-bound.
- `domains/methodology/store.ts` + `routes.ts` — session store uses file I/O; HTTP routes are bridge.
- `domains/registry/*` — copying resources into project directories.
- `domains/experiments/*` — experiment lab UI + per-run JSONL; bridge-only.
- `domains/build/*` — build orchestrator HTTP + file artifacts; bridge-only. It
  *consumes* `StrategyExecutor` from runtime via the existing
  `StrategyExecutorAdapter` pattern.
- `domains/tokens/*` — OAuth token poller + sessions dir reader; bridge-only.
- `startup-recovery.ts` — reconciles persisted PTY sessions with live native sessions.

### 5.6 CLI
- `packages/method-ctl/*` — unchanged; depends on bridge HTTP.

---

## 6. Session Provider Abstraction (key design decision)

The session pool is the most contentious surface because today it hard-codes
PTY/print-session spawn behavior. The extraction introduces a
`SessionProviderFactory` port so both consumers plug their own backing
mechanism.

```typescript
// @methodts/runtime/ports/session-pool.ts (extended)

/**
 * Factory that produces the concrete session implementation for a given
 * session mode. Injected at pool construction — bridge provides a
 * PTY+print factory; agent-runtime provides an HTTP/ctx.llm factory.
 */
export interface SessionProviderFactory {
  /**
   * Create a session backed by whatever mechanism the host provides.
   * The pool handles lifecycle, queueing, diagnostics, channels, and
   * chain bookkeeping — this factory owns ONLY the "how does a prompt
   * actually execute" part.
   */
  createSession(options: SessionProviderOptions): Promise<PtySession>;
}

export interface SessionProviderOptions {
  sessionId: string;
  mode: SessionMode;                       // 'print' | 'cognitive-agent'
  workdir: string;
  allowedTools?: string[];
  allowedPaths?: string[];
  metadata?: Record<string, unknown>;
  /** Invoked on every stream event (text, cycle-start, monitor, etc.). */
  onEvent: (event: StreamEvent) => void;
  /** Optional cognitive config (only used when mode === 'cognitive-agent'). */
  cognitiveConfig?: Partial<CognitiveSessionConfig>;
  /** Optional sink for typed cognitive events (PRD 041 experiment lab). */
  cognitiveSink?: CognitiveSink;
}
```

Bridge's factory (lives in `packages/bridge/src/domains/sessions/factory.ts`,
new file): returns `createPrintSession()` from runtime for print mode,
`createCognitiveSession()` from runtime for cognitive-agent mode, both wired
to `claudeCliProvider()` or `anthropicProvider()`.

Agent-runtime's factory (lives in the new `@methodts/agent-runtime` package):
returns a CortexProviderSession that routes through `ctx.llm`, per
roadmap §4.1 items 2-3.

The pool (`createPool`) stays in runtime and receives the factory via its
options bag.

---

## 7. Migration Note for In-Tree Imports

This FCD does not execute the move; PRD-057 does. When it does:

**Pattern for bridge-internal consumers.** Every current import of form:
```typescript
import { StrategyExecutor } from './domains/strategies/strategy-executor.js';
import { InMemoryEventBus } from './shared/event-bus/index.js';
import type { EventBus } from './ports/event-bus.js';
```

becomes:
```typescript
import { StrategyExecutor } from '@methodts/runtime/strategy';
import { InMemoryEventBus } from '@methodts/runtime/event-bus';
import type { EventBus } from '@methodts/runtime/ports';
```

**Strategy:** single PR per subpath (strategy → event-bus → cost-governor →
sessions → ports) with compat shims in bridge re-exporting from runtime,
allowing rollouts without big-bang atomicity. Compat shims deleted in final
cleanup PR.

**Gate check after migration:** no file under `packages/runtime/src/` may
`import` from `fastify`, `@fastify/*`, `ws`, `node-pty`, or
`packages/bridge/**`.

---

## 8. Cost Governor — Per-AppId Hook

`createCostGovernor({ appId?, eventBus, fileSystem, config })`:

- When `appId` is omitted (bridge case today): behaves exactly as
  `createCostGovernorDomain` does today. Slots scoped by `accountId` only.
- When `appId` is present (agent-runtime / Cortex case): all emitted
  RuntimeEvents carry `payload.appId`; rate-governor slots keyed by
  `${accountId}:${appId}`; `utilization()` takes an optional `appId` filter;
  the token bucket's `weeklyCap` is applied per `(accountId, appId)` tuple
  rather than per `accountId`.

This is the **minimum change** needed to make method's cost governor
composable with Cortex PRD-068 (per-tenant budget reservation). It keeps the
bridge behavior bit-identical and adds a genuinely optional hook.

---

## 9. Why `@methodts/agent-runtime` Is Separate From `@methodts/runtime`

Considered collapsing them. Rejected because:

1. **Different knowledge assumptions.** `@methodts/runtime` is the engine; it
   knows about pacts, strategies, sessions, events. `@methodts/agent-runtime`
   is a **Cortex-shaped convenience layer** that knows about `ctx.llm`,
   `ctx.audit`, `ctx.jobs` — a Cortex-platform coupling that should not
   leak into the engine.
2. **Dependency direction.** agent-runtime depends on runtime + pacta +
   Cortex platform types. Runtime depends on nothing Cortex-specific.
   Merging would force runtime to dep on Cortex types.
3. **Name collision.** "agent-runtime" clearly signals "for running a
   Cortex agent tenant app"; "runtime" signals "the method engine". Two
   audiences, two packages.

So: **this FCD defines the public API of `@methodts/runtime` only**.
`@methodts/agent-runtime` is PRD-058 and will be its own FCD session.

---

## 10. Dependency Graph After Extraction

```
           ┌────────────────────────────┐
           │  @methodts/bridge (L4)       │  Fastify, PTY, cluster, genesis,
           │                            │  triggers, projects, build,
           │                            │  method-ctl, WebSocketSink,
           │                            │  NodeFileSystemProvider,
           │                            │  JsYamlLoader, PTY session factory
           └──────────┬─────────────────┘
                      │ depends on
                      ▼
┌──────────────────────────────────────────────────────────┐
│  @methodts/runtime (L3) — THIS FCD                         │
│  strategy/  sessions/  event-bus/  cost-governor/        │
│  ports/     config/                                      │
└──────────┬────────────────────────────────────┬──────────┘
           │                                    │
           ▼                                    ▼
  ┌────────────────┐                    ┌────────────────┐
  │ @methodts/methodts│                   │ @methodts/pacta   │
  │ (L2)           │                   │ (L3)            │
  └────────────────┘                    └────────────────┘

           ┌────────────────────────────┐
           │ @methodts/agent-runtime (L3) │  (PRD-058, separate FCD)
           │  depends on:               │
           │  @methodts/runtime +         │
           │  @methodts/pacta +           │
           │  Cortex platform types     │
           └────────────────────────────┘
```

No cycles. `@methodts/runtime` has zero transport deps.

---

## 11. Gate Assertions (to add to `packages/bridge/src/architecture.test.ts`
     and a new `packages/runtime/src/architecture.test.ts`)

### G-RUNTIME-ZERO-TRANSPORT (new)
```typescript
it('@methodts/runtime has zero transport dependencies', () => {
  const forbidden = ['fastify', '@fastify/', 'ws', 'node-pty', 'express'];
  const violations = scanPackageImports('packages/runtime/src', forbidden);
  expect(violations).toEqual([]);
});
```

### G-RUNTIME-NO-BRIDGE-BACKREF (new)
```typescript
it('@methodts/runtime never imports from @methodts/bridge', () => {
  const violations = scanPackageImports('packages/runtime/src', ['@methodts/bridge', '../../bridge/']);
  expect(violations).toEqual([]);
});
```

### G-BRIDGE-USES-RUNTIME-PORTS (new, replaces existing port tests)
```typescript
it('bridge cross-domain imports of strategy/event-bus/cost/session go through @methodts/runtime', () => {
  const srcRoots = [
    'packages/bridge/src/domains',
    'packages/bridge/src/shared',
  ];
  const forbiddenPatterns = [
    /from ['"]\.\.\/\.\.\/domains\/strategies\/strategy-executor/,
    /from ['"]\.\.\/\.\.\/shared\/event-bus\/in-memory-event-bus/,
    /from ['"]\.\.\/\.\.\/domains\/cost-governor\/(observations-store|cost-oracle-impl|rate-governor-impl)/,
  ];
  const violations = scanImportPatterns(srcRoots, forbiddenPatterns);
  expect(violations).toEqual([]);
});
```

### G-RUNTIME-EVENT-TYPE-NEUTRAL (new)
```typescript
it('runtime RuntimeEvent does not hard-code bridge-specific domain names', () => {
  // EventDomain union includes (string & {}) escape hatch — this test just
  // asserts no enum-style closed union was reintroduced.
  const src = readFileSync('packages/runtime/src/ports/event-bus.ts', 'utf-8');
  expect(src).toMatch(/\(string & \{\}\)/);
});
```

---

## 12. Producer & Consumer Mapping

**Producer** (domain that IMPLEMENTS these exports):
- New package `@methodts/runtime` at `packages/runtime/`.
- Implementation work tracked under **PRD-057**.
- Wiring: none internal — the package ships primitives. Composition happens
  entirely at consumer side.

**Consumer A** (existing): `@methodts/bridge`
- Wires everything in `packages/bridge/src/server-entry.ts` (unchanged file).
- Imports shift from local paths to `@methodts/runtime/*` subpaths (§7).
- Continues to own PTY session factory, NodeFileSystemProvider,
  JsYamlLoader, WebSocketSink, routes, cluster adapters.

**Consumer B** (planned): `@methodts/agent-runtime` (PRD-058)
- Separate FCD (not this one).
- Imports `@methodts/runtime` + `@methodts/pacta` + Cortex types.
- Wires a Cortex-backed session provider factory, a Cortex-backed
  MethodologySource, a CortexEventConnector, and an AppId-scoped
  CostGovernor.

---

## 13. Agreement

- **Frozen:** 2026-04-14
- **Changes require:** new `/fcd-surface` session (no unilateral edits).
- **Implementation container:** PRD-057 (create it; sized L).
- **Dependent PRDs:** 058 (agent-runtime), 059 (Cortex providers),
  060 (MethodAgentPort) — each is its own co-design session.

---

## 14. Open Questions (explicit)

1. **Checkpoint port placement.** `CheckpointPort` (build orchestrator,
   PRD-047) is currently only used by bridge's build domain. Moving it to
   `@methodts/runtime/ports` is correct by layering but may invite
   cortex-backed agents to adopt it prematurely. **Current decision: move
   the port interface; leave the FS-backed impl in bridge.** Flag for
   PRD-057 review.

2. **`SessionCheckpointSink` location.** Currently in bridge's event-bus
   folder; depends on a `poolList` callback and a session persistence
   `save` callback. Design treats it as runtime (both consumers need
   event-driven checkpointing). Actual persistence backend is injected,
   so this is fine — but the `PersistedSessionInput` type leaks bridge
   session-persistence shape. **Action item in PRD-057:** audit the type
   for bridge-specific fields and generalize.

3. **`ports/methodology-source.ts` vs `StdlibSource`.** Interface moves;
   `StdlibSource` (wraps `@methodts/methodts` stdlib catalog) is
   knowledge-only and could live in runtime. Choosing to **keep
   `StdlibSource` in bridge** for now because it's not consumed outside
   bridge and PRD-064 will replace it with `CortexMethodologySource`
   in agent-runtime. Neutral on revisiting.

4. **`@methodts/cluster` status.** Question from roadmap §8.5. Cluster
   federation is bridge-only for now. No runtime dependency on
   `@methodts/cluster`; cluster stays unchanged.

5. **`registerRoutes` removal from cost-governor factory.** Breaking
   change for bridge callers. Mitigation: bridge gets a tiny new
   `domains/cost-governor/routes.ts` wrapper. Fine.

6. **`CognitiveSink` export name collision.** Runtime exports
   `CognitiveSink`; pacta already has a concept of cognitive events.
   Runtime's class is the *adapter* (CognitiveEvent → RuntimeEvent).
   Consider renaming to `CognitiveEventBusSink` or
   `RuntimeCognitiveSink` to avoid ambiguity when consumers import from
   both packages. **Leaning toward `CognitiveEventBusSink`** — add to
   PRD-057 acceptance criteria.

---

## 15. Status

**Frozen.** Surface is ready for PRD-057 to break ground. Six open questions
above are scoped to PRD-057 implementation — none block the contract freeze.
