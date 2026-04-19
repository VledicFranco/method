// SPDX-License-Identifier: Apache-2.0
/** Shared event bus module — PRD 026.
 *
 * PRD-057 / S2 §3.4 / C3: The bus implementation and all transport-free sinks
 * now live in `@methodts/runtime/event-bus`. This barrel re-exports them so
 * in-tree bridge consumers keep working; `WebSocketSink` stays here (depends
 * on @fastify/websocket — transport-bound per S2 §5.1).
 */

export {
  InMemoryEventBus,
  PersistenceSink,
  ChannelSink,
  getChannelTarget,
  GenesisSink,
  WebhookConnector,
  SessionCheckpointSink,
  createAgentEventAdapter,
  toChannelMessage,
  toAllEventsWrapper,
} from '@methodts/runtime/event-bus';

export type {
  InMemoryEventBusOptions,
  BusStats,
  PersistenceSinkOptions,
  ChannelSinkOptions,
  GenesisSinkOptions,
  GenesisPromptCallback,
  WebhookConnectorOptions,
  SessionCheckpointSinkOptions,
  PersistedSessionInput,
  SessionStatusInfo,
} from '@methodts/runtime/event-bus';

// Bridge-only (transport-bound): WebSocketSink depends on @fastify/websocket.
export { WebSocketSink } from './websocket-sink.js';
