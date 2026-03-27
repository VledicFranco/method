import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';
import type { ProjectMetadata, ProjectsListResponse } from '@/domains/projects/types';

export interface UseProjectsResult {
  projects: ProjectMetadata[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /** Trigger a fresh scan (bypasses cache) */
  scan: () => Promise<void>;
}

/**
 * Fetch all discovered projects from the bridge API.
 * Uses React Query with 60s staleTime — navigating away and back
 * shows cached results instantly while refetching in background.
 */
export function useProjects(): UseProjectsResult {
  const queryClient = useQueryClient();

  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectsListResponse>('/api/projects'),
    staleTime: 60_000,      // Cache for 60s — dashboard feels instant on return
    refetchOnWindowFocus: false,
  });

  const refetch = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['projects'] });
  }, [queryClient]);

  const scan = useCallback(async () => {
    await api.post('/api/projects/scan', {});
    await queryClient.invalidateQueries({ queryKey: ['projects'] });
  }, [queryClient]);

  return {
    projects: data?.projects ?? [],
    loading: isLoading,
    error: queryError ? (queryError instanceof Error ? queryError.message : 'Failed to fetch projects') : null,
    refetch,
    scan,
  };
}
