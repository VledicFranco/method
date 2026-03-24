# PRD 026: Universal Event Bus — Bridge Event Backbone

**Status:** Draft
**Author:** PO + Lysica
**Date:** 2026-03-24
**Depends on:** None (foundational infrastructure)
**Enables:** PRD 025 (Genesis page awareness), WS-2 (strategy events), WS-3 (session persistence)

## Problem

The bridge has 7 distinct event emission/consumption mechanisms:

| Domain | Mechanism | Consumers |
|--------|-----------|-----------|
| Sessions | `appendMessage` to ring-buffered channels | Parent agents (via `bridge_read_events`) |
| Projects | `pushEventToLogWithPersistence` + `_onEventHook` | WsHub → frontend, JSONL persistence |
| Triggers (producer) | `onTriggerFired` callback on TriggerRouter | WsHub → frontend, trigger channels |
| Triggers (consumer) | `addOnMessageHook` on SessionChannels | TriggerRouter (channel-event-trigger.ts) |
| Strategies | `setOnExecutionChangeHook` callback | WsHub → frontend |
| Methodology | `appendMessage` inside route handlers | Session channels (silent swallow on error) |
| PTY Watcher | `observation` hook on pool | TriggerRouter |

Note: the trigger system is both a producer (emits `trigger.fired`) and a consumer
(subscribes to session/methodology events to evaluate trigger conditions). The bus
must support this bidirectional pattern.

Each domain has functional event plumbing coordinated through the composition root,
but the patterns diverge — ring-buffered channels for sessions, hook callbacks for
strategies and triggers, persistence wrappers for projects. The bus consolidates
these into one pattern. The result of the current divergence:
- **Genesis can only see project events** — session lifecycle, strategy execution, trigger fires,
  methodology transitions are invisible to it
- **Frontend gets a partial picture** — WebSocket topics (`events`, `sessions`, `executions`,
  `triggers`) are wired ad-hoc in `server-entry.ts` with manual `wsHub.publish` calls
- **No pluggability** — adding a new event consumer (Slack, webhook, external system) means
  touching `server-entry.ts` and adding another hook callback
- **No unified event schema** — project events have `{ type, projectId, payload, timestamp }`,
  session channel messages have `{ type, sender, content, sequence }`, trigger fires have
  `{ trigger_id, trigger_type, strategy_id, payload }`. Three different shapes for the same concept.
- **No event replay** — only project events have persistence (JSONL). Everything else is ephemeral.

## Objective

One event bus, one event schema, pluggable sinks. Every domain emits typed events to the bus.
Every consumer (frontend, Genesis, persistence, external connectors) subscribes through the
same interface.

## Architecture

### Core Principle: Event Bus as an FCA Port

The event bus is a **port interface** at the bridge level. Domains emit events through the port.
Consumers subscribe through the port. Neither knows about the other.

```
Domains (producers)                    EventBus port                     Sinks (consumers)
───────────────────                    ──────────────                     ──────────────────
sessions/    ──emit──→                                                   ──→ WebSocketSink (frontend push)
strategies/  ──emit──→  EventBus { emit(event), subscribe(filter) }     ──→ PersistenceSink (JSONL/YAML)
triggers/    ──emit──→                                                   ──→ GenesisSink (feed agent context)
projects/    ──emit──→                                                   ──→ ChannelSink (parent agent push)
methodology/ ──emit──→                                                   ──→ [future: SlackSink, WebhookSink, ...]
pty-watcher/ ──emit──→
```

### Unified Event Schema

