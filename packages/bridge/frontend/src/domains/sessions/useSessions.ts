/**
 * Reusable hook for bridge session list + mutations.
 * Extracted from Sessions.tsx for cross-page reuse.
 *
 * PRD 029 C-4: Adds stale-mode hold — when the WebSocket disconnects,
 * the last-known session list is preserved and flagged as stale. On
 * reconnection the query is invalidated to re-fetch fresh data.
 */

import { useMemo, useCallback, useEffect, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';
import { useBridgeEvents } from '@/shared/websocket/useBridgeEvents';
import { wsManager } from '@/shared/websocket/ws-manager';
import type { SessionSummary, SpawnRequest, SpawnResponse } from '@/domains/sessions/types';

export interface UseSessionsResult {
  sessions: SessionSummary[];
  activeSessions: SessionSummary[];
  deadSessions: SessionSummary[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
  kill: (sessionId: string) => void;
  spawn: (req: SpawnRequest) => Promise<SpawnResponse>;
  isSpawning: boolean;
  /** True when the WebSocket is disconnected and data may be outdated. */
  stale: boolean;
}

export function useSessions(opts?: { refetchInterval?: number }): UseSessionsResult {
  const queryClient = useQueryClient();
  const interval = opts?.refetchInterval ?? 5000;

  // ── Stale-mode hold (PRD 029 C-4) ────────────────────────────────────────
  // Track WebSocket connection state. When disconnected, mark data as stale.
  // When reconnected, clear stale flag and re-fetch.
  const [stale, setStale] = useState(!wsManager.connected);
  const wasConnectedRef = useRef(wsManager.connected);

  useEffect(() => {
    const unsub = wsManager.onConnectionChange((connected) => {
      if (connected) {
        // Reconnected — clear stale, re-fetch sessions
        setStale(false);
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
      } else {
        // Disconnected — enter stale mode, keep last-known data
        setStale(true);
      }
      wasConnectedRef.current = connected;
    });
    return unsub;
  }, [queryClient]);

  // ── BridgeEvent invalidation (PRD 026) ────────────────────────────────────
  // Subscribe to session-domain events and invalidate the sessions query on
  // any new event. The refetchInterval below serves as a fallback.
  const sessionEvents = useBridgeEvents({ domain: 'session' });

  useEffect(() => {
    if (sessionEvents.length > 0) {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    }
  }, [sessionEvents.length, queryClient]);

  const { data: sessions = [], isLoading, error } = useQuery({
    queryKey: ['sessions'],
    queryFn: ({ signal }) => api.get<SessionSummary[]>('/sessions', signal),
    refetchInterval: interval,
  });

  const killMutation = useMutation({
    mutationFn: (sessionId: string) => api.del(`/sessions/${sessionId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const spawnMutation = useMutation({
    mutationFn: (req: SpawnRequest) => api.post<SpawnResponse>('/sessions', req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const activeSessions = useMemo(
    () => sessions.filter((s) => s.status !== 'dead'),
    [sessions],
  );

  const deadSessions = useMemo(
    () => sessions.filter((s) => s.status === 'dead'),
    [sessions],
  );

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['sessions'] });
  }, [queryClient]);

  return {
    sessions,
    activeSessions,
    deadSessions,
    isLoading,
    error: error as Error | null,
    refresh,
    kill: killMutation.mutate,
    spawn: spawnMutation.mutateAsync,
    isSpawning: spawnMutation.isPending,
    stale,
  };
}
