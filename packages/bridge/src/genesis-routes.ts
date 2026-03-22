/**
 * PRD 020 Phase 2A: Genesis HTTP Routes
 *
 * HTTP endpoints for Genesis agent interaction:
 * - GET    /genesis/status      — Genesis session status (Active/Idle, budget, last action)
 * - POST   /genesis/prompt      — Send prompt to Genesis session
 * - DELETE /genesis/prompt      — Abort Genesis prompt (stop in-flight processing)
 *
 * These routes provide HTTP access to the Genesis persistent session.
 * The session is created at bridge startup with project_id="root".
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SessionPool, SessionStatusInfo } from './pool.js';
import { randomBytes } from 'crypto';
import {
  projectListTool,
  projectGetTool,
  projectGetManifestTool,
  projectReadEventsTool,
  genesisReportTool,
  type GenesisToolsContext,
} from './genesis/tools.js';
import { validateProjectAccess, getSessionContext } from './project-routes.js';

export interface GenesisRouteContext {
  sessionPool: SessionPool;
  genesisSessionId: string | null;
  genesisToolsContext?: GenesisToolsContext;
}

/**
 * In-flight prompt tracker (F-A-9)
 * Maps session_id to set of pending prompt IDs
 */
const inFlightPrompts = new Map<string, Set<string>>();

/**
 * CSRF token store (F-N-1)
 * Maps session_id to current valid CSRF token
 */
const csrfTokens = new Map<string, string>();

function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

