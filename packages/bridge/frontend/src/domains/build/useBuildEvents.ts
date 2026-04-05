/**
 * useBuildEvents — real-time WebSocket event subscription for a specific build.
 *
 * Subscribes to bridge events on the 'build' domain via useBridgeEvents,
 * filters for the selected buildId, and converts incoming events into
 * ConversationMessage objects that the ConversationPanel can render.
 *
 * Supported event types:
 *   - build.agent_message  → agent message in conversation
 *   - build.gate_waiting   → system message + gate type for action buttons
 *   - build.gate_resolved  → system message indicating gate resolution
 *   - build.phase_started  → system message for phase transition
 *   - build.phase_completed → system message for phase completion
 *
 * @see PRD 047 §Dashboard Architecture — Conversation Panel (Feature 2)
 */

import { useMemo } from 'react';
import { useBridgeEvents } from '@/shared/websocket/useBridgeEvents';
import type { BridgeEvent } from '@/shared/stores/event-store';
import type { ConversationMessage, GateType } from './types';

// ── Event → Message conversion ─────────────────────────────────

/** Formats an ISO timestamp to HH:MM:SS for display consistency with mock data. */
function formatTimestamp(isoTimestamp: string): string {
  try {
    const d = new Date(isoTimestamp);
    if (isNaN(d.getTime())) return isoTimestamp;
    return d.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoTimestamp;
  }
}

/** Convert a BridgeEvent into a ConversationMessage (or null if not mappable). */
function eventToMessage(event: BridgeEvent): ConversationMessage | null {
  const timestamp = formatTimestamp(event.timestamp);
  const payload = event.payload ?? {};

  switch (event.type) {
    case 'build.agent_message':
      return {
        id: `ws-${event.id}`,
        sender: 'agent',
        content: (payload.content as string) ?? (payload.message as string) ?? '',
        timestamp,
        replyTo: (payload.replyTo as string) ?? undefined,
        card: payload.card as ConversationMessage['card'],
      };

    case 'build.gate_waiting':
      return {
        id: `ws-${event.id}`,
        sender: 'system',
        content: `Gate waiting: ${(payload.gate as string) ?? (payload.detail as string) ?? event.type} — awaiting human input`,
        timestamp,
      };

    case 'build.gate_resolved':
      return {
        id: `ws-${event.id}`,
        sender: 'system',
        content: `Gate resolved: ${(payload.gate as string) ?? (payload.detail as string) ?? 'gate passed'}`,
        timestamp,
      };

    case 'build.phase_started':
      return {
        id: `ws-${event.id}`,
        sender: 'system',
        content: `Phase started: ${(payload.phase as string) ?? (payload.target as string) ?? 'unknown'} — ${(payload.detail as string) ?? ''}`.trimEnd(),
        timestamp,
      };

    case 'build.phase_completed':
      return {
        id: `ws-${event.id}`,
        sender: 'system',
        content: `Phase completed: ${(payload.phase as string) ?? (payload.target as string) ?? 'unknown'} — ${(payload.detail as string) ?? ''}`.trimEnd(),
        timestamp,
      };

    default:
      return null;
  }
}

// ── Hook result ────────────────────────────────────────────────

export interface UseBuildEventsResult {
  /** Live conversation messages converted from WebSocket events. */
  messages: ConversationMessage[];
  /** Active gate type from the most recent gate_waiting event (cleared on gate_resolved). */
  liveGate: GateType | null;
}

// ── Hook ───────────────────────────────────────────────────────

/**
 * Subscribe to real-time build events and produce conversation messages.
 * Uses useBridgeEvents internally for the WebSocket subscription.
 *
 * @param buildId — the build to filter events for (null disables subscription)
 */
export function useBuildEvents(buildId: string | null): UseBuildEventsResult {
  // Subscribe to all build-domain events via useBridgeEvents (PRD 026)
  const events = useBridgeEvents({ domain: 'build' });

  // Filter events for the selected build and convert to messages
  const { messages, liveGate } = useMemo(() => {
    if (!buildId) return { messages: [] as ConversationMessage[], liveGate: null as GateType | null };

    const msgs: ConversationMessage[] = [];
    let gate: GateType | null = null;

    for (const event of events) {
      // Filter: only events for this build (check payload.buildId or correlationId)
      const eventBuildId =
        (event.payload?.buildId as string) ??
        (event.correlationId as string) ??
        undefined;

      if (eventBuildId && eventBuildId !== buildId) continue;

      // Track gate state
      if (event.type === 'build.gate_waiting') {
        gate = ((event.payload?.gate as string) ?? null) as GateType | null;
      } else if (event.type === 'build.gate_resolved') {
        gate = null;
      }

      // Convert to message
      const msg = eventToMessage(event);
      if (msg) {
        msgs.push(msg);
      }
    }

    return { messages: msgs, liveGate: gate };
  }, [buildId, events]);

  return { messages, liveGate };
}
