import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import Fastify from 'fastify';
import { createPool } from './domains/sessions/pool.js';
import { createUsagePoller } from './domains/tokens/usage-poller.js';
import { createTokenTracker } from './domains/tokens/tracker.js';
import { registerTokenRoutes } from './domains/tokens/routes.js';
import { registerLiveOutputRoutes } from './domains/sessions/live-output-route.js';
import { registerTranscriptRoutes } from './domains/sessions/transcript-route.js';
import { createTranscriptReader } from './domains/sessions/transcript-reader.js';
import { registerStrategyRoutes } from './domains/strategies/strategy-routes.js';
import { ClaudeCodeProvider } from './domains/strategies/claude-code-provider.js';
import { TriggerRouter, scanAndRegisterTriggers, registerTriggerRoutes } from './domains/triggers/index.js';
import { addOnMessageHook } from './domains/sessions/channels.js';
import { registerFrontendRoutes } from './frontend-route.js';
import { registerRegistryRoutes } from './domains/registry/routes.js';
import { MethodologySessionStore } from './domains/methodology/store.js';
import { registerMethodologyRoutes } from './domains/methodology/routes.js';
import { spawnGenesis, getGenesisSessionId } from './domains/genesis/spawner.js';
import { GenesisPollingLoop } from './domains/genesis/polling-loop.js';
import { CursorMaintenanceJob } from './domains/genesis/cursor-manager.js';
import { registerGenesisRoutes } from './domains/genesis/routes.js';
import { registerProjectRoutes, eventLog, cursorMap, getEventsFromLog, setOnEventHook } from './domains/projects/routes.js';
import websocket from '@fastify/websocket';
import { WsHub } from './ws-hub.js';
import { registerWsRoute } from './ws-route.js';
import { setOnExecutionChangeHook } from './domains/strategies/strategy-routes.js';
import { DiscoveryService } from './domains/projects/discovery-service.js';
import { InMemoryProjectRegistry } from './domains/registry/index.js';
import { JsonLineEventPersistence, YamlEventPersistence } from './domains/projects/events/index.js';

// Configuration from environment variables
const ROOT_DIR = process.env.ROOT_DIR ?? process.cwd();
const PORT = parseInt(process.env.PORT ?? '3456', 10);
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude';
const SETTLE_DELAY_MS = parseInt(process.env.SETTLE_DELAY_MS ?? '1000', 10);
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS ?? '10', 10);
const CLAUDE_OAUTH_TOKEN = process.env.CLAUDE_OAUTH_TOKEN ?? null;
const USAGE_POLL_INTERVAL_MS = parseInt(process.env.USAGE_POLL_INTERVAL_MS ?? '600000', 10);
const CLAUDE_SESSIONS_DIR = process.env.CLAUDE_SESSIONS_DIR ?? join(homedir(), '.claude', 'projects');
const DEAD_SESSION_TTL_MS = parseInt(process.env.DEAD_SESSION_TTL_MS ?? '300000', 10);
const STALE_CHECK_INTERVAL_MS = parseInt(process.env.STALE_CHECK_INTERVAL_MS ?? '60000', 10);
const BATCH_STAGGER_MS = parseInt(process.env.BATCH_STAGGER_MS ?? '3000', 10);
const MIN_SPAWN_GAP_MS = parseInt(process.env.MIN_SPAWN_GAP_MS ?? '2000', 10);
const GENESIS_ENABLED = process.env.GENESIS_ENABLED === 'true';
const GENESIS_POLLING_INTERVAL_MS = parseInt(process.env.GENESIS_POLLING_INTERVAL_MS ?? '5000', 10);
const CURSOR_CLEANUP_INTERVAL_MS = parseInt(process.env.CURSOR_CLEANUP_INTERVAL_MS ?? '3600000', 10);

const pool = createPool({
  maxSessions: MAX_SESSIONS,
  claudeBin: CLAUDE_BIN,
  settleDelayMs: SETTLE_DELAY_MS,
  minSpawnGapMs: MIN_SPAWN_GAP_MS,
});

