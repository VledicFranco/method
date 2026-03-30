/**
 * CognitiveSink — bridges the pacta cognitive algebra (CognitiveEvent) to the
 * Universal Event Bus (BridgeEvent, PRD 026).
 *
 * The sink has two responsibilities:
 *   1. Expose a handle(event: CognitiveEvent) method that cognitive-provider.ts
 *      calls instead of emitting ad-hoc StreamEvents. The sink translates each
 *      of the 9 CognitiveEvent algebra types into a typed BridgeEvent and emits
 *      it on the injected EventBus.
 *   2. Implement EventSink so it can optionally be registered with the bus by the
 *      composition root (server-entry.ts) for passthrough or fan-out use.
 *
 * Severity mapping:
 *   info     — module_step, monitoring_signal, control_directive, workspace_write, cycle_phase
 *   warning  — control_policy_violation, workspace_eviction, learn_failed
 *   error    — cycle_aborted
 *
 * BridgeEvent shape produced:
 *   domain   = 'cognitive'
 *   type     = 'cognitive.{variant}'   (colon replaced with dot, e.g. 'cognitive.module_step')
 *   payload  = full CognitiveEvent data + optional experimentId, runId, cycleNumber fields
 *   source   = 'bridge/sessions/cognitive-sink'
 */

import type { BridgeEvent, BridgeEventInput, EventBus, EventSink } from '../../ports/event-bus.js';
import type { CognitiveEvent } from '@method/pacta';

// ── Context fields forwarded per-event (optional) ───────────────

export interface CognitiveEventContext {
  sessionId?: string;
  projectId?: string;
  experimentId?: string;
  runId?: string;
}

// ── CognitiveSink ────────────────────────────────────────────────

/**
 * Adapter that translates typed CognitiveEvents from the pacta algebra
 * into BridgeEvents on the Universal Event Bus.
 *
 * Constructor-injected EventBus is the only hard dependency (port pattern, DR-15).
 */
export class CognitiveSink implements EventSink {
  readonly name = 'cognitive';

  private readonly bus: EventBus;
  private context: CognitiveEventContext;

  constructor(bus: EventBus, context: CognitiveEventContext = {}) {
    this.bus = bus;
    this.context = context;
  }

  // ── Context mutation ─────────────────────────────────────────

  /**
   * Update the ambient context attached to every emitted BridgeEvent.
   * Call when session, experiment, or run identity changes.
   */
  setContext(context: CognitiveEventContext): void {
    this.context = { ...this.context, ...context };
  }

  // ── Primary entry point ──────────────────────────────────────

  /**
   * Translate a CognitiveEvent into a BridgeEvent and emit it on the bus.
   * This is the method cognitive-provider.ts calls — one call per algebra event.
   */
  handle(event: CognitiveEvent): void {
    const input = this.toBridgeEventInput(event);
    this.bus.emit(input);
  }

  // ── EventSink interface (passthrough / fan-out) ───────────────

  /**
   * EventSink.onEvent — receives BridgeEvents already on the bus.
   * Used when this sink is registered in the composition root for passthrough.
   * Filters to domain='cognitive' and re-emits (no-op for other domains).
   */
  onEvent(_event: BridgeEvent): void {
    // No-op: CognitiveSink is a producer, not a consumer. The composition root
    // may register it as a sink for structural completeness, but this path is
    // intentionally inert to avoid double-emission loops.
  }

  onError(error: Error, event: BridgeEvent): void {
    console.error(`[cognitive-sink] Error processing event ${event.id}:`, error.message);
  }

  // ── Mapping logic ────────────────────────────────────────────

  /**
   * Map a CognitiveEvent to a BridgeEventInput, deriving domain, type, severity,
   * and payload from the algebra discriminant.
   */
  toBridgeEventInput(event: CognitiveEvent): BridgeEventInput {
    const { sessionId, projectId, experimentId, runId } = this.context;
    const source = 'bridge/sessions/cognitive-sink';

    // Strip 'cognitive:' prefix and replace with dot form for bridge type convention.
    // e.g. 'cognitive:module_step' → 'cognitive.module_step'
    const type = event.type.replace(':', '.');

    const basePayload: Record<string, unknown> = {
      ...(event as unknown as Record<string, unknown>),
    };

    // Forward optional ambient context fields when present
    if (experimentId !== undefined) basePayload.experimentId = experimentId;
    if (runId !== undefined) basePayload.runId = runId;

    // cycleNumber is present on several event types — surface it at payload top-level
    // for consumers that want to filter/group by cycle without parsing the full payload.
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
}

// ── Helpers ────────────────────────────────────────────────────

/**
 * Derive BridgeEvent severity from the CognitiveEvent variant.
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
