// SPDX-License-Identifier: Apache-2.0
/**
 * TraceEventBusSink — bridges pacta hierarchical TraceEvents (PRD 058)
 * onto the Universal Event Bus (RuntimeEvent, PRD 026).
 *
 * Mirrors `CognitiveEventBusSink` for the trace stream: pacta's cycle.ts +
 * tracingMiddleware emit `TraceEvent`s to any sink declaring `onEvent`;
 * this sink translates each TraceEvent into a typed RuntimeEvent on
 * domain `'trace'` so the existing bus plumbing (WebSocketSink,
 * PersistenceSink, ChannelSink) routes them without further wiring.
 *
 * The bridge composition root constructs one sink per session, optionally
 * pairs it with a per-session `TraceRingBuffer` from `@methodts/pacta` for
 * the dashboard live-stream pane, and passes both to the cognitive cycle.
 *
 * @see docs/prds/058-hierarchical-trace-observability.md (Wave 3, C-5)
 * @see runtime/src/sessions/cognitive-sink.ts (parallel design)
 */

import type {
  RuntimeEventInput,
  EventBus,
  EventSeverity,
} from '../ports/event-bus.js';
import type { TraceEvent, TraceSink, TraceRecord } from '@methodts/pacta';

// ── Context ─────────────────────────────────────────────────────

export interface TraceEventContext {
  sessionId?: string;
  projectId?: string;
  experimentId?: string;
  runId?: string;
}

// ── Sink ────────────────────────────────────────────────────────

/**
 * Adapter that translates pacta `TraceEvent`s into RuntimeEvents on the
 * Universal Event Bus. Implements `TraceSink` (consumed by pacta's cycle
 * + tracingMiddleware).
 *
 * NOT an `EventSink` — TraceSink and EventSink share the method name
 * `onEvent` with incompatible argument types (TraceEvent vs RuntimeEvent),
 * so this class is a producer onto the bus, not a consumer of it. The
 * composition root passes it to the cognitive cycle as a TraceSink; the
 * bus receives the output via `bus.emit()` calls inside `onEvent`.
 */
export class TraceEventBusSink implements TraceSink {
  readonly name = 'trace';

  private readonly bus: EventBus;
  private context: TraceEventContext;

  constructor(bus: EventBus, context: TraceEventContext = {}) {
    this.bus = bus;
    this.context = context;
  }

  /**
   * Update the ambient context attached to every emitted RuntimeEvent.
   * Call when session, experiment, or run identity changes.
   */
  setContext(context: TraceEventContext): void {
    this.context = { ...this.context, ...context };
  }

  // ── TraceSink interface ──────────────────────────────────────

  /** Legacy flat-record path. Trace records do not flow onto the bus. */
  onTrace(_record: TraceRecord): void {
    // Intentional no-op — only hierarchical TraceEvents are routed.
  }

  /** Translate a TraceEvent into a RuntimeEvent and emit. */
  onEvent(event: TraceEvent): void {
    const input = this.toRuntimeEventInput(event);
    this.bus.emit(input);
  }

  // ── Mapping logic ────────────────────────────────────────────

  toRuntimeEventInput(event: TraceEvent): RuntimeEventInput {
    const { sessionId, projectId, experimentId, runId } = this.context;
    const source = 'runtime/sessions/trace-sink';

    // Type convention: 'trace.cycle_start', 'trace.phase_end', 'trace.operation', ...
    const type = `trace.${event.kind.replace(/-/g, '_')}`;

    const payload: Record<string, unknown> = {
      eventId: event.eventId,
      cycleId: event.cycleId,
      kind: event.kind,
      name: event.name,
      timestamp: event.timestamp,
      durationMs: event.durationMs,
      phase: event.phase,
      data: event.data,
      signals: event.signals,
    };

    if (experimentId !== undefined) payload.experimentId = experimentId;
    if (runId !== undefined) payload.runId = runId;

    return {
      version: 1,
      domain: 'trace',
      type,
      severity: deriveSeverity(event),
      source,
      ...(sessionId !== undefined && { sessionId }),
      ...(projectId !== undefined && { projectId }),
      payload,
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Most trace events are 'info'. Phase or cycle ends carrying an `error`
 * field in their data are 'warning' (the cycle aborted but the trace
 * itself is fine). Future signal-severity escalation can refine this.
 */
function deriveSeverity(event: TraceEvent): EventSeverity {
  const errMaybe = event.data?.['error'];
  if (typeof errMaybe === 'string' && errMaybe.length > 0) return 'warning';
  return 'info';
}
