/**
 * useBridgeEvents — PRD 026 Phase 4.
 *
 * Subscribe to bridge events from any domain via WebSocket.
 * Any page can use this hook to receive real-time events filtered
 * by domain, type, project, or session.
 *
 * Usage:
 *   const events = useBridgeEvents({ domain: 'strategy' });
 *   const errors = useBridgeEvents({ domain: 'session', severity: ['error', 'critical'] });
 */

import { useMemo, useCallback, useRef, useEffect } from 'react';
import { useWebSocket } from '@/shared/websocket/useWebSocket';
import {
  useEventStore,
  type BridgeEvent,
  type BridgeEventFilter,
  type EventSeverity,
} from '@/shared/stores/event-store';

// ── Domain → WebSocket topic mapping ────────────────────────────

const DOMAIN_TOPIC_MAP: Record<string, string> = {
  project: 'events',
  strategy: 'executions',
  trigger: 'triggers',
  session: 'sessions',
};

function domainToTopic(domain?: string): string {
  if (!domain) return 'events'; // Default: project events
  return DOMAIN_TOPIC_MAP[domain] ?? 'events';
}

// ── Filter matching ─────────────────────────────────────────────

function matchesFilter(event: BridgeEvent, filter: BridgeEventFilter): boolean {
  if (filter.domain && event.domain !== filter.domain) return false;

  if (filter.type) {
    if (filter.type.includes('*')) {
      const pattern = new RegExp(
        '^' + filter.type.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
      );
      if (!pattern.test(event.type)) return false;
    } else if (event.type !== filter.type) {
      return false;
    }
  }

  if (filter.projectId && event.projectId !== filter.projectId) return false;
  if (filter.sessionId && event.sessionId !== filter.sessionId) return false;

  if (filter.severity) {
    const severities = Array.isArray(filter.severity)
      ? filter.severity
      : [filter.severity];
    if (!severities.includes(event.severity as EventSeverity)) return false;
  }

  return true;
}

// ── Hook ────────────────────────────────────────────────────────

export function useBridgeEvents(filter: BridgeEventFilter = {}): BridgeEvent[] {
  // Stabilize filter reference to avoid re-subscribing on every render
  const filterJson = JSON.stringify(filter);
  const stableFilter: BridgeEventFilter = useMemo(() => JSON.parse(filterJson), [filterJson]);

  const topic = useMemo(() => domainToTopic(stableFilter.domain), [stableFilter.domain]);

  // Build server-side filter for WebSocket subscription
  const wsFilter = useMemo(() => {
    const f: Record<string, string> = {};
    if (stableFilter.projectId) f.project_id = stableFilter.projectId;
    if (stableFilter.sessionId) f.session_id = stableFilter.sessionId;
    return Object.keys(f).length > 0 ? f : undefined;
  }, [stableFilter.projectId, stableFilter.sessionId]);

  // Stable addEvent ref to avoid re-creating the onMessage callback
  const addEventRef = useRef(useEventStore.getState().addEvent);
  useEffect(() => {
    addEventRef.current = useEventStore.getState().addEvent;
  });

  const onMessage = useCallback((data: BridgeEvent) => {
    addEventRef.current(data);
  }, []);

  useWebSocket<BridgeEvent>(topic, {
    filter: wsFilter,
    enabled: true,
    onMessage,
  });

  // Select matching events from store — useMemo ensures we only filter
  // when the events array reference changes (new event added).
  const events = useEventStore((s) => s.events);

  return useMemo(
    () => events.filter((e) => matchesFilter(e, stableFilter)),
    [events, stableFilter],
  );
}
