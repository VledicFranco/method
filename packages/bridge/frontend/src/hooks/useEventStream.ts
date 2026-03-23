import { useMemo } from 'react';
import { useWebSocket } from './useWebSocket';
import { useWsStore } from '@/stores/ws-store';
import type { ProjectEvent } from '@/lib/types';

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
 * Subscribe to project events via WebSocket.
 * Events are pushed by the server and accumulated in the Zustand store.
 * Maintains the same interface as the previous polling implementation.
 */
export function useEventStream(options: UseEventStreamOptions = {}): UseEventStreamResult {
  const { projectId, enabled = true } = options;

  const filter = useMemo(
    () => (projectId ? { project_id: projectId } : undefined),
    [projectId],
  );

  const appendEvents = useWsStore((s) => s.appendEvents);

  useWebSocket<ProjectEvent>('events', {
    filter,
    enabled,
    onMessage: (event) => {
      appendEvents([event]);
    },
  });

  const { connected, events } = useWsStore((s) => ({
    connected: s.connected,
    events: s.events,
  }));

  const filteredEvents = useMemo(
    () => (projectId ? events.filter((e) => e.projectId === projectId) : events),
    [events, projectId],
  );

  return {
    events: filteredEvents,
    loading: !connected,
    error: null,
    hasMore: false,
    cursor: null,
  };
}
