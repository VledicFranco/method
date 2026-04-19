// SPDX-License-Identifier: Apache-2.0
/**
 * @methodts/runtime/event-bus — EventBus + sinks + connectors (PRD-057 / S2 §3.4).
 *
 * Public surface frozen by S2 §3.4. The bus and all transport-free sinks live
 * here. `WebSocketSink` stays in @methodts/bridge per S2 §5.1 (it depends on
 * @fastify/websocket, which runtime cannot carry).
 */

export { InMemoryEventBus } from './in-memory-event-bus.js';
export type { InMemoryEventBusOptions, BusStats } from './in-memory-event-bus.js';

export { PersistenceSink } from './persistence-sink.js';
export type { PersistenceSinkOptions } from './persistence-sink.js';

export { ChannelSink, getChannelTarget } from './channel-sink.js';
export type { ChannelSinkOptions } from './channel-sink.js';

export { GenesisSink } from './genesis-sink.js';
export type { GenesisSinkOptions, GenesisPromptCallback } from './genesis-sink.js';

export { WebhookConnector } from './webhook-connector.js';
export type { WebhookConnectorOptions } from './webhook-connector.js';

export { SessionCheckpointSink } from './session-checkpoint-sink.js';
export type {
  SessionCheckpointSinkOptions,
  PersistedSessionInput,
  SessionStatusInfo,
} from './session-checkpoint-sink.js';

export { createAgentEventAdapter } from './agent-event-adapter.js';

export { toChannelMessage, toAllEventsWrapper } from './adapters.js';
