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

// ---------- Channels (PRD 008) ----------

import { appendMessage, readMessages, type ChannelMessage } from './channels.js';

/**
 * POST /sessions/:id/channels/progress — Agent reports progress
 */
app.post<{
  Params: { id: string };
  Body: { type: string; content: Record<string, unknown>; sender?: string };
}>('/sessions/:id/channels/progress', async (request, reply) => {
  const { id } = request.params;
  const { type, content, sender } = request.body ?? {};

  if (!type || typeof type !== 'string') {
    return reply.status(400).send({ error: 'Missing required field: type' });
  }

  try {
    const channels = pool.getChannels(id);
    const sequence = appendMessage(channels.progress, sender ?? id, type, content ?? {});
    return reply.status(201).send({ sequence, acknowledged: true });
  } catch (e) {
    const message = (e as Error).message;
    if (message.includes('not found')) {
      return reply.status(404).send({ error: message });
    }
    return reply.status(500).send({ error: message });
  }
});

/**
 * POST /sessions/:id/channels/events — Agent reports lifecycle events
 */
app.post<{
  Params: { id: string };
  Body: { type: string; content: Record<string, unknown>; sender?: string };
}>('/sessions/:id/channels/events', async (request, reply) => {
  const { id } = request.params;
  const { type, content, sender } = request.body ?? {};

  if (!type || typeof type !== 'string') {
    return reply.status(400).send({ error: 'Missing required field: type' });
  }

  try {
    const channels = pool.getChannels(id);
    const sequence = appendMessage(channels.events, sender ?? id, type, content ?? {});

    // Push notification to parent (PRD 008 Component 2)
    const PUSHABLE_EVENTS = new Set(['completed', 'error', 'escalation', 'budget_warning', 'stale']);
    if (PUSHABLE_EVENTS.has(type)) {
      try {
        const status = pool.status(id);
        const parentId = status.chain.parent_session_id;
        if (parentId) {
          const parentStatus = pool.status(parentId);
          if (parentStatus.status !== 'dead') {
            const notification = [
              `BRIDGE NOTIFICATION — Child agent [${id.substring(0, 8)}] event: ${type}`,
              status.metadata?.commission_id
                ? `Commission: ${status.metadata.commission_id} — ${status.metadata.task_summary ?? 'no summary'}`
                : `Session: ${id.substring(0, 8)}`,
              `Details: ${JSON.stringify(content ?? {})}`,
              `Action required: ${type === 'completed' ? 'Collect results and proceed' : type === 'error' ? 'Decide: retry, escalate, or abort' : type === 'escalation' ? 'Child is blocked — provide input' : type === 'budget_warning' ? 'Increase budget or restructure' : 'Investigate stale session'}`,
            ].join('\n');

            // Fire-and-forget — don't await, don't block on response
            pool.prompt(parentId, notification).catch(() => {
              // Push notification delivery failure is non-fatal
            });
          }
        }
      } catch {
        // Parent lookup failure is non-fatal — session may have been killed
      }
    }

    return reply.status(201).send({ sequence, acknowledged: true });
  } catch (e) {
    const message = (e as Error).message;
    if (message.includes('not found')) {
      return reply.status(404).send({ error: message });
    }
    return reply.status(500).send({ error: message });
  }
});

/**
 * GET /sessions/:id/channels/progress — Parent reads child progress
 */
app.get<{
  Params: { id: string };
  Querystring: { since_sequence?: string; reader_id?: string };
}>('/sessions/:id/channels/progress', async (request, reply) => {
  const { id } = request.params;
  const sinceSequence = parseInt(request.query.since_sequence ?? '0', 10);
  const readerId = request.query.reader_id;

  try {
    const channels = pool.getChannels(id);
    const result = readMessages(channels.progress, sinceSequence, readerId);
    return reply.status(200).send(result);
  } catch (e) {
    const message = (e as Error).message;
    if (message.includes('not found')) {
      return reply.status(404).send({ error: message });
    }
    return reply.status(500).send({ error: message });
  }
});

/**
 * GET /sessions/:id/channels/events — Parent reads child events
 */
app.get<{
  Params: { id: string };
  Querystring: { since_sequence?: string; reader_id?: string };
}>('/sessions/:id/channels/events', async (request, reply) => {
  const { id } = request.params;
  const sinceSequence = parseInt(request.query.since_sequence ?? '0', 10);
  const readerId = request.query.reader_id;

  try {
    const channels = pool.getChannels(id);
    const result = readMessages(channels.events, sinceSequence, readerId);
    return reply.status(200).send(result);
  } catch (e) {
    const message = (e as Error).message;
    if (message.includes('not found')) {
      return reply.status(404).send({ error: message });
    }
    return reply.status(500).send({ error: message });
  }
});

/**
 * GET /channels/events — Cross-session event aggregation
 */
app.get<{
  Querystring: { since_sequence?: string; filter_type?: string };
}>('/channels/events', async (_request, reply) => {
  const sinceSequence = parseInt(_request.query.since_sequence ?? '0', 10);
  const filterType = _request.query.filter_type;

  const sessions = pool.list();
  const events: Array<{
    bridge_session_id: string;
    session_metadata: Record<string, unknown>;
    message: ChannelMessage;
  }> = [];

  let globalLastSequence = sinceSequence;

  for (const session of sessions) {
    try {
      const channels = pool.getChannels(session.sessionId);
      const result = readMessages(channels.events, sinceSequence);

      for (const msg of result.messages) {
        if (filterType && msg.type !== filterType) continue;
        events.push({
          bridge_session_id: session.sessionId,
          session_metadata: {
            commission_id: (session.metadata as Record<string, unknown> | undefined)?.commission_id,
            task_summary: (session.metadata as Record<string, unknown> | undefined)?.task_summary,
            methodology: (session.metadata as Record<string, unknown> | undefined)?.methodology_session_id,
          } as Record<string, unknown>,
          message: msg,
        });
        if (msg.sequence > globalLastSequence) {
          globalLastSequence = msg.sequence;
        }
      }
    } catch {
      // Session may have been cleaned up between list() and getChannels()
    }
  }

  // Sort by timestamp
  events.sort((a, b) => a.message.timestamp.localeCompare(b.message.timestamp));

  return reply.status(200).send({
    events,
    last_sequence: globalLastSequence,
  });
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
