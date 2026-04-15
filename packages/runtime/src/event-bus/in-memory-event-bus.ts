/**
 * InMemoryEventBus — Production implementation of the EventBus port (PRD 026).
 *
 * Uses a ring buffer with configurable capacity (default 10,000 events).
 * Oldest events are evicted on overflow. Sinks receive events asynchronously
 * via direct dispatch — no sink failure blocks emit().
 */

import { randomUUID } from 'node:crypto';
import type {
  EventBus,
  EventSink,
  EventConnector,
  ConnectorHealth,
  EventFilter,
  EventSubscription,
  RuntimeEvent,
  RuntimeEventInput,
  EventDomain,
  EventSeverity,
} from '../ports/event-bus.js';

// ── Filter matching ─────────────────────────────────────────────

/**
 * Convert a simple glob pattern (e.g., 'session.*', 'strategy.gate_*')
 * to a RegExp. Only supports '*' as wildcard.
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function matchesFilter(event: RuntimeEvent, filter: EventFilter): boolean {
  // Domain filter
  if (filter.domain !== undefined) {
    const domains = Array.isArray(filter.domain) ? filter.domain : [filter.domain];
    if (!domains.includes(event.domain as EventDomain)) return false;
  }

  // Type filter (supports glob patterns)
  if (filter.type !== undefined) {
    const types = Array.isArray(filter.type) ? filter.type : [filter.type];
    const matched = types.some(pattern => {
      if (pattern.includes('*')) {
        return globToRegex(pattern).test(event.type);
      }
      return pattern === event.type;
    });
    if (!matched) return false;
  }

  // Project filter
  if (filter.projectId !== undefined && event.projectId !== filter.projectId) {
    return false;
  }

  // Session filter
  if (filter.sessionId !== undefined && event.sessionId !== filter.sessionId) {
    return false;
  }

  // Severity filter
  if (filter.severity !== undefined) {
    const severities = Array.isArray(filter.severity) ? filter.severity : [filter.severity];
    if (!severities.includes(event.severity as EventSeverity)) return false;
  }

  return true;
}

// ── Subscriber tracking ─────────────────────────────────────────

interface Subscriber {
  id: number;
  filter: EventFilter;
  handler: (event: RuntimeEvent) => void;
}

// ── Ring buffer ─────────────────────────────────────────────────

class EventRingBuffer {
  private buf: (RuntimeEvent | undefined)[];
  private head = 0;
  private count = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    if (capacity < 1) throw new Error(`EventRingBuffer capacity must be >= 1, got ${capacity}`);
    this.capacity = capacity;
    this.buf = new Array(capacity);
  }

  get length(): number { return this.count; }

  push(event: RuntimeEvent): void {
    const writeIdx = (this.head + this.count) % this.capacity;
    this.buf[writeIdx] = event;
    if (this.count === this.capacity) {
      this.head = (this.head + 1) % this.capacity;
    } else {
      this.count++;
    }
  }

  /** Return events matching a filter, oldest first. */
  query(filter: EventFilter, options?: { limit?: number; since?: string }): RuntimeEvent[] {
    const result: RuntimeEvent[] = [];
    const limit = options?.limit ?? this.count;
    const sinceTime = options?.since ? new Date(options.since).getTime() : 0;

    for (let i = 0; i < this.count; i++) {
      const event = this.buf[(this.head + i) % this.capacity]!;

      // Since filter: skip events before the timestamp
      if (sinceTime > 0 && new Date(event.timestamp).getTime() <= sinceTime) {
        continue;
      }

      if (matchesFilter(event, filter)) {
        result.push(event);
        if (result.length >= limit) break;
      }
    }

    return result;
  }
}

// ── InMemoryEventBus ────────────────────────────────────────────

const DEFAULT_CAPACITY = 10_000;
const MAX_PAYLOAD_SIZE = 65_536; // 64KB

export interface InMemoryEventBusOptions {
  /** Ring buffer capacity. Default: 10,000 events. */
  capacity?: number;
}

export interface BusStats {
  /** Total events emitted via emit(). */
  totalEmitted: number;
  /** Total events imported via importEvent(). */
  totalImported: number;
  /** Current ring buffer occupancy. */
  bufferSize: number;
  /** Ring buffer capacity. */
  bufferCapacity: number;
  /** Number of registered sinks. */
  sinkCount: number;
  /** Number of active subscribers. */
  subscriberCount: number;
}

export class InMemoryEventBus implements EventBus {
  private readonly buffer: EventRingBuffer;
  private readonly capacity: number;
  private readonly sinks: EventSink[] = [];
  private readonly subscribers: Subscriber[] = [];
  private sequence = 0;
  private nextSubscriberId = 1;
  private _totalEmitted = 0;
  private _totalImported = 0;

  constructor(options?: InMemoryEventBusOptions) {
    this.capacity = options?.capacity ?? DEFAULT_CAPACITY;
    this.buffer = new EventRingBuffer(this.capacity);
  }

