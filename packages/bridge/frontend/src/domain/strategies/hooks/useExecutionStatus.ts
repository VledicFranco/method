/** TanStack Query hooks for execution status polling and DAG fetching */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useWebSocket } from '@/hooks/useWebSocket';
import type { ExecutionStatusResponse, StrategyDAG } from '../lib/types';

/** Subscribe to execution status via WebSocket, with REST initial fetch */
export function useExecutionStatus(executionId: string | null, enabled = true) {
  const queryClient = useQueryClient();
  const isActive = enabled && executionId !== null;

  // WebSocket push — update query cache directly for low-latency updates
  useWebSocket<{ execution_id: string; strategy_id: string; status: string }>('executions', {
    filter: executionId ? { execution_id: executionId } : undefined,
    enabled: isActive,
    onMessage: () => {
      // Invalidate to refetch full status (includes node_statuses, cost, etc.)
      queryClient.invalidateQueries({ queryKey: ['execution-status', executionId] });
    },
  });

  return useQuery({
    queryKey: ['execution-status', executionId],
    queryFn: ({ signal }) =>
      api.get<ExecutionStatusResponse>(`/strategies/${executionId}/status`, signal),
    enabled: isActive,
    // Fallback polling for resilience — only if WS disconnects or misses updates.
    // Stops on terminal states.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 10_000; // Slow fallback until first data
      if (data.status === 'completed' || data.status === 'failed' || data.status === 'suspended') {
        return false;
      }
      return 10_000; // Slow fallback — WS handles the fast path
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
