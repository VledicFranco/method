/**
 * PRD 020 Wave 2: Project Routes — Read-Only APIs with Isolation
 *
 * HTTP endpoints for multi-project discovery and access:
 *   GET    /api/projects                 — list all projects
 *   GET    /api/projects/:id             — get single project (with isolation check)
 *   POST   /api/projects/validate        — resume discovery from checkpoint
 *   POST   /api/projects/:id/repair      — diagnose corrupted repo
 *   POST   /api/projects/:id/reload      — reload project config (atomic, audited)
 *   GET    /api/events                   — cursor-based event polling
 *
 * Isolation enforced via IsolationValidator from Wave 1.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ProjectEvent, EventPersistence } from './events/index.js';
import {
  DefaultIsolationValidator,
} from '../../validation/index.js';
import {
  InMemoryProjectRegistry,
} from '../registry/index.js';
import {
  ProjectEventType,
  createProjectEvent,
  createTestEvent,
} from './events/index.js';
import { DiscoveryService, type DiscoveryResult, type ProjectMetadata } from './discovery-service.js';
import { copyMethodology, copyStrategy, validateTargetIds } from '../registry/resource-copier.js';
import { reloadConfig, validateConfig } from '../../config/config-reloader.js';
import path from 'path';
import { randomBytes } from 'crypto';

// ── Event Cursor Management (Phase 1: In-Memory) ────

// Configuration from environment variables
const EVENT_LOG_MAX_SIZE = parseInt(process.env.EVENT_LOG_MAX_SIZE ?? '100000', 10);
const CURSOR_VERSION = '1'; // Version 1: { version, projectId, index, timestamp }

interface CursorState {
  version: string;
  eventIndex: number;
  timestamp: number;
  projectId?: string;
}

// Circular buffer implementation for event log
interface CircularEventLog {
  buffer: ProjectEvent[];
  capacity: number;
  index: number; // Next write position
  count: number; // Total events ever added (for absolute indexing)
}

function createCircularEventLog(capacity: number): CircularEventLog {
  return {
    buffer: [],
    capacity,
    index: 0,
    count: 0,
  };
}

function pushEventToLog(log: CircularEventLog, event: ProjectEvent): void {
  if (log.buffer.length < log.capacity) {
    log.buffer.push(event);
  } else {
    // Evict oldest entry at current index
    log.buffer[log.index] = event;
  }
  log.index = (log.index + 1) % log.capacity;
  log.count++;
}

function getEventsFromLog(log: CircularEventLog, fromIndex: number): ProjectEvent[] {
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

const cursorMap = new Map<string, CursorState>();
const eventLog = createCircularEventLog(EVENT_LOG_MAX_SIZE);
let globalEventPersistence: EventPersistence | undefined; // Set during registration

function setPersistence(persistence: EventPersistence | undefined): void {
  globalEventPersistence = persistence;
}

// ── Event publish hook (wired by WsHub in index.ts) ─────────

type OnEventCallback = (event: ProjectEvent) => void;
let _onEventHook: OnEventCallback | null = null;

function setOnEventHook(hook: OnEventCallback | null): void {
  _onEventHook = hook;
}

async function pushEventToLogWithPersistence(log: CircularEventLog, event: ProjectEvent): Promise<void> {
  pushEventToLog(log, event);
  if (globalEventPersistence) {
    // Don't swallow persistence errors - propagate them for HTTP 5xx response
    await globalEventPersistence.append(event);
  }
  // Push to WebSocket subscribers
  if (_onEventHook) {
    try { _onEventHook(event); } catch { /* non-fatal */ }
  }
}

/**
 * F-S-1: Validate cursor format
 * Cursors must match: ^[a-zA-Z0-9_-]{40,256}$
 */
function validateCursorFormat(cursor: string): boolean {
  return /^[a-zA-Z0-9_-]{40,256}$/.test(cursor);
}

/**
 * F-S-2: Generate cursor using cryptographically strong RNG
 * Returns 64-byte hex string (256 bits entropy)
 * Matches format: ^[a-zA-Z0-9_-]{40,256}$
 */