```typescript
interface BridgeEvent {
  // Identity
  id: string;                    // UUID, globally unique
  version: 1;                    // Schema version for future evolution
  timestamp: string;             // ISO 8601
  sequence: number;              // Monotonic, bus-assigned

  // Classification
  domain: EventDomain;           // 'session' | 'strategy' | 'trigger' | 'project' | 'methodology' | 'system'
  type: string;                  // Domain-owned type string (e.g., 'session.spawned', 'strategy.gate_failed')
  severity: EventSeverity;       // 'info' | 'warning' | 'error' | 'critical'

  // Scoping
  projectId?: string;            // Which project this event belongs to (if applicable)
  sessionId?: string;            // Which session produced this event (if applicable)

  // Payload
  payload: Record<string, unknown>;  // Domain-specific data

  // Metadata
  source: string;                // Which component emitted (e.g., 'bridge/sessions/pool')
  correlationId?: string;        // Links related events (e.g., all events from one strategy execution)
}

// EventDomain is extensible — new domains can be added without modifying this type.
// The union is a type-level hint, not a runtime enum. Domains own their type strings.
type EventDomain = 'session' | 'strategy' | 'trigger' | 'project' | 'methodology' | 'system' | (string & {});
type EventSeverity = 'info' | 'warning' | 'error' | 'critical';
```

### Event Types by Domain

These are the **target event types** for the unified bus. Not all exist in the current
codebase — many are new emissions that domains will add during migration. Current
emissions (e.g., channel message types `started`, `killed`, `stale`) map to the new
domain-scoped names (e.g., `session.spawned`, `session.killed`, `session.stale`).

Each domain owns its event type strings. Adding a new type requires only emitting it
from the domain — no central registry or shared enum needs updating.

```typescript
// Session events (maps from current channel message types)
// Current: 'started' → New: 'session.spawned'
// Current: 'killed' → New: 'session.killed'
// Current: 'stale' → New: 'session.stale'
// New emissions (not in current code): session.prompted, session.responded
'session.spawned'          // New session created
'session.prompted'         // Prompt sent to session
'session.responded'        // Response received
'session.killed'           // Session terminated
'session.stale'            // Session detected as stale
'session.observation'      // PTY watcher detected a pattern (tool call, git commit, test result, etc.)

// Strategy events
'strategy.started'         // Execution began
'strategy.node_started'    // DAG node began executing
'strategy.node_completed'  // DAG node finished
'strategy.gate_passed'     // Gate check passed
'strategy.gate_failed'     // Gate check failed
'strategy.completed'       // Execution finished successfully
'strategy.failed'          // Execution failed

// Trigger events
'trigger.registered'       // New trigger registered
'trigger.fired'            // Trigger condition met
'trigger.paused'           // Trigger paused
'trigger.error'            // Trigger evaluation error

// Project events
'project.discovered'       // New project found during scan
'project.config_updated'   // Project config reloaded
'project.health_changed'   // Project health status changed

// Methodology events
'methodology.session_started'  // Methodology session began
'methodology.step_advanced'    // Step transition
'methodology.step_validated'   // Step validation result
'methodology.routed'           // Method routing decision

// System events (bus self-observability + bridge lifecycle)
'system.bridge_started'    // Bridge process started
'system.bridge_stopping'   // Graceful shutdown initiated
'system.health_degraded'   // Health check detected issues
'system.error'             // Unhandled error
'system.bus_error'         // EventBus sink error (self-monitoring)
'system.bus_stats'         // Periodic bus statistics (events/s, sink latency, buffer usage)
'system.sink_overflow'     // Sink queue full, events dropped
```

### Port Interface

```typescript
// ports/event-bus.ts

interface EventFilter {
  domain?: EventDomain | EventDomain[];
  type?: string | string[];      // Glob patterns: 'session.*', 'strategy.gate_*'
  projectId?: string;
  sessionId?: string;
  severity?: EventSeverity | EventSeverity[];
}

interface EventSubscription {
  unsubscribe: () => void;
}

interface EventBus {
  /**
   * Emit an event to all subscribers. Bus assigns id, timestamp, sequence.
   * Non-blocking: sinks receive events asynchronously. No sink failure blocks emit().
   */
  emit(event: Omit<BridgeEvent, 'id' | 'timestamp' | 'sequence'>): BridgeEvent;

  /** Subscribe to events matching a filter. */
  subscribe(filter: EventFilter, handler: (event: BridgeEvent) => void): EventSubscription;

  /** Query past events (requires a persistence sink). */
  query(filter: EventFilter, options?: { limit?: number; since?: string }): Promise<BridgeEvent[]>;

  /** Register a sink that receives all events. */
  registerSink(sink: EventSink): void;
}

interface EventSink {
  name: string;
  onEvent(event: BridgeEvent): void | Promise<void>;
  onError?: (error: Error, event: BridgeEvent) => void;
}
```

