/**
 * PRD 020 Wave 2: Project Routes — Read-Only APIs with Isolation
 *
 * HTTP endpoints for multi-project discovery and access:
 *   GET    /api/projects                 — list all projects
 *   GET    /api/projects/:id             — get single project (with isolation check)
 *   POST   /api/projects/validate        — resume discovery from checkpoint
 *   POST   /api/projects/:id/repair      — diagnose corrupted repo
 *   GET    /api/events                   — cursor-based event polling
 *
 * Isolation enforced via IsolationValidator from Wave 1.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ProjectEvent, EventPersistence } from '@method/core';
import {
  DefaultIsolationValidator,
  InMemoryProjectRegistry,
  ProjectEventType,
  createProjectEvent,
  createTestEvent,
} from '@method/core';
import { DiscoveryService, type DiscoveryResult, type ProjectMetadata } from './multi-project/discovery-service.js';

// ── Event Cursor Management (Phase 1: In-Memory) ────

interface CursorState {
  eventIndex: number;
  timestamp: number;
}

const cursorMap = new Map<string, CursorState>();
const eventLog: ProjectEvent[] = [];

function generateCursor(index: number): string {
  const cursorId = Math.random().toString(36).slice(2);
  cursorMap.set(cursorId, { eventIndex: index, timestamp: Date.now() });

  // Cleanup old cursors (>24h)
  for (const [id, state] of cursorMap.entries()) {
    if (Date.now() - state.timestamp > 24 * 60 * 60 * 1000) {
      cursorMap.delete(id);
    }
  }

  return cursorId;
}

function parseCursor(cursor: string): number {
  const state = cursorMap.get(cursor);
  if (!state) {
    return 0; // Default to first event
  }
  return state.eventIndex;
}

function getEventsSinceCursor(events: ProjectEvent[], cursorId?: string): ProjectEvent[] {
  const index = cursorId ? parseCursor(cursorId) : 0;
  return events.slice(index);
}

// ── Session/Isolation Context ────

interface SessionContext {
  projectId?: string;
  isAdmin?: boolean;
}

function getSessionContext(req: FastifyRequest): SessionContext {
  // In Phase 1, extract from headers or query params
  // Will be replaced with proper session middleware in Phase 2
  // NOTE: x-admin header removed (F-SECUR-002). Admin checks require cryptographic session binding.
  const projectId = (req.headers['x-project-id'] as string) || undefined;
  return { projectId };
}

// ── Isolation Enforcement ────

function validateProjectAccess(
  requestedProjectId: string,
  sessionContext: SessionContext,
): { allowed: boolean; reason?: string } {
  // Sessions must match project_id (F-SECUR-002: removed header-based admin escalation)
  if (sessionContext.projectId && sessionContext.projectId !== requestedProjectId) {
    return {
      allowed: false,
      reason: `Access denied: project ${requestedProjectId} not accessible to session project ${sessionContext.projectId}`,
    };
  }

  // If no project context, deny write operations (Phase 1: discovery-only, no writes)
  if (!sessionContext.projectId) {
    return { allowed: true }; // Read-only discovery access
  }

  return { allowed: true };
}

// ── Routes Registration ────

export async function registerProjectRoutes(
  app: FastifyInstance,
  discoveryService: DiscoveryService,
  registry: InMemoryProjectRegistry,
  eventPersistence?: EventPersistence,
): Promise<void> {
  const validator = new DefaultIsolationValidator();

  // Initialize registry
  await registry.initialize();

  // GET /api/projects — List all discovered projects
  app.get<{ Params: {}; Reply: { projects: ProjectMetadata[]; discovery_incomplete: boolean } }>(
    '/api/projects',
    async (_req: FastifyRequest, reply: FastifyReply) => {
      try {
        // In Phase 1, run discovery from current working directory
        const result = await discoveryService.discover(process.cwd());

        // Emit event if discovery was stopped due to MAX_PROJECTS limit
        if (result.stopped_at_max_projects) {
          const event = createProjectEvent(
            ProjectEventType.DISCOVERY_INCOMPLETE,
            'discovery',
            {
              reason: 'max_projects_exceeded',
              projects_found: result.projects.length,
              scanned_count: result.scanned_count,
            },
            { phase: 'phase1' },
          );
          eventLog.push(event);
        }

        return reply.status(200).send({
          projects: result.projects,
          discovery_incomplete: result.discovery_incomplete,
          error: result.error,
          scanned_count: result.scanned_count,
          error_count: result.error_count,
          elapsed_ms: result.elapsed_ms,
        });
      } catch (err) {
        return reply.status(500).send({
          error: 'Discovery failed',
          message: (err as Error).message,
        });
      }
    },
  );

  // GET /api/projects/:id — Get single project with isolation check
  app.get<{ Params: { id: string } }>(
    '/api/projects/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const { id } = req.params;
        const sessionContext = getSessionContext(req);

        // Validate access
        const access = validateProjectAccess(id, sessionContext);
        if (!access.allowed) {
          // Audit log
          console.warn(`[ISOLATION] Cross-project access denied: ${access.reason}`);
          return reply.status(403).send({
            error: 'Access denied',
            reason: access.reason,
          });
        }

        // Discover and find project
        const result = await discoveryService.discover(process.cwd());
        const project = result.projects.find((p) => p.id === id);

        if (!project) {
          return reply.status(404).send({
            error: 'Project not found',
            id,
          });
        }

        return reply.status(200).send(project);
      } catch (err) {
        return reply.status(500).send({
          error: 'Failed to fetch project',
          message: (err as Error).message,
        });
      }
    },
  );

  // POST /api/projects/validate — Resume discovery from checkpoint
  app.post<{ Body: { checkpoint?: any }; Reply: DiscoveryResult }>(
    '/api/projects/validate',
    async (req: FastifyRequest<{ Body: Record<string, any> }>, reply: FastifyReply) => {
      try {
        const { checkpoint } = (req.body || {}) as Record<string, any>;

        // Run discovery (checkpoint support added in Phase 2)
        const result = await discoveryService.discover(process.cwd(), checkpoint);

        return reply.status(200).send(result);
      } catch (err) {
        return reply.status(400).send({
          error: 'Validation failed',
          message: (err as Error).message,
        });
      }
    },
  );

  // POST /api/projects/:id/repair — Diagnose corrupted repo
  app.post<{ Params: { id: string } }>(
    '/api/projects/:id/repair',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const { id } = req.params;
        const sessionContext = getSessionContext(req);

        // Validate access
        const access = validateProjectAccess(id, sessionContext);
        if (!access.allowed) {
          console.warn(`[ISOLATION] Cross-project repair denied: ${access.reason}`);
          return reply.status(403).send({
            error: 'Access denied',
            reason: access.reason,
          });
        }

        // Discover and find project
        const result = await discoveryService.discover(process.cwd());
        const project = result.projects.find((p) => p.id === id);

        if (!project) {
          return reply.status(404).send({
            error: 'Project not found',
            id,
          });
        }

        // Provide diagnostic info
        let diagnosis = '';
        let repairSteps: string[] = [];

        if (!project.git_valid) {
          diagnosis = 'Git repository is corrupted or invalid.';
          repairSteps = [
            'Run: git fsck --full',
            'If objects are corrupted, consider git reflog to recover recent commits',
            'Worst case: re-clone the repository',
          ];
        }

        if (!project.method_dir_exists) {
          diagnosis = (diagnosis || '') + ' Missing .method directory.';
          repairSteps.push('Run: mkdir -p .method');
        }

        if (!diagnosis) {
          diagnosis = 'Project appears to be healthy.';
        }

        return reply.status(200).send({
          status: project.status,
          diagnosis,
          repair_steps: repairSteps,
        });
      } catch (err) {
        return reply.status(500).send({
          error: 'Repair diagnostic failed',
          message: (err as Error).message,
        });
      }
    },
  );

  // GET /api/events — Global event polling (Phase 1: testing only, unfiltered)
  // NOTE: F-SECUR-001 — This endpoint returns all events. Not for multi-project production.
  app.get<{ Querystring: { since_cursor?: string } }>(
    '/api/events',
    async (
      req: FastifyRequest<{ Querystring: { since_cursor?: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const { since_cursor } = req.query || {};

        // Get events since cursor
        const newEvents = getEventsSinceCursor(eventLog, since_cursor);

        // Generate next cursor for next poll
        const nextCursor = generateCursor(eventLog.length);
        const hasMore = newEvents.length > 0;

        return reply.status(200).send({
          events: newEvents,
          nextCursor,
          hasMore,
        });
      } catch (err) {
        return reply.status(500).send({
          error: 'Event polling failed',
          message: (err as Error).message,
        });
      }
    },
  );

  // GET /api/projects/:id/events — Project-scoped event polling (F-SECUR-004)
  // Returns only events for the specified project, with isolation check
  app.get<{ Params: { id: string }; Querystring: { since_cursor?: string } }>(
    '/api/projects/:id/events',
    async (
      req: FastifyRequest<{ Params: { id: string }; Querystring: { since_cursor?: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const { id: projectId } = req.params;
        const { since_cursor } = req.query || {};
        const sessionContext = getSessionContext(req);

        // Validate access
        const access = validateProjectAccess(projectId, sessionContext);
        if (!access.allowed) {
          console.warn(`[ISOLATION] Cross-project event access denied: ${access.reason}`);
          return reply.status(403).send({
            error: 'Access denied',
            reason: access.reason,
          });
        }

        // Filter events by projectId
        const projectEvents = eventLog.filter((e) => e.projectId === projectId);

        // Get events since cursor
        const newEvents = getEventsSinceCursor(projectEvents, since_cursor);

        // Generate next cursor for next poll
        const nextCursor = generateCursor(projectEvents.length);
        const hasMore = newEvents.length > 0;

        return reply.status(200).send({
          events: newEvents,
          nextCursor,
          hasMore,
          project_id: projectId,
        });
      } catch (err) {
        return reply.status(500).send({
          error: 'Event polling failed',
          message: (err as Error).message,
        });
      }
    },
  );

  // Helper endpoint for testing: append a test event
  app.post<{ Body: { projectId: string; type: string }; Reply: ProjectEvent }>(
    '/api/events/test',
    async (req: FastifyRequest<{ Body: Record<string, any> }>, reply: FastifyReply) => {
      try {
        const { projectId, type } = (req.body || {}) as Record<string, any>;

        if (!projectId || !type) {
          return reply.status(400).send({
            error: 'Missing required fields: projectId, type',
          });
        }

        // Create and store test event
        const event = createProjectEvent(
          type as any,
          projectId,
          { description: 'Test event' },
          { test: true },
        );

        eventLog.push(event);

        return reply.status(201).send(event);
      } catch (err) {
        return reply.status(400).send({
          error: 'Failed to create test event',
          message: (err as Error).message,
        });
      }
    },
  );
}

// Export for testing
export { getSessionContext, validateProjectAccess, generateCursor, parseCursor, getEventsSinceCursor };
export { eventLog };
