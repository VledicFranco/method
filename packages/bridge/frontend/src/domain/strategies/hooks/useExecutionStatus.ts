/** TanStack Query hooks for execution status polling and DAG fetching */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ExecutionStatusResponse, StrategyDAG } from '../lib/types';

/** Poll execution status every 2s, auto-stop on terminal states */
export function useExecutionStatus(executionId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['execution-status', executionId],
    queryFn: ({ signal }) =>
      api.get<ExecutionStatusResponse>(`/strategies/${executionId}/status`, signal),
    enabled: enabled && executionId !== null,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 2000;
      if (data.status === 'completed' || data.status === 'failed' || data.status === 'suspended') {
        return false;
      }
      return 2000;
    },
  });
}

/** Fetch DAG structure once (staleTime: Infinity — DAG doesn't change during execution) */
export function useStrategyDag(executionId: string | null) {
  return useQuery({
    queryKey: ['strategy-dag', executionId],
    queryFn: ({ signal }) =>
      api.get<StrategyDAG>(`/api/strategies/${executionId}/dag`, signal),
    enabled: executionId !== null,
    staleTime: Infinity,
  });
}