### Capacity & Execution Model

**InMemoryEventBus** uses a ring buffer with configurable capacity (default 10,000 events).
Oldest events evicted on overflow. Memory footprint at ~1KB per event: ~10MB default cap.

**Sink execution:** Each sink receives events asynchronously via an internal bounded queue
(default 500 events). On queue overflow: drop oldest, emit `system.sink_overflow` event.
`onError` captures sink failures without blocking the bus. PersistenceSink uses
write-ahead batching (flush every 1s or 100 events, whichever comes first).

**Performance budgets:** Max event payload 64KB (enforced at emit). Events passed by
reference within-process; serialization occurs only at sink boundaries (WebSocket JSON,
PersistenceSink JSONL). PTY watcher retains its existing rate limiting and dedup logic —
the bus transports already-throttled observations. WebSocket backpressure buffer
increased from 64KB to 128KB per client to handle higher event volume from unified bus.
Backpressure drops are logged as `system.sink_overflow` events.

```typescript
// (remaining types continued below)
```

### Built-in Sinks

#### WebSocketSink
Replaces the current `wsHub.publish` calls in `server-entry.ts` (3 publish points across
projects, strategies, and triggers). The sink receives all events and pushes them to
WebSocket subscribers based on domain-based filtering (replacing hardcoded topic
subscriptions). Note: the current `sessions` WebSocket topic is defined but never published
to — the bus resolves this by routing all session domain events through WebSocketSink.

#### PersistenceSink
Replaces `pushEventToLogWithPersistence` and the project-specific JSONL persistence. Writes
ALL events to a unified event log (JSONL). Enables event replay on bridge restart, historical
queries, and audit trails.

#### GenesisSink
New. Feeds events to the Genesis agent session via a narrow callback interface — NOT
a direct SessionPool import (which would violate G-BOUNDARY).

```typescript
// GenesisSink receives a prompt callback, not the pool itself
interface GenesisPromptCallback {
  (sessionId: string, prompt: string): Promise<void>;
}

// Composition root wires it:
const genesisSink = new GenesisSink({
  promptSession: (id, text) => pool.prompt(id, text, 10000),
  sessionId: genesisSessionId,
  batchWindowMs: 30_000,  // Summarize events every 30s
  filter: { severity: ['warning', 'error', 'critical'] },  // Ignore info-level noise
});
```

GenesisSink accumulates events in a time-windowed buffer (configurable, default 30s).
At window close, it summarizes buffered events into a single prompt. Estimated volume:
~45 summarized prompts/hour (vs. ~2,700 raw events/hour at 7 active sessions).

This is the foundation for Genesis intelligence:
- **Reactive:** Genesis sees a `strategy.gate_failed` event → advises the user
- **Proactive:** Genesis sees 3 `session.stale` events in 10 minutes → alerts the user
- **Autonomous:** Genesis sees a `trigger.fired` event → decides to spawn a session to handle it

#### ChannelSink
Replaces the current `appendMessage` pattern for parent-agent visibility. Parent agents
subscribe to child session events via `bridge_read_events`. ChannelSink filters events
by `sessionId` match, maintains a per-session ring buffer (default 200 events, matching
current channel capacity), and provides cursor-based reads with identical semantics to
the current system.

#### WebSocketSink Topic Migration
WebSocketSink maps legacy topics to domain filters during the transition period:
- topic `events` → domain `project`
- topic `executions` → domain `strategy`
- topic `triggers` → domain `trigger`

