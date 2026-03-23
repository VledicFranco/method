/**
 * PRD 020 Phase 2A: Genesis MCP Tools Implementation
 *
 * Core tool implementations for Genesis agent:
 * - project_list() → discover all projects
 * - project_get(project_id) → get project metadata
 * - project_get_manifest(project_id) → read manifest.yaml
 * - project_read_events(project_id?, since_cursor?) → read project events
 * - genesis_report(message) → report findings to human (Genesis session only)
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DiscoveryService } from '../projects/discovery-service.js';
import type { ProjectEvent } from '../projects/events/index.js';

export interface GenesisToolsContext {
  discoveryService: DiscoveryService;
  rootDir: string;
  eventLog: { buffer: ProjectEvent[]; capacity: number; index: number; count: number };
  cursorMap: Map<string, { version: string; eventIndex: number; timestamp: number; projectId?: string }>;
}

/**
 * Tool: project_list() → list all discovered projects with metadata
 */
export async function projectListTool(ctx: GenesisToolsContext) {
  const result = await ctx.discoveryService.discover(ctx.rootDir);

  // Transform ProjectMetadata to response format
  const projects = result.projects.map(p => ({
    id: p.id,
    name: p.id,
    description: `${p.status === 'healthy' ? '✓' : '⚠'} Project at ${p.path}`,
    installed_methodologies: [], // TODO: read from manifest.yaml
    path: p.path,
    status: p.status,
  }));

  return {
    projects,
    total: projects.length,
    discovery_incomplete: result.discovery_incomplete,
  };
}

/**
 * Tool: project_get(project_id) → get project metadata
 */
export async function projectGetTool(
  ctx: GenesisToolsContext,
  project_id: string,
) {
  const result = await ctx.discoveryService.discover(ctx.rootDir);
  const project = result.projects.find(p => p.id === project_id);

  if (!project) {
    throw new Error(`Project not found: ${project_id}`);
  }

  return {
    id: project.id,
    path: project.path,
    status: project.status,
    git_valid: project.git_valid,
    method_dir_exists: project.method_dir_exists,
    discovered_at: project.discovered_at,
    error_detail: project.error_detail,
  };
}

/**
 * Tool: project_get_manifest(project_id) → read manifest.yaml from project
 */
export async function projectGetManifestTool(
  ctx: GenesisToolsContext,
  project_id: string,
) {
  const result = await ctx.discoveryService.discover(ctx.rootDir);
  const project = result.projects.find(p => p.id === project_id);

  if (!project) {
    throw new Error(`Project not found: ${project_id}`);
  }

  const manifestPath = join(project.path, '.method', 'manifest.yaml');

  try {
    const content = readFileSync(manifestPath, 'utf-8');
    return {
      project_id,
      manifest_path: manifestPath,
      content,
      exists: true,
    };
  } catch (err) {
    return {
      project_id,
      manifest_path: manifestPath,
      content: null,
      exists: false,
      error: (err as Error).message,
    };
  }
}

/**
 * Tool: project_read_events(project_id?, since_cursor?) → read events for a project
 */
export async function projectReadEventsTool(
  ctx: GenesisToolsContext,
  project_id?: string,
  since_cursor?: string,
) {
  // Parse cursor to get starting index (handle version mismatch)
  let startIndex = 0;
  if (since_cursor) {
    const cursorState = ctx.cursorMap.get(since_cursor);
    if (cursorState) {
      // Check version compatibility (Phase 3 migration point)
      if (cursorState.version !== '1') {
        console.warn(`Cursor version mismatch: expected 1, got ${cursorState.version}. Resetting.`);
        startIndex = 0;
      } else {
        startIndex = cursorState.eventIndex;
      }
    }
  }

  // Get all events from circular buffer
  const allEvents = getEventsFromCircularLog(ctx.eventLog, startIndex);

  // Filter events by project_id if provided
  let events = allEvents;
  if (project_id) {
    events = events.filter(e =>
      (e.metadata?.project_id === project_id || !e.metadata?.project_id)
    );
  }

  // Generate next cursor
  const nextCursorId = Math.random().toString(36).slice(2);
  ctx.cursorMap.set(nextCursorId, {
    version: '1',
    eventIndex: ctx.eventLog.count,
    timestamp: Date.now(),
    projectId: project_id,
  });

  // Cleanup old cursors (>24h)
  for (const [id, state] of ctx.cursorMap.entries()) {
    if (Date.now() - state.timestamp > 24 * 60 * 60 * 1000) {
      ctx.cursorMap.delete(id);
    }
  }

  return {
    events,
    nextCursor: nextCursorId,
    hasMore: events.length > 0,
    filter: project_id ? { project_id } : undefined,
  };
}

/**
 * Helper: Get events from circular buffer starting at index
 */
function getEventsFromCircularLog(log: { buffer: ProjectEvent[]; capacity: number; index: number; count: number }, fromIndex: number): ProjectEvent[] {
  if (fromIndex >= log.count) {
    return []; // Index beyond current count
  }

  // Clamp fromIndex to valid range: max(0, count - capacity)
  const minValidIndex = Math.max(0, log.count - log.capacity);
  const clampedIndex = Math.max(minValidIndex, fromIndex);
  const offset = clampedIndex - (log.count - log.buffer.length);

  if (offset >= log.buffer.length) {
    return [];
  }

  const startPos = Math.max(0, offset);
  return log.buffer.slice(startPos);
}

/**
 * Tool: genesis_report(message) → report to human (Genesis only)
 *
 * SECURITY: Must enforce session.project_id === "root"
 * This check is done in the MCP wrapper, not here.
 */
export async function genesisReportTool(message: string) {
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    throw new Error('Report message cannot be empty');
  }

  // Queue message for delivery (would be stored for human to read)
  return {
    timestamp: new Date().toISOString(),
    message: message.trim(),
    delivered: true,
    queue_size: 1, // In real implementation, would track queue size
  };
}
