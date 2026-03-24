/**
 * WebSocketSink — Pushes BridgeEvents to WebSocket subscribers via WsHub (PRD 026).
 *
 * Replaces the ad-hoc wsHub.publish() calls in server-entry.ts. Maps event
 * domains to WebSocket topics for backward compatibility during migration:
 *   - domain 'project'     → topic 'events'
 *   - domain 'strategy'    → topic 'executions'
 *   - domain 'trigger'     → topic 'triggers'
 *   - domain 'session'     → topic 'sessions'
 *
 * New clients can subscribe by domain directly once frontend migrates to
 * the unified event store (PRD 026 Phase 4).
 */

import type { EventSink, BridgeEvent } from '../../ports/event-bus.js';
import type { WsHub, Topic } from '../websocket/hub.js';

// ── Domain → Topic mapping (legacy compatibility) ───────────────

const DOMAIN_TOPIC_MAP: Record<string, Topic> = {
  project: 'events',
  strategy: 'executions',
  trigger: 'triggers',
  session: 'sessions',
};

// ── WebSocketSink ───────────────────────────────────────────────

export class WebSocketSink implements EventSink {
  readonly name = 'websocket';

  constructor(private readonly wsHub: WsHub) {}

  onEvent(event: BridgeEvent): void {
    const topic = DOMAIN_TOPIC_MAP[event.domain];
    if (!topic) return; // Domains without a topic mapping are silently skipped

    this.wsHub.publish(topic, event.payload, (filter) => {
      // Match on projectId if the client subscribed with a project_id filter
      if (filter.project_id && event.projectId) {
        return filter.project_id === event.projectId;
      }
      // Match on sessionId if the client subscribed with a session_id filter
      if (filter.session_id && event.sessionId) {
        return filter.session_id === event.sessionId;
      }
      // Match on execution_id for strategy events
      if (filter.execution_id && event.payload.execution_id) {
        return filter.execution_id === event.payload.execution_id;
      }
      // Match on trigger_id for trigger events
      if (filter.trigger_id && event.payload.trigger_id) {
        return filter.trigger_id === event.payload.trigger_id;
      }
      // No filter → send to all subscribers of this topic
      return true;
    });
  }

  onError(error: Error, event: BridgeEvent): void {
    // WebSocket errors are non-fatal — log and continue
    console.error(`[WebSocketSink] Error dispatching ${event.type}: ${error.message}`);
  }
}