New clients subscribe by domain directly. Legacy topic subscriptions supported through
Phase 4. PTY observations (currently bypassing WebSocket entirely) flow through the bus
as `session.observation` events to WebSocketSink.

### Frontend Integration

The frontend follows FCA Pattern A (separate frontend package with shared types). The
`event-store.ts` Zustand store mirrors the backend `BridgeEvent` type and subscribes
via WebSocket. Domain-specific frontend components use the `useBridgeEvents` hook to
filter events by domain — no cross-domain imports in the frontend.

```typescript
// Frontend: shared/stores/event-store.ts (replaces ws-store.ts)

interface EventStoreState {
  events: BridgeEvent[];                    // All received events
  connected: boolean;
  subscribe: (filter: EventFilter) => void;  // Tell server what we want
  unsubscribe: (domain: string) => void;
}

// Frontend: hook
function useBridgeEvents(filter: EventFilter): BridgeEvent[] {
  // Subscribe to WebSocket events matching filter
  // Return filtered events from store
}

// Usage in any page:
const strategyEvents = useBridgeEvents({ domain: 'strategy', type: 'strategy.gate_*' });
const sessionEvents = useBridgeEvents({ domain: 'session', projectId: selectedProject?.id });
```

### Composition Root Wiring

```typescript
// server-entry.ts

const eventBus = new InMemoryEventBus();

// Register sinks (ONLY in composition root — no domain registers sinks)
eventBus.registerSink(new WebSocketSink(wsHub));
eventBus.registerSink(new PersistenceSink(join(ROOT_DIR, '.method', 'events.jsonl'), fsProvider));
eventBus.registerSink(new ChannelSink());
if (genesisConfig.enabled) {
  // GenesisSink receives a narrow callback, NOT the full SessionPool (G-BOUNDARY)
  eventBus.registerSink(new GenesisSink({
    promptSession: (id, text) => pool.prompt(id, text, 10000),
    sessionId: genesisSessionId,
    batchWindowMs: 30_000,
    filter: { severity: ['warning', 'error', 'critical'] },
  }));
}

// Inject bus into domains
const pool = createPool({ ..., eventBus });
registerStrategyRoutes(app, strategyProvider, { eventBus });
registerTriggerRoutes(app, triggerRouter, { eventBus });
registerProjectRoutes(app, discoveryService, registry, eventPersistence, ROOT_DIR, { eventBus });
registerMethodologyRoutes(app, methodologyStore, { pool, appendMessage, eventBus });
```

## FCA Analysis

| FCA Principle | How this PRD respects it |
|---------------|--------------------------|
| P3 (Port pattern) | EventBus is a port interface in `ports/event-bus.ts` (follows existing bridge port conventions alongside pty-provider, file-system, yaml-loader). Domains depend on the interface, not concrete sinks. |
| P5 (Pure composition) | server-entry.ts creates the bus, registers sinks, injects into domains. Zero logic. Sink registration occurs ONLY in the composition root — no domain registers sinks. |
| P7 (Boundary enforcement) | Domains emit events without knowing who consumes them. Sinks consume without knowing who produces. Event type strings are plain strings owned by each domain — not a shared enum. The `EventDomain` union in the port is a type-level constraint, not a runtime import. |
| P8 (Co-location) | EventBus port in `ports/event-bus.ts`. InMemoryEventBus in `shared/`. Domain-specific event types co-located with their domain (e.g., sessions domain defines `'session.spawned'`). |
| P9 (Observable) | The event bus enables domain observability by providing a typed, queryable event stream through the port pattern (P3 enables P9). The bus itself emits `system.bus_error` and `system.bus_stats` events for self-monitoring. |

### Architecture Gate Impact

- **G-PORT:** Domains emit via `eventBus.emit()`, not direct WebSocket or persistence calls.
  PersistenceSink writes via `FileSystemProvider` port (not direct `fs`). No new G-PORT exceptions.
