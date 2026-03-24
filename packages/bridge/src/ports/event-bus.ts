/**
 * EventBus — Port interface for the Universal Event Bus (PRD 026).
 *
 * The event bus is bridge-level infrastructure. Domains emit typed events
 * through the port. Consumers (WebSocket, persistence, Genesis, parent agents)
 * subscribe through the same interface. Neither producers nor consumers
 * know about each other.
 *
 * Design: DR-15 compliant — domains accept the port via injection.
 * The composition root (server-entry.ts) creates the bus, registers sinks,
 * and injects the bus into domains.
 */

// ── Unified event schema ────────────────────────────────────────

/**
 * Domain classification for events. Extensible — new domains can be added
 * without modifying this type. The union is a type-level hint, not a runtime enum.
 */
export type EventDomain =
  | 'session'
  | 'strategy'
  | 'trigger'
  | 'project'
  | 'methodology'
  | 'system'
  | (string & {});

export type EventSeverity = 'info' | 'warning' | 'error' | 'critical';

/**
 * Canonical event shape for the entire bridge. Every domain event is expressed
 * as a BridgeEvent. Bus assigns id, timestamp, and sequence on emit.
 */
export interface BridgeEvent {
  /** UUID, globally unique. Assigned by the bus. */
  id: string;
  /** Schema version for future evolution. */
  version: 1;
  /** ISO 8601 timestamp. Assigned by the bus. */
  timestamp: string;
  /** Monotonic sequence number. Assigned by the bus. */
  sequence: number;

  /** Which domain produced this event. */
  domain: EventDomain;
  /** Domain-owned type string (e.g., 'session.spawned', 'strategy.gate_failed'). */
  type: string;
  /** Event severity level. */
  severity: EventSeverity;

  /** Which project this event belongs to (if applicable). */
  projectId?: string;
  /** Which session produced this event (if applicable). */
  sessionId?: string;

  /** Domain-specific data. */
  payload: Record<string, unknown>;

  /** Which component emitted (e.g., 'bridge/sessions/pool'). */
  source: string;
  /** Links related events (e.g., all events from one strategy execution). */
  correlationId?: string;
}

/**
 * Input to EventBus.emit() — bus-assigned fields (id, timestamp, sequence)
 * are omitted since the bus fills them in.
 */
export type BridgeEventInput = Omit<BridgeEvent, 'id' | 'timestamp' | 'sequence'>;

// ── Filter and subscription ─────────────────────────────────────

export interface EventFilter {
  domain?: EventDomain | EventDomain[];
  /** Glob-style patterns: 'session.*', 'strategy.gate_*'. */
  type?: string | string[];
  projectId?: string;
  sessionId?: string;
  severity?: EventSeverity | EventSeverity[];
}

export interface EventSubscription {
  unsubscribe: () => void;
}

// ── Sink interface ──────────────────────────────────────────────

/**
 * A sink receives all events from the bus. Sinks are registered in
 * the composition root — no domain registers sinks directly.
 */
export interface EventSink {
  name: string;
  onEvent(event: BridgeEvent): void | Promise<void>;
  onError?: (error: Error, event: BridgeEvent) => void;
}

// ── Port interface ──────────────────────────────────────────────

/**
 * Port interface for the Universal Event Bus.
 *
 * - emit(): non-blocking, bus assigns id/timestamp/sequence. No sink failure blocks emit.
 * - subscribe(): filter-based subscription for in-process consumers.
 * - query(): historical query (requires persistence sink).
 * - registerSink(): register a sink to receive all events.
 */
export interface EventBus {
  /**
   * Emit an event to all subscribers and sinks.
   * Bus assigns id, timestamp, and sequence. Non-blocking.
   */
  emit(event: BridgeEventInput): BridgeEvent;

  /** Subscribe to events matching a filter. */
  subscribe(filter: EventFilter, handler: (event: BridgeEvent) => void): EventSubscription;

  /** Query past events from the ring buffer. */
  query(filter: EventFilter, options?: { limit?: number; since?: string }): BridgeEvent[];

  /** Register a sink that receives all events. */
  registerSink(sink: EventSink): void;
}
