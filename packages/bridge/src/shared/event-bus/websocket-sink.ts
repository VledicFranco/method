/**
 * WebSocketSink — Pushes RuntimeEvents to WebSocket subscribers via WsHub (PRD 026).
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

// PRD-057 / S2 §3.4 / C3: EventSink + RuntimeEvent port interfaces live in
// @method/runtime/ports. WebSocketSink stays in bridge because it depends on
// @fastify/websocket (transport-bound; S2 §5.1).
import type { EventSink, RuntimeEvent } from '@method/runtime/ports';
import type { WsHub, Topic } from '../websocket/hub.js';

// ── Domain → Topic mapping (legacy compatibility) ───────────────

const DOMAIN_TOPIC_MAP: Record<string, Topic> = {
  project: 'events',
  strategy: 'executions',
  trigger: 'triggers',
  session: 'sessions',
  build: 'builds',
};

// ── WebSocketSink ───────────────────────────────────────────────

export class WebSocketSink implements EventSink {
  readonly name = 'websocket';

  constructor(private readonly wsHub: WsHub) {}

  onEvent(event: RuntimeEvent): void {
    const topic = DOMAIN_TOPIC_MAP[event.domain];
    if (!topic) return; // Domains without a topic mapping are silently skipped

    // PRD 026 Phase 4: Send full RuntimeEvent (not just payload) so frontend
    // event store receives the unified schema with domain, type, severity, etc.
    this.wsHub.publish(topic, event, (filter) => {
      // AND all applicable filter dimensions — every specified filter must match.
      // If a filter key is present but the event lacks the corresponding field,
      // the event does not match (explicit filter = explicit exclusion).
      if (filter.project_id) {
        if (filter.project_id !== event.projectId) return false;
      }
      if (filter.session_id) {
        if (filter.session_id !== event.sessionId) return false;
      }
      if (filter.execution_id) {
        if (filter.execution_id !== String(event.payload.execution_id ?? '')) return false;
      }
      if (filter.trigger_id) {
        if (filter.trigger_id !== String(event.payload.trigger_id ?? '')) return false;
      }
      return true;
    });
  }

  onError(error: Error, event: RuntimeEvent): void {
    // WebSocket errors are non-fatal — log and continue
    console.error(`[WebSocketSink] Error dispatching ${event.type}: ${error.message}`);
  }
}
