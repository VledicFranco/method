# Universal Event Bus (UEB)

## Responsibility

`packages/bridge/src/shared/event-bus/` provides a single event backbone for all bridge domains. Every domain emits typed `BridgeEvent` objects to the bus. Every consumer (WebSocket, persistence, Genesis, external connectors) subscribes through the same `EventSink` interface.

**Key constraints:**
- The bus is a port interface (`ports/event-bus.ts`) — domains depend on the interface, not concrete implementations
- Sinks are registered only in the composition root (`server-entry.ts`) — no domain registers sinks
- Producers and consumers never import each other (G-BOUNDARY)
- Adding a new sink or event type requires zero changes to existing domains

## Architecture

```
Domains (producers)                    EventBus port                     Sinks (consumers)
───────────────────                    ──────────────                     ──────────────────
sessions/    ──emit──→                                                   ──→ WebSocketSink (frontend push)
strategies/  ──emit──→  EventBus { emit(), subscribe(), query() }       ──→ PersistenceSink (JSONL)
triggers/    ──emit──→                                                   ──→ GenesisSink (30s batch → agent)
projects/    ──emit──→                                                   ──→ ChannelSink (parent agent push)
methodology/ ──emit──→                                                   ──→ WebhookConnector (HTTP POST)
experiments/ ──emit──→                                                   ──→ [future connectors]
```

## BridgeEvent Schema

```typescript
interface BridgeEvent {
  id: string;              // UUID, bus-assigned
  version: 1;              // Schema version
  timestamp: string;       // ISO 8601, bus-assigned
  sequence: number;        // Monotonic, bus-assigned
  domain: EventDomain;     // 'session' | 'strategy' | 'trigger' | 'project' | 'methodology' | 'system'
  type: string;            // Domain-owned (e.g., 'session.spawned', 'strategy.gate_failed')
  severity: EventSeverity; // 'info' | 'warning' | 'error' | 'critical'
  projectId?: string;
  sessionId?: string;
  payload: Record<string, unknown>;
  source: string;          // Emitting component
  correlationId?: string;  // Links related events
  sourceNodeId?: string;   // Originating bridge node (cluster federation)
  federated?: boolean;     // true if received from another bridge
}
```

## Built-in Sinks

| Sink | Purpose | Key behavior |
|------|---------|-------------|
| WebSocketSink | Real-time frontend push | Maps domains to legacy topics (project→events, strategy→executions) |
| PersistenceSink | Disk persistence | JSONL write-ahead batching (1s/100 events), 24h replay on restart |
| ChannelSink | Parent agent visibility | Per-session ring buffers (200 cap), severity-based push notifications |
| GenesisSink | Genesis agent awareness | 30s batch window, severity filter (warning+error+critical), narrow callback |
| ClusterFederationSink | Cross-bridge event relay | Relays local events to cluster peers via EventRelay; skips `federated: true` events (loop prevention) |

## Connector Architecture

`EventConnector` extends `EventSink` with lifecycle management for external systems:

```typescript
interface EventConnector extends EventSink {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  health(): ConnectorHealth;
}
```

**WebhookConnector** (proof of concept): POSTs BridgeEvent JSON to a configured URL with retry (exponential backoff, max 3), rate limiting (10/s), and health tracking.

**Declarative config** via environment variables:
```
EVENT_CONNECTOR_WEBHOOK_URL=https://example.com/events
EVENT_CONNECTOR_WEBHOOK_FILTER_DOMAIN=session,strategy
EVENT_CONNECTOR_WEBHOOK_FILTER_SEVERITY=error,critical
```

## InMemoryEventBus

- Ring buffer: 10,000 events (configurable), O(1) append with eviction
- Max payload: 64KB (enforced at emit, oversized events rejected as `system.bus_error`)
- Sink dispatch: fire-and-forget, async errors caught via `onError()`
- `query()`: filter-based historical query from ring buffer
- `getStats()`: bus self-monitoring (emitted as `system.bus_stats` every 60s)
- `connectAll()`/`disconnectAll()`: connector lifecycle management
- `connectorHealth()`: queryable via `GET /api/connectors`

## File Structure

```
packages/bridge/src/
├── ports/
│   └── event-bus.ts              Port interfaces: EventBus, EventSink, EventConnector, BridgeEvent
├── shared/event-bus/
│   ├── in-memory-event-bus.ts    Production bus implementation (ring buffer + dispatch)
│   ├── websocket-sink.ts         Frontend push via WsHub
│   ├── persistence-sink.ts       JSONL persistence + replay
│   ├── channel-sink.ts           Per-session buffering + parent push
│   ├── genesis-sink.ts           Batched Genesis prompts
│   ├── webhook-connector.ts      HTTP POST connector (proof of concept)
│   ├── adapters.ts               BridgeEvent → legacy shape converters
│   └── index.ts                  Barrel exports
└── server-entry.ts               Composition root: creates bus, registers sinks, wires domains
```

## PRD Reference

PRD 026: Universal Event Bus — implemented across 5 phases (PR #52–#56).
