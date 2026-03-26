/**
 * WS-3: HTTP routes for session persistence — browse/resume past sessions per project.
 *
 * Endpoints:
 *   GET  /sessions/history              — List all persisted sessions (optional ?workdir= filter)
 *   GET  /sessions/history/:id          — Get a single persisted session with transcript
 *   POST /sessions/history/:id/resume   — Resume a dead session (re-spawn with same workdir)
 */

import type { FastifyInstance } from 'fastify';
import type { SessionPersistenceStore } from './session-persistence.js';
import type { SessionPool } from './pool.js';

export interface PersistenceRouteDeps {
  persistence: SessionPersistenceStore;
  pool: SessionPool;
  tokenTracker: { registerSession(id: string, workdir: string, date: Date): void };
  writePidFile: () => void;
}

export function registerPersistenceRoutes(app: FastifyInstance, deps: PersistenceRouteDeps): void {
  const { persistence, pool, tokenTracker, writePidFile } = deps;

  // ── GET /sessions/history — List all persisted sessions ──

  app.get<{
    Querystring: { workdir?: string; limit?: string };
  }>('/sessions/history', async (request, reply) => {
    const { workdir, limit: limitStr } = request.query;
    const limit = limitStr ? parseInt(limitStr, 10) : 100;

    try {
      let sessions = await persistence.loadAll(workdir);

      // Apply limit
      if (limit > 0 && sessions.length > limit) {
        sessions = sessions.slice(0, limit);
      }

      // Strip transcripts from list view (too large)
      const summaries = sessions.map(({ transcript: _transcript, ...rest }) => rest);

      return reply.status(200).send({
        sessions: summaries,
        total: sessions.length,
        workdir: workdir ?? null,
      });
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  // ── GET /sessions/history/:id — Get a single persisted session ──

  app.get<{
    Params: { id: string };
  }>('/sessions/history/:id', async (request, reply) => {
    const { id } = request.params;

    try {
      const session = await persistence.loadById(id);
      if (!session) {
        return reply.status(404).send({ error: `Persisted session ${id} not found` });
      }

      return reply.status(200).send(session);
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  // ── POST /sessions/history/:id/resume — Resume a dead session ──

  app.post<{
    Params: { id: string };
    Body: {
      initial_prompt?: string;
      mode?: 'pty' | 'print';
    };
  }>('/sessions/history/:id/resume', async (request, reply) => {
    const { id } = request.params;
    const { initial_prompt, mode } = request.body ?? {};

    try {
      const persisted = await persistence.loadById(id);
      if (!persisted) {
        return reply.status(404).send({ error: `Persisted session ${id} not found` });
      }

      // Resume with the SAME session ID so Claude Code's --resume restores conversation context
      // PRD 028: mode field ignored — always print after PTY removal
      void mode; // accepted for API compat, not used
      const result = await pool.create({
        workdir: persisted.workdir,
        initialPrompt: initial_prompt,
        nickname: `${persisted.nickname}-resumed`,
        purpose: persisted.purpose ?? undefined,
        session_id: id,  // reuse original ID for Claude Code --resume
        metadata: {
          resumed_from: id,
          original_nickname: persisted.nickname,
        },
      });

      tokenTracker.registerSession(result.sessionId, persisted.workdir, new Date());
      writePidFile();

      return reply.status(201).send({
        session_id: result.sessionId,
        nickname: result.nickname,
        status: result.status,
        mode: result.mode,
        resumed_from: id,
      });
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });
}
