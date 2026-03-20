/**
 * PRD 019.3: TanStack Query hooks for strategy definitions and executions.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  StrategyDefinitionsResponse,
  StrategyExecution,
  StrategyExecuteResponse,
} from '@/lib/types';

// ── Query Keys ──────────────────────────────────────────────────

export const strategyKeys = {
  all: ['strategies'] as const,
  definitions: () => [...strategyKeys.all, 'definitions'] as const,
  executions: () => [...strategyKeys.all, 'executions'] as const,
};

// ── Hooks ───────────────────────────────────────────────────────

/** Fetch all strategy definitions from .method/strategies/ */
export function useStrategyDefinitions() {
  return useQuery({
    queryKey: strategyKeys.definitions(),
    queryFn: ({ signal }) =>
      api.get<StrategyDefinitionsResponse>('/api/strategies/definitions', signal),
    staleTime: 30_000, // Definitions change infrequently
  });
}

/** Fetch all strategy executions (polling at 5s for live updates) */
export function useStrategyExecutions(enabled = true) {
  return useQuery({
    queryKey: strategyKeys.executions(),
    queryFn: ({ signal }) =>
      api.get<StrategyExecution[]>('/strategies', signal),
    refetchInterval: 5_000,
    enabled,
  });
}

/** Execute a strategy via POST /strategies/execute */
export function useExecuteStrategy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { strategy_path: string; context_inputs?: Record<string, unknown> }) =>
      api.post<StrategyExecuteResponse>('/strategies/execute', params),
    onSuccess: () => {
      // Invalidate executions to pick up the new execution
      queryClient.invalidateQueries({ queryKey: strategyKeys.executions() });
      // Also refresh definitions (last_execution updates)
      queryClient.invalidateQueries({ queryKey: strategyKeys.definitions() });
    },
  });
}