const usagePoller = createUsagePoller({
  oauthToken: CLAUDE_OAUTH_TOKEN,
  pollIntervalMs: USAGE_POLL_INTERVAL_MS,
});

const tokenTracker = createTokenTracker({
  sessionsDir: CLAUDE_SESSIONS_DIR,
});

const transcriptReader = createTranscriptReader({
  sessionsDir: CLAUDE_SESSIONS_DIR,
});

let genesisPollingLoop: GenesisPollingLoop | null = null;
let cursorMaintenanceJob: CursorMaintenanceJob | null = null;

const BRIDGE_STARTED_AT = new Date();

// ── PID file: tracks child process PIDs so external scripts can clean up without nuking all claude.exe ──

const PID_FILE_PATH = join(tmpdir(), `method-bridge-${PORT}.pids`);

function writePidFile(): void {
  try {
    const pids = pool.childPids();
    writeFileSync(PID_FILE_PATH, pids.join('\n') + '\n', { encoding: 'utf-8', mode: 0o600 });
  } catch { /* PID file write failure is non-fatal */ }
}

function removePidFile(): void {
  try { unlinkSync(PID_FILE_PATH); } catch { /* already gone */ }
}

const app = Fastify({ logger: true });

// ---------- WebSocket (real-time push) ----------

app.register(websocket);
const wsHub = new WsHub();
registerWsRoute(app, wsHub);

// Wire WsHub to data sources
setOnEventHook((event) => {
  wsHub.publish('events', event, (filter) =>
    !filter.project_id || filter.project_id === event.projectId,
  );
});
setOnExecutionChangeHook((entry) => {
  wsHub.publish('executions', entry, (filter) =>
    !filter.execution_id || filter.execution_id === entry.execution_id,
  );
});
// ---------- Live Output (PRD 007 Phase 2) ----------

registerLiveOutputRoutes(app, pool);

// ---------- Transcript Browser (PRD 007 Phase 3) ----------

registerTranscriptRoutes(app, pool, transcriptReader);

// ---------- Project Routes (PRD 020 Phase 2A) ----------

// F-I-2: Initialize and register project discovery routes
const discoveryService = new DiscoveryService();
const projectRegistry = new InMemoryProjectRegistry();

// ---------- Genesis Routes (PRD 020 Phase 2A) ----------

// F-A-1: Register Genesis tools routes
// Context will be populated when Genesis is spawned
const genesisRouteContext: any = {
  sessionPool: pool,
  genesisSessionId: null,
  genesisToolsContext: {
    discoveryService,
    rootDir: ROOT_DIR,
    eventLog,
    cursorMap,
  },
};

// ---------- Health ----------

app.get('/health', async (_request, reply) => {
  const stats = pool.poolStats();
  return reply.status(200).send({
    status: 'ok',
    active_sessions: stats.activeSessions,
    max_sessions: stats.maxSessions,
    uptime_ms: Date.now() - BRIDGE_STARTED_AT.getTime(),
    version: '0.3.0',
  });
});

// ---------- Pool Stats ----------

app.get('/pool/stats', async (_request, reply) => {
  const stats = pool.poolStats();
  return reply.status(200).send({
    max_sessions: stats.maxSessions,
    active_count: stats.activeSessions,
    dead_count: stats.deadSessions,
    total_spawned: stats.totalSpawned,
    uptime_ms: Date.now() - stats.startedAt.getTime(),
  });
});

// ---------- Token & Usage API ----------

