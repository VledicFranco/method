/**
 * Hooks for token tracking and subscription usage data.
 * Consumes GET /api/tokens, GET /api/tokens/:id, GET /api/usage.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  AggregateTokenUsage,
  SessionTokenUsage,
  UsageResponse,
} from '@/lib/types';

/** Aggregate token usage across all bridge sessions. Polls every 10s. */
export function useAggregateTokens(opts?: { enabled?: boolean; refetchInterval?: number }) {
  return useQuery({
    queryKey: ['tokens', 'aggregate'],
    queryFn: ({ signal }) => api.get<AggregateTokenUsage>('/api/tokens', signal),
    refetchInterval: opts?.refetchInterval ?? 10_000,
    enabled: opts?.enabled ?? true,
  });
}

/** Per-session token usage. Triggers a server-side refresh on each poll. */
export function useSessionTokens(sessionId: string | null, opts?: { enabled?: boolean; refetchInterval?: number }) {
  return useQuery({
    queryKey: ['tokens', 'session', sessionId],
    queryFn: ({ signal }) => api.get<SessionTokenUsage>(`/api/tokens/${sessionId}`, signal),
    refetchInterval: opts?.refetchInterval ?? 10_000,
    enabled: (opts?.enabled ?? true) && sessionId !== null,
  });
}

/** Subscription usage meters (5h window, 7d ceiling, sonnet, opus). Polls every 30s. */
export function useSubscriptionUsage(opts?: { enabled?: boolean; refetchInterval?: number }) {
  return useQuery({
    queryKey: ['usage', 'subscription'],
    queryFn: ({ signal }) => api.get<UsageResponse>('/api/usage', signal),
    refetchInterval: opts?.refetchInterval ?? 30_000,
    enabled: opts?.enabled ?? true,
  });
}
