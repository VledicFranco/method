/**
 * PRD 020 Phase 3: Resource Copying Hooks
 *
 * TanStack Query hooks for copying methodologies and strategies between projects.
 */

import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface ProjectMetadata {
  id: string;
  path: string;
  status: 'healthy' | 'git_corrupted' | 'missing_config' | 'permission_denied';
  git_valid: boolean;
  method_dir_exists: boolean;
  error_detail?: string;
  discovered_at: string;
}

export interface CopyMethodologyRequest {
  source_id: string;
  method_name: string;
  target_ids: string[];
}

export interface CopyMethodologyResponse {
  copied_to: Array<{
    project_id: string;
    status: 'success' | 'error';
    error_detail?: string;
  }>;
}

export interface CopyStrategyRequest {
  source_id: string;
  strategy_name: string;
  target_ids: string[];
}

export interface CopyStrategyResponse {
  copied_to: Array<{
    project_id: string;
    status: 'success' | 'error';
    error_detail?: string;
  }>;
}

export interface ProjectsResponse {
  projects: ProjectMetadata[];
  discovery_incomplete: boolean;
  error?: string;
  scanned_count: number;
  error_count: number;
  elapsed_ms: number;
}

/** Fetch list of projects for copy modal */
export function useProjectList() {
  return useQuery<ProjectMetadata[]>({
    queryKey: ['projects', 'list'],
    queryFn: ({ signal }) =>
      api.get<ProjectsResponse>('/api/projects', signal).then(res => res.projects),
    staleTime: 60_000, // 1 minute
  });
}

/** Mutation for copying methodology between projects */
export function useCopyMethodology() {
  return useMutation({
    mutationFn: (args: CopyMethodologyRequest) =>
      api.post<CopyMethodologyResponse>('/api/resources/copy-methodology', args),
  });
}

/** Mutation for copying strategy between projects */
export function useCopyStrategy() {
  return useMutation({
    mutationFn: (args: CopyStrategyRequest) =>
      api.post<CopyStrategyResponse>('/api/resources/copy-strategy', args),
  });
}
