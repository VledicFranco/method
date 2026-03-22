/**
 * PRD 020 Phase 2A: Genesis HTTP Routes
 *
 * HTTP endpoints for Genesis agent interaction:
 * - GET    /genesis/status                           — Genesis session status (Active/Idle, budget, last action)
 * - POST   /genesis/prompt                           — Send prompt to Genesis session
 * - DELETE /genesis/prompt                           — Abort Genesis prompt (stop in-flight processing)
 * - GET    /api/genesis/projects/list                — List all discovered projects (root only)
 * - GET    /api/genesis/projects/:projectId          — Get project metadata
 * - GET    /api/genesis/projects/:projectId/manifest — Get project manifest
 * - GET    /api/genesis/projects/events              — Read project events (cursor-based pagination)
 * - POST   /api/genesis/report                       — Report findings (Genesis session only)
 *
 * HTTP Status Code Standardization (F-S-2):
 * - 200: Success (return data)
 * - 400: Bad request (invalid input: missing/malformed message, invalid cursor, out of bounds)
 * - 403: Forbidden (CSRF token invalid, access denied, authorization failed)
 * - 404: Not found (project not found, session not found)
 * - 500: Server error (unexpected exceptions)
 * - 501: Not implemented (PTY interrupt unavailable)
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
  /**
   * GET /genesis/status — Return Genesis session status
   *
   * @returns {Object} Success response (200)
   * @returns {SessionStatusInfo} - Session status including sessionId, nickname, status, etc.
   * @returns {string} csrf_token - CSRF token for POST /genesis/prompt (F-N-1)
   *
   * @returns {Object} Error response (503)
   * @returns {string} error - Error code: 'Genesis not running' or 'Genesis session lost'
   * @returns {string} message - Human-readable error message
   *
   * Error cases:
   * - 503 Genesis not running: genesisSessionId is null
   * - 503 Genesis session lost: session not found or marked dead
   * - 500 Server error: unexpected exception during status fetch
   */
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

  /**
   * POST /genesis/prompt — Send prompt to Genesis
   *
   * @param {Object} body - Request body
   * @param {string} body.message - Prompt message (required, non-empty)
   * @param {number} [body.timeoutMs] - Execution timeout in milliseconds (optional, default 30000)
   * @param {string} body.csrf_token - CSRF token from GET /genesis/status (required, F-N-1)
   *
   * @returns {Object} Success response (200)
   * @returns {string} output - Genesis prompt execution output
   * @returns {boolean} timedOut - Whether the prompt execution timed out
   * @returns {string} prompt_id - Unique prompt ID for tracking (F-A-9)
   *
   * @returns {Object} Error response (400)
   * @returns {string} error - Error code: 'Invalid request'
   * @returns {string} message - "message field is required and must be non-empty string"
   *
   * @returns {Object} Error response (403)
   * @returns {string} error - Error code: 'CSRF token invalid or missing'
   * @returns {string} message - Human-readable explanation of CSRF failure
   *
   * @returns {Object} Error response (503)
   * @returns {string} error - Error code: 'Genesis not running'
   * @returns {string} message - "Genesis session has not been initialized"
   *
   * @returns {Object} Error response (500)
   * @returns {string} error - Error code: 'Failed to send prompt to Genesis'
   * @returns {string} message - Exception message
   *
   * Error cases:
   * - 400 Invalid request: message missing, empty, or whitespace-only
   * - 403 CSRF token invalid: csrf_token missing or doesn't match stored token
   * - 503 Genesis not running: genesisSessionId is null
   * - 500 Server error: unexpected exception during prompt execution
   */
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

  /**
   * DELETE /genesis/prompt — Abort in-flight prompt
   *
   * Cancels the oldest pending prompt and attempts to interrupt the PTY session with CTRL-C.
   *
   * @returns {Object} Success response (200)
   * @returns {boolean} aborted - Always true on success
   * @returns {string} [cancelled_prompt_id] - ID of cancelled prompt (F-A-9), if one existed
   *
   * @returns {Object} Not implemented response (501)
   * @returns {boolean} aborted - Always false (PTY interrupt unavailable)
   * @returns {string} reason - Error code: 'pty_interrupt_not_supported'
   *
   * @returns {Object} Error response (503)
   * @returns {string} error - Error code: 'Genesis not running'
   * @returns {string} message - "Genesis session has not been initialized"
   *
   * @returns {Object} Error response (500)
   * @returns {string} error - Error code: 'Failed to abort Genesis prompt'
   * @returns {string} message - Exception message
   *
   * Error cases:
   * - 200 Success: prompt successfully aborted via CTRL-C
   * - 501 Not implemented: session exists but PTY interrupt unavailable (print mode or dead)
   * - 503 Genesis not running: genesisSessionId is null
   * - 500 Server error: unexpected exception during abort
   */
  app.delete<{ Reply: { aborted: boolean; cancelled_prompt_id?: string; reason?: string } | { aborted: false; reason: string } | { error: string; message: string } }>(
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
        const cancelledPromptId = cancelPrompt(context.genesisSessionId);

        // Get the session to attempt PTY interrupt
        const session = context.sessionPool.getSession(context.genesisSessionId);
        if (!session) {
          // Session doesn't exist
          return reply.status(501).send({
            aborted: false,
            reason: 'pty_interrupt_not_supported',
          });
        }

        // Attempt to send CTRL-C to PTY stdin
        const interrupted = session.interrupt();

        if (interrupted) {
          return reply.status(200).send({
            aborted: true,
            cancelled_prompt_id: cancelledPromptId || undefined,
          });
        } else {
          // PTY interrupt not available (e.g., print mode or dead session)
          return reply.status(501).send({
            aborted: false,
            reason: 'pty_interrupt_not_supported',
          });
        }
      } catch (err) {
        return reply.status(500).send({
          error: 'Failed to abort Genesis prompt',
          message: (err as Error).message,
        });
      }
    },
  );

  /**
   * Genesis Project Tools
   * GET /api/genesis/projects/list — List all discovered projects
   *
   * Returns all discovered projects. Only root (Genesis) can call this.
   *
   * @returns {Object} Success response (200)
   * @returns {Array} projects - Array of discovered project objects (ordered by name, ascending, F-S-5)
   * @returns {boolean} stopped_at_max_projects - Whether discovery was capped at max
   * @returns {number} scanned_count - Total projects scanned
   * @returns {boolean} discovery_incomplete - Whether scan is still in progress
   *
   * @returns {Object} Error response (403)
   * @returns {string} error - Error code: 'Access denied'
   * @returns {string} message - "Only Genesis (root) can list all projects"
   *
   * @returns {Object} Error response (503)
   * @returns {string} error - Error code: 'Genesis tools not available'
   * @returns {string} message - "Genesis tools context not initialized"
   *
   * @returns {Object} Error response (500)
   * @returns {string} error - Error code: 'Failed to list projects'
   * @returns {string} message - Exception message
   *
   * Error cases:
   * - 403 Access denied: caller is not root (F-SEC-001)
   * - 503 Genesis tools not available: tools context not initialized
   * - 500 Server error: unexpected exception during listing
   */
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
        // Results ordered by name (ascending) — F-S-5
        return reply.status(200).send(result);
      } catch (err) {
        return reply.status(500).send({
          error: 'Failed to list projects',
          message: (err as Error).message,
        });
      }
    },
  );

  /**
   * GET /api/genesis/projects/:projectId — Get project metadata
   *
   * Returns metadata for a single project. Requires authorization to access the project.
   *
   * @param {string} projectId - Project ID (URL path parameter)
   *
   * @returns {Object} Success response (200)
   * @returns {string} id - Project ID
   * @returns {string} summary - Project summary
   * @returns {Object} metadata - Additional project metadata
   *
   * @returns {Object} Error response (403)
   * @returns {string} error - Error code: 'Access denied'
   * @returns {string} message - Authorization failure reason (F-SEC-001)
   *
   * @returns {Object} Error response (404)
   * @returns {string} error - Error code: 'Project not found'
   * @returns {string} message - Exception message with details
   *
   * @returns {Object} Error response (503)
   * @returns {string} error - Error code: 'Genesis tools not available'
   * @returns {string} message - "Genesis tools context not initialized"
   *
   * @returns {Object} Error response (500)
   * @returns {string} error - Error code: 'Failed to get project'
   * @returns {string} message - Exception message
   *
   * Error cases:
   * - 403 Access denied: caller not authorized for this project (F-SEC-001)
   * - 404 Project not found: projectId doesn't exist
   * - 503 Genesis tools not available: tools context not initialized
   * - 500 Server error: unexpected exception during fetch
   */
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
        // Single result (no ordering needed) — F-S-5
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

  /**
   * GET /api/genesis/projects/:projectId/manifest — Get project manifest
   *
   * Returns the manifest.yaml for a single project. Requires authorization.
   *
   * @param {string} projectId - Project ID (URL path parameter)
   *
   * @returns {Object} Success response (200)
   * @returns {Object} - Manifest YAML content (methodologies, strategies, etc.)
   *
   * @returns {Object} Error response (403)
   * @returns {string} error - Error code: 'Access denied'
   * @returns {string} message - Authorization failure reason (F-SEC-001)
   *
   * @returns {Object} Error response (404)
   * @returns {string} error - Error code: 'Project not found'
   * @returns {string} message - Exception message with details
   *
   * @returns {Object} Error response (503)
   * @returns {string} error - Error code: 'Genesis tools not available'
   * @returns {string} message - "Genesis tools context not initialized"
   *
   * @returns {Object} Error response (500)
   * @returns {string} error - Error code: 'Failed to get project manifest'
   * @returns {string} message - Exception message
   *
   * Error cases:
   * - 403 Access denied: caller not authorized for this project (F-SEC-001)
   * - 404 Project not found: projectId doesn't exist
   * - 503 Genesis tools not available: tools context not initialized
   * - 500 Server error: unexpected exception during fetch
   */
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
        // Single result (no ordering needed) — F-S-5
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

  /**
   * GET /api/genesis/projects/events — Read project events (cursor-based pagination)
   *
   * Returns events across all projects or for a specific project, with cursor-based pagination.
   * Results are ordered by timestamp (ascending, F-S-5).
   *
   * @param {string} [query.project_id] - Optional project ID to filter events (F-SEC-001)
   * @param {string} [query.since_cursor] - Optional cursor for pagination (F-N-11)
   *
   * @returns {Object} Success response (200)
   * @returns {Array} events - Array of project events, ordered by timestamp (ascending)
   * @returns {string} [nextCursor] - Cursor for next page of results (if more available)
   *
   * @returns {Object} Error response (400)
   * @returns {string} error - Error code: 'Invalid cursor format'
   * @returns {string} message - "since_cursor must be alphanumeric with underscores/hyphens, 40-256 chars"
   *
   * @returns {Object} Error response (403)
   * @returns {string} error - Error code: 'Access denied'
   * @returns {string} message - Authorization failure reason (F-SEC-001)
   *
   * @returns {Object} Error response (503)
   * @returns {string} error - Error code: 'Genesis tools not available'
   * @returns {string} message - "Genesis tools context not initialized"
   *
   * @returns {Object} Error response (500)
   * @returns {string} error - Error code: 'Failed to read events'
   * @returns {string} message - Exception message
   *
   * Error cases:
   * - 400 Invalid cursor format: since_cursor fails validation (F-N-11)
   * - 403 Access denied: caller not authorized for specified project (F-SEC-001)
   * - 503 Genesis tools not available: tools context not initialized
   * - 500 Server error: unexpected exception during read
   */
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

        // F-N-11: Validate cursor format before passing to tool
        if (req.query.since_cursor && !/^[a-zA-Z0-9_-]{40,256}$/.test(req.query.since_cursor)) {
          return reply.status(400).send({
            error: 'Invalid cursor format',
            message: 'since_cursor must be alphanumeric with underscores/hyphens, 40-256 chars',
          });
        }

        const result = await projectReadEventsTool(
          context.genesisToolsContext,
          req.query.project_id,
          req.query.since_cursor,
        );
        // Results ordered by timestamp (ascending) — F-S-5
        return reply.status(200).send(result);
      } catch (err) {
        return reply.status(500).send({
          error: 'Failed to read events',
          message: (err as Error).message,
        });
      }
    },
  );

  /**
   * POST /api/genesis/report — Report findings (Genesis session only)
   *
   * Allows Genesis (root project) to record findings in the method system.
   * Only callable from project_id="root" (F-NIKA-1).
   *
   * @param {Object} body - Request body
   * @param {string} body.message - Report message (required, non-empty)
   *
   * @returns {Object} Success response (200)
   * @returns {Object} - Report confirmation/result from genesisReportTool
   *
   * @returns {Object} Error response (400)
   * @returns {string} error - Error code: 'Invalid request'
   * @returns {string} message - "message field is required and must be non-empty string"
   *
   * @returns {Object} Error response (403)
   * @returns {string} error - Error code: 'Forbidden'
   * @returns {string} message - "genesis_report is only available to Genesis session (root), not {projectId}"
   *
   * @returns {Object} Error response (500)
   * @returns {string} error - Error code: 'Failed to report findings'
   * @returns {string} message - Exception message
   *
   * Error cases:
   * - 400 Invalid request: message missing, empty, or whitespace-only
   * - 403 Forbidden: caller is not Genesis (project_id != "root", F-NIKA-1)
   * - 500 Server error: unexpected exception during report
   */
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