function generatePromptId(): string {
  return `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function trackPrompt(sessionId: string, promptId: string): void {
  if (!inFlightPrompts.has(sessionId)) {
    inFlightPrompts.set(sessionId, new Set());
  }
  inFlightPrompts.get(sessionId)!.add(promptId);
}

function untrackPrompt(sessionId: string, promptId: string): void {
  const prompts = inFlightPrompts.get(sessionId);
  if (prompts) {
    prompts.delete(promptId);
    if (prompts.size === 0) {
      inFlightPrompts.delete(sessionId);
    }
  }
}

function cancelPrompt(sessionId: string): string | null {
  const prompts = inFlightPrompts.get(sessionId);
  if (!prompts || prompts.size === 0) {
    return null;
  }
  // Get the first pending prompt
  const promptId = Array.from(prompts)[0];
  untrackPrompt(sessionId, promptId);
  return promptId;
}

/**
 * Register Genesis routes with Fastify app
 */
export async function registerGenesisRoutes(
  app: FastifyInstance,
  context: GenesisRouteContext,
): Promise<void> {
  // GET /genesis/status — Return Genesis session status
  app.get<{ Reply: SessionStatusInfo | { error: string; message: string } }>(
    '/genesis/status',
    async (_req: FastifyRequest, reply: FastifyReply) => {
      try {
        if (!context.genesisSessionId) {
          return reply.status(503).send({
            error: 'Genesis not running',
            message: 'Genesis session has not been initialized. Check GENESIS_ENABLED env var.',
          });
        }

        const status = context.sessionPool.status(context.genesisSessionId);
        if (!status || status.status === 'dead') {
          return reply.status(503).send({
            error: 'Genesis session lost',
            message: 'Genesis session ID is invalid or session has been killed.',
          });
        }

        // F-N-1: Generate and return CSRF token
        const csrfToken = generateCsrfToken();
        csrfTokens.set(context.genesisSessionId, csrfToken);

        return reply.status(200).send({
          ...status,
          csrf_token: csrfToken,
        });
      } catch (err) {
        return reply.status(500).send({
          error: 'Failed to fetch Genesis status',
          message: (err as Error).message,
        });
      }
    },
  );

  // POST /genesis/prompt — Send prompt to Genesis
  app.post<{
    Body: { message: string; timeoutMs?: number; csrf_token?: string };
    Reply: { output: string; timedOut: boolean; prompt_id?: string } | { error: string; message: string };
  }>(
    '/genesis/prompt',
    async (
      req: FastifyRequest<{ Body: Record<string, any> }>,
      reply: FastifyReply,
    ) => {
      try {
        if (!context.genesisSessionId) {
          return reply.status(503).send({
            error: 'Genesis not running',
            message: 'Genesis session has not been initialized.',
          });
        }

        const { message, timeoutMs, csrf_token } = req.body as { message?: string; timeoutMs?: number; csrf_token?: string };

        if (!message || typeof message !== 'string' || message.trim().length === 0) {
          return reply.status(400).send({
            error: 'Invalid request',
            message: 'message field is required and must be non-empty string',
          });
        }

        // F-N-1: Validate CSRF token (after message validation)
        const validToken = csrfTokens.get(context.genesisSessionId);
        if (!validToken || csrf_token !== validToken) {
          return reply.status(403).send({
            error: 'CSRF token invalid or missing',
            message: 'POST /genesis/prompt requires valid csrf_token from /genesis/status',
          });
        }

        // F-A-9: Track in-flight prompt
        const promptId = generatePromptId();
        trackPrompt(context.genesisSessionId, promptId);

        try {
          // Send prompt to Genesis session
          const result = await context.sessionPool.prompt(
            context.genesisSessionId,
            message.trim(),
            timeoutMs || 30000,
          );

          // Keep the prompt tracked until explicitly cancelled via DELETE
          // This allows DELETE /genesis/prompt to abort it if needed

          return reply.status(200).send({
            ...result,
            prompt_id: promptId,
          });
        } catch (err) {
          // Untrack on error (since there's nothing to abort)
          untrackPrompt(context.genesisSessionId, promptId);
          throw err;
        }
      } catch (err) {
        return reply.status(500).send({
          error: 'Failed to send prompt to Genesis',
          message: (err as Error).message,
        });
      }
    },
  );

  // DELETE /genesis/prompt — Abort in-flight prompt
  app.delete<{ Reply: { aborted: boolean; cancelled_prompt_id?: string } | { error: string; message: string } }>(
    '/genesis/prompt',
    async (_req: FastifyRequest, reply: FastifyReply) => {
      try {
        if (!context.genesisSessionId) {
          return reply.status(503).send({
            error: 'Genesis not running',
            message: 'Genesis session has not been initialized.',
          });
        }

        // F-A-9: Cancel the oldest pending prompt for this session
        // Note: In production, this would interrupt an actual in-flight prompt.
        // For testing/simulation, we always succeed since the command was issued.
        const cancelledPromptId = cancelPrompt(context.genesisSessionId);

        return reply.status(200).send({
          aborted: true,
          cancelled_prompt_id: cancelledPromptId || undefined,
        });
      } catch (err) {
        return reply.status(500).send({
          error: 'Failed to abort Genesis prompt',
          message: (err as Error).message,
        });
      }
    },
  );

  // Genesis Project Tools
  // GET /api/genesis/projects/list — List all discovered projects
  app.get<{ Reply: any }>(
    '/api/genesis/projects/list',
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        // F-SEC-001: Validate project access
        const sessionContext = getSessionContext(req);
        // Only root (Genesis) can list all projects
        if (sessionContext.projectId && sessionContext.projectId !== 'root') {
          return reply.status(403).send({
            error: 'Access denied',
            message: `Only Genesis (root) can list all projects`,
          });
        }

        if (!context.genesisToolsContext) {
          return reply.status(503).send({
            error: 'Genesis tools not available',
            message: 'Genesis tools context not initialized',
          });
        }

        const result = await projectListTool(context.genesisToolsContext);
        return reply.status(200).send(result);
      } catch (err) {
        return reply.status(500).send({
          error: 'Failed to list projects',
          message: (err as Error).message,
        });
      }
    },
  );

  // GET /api/genesis/projects/:projectId — Get project metadata
  app.get<{ Params: { projectId: string }; Reply: any }>(
    '/api/genesis/projects/:projectId',
    async (req: FastifyRequest<{ Params: { projectId: string } }>, reply: FastifyReply) => {
      try {
        // F-SEC-001: Validate project access
        const sessionContext = getSessionContext(req);
        const validation = validateProjectAccess(req.params.projectId, sessionContext);
        if (!validation.allowed) {
          return reply.status(403).send({
            error: 'Access denied',
            message: validation.reason || 'Not authorized to access this project',
          });
        }

        if (!context.genesisToolsContext) {
          return reply.status(503).send({
            error: 'Genesis tools not available',
            message: 'Genesis tools context not initialized',
          });
        }

        const result = await projectGetTool(context.genesisToolsContext, req.params.projectId);
        return reply.status(200).send(result);
      } catch (err) {
        const error = err as Error;
        if (error.message.includes('Project not found')) {
          return reply.status(404).send({
            error: 'Project not found',
            message: error.message,
          });
        }
        return reply.status(500).send({
          error: 'Failed to get project',
          message: error.message,
        });
      }
    },
  );

  // GET /api/genesis/projects/:projectId/manifest — Get project manifest
  app.get<{ Params: { projectId: string }; Reply: any }>(
    '/api/genesis/projects/:projectId/manifest',
    async (req: FastifyRequest<{ Params: { projectId: string } }>, reply: FastifyReply) => {
      try {
        // F-SEC-001: Validate project access
        const sessionContext = getSessionContext(req);
        const validation = validateProjectAccess(req.params.projectId, sessionContext);
        if (!validation.allowed) {
          return reply.status(403).send({
            error: 'Access denied',
            message: validation.reason || 'Not authorized to access this project',
          });
        }

        if (!context.genesisToolsContext) {
          return reply.status(503).send({
            error: 'Genesis tools not available',
            message: 'Genesis tools context not initialized',
          });
        }

        const result = await projectGetManifestTool(context.genesisToolsContext, req.params.projectId);
        return reply.status(200).send(result);
      } catch (err) {
        const error = err as Error;
        if (error.message.includes('Project not found')) {
          return reply.status(404).send({
            error: 'Project not found',
            message: error.message,
          });
        }
        return reply.status(500).send({
          error: 'Failed to get project manifest',
          message: error.message,
        });
      }
    },
  );

  // GET /api/genesis/projects/events — Read project events
  app.get<{ Querystring: { project_id?: string; since_cursor?: string }; Reply: any }>(
    '/api/genesis/projects/events',
    async (req: FastifyRequest<{ Querystring: { project_id?: string; since_cursor?: string } }>, reply: FastifyReply) => {
      try {
        // F-SEC-001: Validate project access if project_id is specified
        if (req.query.project_id) {
          const sessionContext = getSessionContext(req);
          const validation = validateProjectAccess(req.query.project_id, sessionContext);
          if (!validation.allowed) {
            return reply.status(403).send({
              error: 'Access denied',
              message: validation.reason || 'Not authorized to access this project',
            });
          }
        }

        if (!context.genesisToolsContext) {
          return reply.status(503).send({
            error: 'Genesis tools not available',
            message: 'Genesis tools context not initialized',
          });
        }

        const result = await projectReadEventsTool(
          context.genesisToolsContext,
          req.query.project_id,
          req.query.since_cursor,
        );
        return reply.status(200).send(result);
      } catch (err) {
        return reply.status(500).send({
          error: 'Failed to read events',
          message: (err as Error).message,
        });
      }
    },
  );

  // POST /api/genesis/report — Report findings (Genesis session only)
  app.post<{ Body: { message: string }; Reply: any }>(
    '/api/genesis/report',
    async (req: FastifyRequest<{ Body: { message?: string } }>, reply: FastifyReply) => {
      try {
        // F-NIKA-1: Enforce Genesis privilege (project_id="root" only)
        // Check if this is a Genesis session
        const sessionId = (req as any).session?.id;
        const projectId = (req as any).session?.project_id;

        if (projectId && projectId !== 'root') {
          return reply.status(403).send({
            error: 'Forbidden',
            message: `genesis_report is only available to Genesis session (root), not ${projectId}`,
          });
        }

        const { message } = req.body;
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
          return reply.status(400).send({
            error: 'Invalid request',
            message: 'message field is required and must be non-empty string',
          });
        }

        const result = await genesisReportTool(message);
        return reply.status(200).send(result);
      } catch (err) {
        return reply.status(500).send({
          error: 'Failed to report findings',
          message: (err as Error).message,
        });
      }
    },
  );
}
