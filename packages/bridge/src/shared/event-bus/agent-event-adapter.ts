/**
 * AgentEvent-to-BridgeEvent Adapter — PRD 029 Phase C-2.
 *
 * Creates an onEvent callback compatible with Pacta's CreateAgentOptions.onEvent
 * that maps AgentEvent objects to BridgeEventInput and emits them to the bus.
 *
 * This bridges the Pacta agent SDK observability surface into the Universal
 * Event Bus so that agent lifecycle events appear alongside session, strategy,
 * and trigger events.
 */

import type { AgentEvent } from '@method/pacta';
import type { EventBus, BridgeEventInput, EventSeverity } from '../../ports/event-bus.js';

// ── Severity mapping ─────────────────────────────────────────────

const SEVERITY_MAP: Record<string, EventSeverity> = {
  error: 'error',
  budget_exhausted: 'error',
  budget_warning: 'warning',
};

function mapSeverity(eventType: string): EventSeverity {
  return SEVERITY_MAP[eventType] ?? 'info';
}

// ── Adapter factory ──────────────────────────────────────────────

/**
 * Create an onEvent callback that maps Pacta AgentEvents to BridgeEvents.
 *
 * @param eventBus - The Universal Event Bus to emit into.
 * @param sessionId - Bridge session ID that owns this agent.
 * @param projectId - Project ID context for the agent.
 * @returns An onEvent callback compatible with CreateAgentOptions.onEvent.
 */
export function createAgentEventAdapter(
  eventBus: EventBus,
  sessionId: string,
  projectId: string,
): (event: AgentEvent) => void {
  return (event: AgentEvent): void => {
    const bridgeEvent: BridgeEventInput = {
      version: 1,
      domain: 'agent',
      type: `agent.${event.type}`,
      severity: mapSeverity(event.type),
      sessionId,
      projectId,
      payload: {
        ...event,
        sessionId,
        projectId,
      },
      source: `bridge/agent/${sessionId}`,
    };

    eventBus.emit(bridgeEvent);
  };
}
