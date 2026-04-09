# event-bus/ — Universal Event Bus (PRD 026)

Single typed event backbone for the bridge. All bridge domains emit `BridgeEvent` objects to one bus. Consumers register `EventSink` implementations at the composition root — never directly in domain code.

## Purpose

Decouples event producers (domains) from consumers (websocket, persistence, parent agents, genesis, webhooks). Any domain can emit an event without knowing who listens. New consumers are added at the composition root with zero changes to domain code.

## Core Types

```typescript
interface BridgeEvent {
  domain: EventDomain;        // 'sessions' | 'projects' | 'strategies' | ...
  type: string;               // e.g. 'session.started', 'strategy.gate.passed'
  severity: EventSeverity;    // 'debug' | 'info' | 'warn' | 'error'
  data: unknown;
  timestamp: string;
  correlationId?: string;
}

interface EventSink {
  handle(event: BridgeEvent): Promise<void>;
  filter?: EventFilter;       // optional — only receive matching events
}
```

## Built-in Sinks

| Sink | Purpose |
|------|---------|
| `WebSocketSink` | Streams events to connected frontend clients |
| `PersistenceSink` | Appends events to `.method/events.jsonl` |
| `ChannelSink` | Forwards events to parent agent sessions |
| `GenesisSink` | Batches events into 30s summaries for ambient UI |
| `WebhookConnector` | POSTs events to external webhook URL |
| `SessionCheckpointSink` | Persists session state for crash recovery |

## Usage

```typescript
// In any domain — only import the EventBus port type
bus.emit({ domain: 'sessions', type: 'session.started', severity: 'info', data: { sessionId } });

// In server-entry.ts only — register sinks
bus.subscribe(new PersistenceSink({ eventsPath: '.method/events.jsonl' }));
bus.subscribe(new WebSocketSink(wsServer));

// Webhook (env-configured)
// Set EVENT_CONNECTOR_WEBHOOK_URL to auto-register
// Set EVENT_CONNECTOR_WEBHOOK_FILTER_DOMAIN to filter by domain
```

## InMemoryEventBus

Test implementation included. Supports `getEmitted()` for assertions and `reset()` between tests. The interface is identical to the production bus — domain code tests without a real event store.
