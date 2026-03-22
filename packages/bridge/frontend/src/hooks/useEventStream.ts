import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { ProjectEvent, EventsResponse } from '@/lib/types';

export interface UseEventStreamOptions {
  /** Poll interval in milliseconds (default: 3000) */
  pollIntervalMs?: number;
  /** Optional project ID filter */
  projectId?: string;
  /** Enable/disable polling (default: true) */
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
 * Poll events from the bridge API with cursor-based pagination.
 * Events are appended to the list as new events arrive.
 * Cursor is persisted to localStorage for session continuity.
 */
export function useEventStream(options: UseEventStreamOptions = {}): UseEventStreamResult {
  const {
    pollIntervalMs = 3000,
    projectId: filterProjectId,
    enabled = true,
  } = options;

  const [events, setEvents] = useState<ProjectEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursorKeyRef = useRef(`event-cursor-${filterProjectId || 'global'}`);

  // Load cursor from localStorage on mount
  useEffect(() => {
    const savedCursor = localStorage.getItem(cursorKeyRef.current);
    if (savedCursor) {
      setCursor(savedCursor);
    }
  }, [filterProjectId]);

  const pollEvents = useCallback(async () => {
    if (!enabled) return;

    try {
      setLoading(true);
      setError(null);

      const query = new URLSearchParams();
      if (cursor) {
        query.set('since_cursor', cursor);
      }
      if (filterProjectId) {
        query.set('project_id', filterProjectId);
      }

      const path = `/api/events?${query.toString()}`;
      const response = await api.get<EventsResponse>(path);

      // Append new events (don't replace to keep history)
      if (response.events && response.events.length > 0) {
        setEvents((prev) => [...prev, ...response.events]);
      }

      // Update cursor for next poll
      if (response.nextCursor) {
        setCursor(response.nextCursor);
        localStorage.setItem(cursorKeyRef.current, response.nextCursor);
      }

      setHasMore(response.hasMore ?? false);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to poll events';
      setError(errorMsg);
      console.error('[useEventStream]', errorMsg);
    } finally {
      setLoading(false);
    }
  }, [enabled, cursor, filterProjectId]);

  // Set up polling interval
  useEffect(() => {
    if (!enabled) return;

    // Poll immediately on mount or when dependencies change
    pollEvents();

    // Set up recurring poll
    pollTimerRef.current = setInterval(() => {
      pollEvents();
    }, pollIntervalMs);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [enabled, pollIntervalMs, pollEvents]);

  return {
    events,
    loading,
    error,
    hasMore,
    cursor,
  };
}
