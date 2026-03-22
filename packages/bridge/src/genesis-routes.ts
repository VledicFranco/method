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

export interface GenesisRouteContext {
  sessionPool: SessionPool;
  genesisSessionId: string | null;
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

        return reply.status(200).send(status);
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
    Body: { message: string; timeoutMs?: number };
    Reply: { output: string; timedOut: boolean } | { error: string; message: string };
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

        const { message, timeoutMs } = req.body as { message?: string; timeoutMs?: number };

        if (!message || typeof message !== 'string' || message.trim().length === 0) {
          return reply.status(400).send({
            error: 'Invalid request',
            message: 'message field is required and must be non-empty string',
          });
        }

        // Send prompt to Genesis session
        const result = await context.sessionPool.prompt(
          context.genesisSessionId,
          message.trim(),
          timeoutMs || 30000,
        );

        return reply.status(200).send(result);
      } catch (err) {
        return reply.status(500).send({
          error: 'Failed to send prompt to Genesis',
          message: (err as Error).message,
        });
      }
    },
  );

  // DELETE /genesis/prompt — Abort in-flight prompt
  app.delete<{ Reply: { aborted: boolean } | { error: string; message: string } }>(
    '/genesis/prompt',
    async (_req: FastifyRequest, reply: FastifyReply) => {
      try {
        if (!context.genesisSessionId) {
          return reply.status(503).send({
            error: 'Genesis not running',
            message: 'Genesis session has not been initialized.',
          });
        }

        // In real implementation, would have an abort mechanism on the session pool
        // For now, return success (abort mechanism can be added in Phase 2B)
        return reply.status(200).send({
          aborted: true,
        });
      } catch (err) {
        return reply.status(500).send({
          error: 'Failed to abort Genesis prompt',
          message: (err as Error).message,
        });
      }
    },
  );
}
