/**
 * Experiments domain — React Query hooks (PRD 041).
 *
 * Data fetching hooks for the Cognitive Experiment Lab dashboard.
 * Follows the same pattern as useSessions / useStrategies.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';
import type {
  Experiment,
  ExperimentDetailResponse,
  Run,
  TraceRecord,
  TraceFilter,
} from '@/domains/experiments/types';

// ── Query keys ───────────────────────────────────────────────────

export const experimentKeys = {
  all: ['experiments'] as const,
  list: () => [...experimentKeys.all, 'list'] as const,
  detail: (id: string) => [...experimentKeys.all, 'detail', id] as const,
  run: (experimentId: string, runId: string) =>
    [...experimentKeys.all, 'run', experimentId, runId] as const,
  traces: (experimentId: string, runId: string, filter?: TraceFilter) =>
    [...experimentKeys.all, 'traces', experimentId, runId, filter ?? {}] as const,
};

// ── Hooks ────────────────────────────────────────────────────────

/**
 * Fetch the list of all experiments.
 * GET /lab
 */
export function useExperimentList() {
  return useQuery({
    queryKey: experimentKeys.list(),
    queryFn: ({ signal }) => api.get<Experiment[]>('/lab', signal),
    refetchInterval: 15_000,
  });
}

/**
 * Fetch an experiment plus its runs list.
 * GET /lab/:id  →  { experiment, runs }
 */
export function useExperiment(experimentId: string) {
  return useQuery({
    queryKey: experimentKeys.detail(experimentId),
    queryFn: ({ signal }) =>
      api.get<ExperimentDetailResponse>(`/lab/${experimentId}`, signal),
    enabled: !!experimentId,
    refetchInterval: 10_000,
  });
}

/**
 * Fetch a single run's details including metrics.
 * GET /lab/:id/runs/:runId
 */
export function useRun(experimentId: string, runId: string) {
  return useQuery({
    queryKey: experimentKeys.run(experimentId, runId),
    queryFn: ({ signal }) =>
      api.get<Run>(`/lab/${experimentId}/runs/${runId}`, signal),
    enabled: !!experimentId && !!runId,
    refetchInterval: 5_000,
  });
}

/**
 * Fetch trace events for a run, optionally filtered.
 * GET /lab/:id/runs/:runId/traces[?cycleNumber=n&moduleId=m&phase=p]
 */
export function useRunTraces(
  experimentId: string,
  runId: string,
  filter?: TraceFilter,
) {
  // Build query string from filter params
  function buildQueryString(f?: TraceFilter): string {
    if (!f) return '';
    const params = new URLSearchParams();
    if (f.cycleNumber !== undefined) params.set('cycleNumber', String(f.cycleNumber));
    if (f.moduleId) params.set('moduleId', f.moduleId);
    if (f.phase) params.set('phase', f.phase);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }

  return useQuery({
    queryKey: experimentKeys.traces(experimentId, runId, filter),
    queryFn: ({ signal }) =>
      api.get<TraceRecord[]>(
        `/lab/${experimentId}/runs/${runId}/traces${buildQueryString(filter)}`,
        signal,
      ),
    enabled: !!experimentId && !!runId,
    refetchInterval: 5_000,
  });
}

/**
 * Return a stable refresh function for the experiment list query.
 * Convenience hook for components that need manual refresh control.
 */
export function useRefreshExperiments() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: experimentKeys.list() });
  };
}