- **G-BOUNDARY:** No cross-domain coupling — producers and consumers never import each other.
  GenesisSink uses a narrow callback port, not SessionPool import. No new G-BOUNDARY exceptions.
  During Phase 2 dual-emit period, temporary exceptions may exist — these must be retired
  before Phase 2 completion gate.
- **G-LAYER:** EventBus port follows existing bridge port conventions (alongside `pty-provider.ts`,
  `file-system.ts`, `yaml-loader.ts`). Sinks are L4 infrastructure wired at composition root.
  No G-LAYER violations.

**Expected temporary exceptions during migration:** 0 if sinks are wired correctly through
composition root. If a domain temporarily imports a legacy hook AND the bus, that's a dual-emit
transient — documented in Phase 2 and retired at the completion gate.

## Phases

### Phase 1: Port + InMemoryEventBus + Migration
- Define `EventBus` and `EventSink` port interfaces in `ports/event-bus.ts`
- Implement `InMemoryEventBus` (in-memory, no persistence) in `shared/`
- Define `BridgeEvent` schema and all event types
- Migrate ONE domain (sessions) to emit through the bus
- WebSocketSink replaces the sessions `wsHub.publish` call
- Verify: frontend receives session events via new bus

### Phase 2: Full Domain Migration
- Migrate remaining domains: strategies, triggers, projects, methodology (fix silent error swallowing), pty-watcher
- Migrate all 7 event pathways identified in the Problem section (including `addOnMessageHook`)
- Strategy domain enriches events beyond current minimal hook (current: 3 fields via `setOnExecutionChangeHook` → new: full BridgeEvent with node_id, gate_result, cost_usd, retro_path)
- TriggerRouter's `ChannelEventTrigger` subscribes to bus events (replacing `addOnMessageHook`)
- Remove all hook callbacks from server-entry.ts (`setOnEventHook`, `setOnExecutionChangeHook`, `onTriggerFired`, `pool.setObservationHook`, `addOnMessageHook`)
- Update `bridge_read_events` and `bridge_all_events` MCP tools with adapter layer for legacy shapes
- Dual-emit period: old + new mechanisms active simultaneously until verified
- Composition root wires bus → domains via injection
- Verify: all current WebSocket topics still work on frontend
- **Completion gate: zero temporary G-BOUNDARY exceptions remaining. All cross-domain event wiring flows through the bus port.**

### Phase 3: PersistenceSink + Event Replay
- Implement PersistenceSink (JSONL, uses FileSystemProvider port)
- Replace project-specific `pushEventToLogWithPersistence` with the bus
- Event replay on bridge restart: replay events from configurable window (default 24 hours, env: `EVENT_REPLAY_WINDOW_HOURS`). Sink cursors persisted alongside event log for cursor recovery.
- Migrate existing project JSONL event logs to unified format (or support reading both during transition)
- HTTP endpoint: `GET /api/events` queries the bus (replaces current project-only endpoint)
- Verify: events survive bridge restart

### Phase 4: GenesisSink + Frontend Event Store
- Implement GenesisSink (buffers events, prompts Genesis with summaries)
- Frontend: replace `ws-store.ts` with `event-store.ts` backed by unified event subscription
- Frontend: `useBridgeEvents(filter)` hook for any page to subscribe to any domain's events
- Verify: Genesis receives all event types, frontend can subscribe to any domain

### Phase 5: Connector Architecture
- Define `EventConnector` interface extending `EventSink` with lifecycle (connect, disconnect, health)
- Implement one external connector as proof of concept (webhook or Slack)
- Configuration: connectors declared in `.method/manifest.yaml` or environment variables
- Verify: external system receives bridge events

## Migration & Backward Compatibility

### Dual-Emit Period (Phase 2)

During Phase 2, domains emit to BOTH the old mechanism and the new bus. This ensures
zero consumer disruption while migration proceeds domain by domain:

