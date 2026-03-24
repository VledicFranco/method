import { useEffect, useState } from 'react';
import { api } from '@/shared/lib/api';
import type { ProjectMetadata, ProjectsListResponse } from '@/domains/projects/types';

export interface UseProjectsResult {
  projects: ProjectMetadata[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Fetch all discovered projects from the bridge API.
 * Auto-refetches on mount, but projects are typically static per session.
 */
export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<ProjectMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get<ProjectsListResponse>('/api/projects');
      setProjects(response.projects || []);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch projects';
      setError(errorMsg);
      console.error('[useProjects]', errorMsg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  return {
    projects,
    loading,
    error,
    refetch: fetchProjects,
  };
}
