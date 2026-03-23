/** Project & event domain types — pure HTTP consumer interfaces (PRD 020.4) */

export interface ProjectMetadata {
  id: string;
  name: string;
  description?: string;
  path: string;
  status: 'healthy' | 'degraded' | 'error';
  git_valid: boolean;
  method_dir_exists: boolean;
  installed_methodologies: string[];
  last_scanned: string;
}

export interface ProjectsListResponse {
  projects: ProjectMetadata[];
  discovery_incomplete: boolean;
  error?: string;
  scanned_count: number;
  error_count: number;
  elapsed_ms: number;
}

export interface ProjectEvent {
  id: string;
  projectId: string;
  type: string;
  timestamp: string;
  metadata: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export interface EventsResponse {
  events: ProjectEvent[];
  nextCursor: string;
  hasMore: boolean;
}
