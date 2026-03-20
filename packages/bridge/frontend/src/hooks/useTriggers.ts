/**
 * PRD 019.4: TanStack Query hooks for trigger data fetching and mutations.
 *
 * Provides polling-based data fetching (10s interval) for triggers and history,
 * plus mutations for enable/disable, pause/resume, and reload.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  TriggerListResponse,
  TriggerHistoryResponse,
  TriggerDetailResponse,
  TriggerReloadResponse,
  TriggerActionResponse,
} from '@/lib/types';

const POLL_INTERVAL = 10_000; // 10 seconds

// ── Query Keys ──

export const triggerKeys = {
  all: ['triggers'] as const,
  list: () => [...triggerKeys.all, 'list'] as const,
  detail: (id: string) => [...triggerKeys.all, 'detail', id] as const,
  history: (triggerId?: string) => [...triggerKeys.all, 'history', triggerId ?? 'all'] as const,
};

// ── Queries ──

/** Fetch all registered triggers with status, stats, and config */
export function useTriggerList() {
  return useQuery({
    queryKey: triggerKeys.list(),
    queryFn: ({ signal }) => api.get<TriggerListResponse>('/triggers', signal),
    refetchInterval: POLL_INTERVAL,
    staleTime: 5_000,
  });
}

/** Fetch trigger fire history (all or filtered by trigger ID) */
export function useTriggerHistory(triggerId?: string, limit = 50) {
  const path = triggerId
    ? `/triggers/history?trigger_id=${encodeURIComponent(triggerId)}&limit=${limit}`
    : `/triggers/history?limit=${limit}`;

  return useQuery({
    queryKey: triggerKeys.history(triggerId),
    queryFn: ({ signal }) => api.get<TriggerHistoryResponse>(path, signal),
    refetchInterval: POLL_INTERVAL,
    staleTime: 5_000,
  });
}

/** Fetch single trigger detail (for deep link / slide-over) */
export function useTriggerDetail(triggerId: string | null) {
  return useQuery({
    queryKey: triggerKeys.detail(triggerId ?? ''),
    queryFn: ({ signal }) =>
      api.get<TriggerDetailResponse>(`/triggers/${encodeURIComponent(triggerId!)}`, signal),
    enabled: !!triggerId,
    staleTime: 5_000,
  });
}

// ── Mutations ──

/** Enable or disable a trigger */
export function useToggleTrigger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ triggerId, enable }: { triggerId: string; enable: boolean }) => {
      const action = enable ? 'enable' : 'disable';
      return api.post<TriggerActionResponse>(
        `/triggers/${encodeURIComponent(triggerId)}/${action}`,
      );
    },
    onMutate: async ({ triggerId, enable }) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: triggerKeys.list() });
      const previous = queryClient.getQueryData<TriggerListResponse>(triggerKeys.list());

      if (previous) {
        queryClient.setQueryData<TriggerListResponse>(triggerKeys.list(), {
          ...previous,
          triggers: previous.triggers.map((t) =>
            t.trigger_id === triggerId ? { ...t, enabled: enable } : t,
          ),
        });
      }

      return { previous };
    },
    onError: (_err, _vars, context) => {
      // Revert on error
      if (context?.previous) {
        queryClient.setQueryData(triggerKeys.list(), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: triggerKeys.list() });
    },
  });
}

/** Pause all triggers */
export function usePauseTriggers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<TriggerActionResponse>('/triggers/pause'),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: triggerKeys.list() });
      const previous = queryClient.getQueryData<TriggerListResponse>(triggerKeys.list());

      if (previous) {
        queryClient.setQueryData<TriggerListResponse>(triggerKeys.list(), {
          ...previous,
          paused: true,
        });
      }

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(triggerKeys.list(), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: triggerKeys.list() });
    },
  });
}

/** Resume all triggers */
export function useResumeTriggers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<TriggerActionResponse>('/triggers/resume'),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: triggerKeys.list() });
      const previous = queryClient.getQueryData<TriggerListResponse>(triggerKeys.list());

      if (previous) {
        queryClient.setQueryData<TriggerListResponse>(triggerKeys.list(), {
          ...previous,
          paused: false,
        });
      }

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(triggerKeys.list(), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: triggerKeys.list() });
    },
  });
}

/** Reload trigger registrations */
export function useReloadTriggers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<TriggerReloadResponse>('/triggers/reload'),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: triggerKeys.all });
    },
  });
}
