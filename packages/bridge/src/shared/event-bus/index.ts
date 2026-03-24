/** Shared event bus module — PRD 026. */

export { InMemoryEventBus, type InMemoryEventBusOptions } from './in-memory-event-bus.js';
export { WebSocketSink } from './websocket-sink.js';
export { PersistenceSink, type PersistenceSinkOptions } from './persistence-sink.js';
export { ChannelSink, type ChannelSinkOptions, getChannelTarget } from './channel-sink.js';
export { toChannelMessage, toAllEventsWrapper } from './adapters.js';
