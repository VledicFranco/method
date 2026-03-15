import { homedir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { createPool } from './pool.js';
import { createUsagePoller } from './usage-poller.js';
import { createTokenTracker } from './token-tracker.js';
import { registerDashboardRoute } from './dashboard-route.js';

// Configuration from environment variables
const PORT = parseInt(process.env.PORT ?? '3456', 10);
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude';
const SETTLE_DELAY_MS = parseInt(process.env.SETTLE_DELAY_MS ?? '2000', 10);
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS ?? '5', 10);
const CLAUDE_OAUTH_TOKEN = process.env.CLAUDE_OAUTH_TOKEN ?? null;
const USAGE_POLL_INTERVAL_MS = parseInt(process.env.USAGE_POLL_INTERVAL_MS ?? '60000', 10);
const CLAUDE_SESSIONS_DIR = process.env.CLAUDE_SESSIONS_DIR ?? join(homedir(), '.claude', 'projects');
const DEAD_SESSION_TTL_MS = parseInt(process.env.DEAD_SESSION_TTL_MS ?? '300000', 10);

const pool = createPool({
  maxSessions: MAX_SESSIONS,
  claudeBin: CLAUDE_BIN,
  settleDelayMs: SETTLE_DELAY_MS,
});

const usagePoller = createUsagePoller({
  oauthToken: CLAUDE_OAUTH_TOKEN,
  pollIntervalMs: USAGE_POLL_INTERVAL_MS,
});

const tokenTracker = createTokenTracker({
  sessionsDir: CLAUDE_SESSIONS_DIR,
});

const BRIDGE_STARTED_AT = new Date();

const app = Fastify({ logger: true });

// ---------- Dashboard ----------

registerDashboardRoute(app, pool, usagePoller, tokenTracker, {
  port: PORT,
  startedAt: BRIDGE_STARTED_AT,
  version: '0.2.0',
});

// ---------- Health ----------

app.get('/health', async (_request, reply) => {
  const stats = pool.poolStats();
  return reply.status(200).send({
    status: 'ok',
    active_sessions: stats.activeSessions,
    max_sessions: stats.maxSessions,
    uptime_ms: Date.now() - BRIDGE_STARTED_AT.getTime(),
    version: '0.2.0',
  });
});

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
    parent_session_id?: string;
    depth?: number;
    budget?: { max_depth?: number; max_agents?: number; agents_spawned?: number };
  };
}>('/sessions', async (request, reply) => {
  const { workdir, initial_prompt, spawn_args, metadata, parent_session_id, depth, budget } = request.body ?? {};

  if (!workdir || typeof workdir !== 'string') {
    return reply.status(400).send({ error: 'Missing required field: workdir' });
  }

  try {
    const result = await pool.create({
      workdir,
      initialPrompt: initial_prompt,
      spawnArgs: spawn_args,
      metadata,
      parentSessionId: parent_session_id,
      depth,
      budget,
    });

    // Register session with token tracker
    tokenTracker.registerSession(result.sessionId, workdir, new Date());

    return reply.status(201).send({
      session_id: result.sessionId,
      status: result.status,
      depth: result.chain.depth,
      parent_session_id: result.chain.parent_session_id,
      budget: result.chain.budget,
    });
  } catch (e) {
    const message = (e as Error).message;
    if (message.includes('pool full')) {
      return reply.status(503).send({ error: message });
    }
    // Budget/depth errors come as JSON strings — try to parse and return structured
    try {
      const parsed = JSON.parse(message);
      if (parsed.error === 'DEPTH_EXCEEDED' || parsed.error === 'BUDGET_EXHAUSTED') {
        return reply.status(409).send(parsed);
      }
    } catch { /* not JSON, fall through */ }
    return reply.status(500).send({ error: message });
  }
});

/**
 * POST /sessions/:id/prompt — Send a prompt to a session and wait for the response.
 */
app.post<{
  Params: { id: string };
  Body: { prompt: string; timeout_ms?: number; settle_delay_ms?: number };
}>('/sessions/:id/prompt', async (request, reply) => {
  const { id } = request.params;
  const { prompt, timeout_ms, settle_delay_ms } = request.body ?? {};

  if (!prompt || typeof prompt !== 'string') {
    return reply.status(400).send({ error: 'Missing required field: prompt' });
  }

  try {
    const result = await pool.prompt(id, prompt, timeout_ms, settle_delay_ms);

    // Refresh token usage after each prompt
    tokenTracker.refreshUsage(id);

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
      parent_session_id: result.chain.parent_session_id,
      depth: result.chain.depth,
      children: result.chain.children,
      budget: result.chain.budget,
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
      parent_session_id: s.chain.parent_session_id,
      depth: s.chain.depth,
      children: s.chain.children,
      budget: s.chain.budget,
    })),
  );
});

// ---------- Start ----------

async function start() {
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    app.log.info(`@method/bridge listening on port ${PORT}`);

    // Start usage polling after server is listening
    usagePoller.start();

    // Dead session cleanup timer
    setInterval(() => {
      const removed = pool.removeDead(DEAD_SESSION_TTL_MS);
      if (removed > 0) {
        app.log.info(`Cleaned up ${removed} dead session(s) (TTL: ${DEAD_SESSION_TTL_MS}ms)`);
      }
    }, 60_000); // Check every minute
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

function gracefulShutdown(signal: string) {
  app.log.info(`Received ${signal} — shutting down gracefully`);

  // Stop accepting new connections
  app.close().then(() => {
    // Stop usage polling
    usagePoller.stop();

    // Kill all sessions
    const sessions = pool.list();
    let killed = 0;
    for (const session of sessions) {
      if (session.status !== 'dead') {
        try {
          pool.kill(session.sessionId);
          killed++;
        } catch { /* already dead */ }
      }
    }

    const uptimeMs = Date.now() - BRIDGE_STARTED_AT.getTime();
    app.log.info(`Shutdown complete: ${killed} sessions killed, uptime ${Math.floor(uptimeMs / 60000)}m`);
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

start();
