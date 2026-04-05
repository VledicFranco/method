/**
 * Hooks for Cost Governor data (PRD 051).
 * Polls the /api/cost-governor/* endpoints.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';
import type { UtilizationResponse, HistoryResponse, StrategyEstimate } from './types';

/** Current rate-governor utilization. Polls every 5s. */
export function useUtilization(opts?: { enabled?: boolean; refetchInterval?: number }) {
  return useQuery({
    queryKey: ['cost-governor', 'utilization'],
    queryFn: ({ signal }) =>
      api.get<UtilizationResponse>('/api/cost-governor/utilization', signal),
    refetchInterval: opts?.refetchInterval ?? 5_000,
    enabled: opts?.enabled ?? true,
    retry: false,
  });
}

/** Query observation history for a signature. */
export function useHistory(params: {
  methodologyId: string;
  capabilities?: string[];
  model: string;
  inputSizeBucket?: string;
  limit?: number;
  enabled?: boolean;
}) {
  const { methodologyId, capabilities = [], model, inputSizeBucket = 's', limit = 50, enabled = true } = params;
  return useQuery({
    queryKey: ['cost-governor', 'history', methodologyId, capabilities.join(','), model, inputSizeBucket, limit],
    queryFn: ({ signal }) => {
      const qs = new URLSearchParams({
        methodologyId,
        capabilities: capabilities.join(','),
        model,
        inputSizeBucket,
        limit: String(limit),
      });
      return api.get<HistoryResponse>(`/api/cost-governor/history?${qs}`, signal);
    },
    enabled: enabled && !!methodologyId && !!model,
    retry: false,
  });
}

/** Dry-run estimate for a DAG. */
export async function dryRun(body: {
  nodes: Array<{ nodeId: string; signature: HistoryResponse['observations'][0]['signature'] }>;
  edges: Array<{ nodeId: string; dependsOn: string[] }>;
}): Promise<StrategyEstimate> {
  return api.post<StrategyEstimate>('/api/cost-governor/dry-run', body);
}
