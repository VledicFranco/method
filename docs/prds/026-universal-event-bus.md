# PRD 026: Universal Event Bus — Bridge Event Backbone

**Status:** Draft
**Author:** PO + Lysica
**Date:** 2026-03-24
**Depends on:** None (foundational infrastructure)
**Enables:** PRD 025 (Genesis page awareness), WS-2 (strategy events), WS-3 (session persistence)

## Problem

The bridge has 5+ independent event emission mechanisms:

| Domain | Mechanism | Consumers |
|--------|-----------|-----------|
| Sessions | `appendMessage` to ring-buffered channels | Parent agents (via `bridge_read_events`) |
| Projects | `pushEventToLogWithPersistence` + `_onEventHook` | WsHub → frontend, JSONL persistence |
| Triggers | `onTriggerFired` callback on TriggerRouter | WsHub → frontend, trigger channels |
| Strategies | `setOnExecutionChangeHook` callback | WsHub → frontend |
| Methodology | `appendMessage` inside route handlers | Session channels (silent swallow on error) |
| PTY Watcher | `observation` hook on pool | TriggerRouter |

Each domain invented its own event plumbing. The result:
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
  timestamp: string;             // ISO 8601
  sequence: number;              // Monotonic, bus-assigned

  // Classification
  domain: EventDomain;           // 'session' | 'strategy' | 'trigger' | 'project' | 'methodology' | 'system'
  type: string;                  // Domain-specific type (e.g., 'session.spawned', 'strategy.gate_failed')
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

type EventDomain = 'session' | 'strategy' | 'trigger' | 'project' | 'methodology' | 'system';
type EventSeverity = 'info' | 'warning' | 'error' | 'critical';
```

### Event Types by Domain

```typescript
// Session events
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

// System events
'system.bridge_started'    // Bridge process started
'system.bridge_stopping'   // Graceful shutdown initiated
'system.health_degraded'   // Health check detected issues
'system.error'             // Unhandled error
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
  /** Emit an event to all subscribers. Bus assigns id, timestamp, sequence. */
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

### Built-in Sinks

#### WebSocketSink
Replaces the current ad-hoc `wsHub.publish` calls in `server-entry.ts`. The sink receives all
events and pushes them to WebSocket subscribers based on their topic subscriptions. Frontend
subscribes to event domains instead of hardcoded topics.

#### PersistenceSink
Replaces `pushEventToLogWithPersistence` and the project-specific JSONL persistence. Writes
ALL events to a unified event log (JSONL). Enables event replay on bridge restart, historical
queries, and audit trails.

#### GenesisSink
New. Feeds events to the Genesis agent session. Genesis receives a stream of everything
happening in the bridge — session lifecycle, strategy execution, trigger fires, methodology
transitions. This is the foundation for Genesis intelligence:
- **Reactive:** Genesis sees a `strategy.gate_failed` event → advises the user
- **Proactive:** Genesis sees 3 `session.stale` events in 10 minutes → alerts the user
- **Autonomous:** Genesis sees a `trigger.fired` event → decides to spawn a session to handle it

#### ChannelSink
Replaces the current `appendMessage` pattern for parent-agent visibility. Parent agents
subscribe to child session events via `bridge_read_events` — the channel sink filters events
by sessionId and buffers them for cursor-based reading.

### Frontend Integration

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

// Register sinks
eventBus.registerSink(new WebSocketSink(wsHub));
eventBus.registerSink(new PersistenceSink(join(ROOT_DIR, '.method', 'events.jsonl'), fsProvider));
eventBus.registerSink(new ChannelSink(/* parent agent channels */));
if (genesisConfig.enabled) {
  eventBus.registerSink(new GenesisSink(pool, genesisSessionId));
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
| P3 (Port pattern) | EventBus is a port interface. Domains depend on the interface, not concrete sinks. |
| P5 (Pure composition) | server-entry.ts creates the bus, registers sinks, injects into domains. Zero logic. |
| P7 (Boundary enforcement) | Domains emit events without knowing who consumes them. Sinks consume without knowing who produces. |
| P8 (Co-location) | EventBus port in `ports/event-bus.ts`. InMemoryEventBus in `shared/`. Domain-specific event types co-located with their domain. |
| P9 (Observable) | The event bus IS the observability layer — every domain action becomes a typed, queryable event. |

### Architecture Gate Impact

- **G-PORT:** Domains emit via `eventBus.emit()`, not direct WebSocket or persistence calls
- **G-BOUNDARY:** No cross-domain coupling — producers and consumers never import each other
- **G-LAYER:** EventBus port defined at bridge level (L4). Sinks are L4 infrastructure. Clean.

## Phases

### Phase 1: Port + InMemoryEventBus + Migration
- Define `EventBus` and `EventSink` port interfaces in `ports/event-bus.ts`
- Implement `InMemoryEventBus` (in-memory, no persistence) in `shared/`
- Define `BridgeEvent` schema and all event types
- Migrate ONE domain (sessions) to emit through the bus
- WebSocketSink replaces the sessions `wsHub.publish` call
- Verify: frontend receives session events via new bus

### Phase 2: Full Domain Migration
- Migrate remaining domains: strategies, triggers, projects, methodology, pty-watcher
- Remove all ad-hoc hook callbacks from server-entry.ts (`setOnEventHook`, `setOnExecutionChangeHook`, `onTriggerFired`, `pool.setObservationHook`)
- Composition root wires bus → domains via injection
- Verify: all current WebSocket topics still work on frontend

### Phase 3: PersistenceSink + Event Replay
- Implement PersistenceSink (JSONL, uses FileSystemProvider port)
- Replace project-specific `pushEventToLogWithPersistence` with the bus
- Event replay on bridge restart (read JSONL, populate in-memory buffer)
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
