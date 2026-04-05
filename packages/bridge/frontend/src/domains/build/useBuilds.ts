/**
 * useBuilds — data hook for the build dashboard.
 *
 * Fetches builds from /api/builds with WebSocket-driven cache invalidation.
 * Falls back to mock data when the backend is unreachable.
 *
 * Provides mutation functions for starting, aborting, and resuming builds.
 *
 * @see PRD 047 — Build Orchestrator §Dashboard Architecture
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useWebSocket } from '@/shared/websocket/useWebSocket';
import { api } from '@/shared/lib/api';
import { MOCK_BUILDS } from './mock-data';
import { PHASES } from './types';
import type { BuildSummary, AutonomyLevel, BuildStatus, PhaseInfo } from './types';

// ── API response types (match backend routes.ts) ──

interface ApiBuild {
  id: string;
  requirement: string;
  autonomyLevel: AutonomyLevel;
  projectId?: string;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  startedAt: string;
  completedAt?: string;
}

interface ApiBuildsResponse {
  builds: ApiBuild[];
}

/** Map a backend build entry to a frontend BuildSummary with reasonable defaults. */
function toBuildSummary(b: ApiBuild): BuildSummary {
  const status: BuildStatus = b.status === 'aborted' ? 'failed' : b.status;

  // Derive phase info from status — enriched by WebSocket events in real-time
  const phases: PhaseInfo[] = PHASES.map((phase) => ({
    phase,
    status: status === 'completed' ? ('completed' as const) : ('future' as const),
  }));

  // Use first ~40 chars of requirement as display name
  const name = b.requirement.length > 40
    ? b.requirement.slice(0, 37) + '...'
    : b.requirement;

  return {
    id: b.id,
    name,
    requirement: b.requirement,
    status,
    currentPhase: status === 'completed' ? 'completed' : 'explore',
    phases,
    costUsd: 0,
    budgetUsd: 5,
    commissions: [],
    criteria: [],
    failures: [],
    events: [],
    gantt: [],
    autonomy: b.autonomyLevel ?? 'discuss-all',
    refinements: [],
    projectId: b.projectId,
  };
}

// ── Hook result ──

export interface UseBuildsResult {
  builds: BuildSummary[];
  selectedBuild: BuildSummary | null;
  selectedId: string | null;
  selectBuild: (id: string) => void;
  isLoading: boolean;
  error: Error | null;
  usingMock: boolean;
  startBuild: (requirement: string, autonomyLevel?: AutonomyLevel, projectId?: string) => Promise<string>;
  abortBuild: (id: string, reason?: string) => Promise<void>;
  resumeBuild: (id: string) => Promise<{ buildId: string; resumedFromPhase: string }>;
}

export function useBuilds(initialId?: string): UseBuildsResult {
  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? null);
  const queryClient = useQueryClient();

  // PRD 047: WebSocket subscription for real-time build event updates.
  // Invalidates the query cache on any build.* event, triggering a refetch.
  useWebSocket('builds', {
    enabled: true,
    onMessage: () => {
      queryClient.invalidateQueries({ queryKey: ['builds'] });
    },
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['builds'],
    queryFn: async ({ signal }) => {
      const res = await api.get<ApiBuildsResponse>('/api/builds', signal);
      return res.builds.map(toBuildSummary);
    },
    // Slow fallback polling — WebSocket handles real-time, polling is safety net
    refetchInterval: 30_000,
    retry: 1,
  });

  // Fall back to mock data when API is unavailable
  const usingMock = !data || (error != null);
  const builds = usingMock ? MOCK_BUILDS : data;

  // Auto-select first build if none selected
  const effectiveId = selectedId ?? builds[0]?.id ?? null;

  const selectedBuild = useMemo(
    () => builds.find((b) => b.id === effectiveId) ?? null,
    [builds, effectiveId],
  );

  const selectBuild = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  // ── Mutations ──

  const startMutation = useMutation({
    mutationFn: async ({ requirement, autonomyLevel, projectId }: { requirement: string; autonomyLevel?: AutonomyLevel; projectId?: string }) => {
      const res = await api.post<{ buildId: string }>('/api/builds/start', { requirement, autonomyLevel, projectId });
      return res.buildId;
    },
    onSuccess: (buildId) => {
      queryClient.invalidateQueries({ queryKey: ['builds'] });
      setSelectedId(buildId);
    },
  });

  const abortMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      await api.post<{ ok: boolean }>(`/api/builds/${id}/abort`, { reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['builds'] });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      return api.post<{ ok: boolean; buildId: string; resumedFromPhase: string }>(`/api/builds/${id}/resume`);
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['builds'] });
      setSelectedId(res.buildId);
    },
  });

  const startBuild = useCallback(
    async (requirement: string, autonomyLevel?: AutonomyLevel, projectId?: string) => {
      return startMutation.mutateAsync({ requirement, autonomyLevel, projectId });
    },
    [startMutation],
  );

  const abortBuild = useCallback(
    async (id: string, reason?: string) => {
      await abortMutation.mutateAsync({ id, reason });
    },
    [abortMutation],
  );

  const resumeBuild = useCallback(
    async (id: string) => {
      const res = await resumeMutation.mutateAsync({ id });
      return { buildId: res.buildId, resumedFromPhase: res.resumedFromPhase };
    },
    [resumeMutation],
  );

  return {
    builds,
    selectedBuild,
    selectedId: effectiveId,
    selectBuild,
    isLoading: isLoading && !usingMock,
    error: error as Error | null,
    usingMock,
    startBuild,
    abortBuild,
    resumeBuild,
  };
}
