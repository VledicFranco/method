/**
 * useBuilds — data hook for the build dashboard.
 *
 * Fetches builds from /api/builds, falling back to mock data
 * when the backend is unreachable.
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
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

  const { data, isLoading, error } = useQuery({
    queryKey: ['builds'],
    queryFn: ({ signal }) => api.get<BuildSummary[]>('/builds', signal),
    refetchInterval: 5000,
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