  emit(input: RuntimeEventInput): RuntimeEvent {
    // Enforce max payload size
    const payloadStr = JSON.stringify(input.payload);
    if (payloadStr.length > MAX_PAYLOAD_SIZE) {
      // Emit a system error event about the oversized payload, then reject
      const errorEvent: RuntimeEvent = {
        id: randomUUID(),
        version: 1,
        timestamp: new Date().toISOString(),
        sequence: ++this.sequence,
        domain: 'system',
        type: 'system.bus_error',
        severity: 'error',
        payload: {
          error: 'payload_too_large',
          original_type: input.type,
          size: payloadStr.length,
          max: MAX_PAYLOAD_SIZE,
        },
        source: 'runtime/event-bus/in-memory',
      };
      this.buffer.push(errorEvent);
      this.dispatch(errorEvent);
      return errorEvent;
    }

    const event: RuntimeEvent = {
      ...input,
      id: randomUUID(),
      version: 1,
      timestamp: new Date().toISOString(),
      sequence: ++this.sequence,
    };

    this._totalEmitted++;

    // Store in ring buffer
    this.buffer.push(event);

    // Dispatch to sinks and subscribers
    this.dispatch(event);

    return event;
  }

  subscribe(filter: EventFilter, handler: (event: RuntimeEvent) => void): EventSubscription {
    const id = this.nextSubscriberId++;
    const subscriber: Subscriber = { id, filter, handler };
    this.subscribers.push(subscriber);

    return {
      unsubscribe: () => {
        const idx = this.subscribers.findIndex(s => s.id === id);
        if (idx !== -1) this.subscribers.splice(idx, 1);
      },
    };
  }

  query(filter: EventFilter, options?: { limit?: number; since?: string }): RuntimeEvent[] {
    return this.buffer.query(filter, options);
  }

  /** Get current bus statistics for monitoring/system.bus_stats emission. */
  getStats(): BusStats {
    return {
      totalEmitted: this._totalEmitted,
      totalImported: this._totalImported,
      bufferSize: this.buffer.length,
      bufferCapacity: this.capacity,
      sinkCount: this.sinks.length,
      subscriberCount: this.subscribers.length,
    };
  }

  importEvent(event: RuntimeEvent): void {
    // Update sequence to prevent collisions with future emits
    if (event.sequence > this.sequence) {
      this.sequence = event.sequence;
    }

    this._totalImported++;

    // Store in ring buffer
    this.buffer.push(event);

    // Dispatch to sinks and subscribers
    this.dispatch(event);
  }

  registerSink(sink: EventSink): void {
    this.sinks.push(sink);
  }

  // ── Connector lifecycle (PRD 026 Phase 5) ──────────────────

  /** Check if a sink implements the EventConnector interface. */
  private isConnector(sink: EventSink): sink is EventConnector {
    return 'connect' in sink && 'disconnect' in sink && 'health' in sink;
  }

  /** Connect all registered connectors. Call after all sinks registered. */
  async connectAll(): Promise<void> {
    for (const sink of this.sinks) {
      if (this.isConnector(sink)) {
        try {
          await sink.connect();
        } catch (err) {
          console.error(`[event-bus] Connector ${sink.name} failed to connect:`, (err as Error).message);
        }
      }
    }
  }

  /** Disconnect all registered connectors. Call on shutdown. */
  async disconnectAll(): Promise<void> {
    for (const sink of this.sinks) {
      if (this.isConnector(sink)) {
        try {
          await sink.disconnect();
        } catch (err) {
          console.error(`[event-bus] Connector ${sink.name} failed to disconnect:`, (err as Error).message);
        }
      }
    }
  }

  /** Get health status of all registered connectors. */
  connectorHealth(): Array<{ name: string; health: ConnectorHealth }> {
    const results: Array<{ name: string; health: ConnectorHealth }> = [];
    for (const sink of this.sinks) {
      if (this.isConnector(sink)) {
        results.push({ name: sink.name, health: sink.health() });
      }
    }
    return results;
  }

  // ── Internal dispatch ───────────────────────────────────────

  private dispatch(event: RuntimeEvent): void {
    // Snapshot arrays to guard against mutation during dispatch
    // (e.g., a handler calling unsubscribe or registerSink)
    const sinks = [...this.sinks];
    const subscribers = [...this.subscribers];

    // Dispatch to sinks (fire-and-forget)
    for (const sink of sinks) {
      try {
        const result = sink.onEvent(event);
        // Handle async sinks — catch errors without blocking
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch(err => {
            if (sink.onError) {
              sink.onError(err as Error, event);
            }
          });
        }
      } catch (err) {
        if (sink.onError) {
          try { sink.onError(err as Error, event); } catch { /* double fault — swallow */ }
        }
      }
    }

    // Dispatch to subscribers (filter-matched, synchronous)
    for (const sub of subscribers) {
      if (matchesFilter(event, sub.filter)) {
        try {
          sub.handler(event);
        } catch {
          // Subscriber errors are non-fatal
        }
      }
    }
  }
}
