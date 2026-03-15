import Fastify from 'fastify';
import { createPool } from './pool.js';

// Configuration from environment variables
const PORT = parseInt(process.env.PORT ?? '3456', 10);
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude';
const SETTLE_DELAY_MS = parseInt(process.env.SETTLE_DELAY_MS ?? '2000', 10);
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS ?? '5', 10);

const pool = createPool({
  maxSessions: MAX_SESSIONS,
  claudeBin: CLAUDE_BIN,
  settleDelayMs: SETTLE_DELAY_MS,
});

const app = Fastify({ logger: true });

// ---------- Routes ----------

/**
 * POST /sessions — Spawn a new Claude Code agent session.
 */
app.post<{
  Body: {
    workdir: string;
    initial_prompt?: string;
    spawn_args?: string[];
    metadata?: Record<string, unknown>;
  };
}>('/sessions', async (request, reply) => {
  const { workdir, initial_prompt, spawn_args, metadata } = request.body ?? {};

  if (!workdir || typeof workdir !== 'string') {
    return reply.status(400).send({ error: 'Missing required field: workdir' });
  }

  try {
    const result = await pool.create({
      workdir,
      initialPrompt: initial_prompt,
      spawnArgs: spawn_args,
      metadata,
    });
    return reply.status(201).send({
      session_id: result.sessionId,
      status: result.status,
    });
  } catch (e) {
    const message = (e as Error).message;
    if (message.includes('pool full')) {
      return reply.status(503).send({ error: message });
    }
    return reply.status(500).send({ error: message });
  }
});

/**
 * POST /sessions/:id/prompt — Send a prompt to a session and wait for the response.
 */
app.post<{
  Params: { id: string };
  Body: { prompt: string; timeout_ms?: number };
}>('/sessions/:id/prompt', async (request, reply) => {
  const { id } = request.params;
  const { prompt, timeout_ms } = request.body ?? {};

  if (!prompt || typeof prompt !== 'string') {
    return reply.status(400).send({ error: 'Missing required field: prompt' });
  }

  try {
    const result = await pool.prompt(id, prompt, timeout_ms);
    return reply.status(200).send({
      output: result.output,
      timed_out: result.timedOut,
    });
  } catch (e) {
    const message = (e as Error).message;
    if (message.includes('not found')) {
      return reply.status(404).send({ error: message });
    }
    if (message.includes('dead')) {
      return reply.status(400).send({ error: message });
    }
    return reply.status(500).send({ error: message });
  }
});

/**
 * GET /sessions/:id/status — Get session status and queue depth.
 */
app.get<{
  Params: { id: string };
}>('/sessions/:id/status', async (request, reply) => {
  const { id } = request.params;

  try {
    const result = pool.status(id);
    return reply.status(200).send({
      session_id: result.sessionId,
      status: result.status,
      queue_depth: result.queueDepth,
      metadata: result.metadata,
      prompt_count: result.promptCount,
      last_activity_at: result.lastActivityAt.toISOString(),
      workdir: result.workdir,
    });
  } catch (e) {
    const message = (e as Error).message;
    if (message.includes('not found')) {
      return reply.status(404).send({ error: message });
    }
    return reply.status(500).send({ error: message });
  }
});

/**
 * DELETE /sessions/:id — Kill a session.
 */
app.delete<{
  Params: { id: string };
}>('/sessions/:id', async (request, reply) => {
  const { id } = request.params;

  try {
    const result = pool.kill(id);
    return reply.status(200).send({
      session_id: result.sessionId,
      killed: result.killed,
    });
  } catch (e) {
    const message = (e as Error).message;
    if (message.includes('not found')) {
      return reply.status(404).send({ error: message });
    }
    return reply.status(500).send({ error: message });
  }
});

/**
 * GET /sessions — List all sessions.
 */
app.get('/sessions', async (_request, reply) => {
  const sessions = pool.list();
  return reply.status(200).send(
    sessions.map((s) => ({
      session_id: s.sessionId,
      status: s.status,
      queue_depth: s.queueDepth,
      metadata: s.metadata,
      prompt_count: s.promptCount,
      last_activity_at: s.lastActivityAt.toISOString(),
      workdir: s.workdir,
    })),
  );
});

// ---------- Start ----------

async function start() {
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    app.log.info(`@method/bridge listening on port ${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
