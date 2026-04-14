/**
 * EventBus — Port interface for the Universal Event Bus (PRD 026).
 *
 * The event bus is runtime-level infrastructure. Domains emit typed events
 * through the port. Consumers (WebSocket, persistence, Genesis, parent agents)
 * subscribe through the same interface. Neither producers nor consumers
 * know about each other.
 *
 * PRD-057: Moved from @method/bridge/ports/event-bus.ts. The type was
 * renamed `BridgeEvent` → `RuntimeEvent` to reflect that the bus now serves
 * multiple consumers (bridge, agent-runtime, future SLM server). Event
 * `type` strings (wire format) are unchanged.
 *
 * Design: DR-15 compliant — domains accept the port via injection.
 * The composition root (server-entry.ts in bridge) creates the bus, registers
 * sinks, and injects the bus into domains.
 */

// ── Unified event schema ────────────────────────────────────────

/**
 * Domain classification for events. Extensible — new domains can be added
 * without modifying this type. The union is a type-level hint, not a runtime enum.
 * The `(string & {})` escape hatch keeps this neutral across downstream consumers.
 */
export type EventDomain =
  | 'session'
  | 'strategy'
  | 'trigger'
  | 'project'
  | 'methodology'
  | 'system'
  | 'agent'
  | (string & {});

export type EventSeverity = 'info' | 'warning' | 'error' | 'critical';

/**
 * Canonical event shape for the entire runtime. Every domain event is expressed
 * as a RuntimeEvent. Bus assigns id, timestamp, and sequence on emit.
 *
 * Renamed from `BridgeEvent` per PRD-057 / S2 §4. A back-compat alias lives in
 * `@method/bridge/ports/event-bus.ts`.
 */
export interface RuntimeEvent {
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

  /** Which component emitted (e.g., 'bridge/sessions/pool', 'runtime/event-bus/persistence-sink'). */
  source: string;
  /** Links related events (e.g., all events from one strategy execution). */
  correlationId?: string;

  /** Originating bridge node ID (set when event is federated from another bridge). */
  sourceNodeId?: string;
  /** True if this event was received from another bridge via cluster federation. */
  federated?: boolean;
}

/**
 * Input to EventBus.emit() — bus-assigned fields (id, timestamp, sequence)
 * are omitted since the bus fills them in.
 *
 * Renamed from `BridgeEventInput` per PRD-057 / S2 §4.
 */
export type RuntimeEventInput = Omit<RuntimeEvent, 'id' | 'timestamp' | 'sequence'>;

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
  onEvent(event: RuntimeEvent): void | Promise<void>;
  onError?: (error: Error, event: RuntimeEvent) => void;
}

// ── Connector interface (PRD 026 Phase 5) ───────────────────────

/**
 * Health status for a connector.
 */
export interface ConnectorHealth {
  connected: boolean;
  lastEventAt: string | null;
  errorCount: number;
}

/**
 * An EventConnector extends EventSink with lifecycle management for
 * long-lived external connections (webhooks, Slack, external APIs).
 *
 * Connectors manage their own retry/backoff. The composition root
 * calls connect() after registration and disconnect() on shutdown.
 */
export interface EventConnector extends EventSink {
  /** Establish connection to the external system. */
  connect(): Promise<void>;
  /** Graceful teardown. */
  disconnect(): Promise<void>;
  /** Current health status. */
  health(): ConnectorHealth;
}

// ── PRD-044: Strategy gate event payload types ──────────────────

/**
 * Payload shape for domain='strategy', type='gate.awaiting_approval'.
 * Emitted by bridge/strategies when a human_approval gate fires and the
 * executor suspends waiting for a human decision.
 */
export interface StrategyGateAwaitingApprovalPayload {
  strategy_id: string;
  execution_id: string;
  gate_id: string;
  node_id: string;
  /** GlyphJS markdown to display in the dashboard (surface contract, PRD excerpt, etc.) */
  artifact_markdown: string;
  artifact_type: 'surface_record' | 'prd' | 'plan' | 'review_report' | 'custom';
  /** Milliseconds before oversight escalation fires. */
  timeout_ms: number;
}

/**
 * Payload shape for domain='strategy', type='gate.approval_response'.
 * Sent by the frontend dashboard to resume a suspended human_approval gate.
 */
export interface StrategyGateApprovalResponsePayload {
  execution_id: string;
  gate_id: string;
  decision: 'approved' | 'rejected' | 'changes_requested';
  /** Passed as retry context when decision is rejected or changes_requested. */
  feedback?: string;
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
  emit(event: RuntimeEventInput): RuntimeEvent;

  /**
   * Import a pre-existing event (e.g., from replay) without reassigning
   * id, timestamp, or sequence. Pushes to ring buffer and dispatches to
   * sinks/subscribers. Updates internal sequence counter to avoid collisions.
   */
  importEvent(event: RuntimeEvent): void;

  /** Subscribe to events matching a filter. */
  subscribe(filter: EventFilter, handler: (event: RuntimeEvent) => void): EventSubscription;

  /** Query past events from the ring buffer. */
  query(filter: EventFilter, options?: { limit?: number; since?: string }): RuntimeEvent[];

  /** Register a sink that receives all events. */
  registerSink(sink: EventSink): void;
}
