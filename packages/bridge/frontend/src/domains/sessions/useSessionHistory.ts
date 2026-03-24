/**
 * WS-3: Hook for browsing persisted session history per project.
 * Fetches from the /sessions/history endpoint.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';

export interface PersistedSessionSummary {
  session_id: string;
  workdir: string;
  nickname: string;
  purpose: string | null;
  mode: 'pty' | 'print';
  status: string;
  created_at: string;
  last_activity_at: string;
  prompt_count: number;
  depth: number;
  parent_session_id: string | null;
  isolation: string;
  metadata?: Record<string, unknown>;
}

export interface PersistedSessionDetail extends PersistedSessionSummary {
  transcript?: string;
}

interface HistoryListResponse {
  sessions: PersistedSessionSummary[];
  total: number;
  workdir: string | null;
}

interface ResumeResponse {
  session_id: string;
  nickname: string;
  status: string;
  mode: string;
  resumed_from: string;
}

export function useSessionHistory(workdir?: string) {
  const queryClient = useQueryClient();

  const queryKey = ['session-history', workdir ?? 'all'];

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: ({ signal }) => {
      const params = workdir ? `?workdir=${encodeURIComponent(workdir)}` : '';
      return api.get<HistoryListResponse>(`/sessions/history${params}`, signal);
    },
    refetchInterval: 30_000, // Refresh every 30s (history doesn't change rapidly)
  });

  const resumeMutation = useMutation({
    mutationFn: ({ sessionId, prompt }: { sessionId: string; prompt?: string }) =>
      api.post<ResumeResponse>(`/sessions/history/${sessionId}/resume`, {
        initial_prompt: prompt,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    sessions: data?.sessions ?? [],
    total: data?.total ?? 0,
    isLoading,
    error: error as Error | null,
    resume: resumeMutation.mutateAsync,
    isResuming: resumeMutation.isPending,
  };
}

export function useSessionHistoryDetail(sessionId: string | null) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['session-history-detail', sessionId],
    queryFn: ({ signal }) =>
      api.get<PersistedSessionDetail>(`/sessions/history/${sessionId}`, signal),
    enabled: !!sessionId,
  });

  return {
    session: data ?? null,
    isLoading,
    error: error as Error | null,
  };
}
