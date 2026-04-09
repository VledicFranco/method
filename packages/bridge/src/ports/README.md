# ports/ — Bridge Cross-Domain Port Interfaces

All port interfaces consumed by bridge domains. Defined here at the application root so domains depend on abstractions, not concrete implementations. Adapters (implementations) are wired in `server-entry.ts`.

## Ports

| Port | File | Consumer | Description |
|------|------|---------|-------------|
| `FileSystemProvider` | `file-system.ts` | registry, projects, methodology | Filesystem read/write abstraction |
| `YamlLoader` | `yaml-loader.ts` | registry, methodology | YAML parse/dump |
| `MethodologySource` | `methodology-source.ts` | methodology domain | Step lookup from methodts stdlib |
| `EventBus` / `EventSink` | `event-bus.ts` | all domains | Universal typed event backbone |
| `SessionPool` | `session-pool.ts` | sessions, genesis | PTY session lifecycle |
| `NativeSessionDiscovery` | `native-session-discovery.ts` | sessions | Discover existing Claude sessions |
| `CostOracle` | `cost-oracle.ts` | cost-governor | Token cost estimation per node/strategy |
| `BridgeRateGovernor` | `rate-governor.ts` | cost-governor | Rate limit enforcement |
| `HistoricalObservations` | `historical-observations.ts` | cost-governor | Append-only usage log |
| `CheckpointPort` | `checkpoint.ts` | build domain | Pipeline state persistence |
| `ConversationPort` | `conversation.ts` | build domain | Agent conversation channel |

## Event Bus (PRD 026)

`EventBus` is the single event backbone. Domains emit typed `BridgeEvent` objects; sinks subscribe at the composition root. Built-in sinks: `WebSocketSink` (frontend), `PersistenceSink` (JSONL), `ChannelSink` (parent agents), `GenesisSink` (batched summaries), `WebhookConnector` (external).

```typescript
// Emit from any domain
bus.emit({ domain: 'sessions', type: 'session.started', severity: 'info', data: { ... } });

// Register sink at composition root only
bus.subscribe(new WebSocketSink(wsServer));
```

## Methodology Source (docs/arch/methodology-source.md)

`StdlibSource` wraps `@method/methodts` stdlib catalog. `InMemorySource` is used for testing. The bridge never imports methodts directly in domain code — always through this port.
