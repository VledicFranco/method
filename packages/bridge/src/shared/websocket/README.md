# Shared — WebSocket Hub

Multiplexed WebSocket layer for the bridge. A single `WsHub` instance manages all connected clients, routes messages by topic, and replays recent events to reconnecting clients.

## Components

| Component | Description |
|-----------|-------------|
| `WsHub` | Core hub — topic-based subscription, broadcast, replay buffer per topic |
| `registerWsRoute` | Fastify route registration for the `/ws` endpoint |

## Topic Model

The hub uses a typed `Topic` discriminant. Valid topics are defined in `VALID_TOPICS`. Clients subscribe to one or more topics; the hub delivers only messages matching their subscriptions.

Built-in topics mirror the bridge event bus domains: `sessions`, `build`, `cost`, `cluster`, `projects`, `triggers`, `genesis`.

## Replay

Each topic maintains a configurable replay buffer (last N events). Clients that reconnect after a brief disconnect receive buffered events immediately — avoiding the "missed events" problem without requiring persistent queues.

The hub does NOT persist events — that's the `PersistenceSink`'s job (event bus layer). The replay buffer is purely in-memory and bounded.

## Integration

The Universal Event Bus's `WebSocketSink` holds a reference to the `WsHub`. It translates `BridgeEvent` objects to `ServerMessage` JSON and calls `hub.broadcast(topic, message)` for each event.
