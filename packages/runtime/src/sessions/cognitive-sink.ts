/**
 * CognitiveEventBusSink — bridges the pacta cognitive algebra (CognitiveEvent)
 * to the Universal Event Bus (RuntimeEvent, PRD 026).
 *
 * PRD-057 / S2 §14 Q6 / C5: the class is named `CognitiveEventBusSink` to
 * disambiguate from `@method/pacta`'s `CognitiveEvent` producer concept. The
 * shorter legacy name `CognitiveSink` is aliased for back-compat in
 * `@method/bridge/domains/sessions/cognitive-sink.ts` until C7 cleanup.
 *
 * The sink has two responsibilities:
 *   1. Expose a handle(event: CognitiveEvent) method that cognitive-provider.ts
 *      calls instead of emitting ad-hoc StreamEvents. The sink translates each
 *      of the 9 CognitiveEvent algebra types into a typed RuntimeEvent and
 *      emits it on the injected EventBus.
 *   2. Implement EventSink so it can optionally be registered with the bus by
 *      the composition root (server-entry.ts) for passthrough or fan-out use.
 *
 * Severity mapping:
 *   info     — module_step, monitoring_signal, control_directive, workspace_write, cycle_phase
 *   warning  — control_policy_violation, workspace_eviction, learn_failed
 *   error    — cycle_aborted
 *
 * RuntimeEvent shape produced:
 *   domain   = 'cognitive'
 *   type     = 'cognitive.{variant}'   (colon replaced with dot, e.g. 'cognitive.module_step')
 *   payload  = full CognitiveEvent data + optional experimentId, runId, cycleNumber fields
 *   source   = 'runtime/sessions/cognitive-sink'
 */

import type { RuntimeEvent, RuntimeEventInput, EventBus, EventSink } from '../ports/event-bus.js';
import type { CognitiveEvent } from '@method/pacta';

// ── Context fields forwarded per-event (optional) ───────────────

export interface CognitiveEventContext {
  sessionId?: string;
  projectId?: string;
  experimentId?: string;
  runId?: string;
}

// ── CognitiveEventBusSink ───────────────────────────────────────

/**
 * Adapter that translates typed CognitiveEvents from the pacta algebra
 * into RuntimeEvents on the Universal Event Bus.
 *
 * Constructor-injected EventBus is the only hard dependency (port pattern, DR-15).
 */
export class CognitiveEventBusSink implements EventSink {
  readonly name = 'cognitive';

  private readonly bus: EventBus;
  private context: CognitiveEventContext;

  constructor(bus: EventBus, context: CognitiveEventContext = {}) {
    this.bus = bus;
    this.context = context;
  }

  // ── Context mutation ─────────────────────────────────────────

  /**
   * Update the ambient context attached to every emitted RuntimeEvent.
   * Call when session, experiment, or run identity changes.
   */
  setContext(context: CognitiveEventContext): void {
    this.context = { ...this.context, ...context };
  }

  // ── Primary entry point ──────────────────────────────────────

  /**
   * Translate a CognitiveEvent into a RuntimeEvent and emit it on the bus.
   * This is the method cognitive-provider.ts calls — one call per algebra event.
   */
  handle(event: CognitiveEvent): void {
    const input = this.toRuntimeEventInput(event);
    this.bus.emit(input);
  }

  // ── EventSink interface (passthrough / fan-out) ───────────────

  /**
   * EventSink.onEvent — receives RuntimeEvents already on the bus.
   * Used when this sink is registered in the composition root for passthrough.
   * Filters to domain='cognitive' and re-emits (no-op for other domains).
   */
  onEvent(_event: RuntimeEvent): void {
    // No-op: CognitiveEventBusSink is a producer, not a consumer. The composition
    // root may register it as a sink for structural completeness, but this path
    // is intentionally inert to avoid double-emission loops.
  }

  onError(error: Error, event: RuntimeEvent): void {
    console.error(`[cognitive-sink] Error processing event ${event.id}:`, error.message);
  }

  // ── Mapping logic ────────────────────────────────────────────

  /**
   * Map a CognitiveEvent to a RuntimeEventInput, deriving domain, type,
   * severity, and payload from the algebra discriminant.
   */
  toRuntimeEventInput(event: CognitiveEvent): RuntimeEventInput {
    const { sessionId, projectId, experimentId, runId } = this.context;
    const source = 'runtime/sessions/cognitive-sink';

    // Strip 'cognitive:' prefix and replace with dot form for runtime type
    // convention: e.g. 'cognitive:module_step' → 'cognitive.module_step'.
    const type = event.type.replace(':', '.');

    const basePayload: Record<string, unknown> = {
      ...(event as unknown as Record<string, unknown>),
    };

    // Forward optional ambient context fields when present.
    if (experimentId !== undefined) basePayload.experimentId = experimentId;
    if (runId !== undefined) basePayload.runId = runId;

    // cycleNumber is present on several event types — surface it at payload
    // top-level for consumers that want to filter/group by cycle without
    // parsing the full payload.
    const cycleNumber = extractCycleNumber(event);
    if (cycleNumber !== undefined) basePayload.cycleNumber = cycleNumber;

    return {
      version: 1,
      domain: 'cognitive',
      type,
      severity: deriveSeverity(event),
      source,
      ...(sessionId !== undefined && { sessionId }),
      ...(projectId !== undefined && { projectId }),
      payload: basePayload,
    };
  }

  /** @deprecated Alias retained for migration. Prefer `toRuntimeEventInput`. */
  toBridgeEventInput(event: CognitiveEvent): RuntimeEventInput {
    return this.toRuntimeEventInput(event);
  }
}

// ── Helpers ────────────────────────────────────────────────────

/**
 * Derive RuntimeEvent severity from the CognitiveEvent variant.
 *
 * info    — normal execution signals (steps, directives, writes, phases, monitoring)
 * warning — anomalies that may require attention (policy violation, eviction, LEARN failure)
 * error   — unrecoverable failures that halt the cycle (cycle aborted)
 */
function deriveSeverity(event: CognitiveEvent): 'info' | 'warning' | 'error' {
  switch (event.type) {
    case 'cognitive:module_step':         return 'info';
    case 'cognitive:monitoring_signal':   return 'info';
    case 'cognitive:control_directive':   return 'info';
    case 'cognitive:workspace_write':     return 'info';
    case 'cognitive:cycle_phase':         return 'info';
    case 'cognitive:control_policy_violation': return 'warning';
    case 'cognitive:workspace_eviction':  return 'warning';
    case 'cognitive:learn_failed':        return 'warning';
    case 'cognitive:cycle_aborted':       return 'error';
    default:
      // Exhaustive check — TypeScript narrows to never here.
      // Runtime fallback for forward-compatibility with new event types.
      return 'info';
  }
}

/**
 * Extract cycleNumber from events that carry it, returning undefined otherwise.
 */
function extractCycleNumber(event: CognitiveEvent): number | undefined {
  switch (event.type) {
    case 'cognitive:cycle_phase':    return event.cycleNumber;
    case 'cognitive:learn_failed':   return event.cycleNumber;
    case 'cognitive:cycle_aborted':  return event.cycleNumber;
    default:
      return undefined;
  }
}
