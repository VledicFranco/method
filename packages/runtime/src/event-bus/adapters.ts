/**
 * PRD 026 Phase 2: MCP Adapter Layer
 *
 * Translates RuntimeEvent → legacy channel/event shapes so that
 * bridge_read_events and bridge_all_events MCP tools return
 * backward-compatible JSON. Used during the transition from channels
 * to bus-native reads (Phase 3).
 */

import type { RuntimeEvent } from '../ports/event-bus.js';

/**
 * Convert a RuntimeEvent to the legacy ChannelMessage shape used by
 * `bridge_read_events` (session-scoped channel reads).
 *
 * Legacy shape:
 * ```json
 * { "sequence": N, "timestamp": "...", "sender": "...", "type": "...", "content": {...} }
 * ```
 */
export function toChannelMessage(event: RuntimeEvent): {
  sequence: number;
  timestamp: string;
  sender: string;
  type: string;
  content: Record<string, unknown>;
} {
  return {
    sequence: event.sequence,
    timestamp: event.timestamp,
    sender: event.source,
    type: event.type,
    content: event.payload,
  };
}

/**
 * Convert an array of RuntimeEvents to the legacy all-events wrapper shape
 * used by `bridge_all_events` (cross-session event polling).
 *
 * Legacy shape:
 * ```json
 * {
 *   "messages": [...],
 *   "last_sequence": N,
 *   "has_more": false
 * }
 * ```
 */
export function toAllEventsWrapper(
  events: RuntimeEvent[],
  hasMore = false,
): {
  messages: Array<{
    sequence: number;
    timestamp: string;
    sender: string;
    type: string;
    content: Record<string, unknown>;
  }>;
  last_sequence: number;
  has_more: boolean;
} {
  const messages = events.map(toChannelMessage);
  return {
    messages,
    last_sequence: messages.length > 0
      ? messages[messages.length - 1].sequence
      : 0,
    has_more: hasMore,
  };
}
