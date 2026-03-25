import { useMemo, useCallback, useRef, useEffect } from 'react';
import { useWebSocket } from '@/shared/websocket/useWebSocket';
import { useEventStore, type BridgeEvent } from '@/shared/stores/event-store';
import type { ProjectEvent } from '@/domains/projects/types';

export interface UseEventStreamOptions {
  /** @deprecated No longer used — events are pushed via WebSocket */
  pollIntervalMs?: number;
  /** Optional project ID filter */
  projectId?: string;
  /** Enable/disable the subscription (default: true) */
  enabled?: boolean;
}

export interface UseEventStreamResult {
  events: ProjectEvent[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  cursor: string | null;
}

/**
 * Convert BridgeEvent → ProjectEvent for backward compatibility.
 * useEventStream's public API still returns ProjectEvent[].
 */
function bridgeToProjectEvent(e: BridgeEvent): ProjectEvent {
  return {
    id: e.id,
    projectId: e.projectId ?? '',
    type: e.type,
    timestamp: e.timestamp,
    metadata: (e.payload.metadata as Record<string, unknown>) ?? {},
    payload: e.payload,
  };
}

/**
 * Subscribe to project events via WebSocket.
 * Internally uses the unified event store (PRD 026 Phase 4).
 * Public API unchanged — still returns ProjectEvent[].
 */
export function useEventStream(options: UseEventStreamOptions = {}): UseEventStreamResult {
  const { projectId, enabled = true } = options;

  const wsFilter = useMemo(
    () => (projectId ? { project_id: projectId } : undefined),
    [projectId],
  );

  // Stable ref for addEvent to avoid re-creating onMessage
  const addEventRef = useRef(useEventStore.getState().addEvent);
  useEffect(() => {
    addEventRef.current = useEventStore.getState().addEvent;
  });

  const onMessage = useCallback((event: BridgeEvent) => {
    addEventRef.current(event);
  }, []);

  useWebSocket<BridgeEvent>('events', {
    filter: wsFilter,
    enabled,
    onMessage,
  });

  const connected = useEventStore((s) => s.connected);
  const events = useEventStore((s) => s.events);

  // Filter to project domain events and convert to legacy shape
  const filteredEvents = useMemo(() => {
    let projectEvents = events.filter((e) => e.domain === 'project');
    if (projectId) {
      projectEvents = projectEvents.filter((e) => e.projectId === projectId);
    }
    return projectEvents.map(bridgeToProjectEvent);
  }, [events, projectId]);

  return {
    events: filteredEvents,
    loading: !connected,
    error: null,
    hasMore: false,
    cursor: null,
  };
}
