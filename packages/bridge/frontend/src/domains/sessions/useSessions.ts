/**
 * Reusable hook for bridge session list + mutations.
 * Extracted from Sessions.tsx for cross-page reuse.
 */

import { useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';
import { useBridgeEvents } from '@/shared/websocket/useBridgeEvents';
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
}

export function useSessions(opts?: { refetchInterval?: number }): UseSessionsResult {
  const queryClient = useQueryClient();
  const interval = opts?.refetchInterval ?? 5000;

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
  };
}