- Sessions: `appendMessage` continues alongside `eventBus.emit()` until ChannelSink is verified
- Projects: `pushEventToLogWithPersistence` continues alongside bus until PersistenceSink is verified
- Strategies: `setOnExecutionChangeHook` continues alongside bus

### MCP Tool Response Shape Adapter

MCP tools (`bridge_read_events`, `bridge_all_events`, `bridge_read_progress`) currently
serialize REST responses in legacy shapes (ChannelMessage, ProjectEvent wrappers). During
migration, an adapter layer translates BridgeEvent back to current shapes:

```typescript
// Adapter: BridgeEvent → legacy ChannelMessage shape
function toChannelMessage(event: BridgeEvent): ChannelMessage {
  return {
    sequence: event.sequence,
    timestamp: event.timestamp,
    sender: event.sessionId ?? event.source,
    type: event.type.split('.')[1] ?? event.type,  // 'session.spawned' → 'spawned'
    content: event.payload,
  };
}
```

For `bridge_all_events` (aggregated cross-session events), the legacy wrapper shape
`{ bridge_session_id, session_metadata, message }` is reconstructed from BridgeEvent:

```typescript
function toAllEventsWrapper(event: BridgeEvent) {
  return {
    bridge_session_id: event.sessionId ?? event.domain,
    session_metadata: {
      commission_id: event.correlationId,
      methodology: event.payload.methodology,
      ...(event.domain === 'trigger' ? { trigger_id: event.payload.trigger_id } : {}),
    },
    message: toChannelMessage(event),
  };
}
```

Old pathways removed only when all consumers confirmed working on new shapes.

### Trigger System Migration

The trigger system is both a producer and consumer. In Phase 2:
- TriggerRouter's `ChannelEventTrigger` subscribes to bus events (replacing `addOnMessageHook`)
- TriggerRouter emits `trigger.fired` events to the bus (replacing `onTriggerFired` callback)
- Trigger evaluation continues to use domain-specific logic; only the event transport changes

### Push Notification Criteria

Push notifications to parent agents transition from type-based filtering (current
`PUSHABLE_EVENTS` set: completed, error, escalation, budget_warning, stale, scope_violation)
to configurable criteria (type + severity). Mapping during migration:
- `completed` → severity `info` (no auto-push)
- `error` → severity `error` (push)
- `escalation` → severity `warning` (push)
- `budget_warning` → severity `warning` (push)
- `stale` → severity `warning` (push)
- `scope_violation` → severity `error` (push)

### Schema Versioning

BridgeEvent includes a `version: 1` field for future schema evolution. Consumers that
cannot parse a newer version fall back to the adapter layer.

## Non-Goals

- **Event sourcing / CQRS** — the bus is for observation and reaction, not for rebuilding state from events
- **Guaranteed delivery** — sinks are best-effort. If a sink is slow, events may be dropped (configurable buffer).
  Production-grade delivery guarantees are a future concern.
- **Schema evolution / versioning** — v1 schema ships, migrations are a future concern if the schema changes
- **Multi-bridge federation** — one bus per bridge instance. Cross-bridge event routing is out of scope.

## Success Criteria

1. **One emit call per domain event** — no more dual `appendMessage` + `wsHub.publish` + `_onEventHook` for the same event
2. **Zero ad-hoc hook callbacks in server-entry.ts** — all replaced by `eventBus.registerSink()`
3. **Frontend receives all domain events via WebSocket** — not just projects and executions
4. **Genesis receives all domain events** — full system awareness, not just project events
5. **Events persist and replay** — `GET /api/events?domain=session&since=...` returns historical events
6. **Architecture gates pass** — G-PORT, G-BOUNDARY, G-LAYER
7. **Adding a new sink requires zero changes to existing domains** — implement `EventSink`, register in composition root, done
8. **Adding a new event type requires zero changes to the bus** — define the type string, emit it from the domain, done