function generateCursor(index: number, projectId?: string): string {
  // F-S-2: Use crypto.randomBytes for 256 bits entropy (64 hex chars)
  const cursorId = randomBytes(32).toString('hex');

  cursorMap.set(cursorId, {
    version: CURSOR_VERSION,
    eventIndex: index,
    timestamp: Date.now(),
    projectId,
  });

  // Cleanup old cursors (>24h)
  for (const [id, state] of cursorMap.entries()) {
    if (Date.now() - state.timestamp > 24 * 60 * 60 * 1000) {
      cursorMap.delete(id);
    }
  }

  return cursorId;
}

function parseCursor(cursor: string): { index: number; projectId?: string } {
  // F-S-1: Validate cursor format before lookup
  if (!validateCursorFormat(cursor)) {
    return { index: 0 };
  }

  const state = cursorMap.get(cursor);
  if (!state) {
    return { index: 0 };
  }

  // Check version compatibility (Phase 3 migration point)
  if (state.version !== CURSOR_VERSION) {
    console.warn(`Cursor version mismatch: expected ${CURSOR_VERSION}, got ${state.version}. Resetting.`);
    return { index: 0 };
  }

  return { index: state.eventIndex, projectId: state.projectId };
}

function getEventsSinceCursor(events: ProjectEvent[], cursorId?: string): ProjectEvent[] {
  const { index } = cursorId ? parseCursor(cursorId) : { index: 0 };
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

/**
 * F-S-3: Validate projectId for length and format
 * Format: 1-100 characters, alphanumeric + hyphens/underscores
 */
function validateProjectIdFormat(projectId: string): boolean {
  if (typeof projectId !== 'string') {
    return false;
  }
  if (projectId.length < 1 || projectId.length > 100) {
    return false;
  }
  return /^[a-zA-Z0-9_-]+$/.test(projectId);
}

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
  rootDir: string = process.cwd(),
): Promise<void> {
  const validator = new DefaultIsolationValidator();

  // Set global persistence for this registration
  setPersistence(eventPersistence);

  // Initialize registry
  await registry.initialize();

  // GET /api/projects — List all discovered projects
  app.get<{ Params: {}; Reply: { projects: ProjectMetadata[]; discovery_incomplete: boolean } }>(
    '/api/projects',
    async (_req: FastifyRequest, reply: FastifyReply) => {
      try {
        // In Phase 1, run discovery from current working directory
        const result = await discoveryService.discover(rootDir);

        // Emit event if discovery was stopped due to MAX_PROJECTS limit
        if (result.stopped_at_max_projects) {
          try {
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
            await pushEventToLogWithPersistence(eventLog, event);
          } catch (persistErr) {
            return reply.status(500).send({
              error: 'Event persistence failed',
              message: (persistErr as Error).message,
            });
          }
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
        const result = await discoveryService.discover(rootDir);
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
        const result = await discoveryService.discover(rootDir, checkpoint);

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
        const result = await discoveryService.discover(rootDir);
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

  // POST /api/projects/:id/reload — Reload project config (atomic, with audit logging)
  app.post<{ Params: { id: string }; Body: Record<string, any> }>(
    '/api/projects/:id/reload',
    async (req: FastifyRequest<{ Params: { id: string }; Body: Record<string, any> }>, reply: FastifyReply) => {
      try {
        const { id: projectId } = req.params;
        const newConfig = req.body || {};
        const sessionContext = getSessionContext(req);

        // Validate access
        const access = validateProjectAccess(projectId, sessionContext);
        if (!access.allowed) {
          console.warn(`[ISOLATION] Cross-project config reload denied: ${access.reason}`);
          return reply.status(403).send({
            error: 'Access denied',
            reason: access.reason,
          });
        }

        // Only allow reload if session owns the project or admin override present
        if (sessionContext.projectId && sessionContext.projectId !== projectId) {
          console.warn(`[AUDIT] Unauthorized config reload attempt for ${projectId} from session ${sessionContext.projectId}`);
          return reply.status(403).send({
            error: 'Privilege denied',
            reason: `session.project_id (${sessionContext.projectId}) does not match requested project (${projectId})`,
          });
        }

        // Validate config structure
        const validation = validateConfig(newConfig);
        if (!validation.valid) {
          return reply.status(400).send({
            error: 'Config validation failed',
            errors: validation.errors,
          });
        }

        // Determine config file path
        const configPath = path.join(rootDir, projectId, 'manifest.yaml');

        // Perform atomic reload
        const result = await reloadConfig({
          configPath,
          newConfig,
          userId: sessionContext.projectId || 'anonymous',
          metadata: { projectId },
        });

        if (!result.success) {
          return reply.status(400).send({
            error: result.message,
            detail: result.error,
          });
        }

        // Emit config reload event
        try {
          const event = createProjectEvent(
            ProjectEventType.CONFIG_UPDATED,
            projectId,
            {
              config_path: configPath,
              changes: result.diff,
            },
            { phase: 'phase2b' },
          );
          await pushEventToLogWithPersistence(eventLog, event);
        } catch (persistErr) {
          return reply.status(500).send({
            error: 'Event persistence failed',
            message: (persistErr as Error).message,
          });
        }

        // Trigger registry rescan
        try {
          await registry.rescan();
          console.log(`[FileWatcher] Rescan triggered after config reload for ${projectId}`);
        } catch (err) {
          console.warn(`[FileWatcher] Rescan failed after config reload:`, (err as Error).message);
          // Don't fail the request if rescan fails
        }

        return reply.status(200).send({
          success: true,
          message: 'Config reloaded and rescanned successfully',
          old_config: result.oldConfig,
          new_config: result.newConfig,
          changes: result.diff,
        });
      } catch (err) {
        return reply.status(500).send({
          error: 'Config reload failed',
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

        // Get all events from circular buffer
        const allEvents = getEventsFromLog(eventLog, 0);

        // Get events since cursor
        const newEvents = getEventsSinceCursor(allEvents, since_cursor);

        // Generate next cursor for next poll (use count to handle wrap-around)
        const nextCursor = generateCursor(eventLog.count);
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

        // Get all events from circular buffer and filter by projectId
        const allEvents = getEventsFromLog(eventLog, 0);
        const projectEvents = allEvents.filter((e) => e.projectId === projectId);

        // Get events since cursor
        const newEvents = getEventsSinceCursor(projectEvents, since_cursor);

        // Generate next cursor for next poll
        const nextCursor = generateCursor(eventLog.count, projectId);
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

        try {
          await pushEventToLogWithPersistence(eventLog, event);
        } catch (persistErr) {
          return reply.status(500).send({
            error: 'Event persistence failed',
            message: (persistErr as Error).message,
          });
        }

        return reply.status(201).send(event);
      } catch (err) {
        return reply.status(400).send({
          error: 'Failed to create test event',
          message: (err as Error).message,
        });
      }
    },
  );

  // POST /api/resources/copy-methodology — Copy methodology from source to targets
  app.post<{ Body: Record<string, any> }>(
    '/api/resources/copy-methodology',
    async (req: FastifyRequest<{ Body: Record<string, any> }>, reply: FastifyReply) => {
      try {
        const { source_id, method_name, target_ids } = req.body || {};

        if (!source_id || !method_name || !target_ids || !Array.isArray(target_ids)) {
          return reply.status(400).send({
            error: 'Missing or invalid required fields: source_id, method_name, target_ids (array)',
          });
        }

        // F-S-3: Validate source_id format (1-100 chars, alphanumeric + hyphens/underscores)
        if (!validateProjectIdFormat(source_id)) {
          return reply.status(400).send({
            error: 'Invalid source_id',
            message: 'source_id must be 1-100 characters, alphanumeric with hyphens/underscores',
          });
        }

        // F-S-1: Validate target_ids bounds and format
        const targetValidation = validateTargetIds(target_ids);
        if (!targetValidation.valid) {
          return reply.status(400).send({
            error: 'Invalid target_ids',
            message: targetValidation.error,
          });
        }

        // F-S-3: Validate that requester can access source project
        const sessionContext = getSessionContext(req);
        const sourceValidation = validateProjectAccess(source_id, sessionContext);
        if (!sourceValidation.allowed) {
          return reply.status(403).send({
            error: 'Access denied',
            reason: `Cannot copy from project ${source_id} — permission denied`,
            message: sourceValidation.reason || 'Not authorized to access source project',
          });
        }

        // F-S-3: Validate that requester can access ALL target projects
        for (const targetId of target_ids) {
          const targetValidation = validateProjectAccess(targetId, sessionContext);
          if (!targetValidation.allowed) {
            return reply.status(403).send({
              error: 'Access denied to one or more target projects',
              reason: `Cannot copy to project ${targetId} — permission denied`,
              message: targetValidation.reason || 'Not authorized to write to target project',
            });
          }
        }

        const result = await copyMethodology({
          source_id,
          method_name,
          target_ids,
        }, rootDir);

        return reply.status(200).send(result);
      } catch (err) {
        return reply.status(500).send({
          error: 'Resource copy failed',
          message: (err as Error).message,
        });
      }
    },
  );

  // POST /api/resources/copy-strategy — Copy strategy from source to targets
  app.post<{ Body: Record<string, any> }>(
    '/api/resources/copy-strategy',
    async (req: FastifyRequest<{ Body: Record<string, any> }>, reply: FastifyReply) => {
      try {
        const { source_id, strategy_name, target_ids } = req.body || {};

        if (!source_id || !strategy_name || !target_ids || !Array.isArray(target_ids)) {
          return reply.status(400).send({
            error: 'Missing or invalid required fields: source_id, strategy_name, target_ids (array)',
          });
        }

        // F-S-3: Validate source_id format (1-100 chars, alphanumeric + hyphens/underscores)
        if (!validateProjectIdFormat(source_id)) {
          return reply.status(400).send({
            error: 'Invalid source_id',
            message: 'source_id must be 1-100 characters, alphanumeric with hyphens/underscores',
          });
        }

        // F-S-1: Validate target_ids bounds and format
        const targetValidation = validateTargetIds(target_ids);
        if (!targetValidation.valid) {
          return reply.status(400).send({
            error: 'Invalid target_ids',
            message: targetValidation.error,
          });
        }

        // F-S-3: Validate that requester can access source project
        const sessionContext = getSessionContext(req);
        const sourceValidation = validateProjectAccess(source_id, sessionContext);
        if (!sourceValidation.allowed) {
          return reply.status(403).send({
            error: 'Access denied',
            reason: `Cannot copy from project ${source_id} — permission denied`,
            message: sourceValidation.reason || 'Not authorized to access source project',
          });
        }

        // F-S-3: Validate that requester can access ALL target projects
        for (const targetId of target_ids) {
          const targetValidation = validateProjectAccess(targetId, sessionContext);
          if (!targetValidation.allowed) {
            return reply.status(403).send({
              error: 'Access denied to one or more target projects',
              reason: `Cannot copy to project ${targetId} — permission denied`,
              message: targetValidation.reason || 'Not authorized to write to target project',
            });
          }
        }

        const result = await copyStrategy({
          source_id,
          strategy_name,
          target_ids,
        }, rootDir);

        return reply.status(200).send(result);
      } catch (err) {
        return reply.status(500).send({
          error: 'Resource copy failed',
          message: (err as Error).message,
        });
      }
    },
  );
}

// Export for testing
export { getSessionContext, validateProjectAccess, generateCursor, parseCursor, getEventsSinceCursor, validateCursorFormat, validateProjectIdFormat };
export { eventLog, cursorMap, pushEventToLog, getEventsFromLog, createCircularEventLog, pushEventToLogWithPersistence, setPersistence, setOnEventHook };
export type { CircularEventLog, CursorState };
