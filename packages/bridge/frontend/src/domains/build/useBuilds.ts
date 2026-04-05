/**
 * useBuilds — data hook for the build dashboard.
 *
 * Fetches builds from /api/builds with WebSocket-driven cache invalidation.
 * Falls back to mock data when the backend is unreachable.
 *
 * @see PRD 047 — Build Orchestrator §Dashboard Architecture
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWebSocket } from '@/shared/websocket/useWebSocket';
import { api } from '@/shared/lib/api';
import { MOCK_BUILDS } from './mock-data';
import type { BuildSummary } from './types';

export interface UseBuildsResult {
  builds: BuildSummary[];
  selectedBuild: BuildSummary | null;
  selectedId: string | null;
  selectBuild: (id: string) => void;
  isLoading: boolean;
  error: Error | null;
  usingMock: boolean;
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
    queryFn: ({ signal }) => api.get<BuildSummary[]>('/builds', signal),
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

  return {
    builds,
    selectedBuild,
    selectedId: effectiveId,
    selectBuild,
    isLoading: isLoading && !usingMock,
    error: error as Error | null,
    usingMock,
  };
}