registerTokenRoutes(app, tokenTracker, usagePoller);

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
    isolation?: 'worktree' | 'shared';
    timeout_ms?: number;
    nickname?: string;
    purpose?: string;
    spawn_delay_ms?: number;
    mode?: 'pty' | 'print';
    /** PRD 014: Glob patterns of files the agent is allowed to modify. */
    allowed_paths?: string[];
    /** PRD 014: Scope enforcement mode. */
    scope_mode?: 'enforce' | 'warn';
  };
}>('/sessions', async (request, reply) => {
  const { workdir, initial_prompt, spawn_args, metadata, parent_session_id, depth, budget, isolation, timeout_ms, nickname, purpose, spawn_delay_ms, mode, allowed_paths, scope_mode } = request.body ?? {};

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
      isolation,
      timeout_ms,
      nickname,
      purpose,
      spawn_delay_ms,
      mode,
      allowed_paths,
      scope_mode,
    });

    // Register session with token tracker
    tokenTracker.registerSession(result.sessionId, workdir, new Date());
    writePidFile();

    app.log.info(`[${result.nickname}] Session spawned`);

    return reply.status(201).send({
      session_id: result.sessionId,
      nickname: result.nickname,
      status: result.status,
      mode: result.mode,
      depth: result.chain.depth,
      parent_session_id: result.chain.parent_session_id,
      budget: result.chain.budget,
      isolation: result.worktree.isolation,
      worktree_path: result.worktree.worktree_path,
      metals_available: result.worktree.metals_available,
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
 * POST /sessions/batch — Spawn multiple sessions with staggered delays (PRD 012).
 */
app.post<{
  Body: {
    sessions: Array<{
      workdir: string;
      initial_prompt?: string;
      spawn_args?: string[];
      metadata?: Record<string, unknown>;
      parent_session_id?: string;
      depth?: number;
      budget?: { max_depth?: number; max_agents?: number; agents_spawned?: number };
      isolation?: 'worktree' | 'shared';
      timeout_ms?: number;
      nickname?: string;
      purpose?: string;
      mode?: 'pty' | 'print';
      allowed_paths?: string[];
      scope_mode?: 'enforce' | 'warn';
    }>;
    stagger_ms?: number;
  };
}>('/sessions/batch', async (request, reply) => {
  const { sessions: sessionConfigs, stagger_ms } = request.body ?? {};

  if (!Array.isArray(sessionConfigs) || sessionConfigs.length === 0) {
    return reply.status(400).send({ error: 'Missing required field: sessions (non-empty array)' });
  }

  const stagger = stagger_ms ?? BATCH_STAGGER_MS;
  const results: Array<{
    session_id: string;
    nickname: string;
    status: string;
    mode: string;
    depth: number;
    parent_session_id: string | null;
    budget: { max_depth: number; max_agents: number; agents_spawned: number };
    isolation: string;
    worktree_path: string | null;
    metals_available: boolean;
    error?: string;
  }> = [];

  for (let i = 0; i < sessionConfigs.length; i++) {
    const cfg = sessionConfigs[i];

    // Stagger delay between spawns (skip delay for the first session)
    if (i > 0 && stagger > 0) {
      await new Promise(r => setTimeout(r, stagger));
    }

    if (!cfg.workdir || typeof cfg.workdir !== 'string') {
      results.push({
        session_id: '',
        nickname: '',
        status: 'error',
        mode: 'pty',
        depth: 0,
        parent_session_id: null,
        budget: { max_depth: 3, max_agents: 10, agents_spawned: 0 },
        isolation: 'shared',
        worktree_path: null,
        metals_available: true,
        error: `Session ${i}: missing required field: workdir`,
      });
      continue;
    }

    try {
      const result = await pool.create({
        workdir: cfg.workdir,
        initialPrompt: cfg.initial_prompt,
        spawnArgs: cfg.spawn_args,
        metadata: cfg.metadata,
        parentSessionId: cfg.parent_session_id,
        depth: cfg.depth,
        budget: cfg.budget,
        isolation: cfg.isolation,
        timeout_ms: cfg.timeout_ms,
        nickname: cfg.nickname,
        purpose: cfg.purpose,
        mode: cfg.mode,
        allowed_paths: cfg.allowed_paths,
        scope_mode: cfg.scope_mode,
      });

      tokenTracker.registerSession(result.sessionId, cfg.workdir, new Date());
      app.log.info(`[batch ${i}/${sessionConfigs.length}] [${result.nickname}] Session spawned (${result.mode})`);

      results.push({
        session_id: result.sessionId,
        nickname: result.nickname,
        status: result.status,
        mode: result.mode,
        depth: result.chain.depth,
        parent_session_id: result.chain.parent_session_id,
        budget: result.chain.budget,
        isolation: result.worktree.isolation,
        worktree_path: result.worktree.worktree_path,
        metals_available: result.worktree.metals_available,
      });
    } catch (e) {
      const message = (e as Error).message;
      app.log.error(`[batch ${i}/${sessionConfigs.length}] Spawn failed: ${message}`);
      results.push({
        session_id: '',
        nickname: '',
        status: 'error',
        mode: 'pty',
        depth: 0,
        parent_session_id: null,
        budget: { max_depth: 3, max_agents: 10, agents_spawned: 0 },
        isolation: 'shared',
        worktree_path: null,
        metals_available: true,
        error: message,
      });
    }
  }

  const spawned = results.filter(r => r.status !== 'error').length;
  const failed = results.filter(r => r.status === 'error').length;
  writePidFile();

  return reply.status(201).send({
    sessions: results,
    stagger_ms: stagger,
    spawned,
    failed,
  });
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
 * POST /sessions/:id/resize — Resize the PTY terminal dimensions.
 */
app.post<{
  Params: { id: string };
  Body: { cols: number; rows: number };
}>('/sessions/:id/resize', async (request, reply) => {
  const { id } = request.params;
  const { cols, rows } = request.body ?? {};

  if (!cols || !rows || typeof cols !== 'number' || typeof rows !== 'number') {
    return reply.status(400).send({ error: 'Missing required fields: cols (number), rows (number)' });
  }

  try {
    const session = pool.getSession(id);
    session.resize(cols, rows);
    return reply.status(200).send({ resized: true, cols, rows });
  } catch (e) {
    const message = (e as Error).message;
    if (message.includes('not found')) {
      return reply.status(404).send({ error: message });
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
      nickname: result.nickname,
      purpose: result.purpose,
      status: result.status,
      mode: result.mode,
      queue_depth: result.queueDepth,
      metadata: result.metadata,
      prompt_count: result.promptCount,
      last_activity_at: result.lastActivityAt.toISOString(),
      workdir: result.workdir,
      parent_session_id: result.chain.parent_session_id,
      depth: result.chain.depth,
      children: result.chain.children,
      budget: result.chain.budget,
      isolation: result.worktree.isolation,
      worktree_path: result.worktree.worktree_path,
      metals_available: result.worktree.metals_available,
      stale: result.stale,
      diagnostics: result.diagnostics,
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
  Body: { worktree_action?: 'merge' | 'keep' | 'discard' };
}>('/sessions/:id', async (request, reply) => {
  const { id } = request.params;
  const { worktree_action } = request.body ?? {};

  try {
    const result = pool.kill(id, worktree_action);
    writePidFile();
    return reply.status(200).send({
      session_id: result.sessionId,
      killed: result.killed,
      worktree_cleaned: result.worktree_cleaned,
    });
  } catch (e) {
    const message = (e as Error).message;
    if (message.includes('not found')) {
      return reply.status(404).send({ error: message });
    }
    return reply.status(500).send({ error: message });
  }
});

// NOTE: /genesis/status route is now registered in registerGenesisRoutes()
// Removed duplicate to avoid FastifyError: Method 'GET' already declared

/**
 * GET /sessions — List all sessions.
 */
app.get('/sessions', async (_request, reply) => {
  const sessions = pool.list();
  return reply.status(200).send(
    sessions.map((s) => ({
      session_id: s.sessionId,
      nickname: s.nickname,
      purpose: s.purpose,
      status: s.status,
      mode: s.mode,
      queue_depth: s.queueDepth,
      metadata: s.metadata,
      prompt_count: s.promptCount,
      last_activity_at: s.lastActivityAt.toISOString(),
      workdir: s.workdir,
      parent_session_id: s.chain.parent_session_id,
      depth: s.chain.depth,
      children: s.chain.children,
      budget: s.chain.budget,
      isolation: s.worktree.isolation,
      worktree_path: s.worktree.worktree_path,
      metals_available: s.worktree.metals_available,
      stale: s.stale,
    })),
  );
});

// ---------- Channels (PRD 008) ----------

import { appendMessage, readMessages, createSessionChannels, type ChannelMessage } from './domains/sessions/channels.js';

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

    // Push notification to parent (PRD 008 Component 2, PRD 014: scope_violation)
    const PUSHABLE_EVENTS = new Set(['completed', 'error', 'escalation', 'budget_warning', 'stale', 'scope_violation']);
    if (PUSHABLE_EVENTS.has(type)) {
      try {
        const status = pool.status(id);
        const parentId = status.chain.parent_session_id;
        if (parentId) {
          const parentStatus = pool.status(parentId);
          if (parentStatus.status !== 'dead') {
            const notification = [
              `BRIDGE NOTIFICATION — Child agent [${status.nickname}] event: ${type}`,
              status.metadata?.commission_id
                ? `Commission: ${status.metadata.commission_id} — ${status.metadata.task_summary ?? 'no summary'}`
                : `Session: ${status.nickname} (${id.substring(0, 8)})`,
              `Details: ${JSON.stringify(content ?? {})}`,
              `Action required: ${type === 'completed' ? 'Collect results and proceed' : type === 'error' ? 'Decide: retry, escalate, or abort' : type === 'escalation' ? 'Child is blocked — provide input' : type === 'budget_warning' ? 'Increase budget or restructure' : type === 'scope_violation' ? 'Child is writing outside its allowed scope — intervene or adjust allowed_paths' : 'Investigate stale session'}`,
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

  // PRD 018 Phase 2a-4: Include trigger_fired events from global trigger channel
  try {
    const triggerResult = readMessages(triggerChannels.events, sinceSequence);
    for (const msg of triggerResult.messages) {
      if (filterType && msg.type !== filterType) continue;
      events.push({
        bridge_session_id: 'triggers',
        session_metadata: {
          trigger_id: (msg.content as Record<string, unknown>)?.trigger_id,
          strategy_id: (msg.content as Record<string, unknown>)?.strategy_id,
        } as Record<string, unknown>,
        message: msg,
      });
      if (msg.sequence > globalLastSequence) {
        globalLastSequence = msg.sequence;
      }
    }
  } catch {
    // Trigger channel read failure is non-fatal
  }

  // Sort by timestamp
  events.sort((a, b) => a.message.timestamp.localeCompare(b.message.timestamp));

  return reply.status(200).send({
    events,
    last_sequence: globalLastSequence,
  });
});

// ---------- Shutdown (graceful via API) ----------

/**
 * POST /shutdown — Trigger graceful shutdown from external scripts.
 * Preferred over force-killing the process, so sessions get cleaned up properly.
 */
app.post('/shutdown', async (request, reply) => {
  const ip = request.ip;
  if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
    return reply.status(403).send({ error: 'Shutdown only allowed from localhost' });
  }
  reply.status(200).send({ status: 'shutting_down' });
  setImmediate(() => gracefulShutdown('API'));
});

// ---------- Strategy Pipelines (PRD 017) ----------

const STRATEGY_ENABLED = process.env.STRATEGY_ENABLED !== 'false';

if (STRATEGY_ENABLED) {
  const strategyProvider = new ClaudeCodeProvider(CLAUDE_BIN);
  registerStrategyRoutes(app, strategyProvider);
}

// ---------- Registry API (PRD 019.2) ----------

registerRegistryRoutes(app);

// ---------- Methodology API (PRD 021) ----------

const methodologyStore = new MethodologySessionStore(resolve(ROOT_DIR, 'registry'));
registerMethodologyRoutes(app, methodologyStore, pool);

// ---------- Frontend SPA (PRD 019.1 — Narrative Flow) ----------

const FRONTEND_ENABLED = process.env.FRONTEND_ENABLED !== 'false';

if (FRONTEND_ENABLED) {
  registerFrontendRoutes(app);
}

// ---------- Event Triggers (PRD 018) ----------

const TRIGGERS_ENABLED = process.env.TRIGGERS_ENABLED !== 'false';
const TRIGGERS_STRATEGY_DIR = process.env.TRIGGERS_STRATEGY_DIR ?? '.method/strategies';

// PRD 018 Phase 2a-4: Global channel for trigger_fired events (visible in GET /channels/events)
const triggerChannels = createSessionChannels();

let triggerRouter: TriggerRouter | null = null;

if (TRIGGERS_ENABLED) {
  triggerRouter = new TriggerRouter({
    baseDir: ROOT_DIR,
    bridgeUrl: `http://localhost:${PORT}`,
    logger: {
      info: (msg) => app.log.info(msg),
      warn: (msg) => app.log.warn(msg),
      error: (msg) => app.log.error(msg),
    },
    // PRD 018 Phase 2a-4: Emit trigger_fired events to the global trigger channel
    onTriggerFired: (event) => {
      appendMessage(
        triggerChannels.events,
        event.strategy_id,
        'trigger_fired',
        {
          trigger_id: event.trigger_id,
          trigger_type: event.trigger_type,
          strategy_id: event.strategy_id,
          debounced_count: event.debounced_count,
          payload: event.payload,
        },
      );
      // Push to WebSocket subscribers
      wsHub.publish('triggers', {
        type: 'fire',
        trigger_id: event.trigger_id,
        trigger_type: event.trigger_type,
        strategy_id: event.strategy_id,
      }, (filter) =>
        !filter.trigger_id || filter.trigger_id === event.trigger_id,
      );
    },
  });

  // PRD 018 Phase 2a-2: Wire PTY watcher observation forwarding
  pool.setObservationHook((observation) => {
    if (triggerRouter) {
      triggerRouter.onObservation(observation);
    }
  });

  // PRD 018 Phase 2a-2: Wire channel event hook
  addOnMessageHook((info) => {
    if (triggerRouter) {
      triggerRouter.onChannelMessage(info);
    }
  });

  // PRD 018 Phase 2a-3: Register trigger management API + webhook routes
  registerTriggerRoutes(app, triggerRouter, TRIGGERS_STRATEGY_DIR);
}

// ---------- Start ----------

async function start() {
  try {
    // F-I-2: Register Genesis and Project routes before listening (prevents initialization race)
    await registerGenesisRoutes(app, genesisRouteContext);

    // Initialize event persistence with JSON Lines format and YAML fallback
    const jsonlPath = join(ROOT_DIR, '.method', 'genesis-events.jsonl');
    const yamlPath = join(ROOT_DIR, '.method', 'genesis-events.yaml');
    const eventPersistence = new JsonLineEventPersistence(jsonlPath, yamlPath);
    await eventPersistence.recover();

    await registerProjectRoutes(app, discoveryService, projectRegistry, eventPersistence, ROOT_DIR);

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

    // PRD 018: Scan strategy files and register event triggers
    if (triggerRouter) {
      scanAndRegisterTriggers(triggerRouter, TRIGGERS_STRATEGY_DIR, {
        info: (msg) => app.log.info(msg),
        warn: (msg) => app.log.warn(msg),
        error: (msg) => app.log.error(msg),
      }).then((result) => {
        if (result.registered > 0) {
          app.log.info(
            `Trigger startup scan: ${result.registered} trigger(s) registered from ${result.scanned} file(s)`,
          );
        }
        if (result.errors.length > 0) {
          app.log.warn(
            `Trigger startup scan: ${result.errors.length} file(s) had errors`,
          );
        }
      }).catch((err) => {
        app.log.error(`Trigger startup scan failed: ${(err as Error).message}`);
      });
    }

    // PRD 006 Component 4: Stale detection timer
    setInterval(() => {
      const result = pool.checkStale();
      if (result.stale.length > 0) {
        app.log.warn(`Stale sessions detected: ${result.stale.join(', ')}`);
      }
      if (result.killed.length > 0) {
        app.log.warn(`Auto-killed stale sessions: ${result.killed.join(', ')}`);
      }
    }, STALE_CHECK_INTERVAL_MS);

    // PRD 020 Phase 2A: Spawn Genesis on startup if enabled
    if (GENESIS_ENABLED) {
      try {
        const genesisResult = await spawnGenesis(pool, ROOT_DIR, 50000);
        app.log.info(
          `Genesis spawned: session_id=${genesisResult.sessionId}, budget=${genesisResult.budgetTokensPerDay} tokens/day`,
        );

        // F-A-3: Instantiate and start Genesis polling loop
        genesisPollingLoop = new GenesisPollingLoop({
          intervalMs: GENESIS_POLLING_INTERVAL_MS,
          cursorFilePath: '.method/genesis-cursors.yaml',
        });

        // Create eventFetcher callback that fetches from the event log
        const eventFetcher = async (_projectId: string, cursor: string): Promise<any[]> => {
          try {
            // Parse cursor to get starting index
            let startIndex = 0;
            if (cursor) {
              // Simple cursor parsing: try to extract index from cursor string
              // In production, would use proper cursor format
              const parsed = parseInt(cursor, 10);
              if (!isNaN(parsed)) {
                startIndex = parsed;
              }
            }

            // Get all events from the log
            const allEvents = getEventsFromLog(eventLog, startIndex);
            return allEvents;
          } catch (err) {
            app.log.warn(`Event fetcher error: ${(err as Error).message}`);
            return [];
          }
        };

        // Create callback for new events
        const onNewEvents = async (_projectId: string, events: any[]): Promise<void> => {
          if (!genesisResult.sessionId || events.length === 0) return;

          try {
            // Generate a summary of the events for Genesis
            const eventSummary = events.map(e => {
              const type = typeof e.type === 'string' ? e.type : JSON.stringify(e.type);
              const projectId = e.projectId || 'unknown';
              return `${type} (${projectId})`;
            }).join(', ');

            // Dispatch prompt to Genesis
            const prompt = `Observed ${events.length} new event(s): ${eventSummary}\n\nUse project_read_events() to fetch details and analyze the impact on project state.`;

            // Fire async prompt but don't wait (Genesis session handles it)
            pool.prompt(genesisResult.sessionId, prompt, 10000).catch(err => {
              app.log.warn(`Failed to send prompt to Genesis: ${(err as Error).message}`);
            });
          } catch (err) {
            app.log.warn(`Event callback error: ${(err as Error).message}`);
          }
        };

        // Create projectProvider callback that returns discovered projects
        const projectProvider = () => {
          const cached = discoveryService.getCachedProjects();
          return cached.length > 0 ? cached.map(p => p.id) : ['root'];
        };

        // Start the polling loop
        genesisPollingLoop.start(
          genesisResult.sessionId,
          pool,
          eventFetcher,
          onNewEvents,
          projectProvider,
        );

        app.log.info(`Genesis polling loop started (interval: ${GENESIS_POLLING_INTERVAL_MS}ms)`);

        // F-T-2: Start cursor maintenance job
        cursorMaintenanceJob = new CursorMaintenanceJob(
          join(ROOT_DIR, '.method', 'genesis-cursors.yaml'),
          CURSOR_CLEANUP_INTERVAL_MS,
        );
        cursorMaintenanceJob.start();
      } catch (err) {
        app.log.error(`Failed to spawn Genesis: ${(err as Error).message}`);
      }
    }
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

    // Stop Genesis polling loop if running
    if (genesisPollingLoop) {
      genesisPollingLoop.stop();
    }

    // Stop cursor maintenance job if running
    if (cursorMaintenanceJob) {
      cursorMaintenanceJob.stop();
    }

    // Stop trigger watchers (PRD 018)
    if (triggerRouter) {
      triggerRouter.shutdown().catch(() => { /* non-fatal */ });
    }

    // Disconnect hooks and close WebSocket connections during teardown
    pool.setObservationHook(null);
    wsHub.destroy();
    setOnEventHook(null);
    setOnExecutionChangeHook(null);

    // Kill all sessions (triggers auto-retro via handleSessionDeath)
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

    // Clean up PID file — no children left
    removePidFile();

    const uptimeMs = Date.now() - BRIDGE_STARTED_AT.getTime();
    app.log.info(`Shutdown complete: ${killed} sessions killed, uptime ${Math.floor(uptimeMs / 60000)}m`);

    // Brief delay to let PTY processes terminate before exiting
    setTimeout(() => process.exit(0), 500);
  });

  // Force exit after 5s if graceful shutdown hangs
  setTimeout(() => {
    app.log.warn('Graceful shutdown timed out — forcing exit');
    removePidFile();
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

start();
