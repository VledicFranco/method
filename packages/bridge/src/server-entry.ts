import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { createSessionChannels } from './domains/sessions/channels.js';
import { registerSessionRoutes } from './domains/sessions/routes.js';
import { createSessionPersistenceStore } from './domains/sessions/session-persistence.js';
import { registerPersistenceRoutes } from './domains/sessions/persistence-routes.js';
import { registerFrontendRoutes } from './shared/frontend-route.js';
import { registerRegistryRoutes } from './domains/registry/routes.js';
import { MethodologySessionStore } from './domains/methodology/store.js';
import { registerMethodologyRoutes } from './domains/methodology/routes.js';
import { spawnGenesis } from './domains/genesis/spawner.js';
// PRD 026 Phase 4: Polling loop + cursor maintenance replaced by GenesisSink
import { registerGenesisRoutes } from './domains/genesis/routes.js';
import { registerProjectRoutes, eventLog, cursorMap } from './domains/projects/routes.js';
import { setProjectRoutesEventBus } from './domains/projects/routes.js';
import { copyMethodology, copyStrategy, setResourceCopierPorts } from './domains/registry/resource-copier.js';
import websocket from '@fastify/websocket';
import { WsHub } from './shared/websocket/hub.js';
import { registerWsRoute } from './shared/websocket/route.js';
import { setStrategyRoutesEventBus } from './domains/strategies/strategy-routes.js';
import { DiscoveryService } from './domains/projects/discovery-service.js';
import { InMemoryProjectRegistry } from './domains/registry/index.js';
// PRD 026 Phase 4: JsonLineEventPersistence removed — PersistenceSink handles unified event persistence
import { loadSessionsConfig } from './domains/sessions/config.js';
import { loadTokensConfig } from './domains/tokens/config.js';
import { loadTriggersConfig } from './domains/triggers/config.js';
import { loadGenesisConfig } from './domains/genesis/config.js';
import { loadStrategiesConfig } from './domains/strategies/config.js';
import { NodePtyProvider } from './ports/pty-provider.js';
import { NodeFileSystemProvider } from './ports/file-system.js';
import { JsYamlLoader } from './ports/yaml-loader.js';
import { StdlibSource } from './ports/stdlib-source.js';
import { InMemoryEventBus, WebSocketSink, PersistenceSink, ChannelSink, GenesisSink, WebhookConnector } from './shared/event-bus/index.js';
import type { EventFilter, EventSeverity } from './ports/event-bus.js';

// ── Domain configuration (Zod-validated, env-backed) ──────────
const sessionsConfig = loadSessionsConfig();
const tokensConfig = loadTokensConfig();
const triggersConfig = loadTriggersConfig();
const genesisConfig = loadGenesisConfig();
const strategiesConfig = loadStrategiesConfig();

// Composition-level config (stays in server-entry)
const ROOT_DIR = process.env.ROOT_DIR ?? process.cwd();
const PORT = parseInt(process.env.PORT ?? '3456', 10);

// PRD 023 D2: Instantiate port providers for dependency injection
const ptyProvider = new NodePtyProvider();
const fsProvider = new NodeFileSystemProvider();
const yamlLoader = new JsYamlLoader();

// PRD 024 MG-7: Shared LLM provider for print-mode sessions and strategy pipelines
const llmProvider = new ClaudeCodeProvider(sessionsConfig.claudeBin);

// PRD 024 MG-1/MG-2: Wire ports into all domain modules
setResourceCopierPorts(fsProvider, yamlLoader);

// Strategies domain
import { setRetroWriterFs } from './domains/strategies/retro-writer.js';
import { setStrategyRoutesPorts } from './domains/strategies/strategy-routes.js';
import { setStrategyParserYaml } from './domains/strategies/strategy-parser.js';
import { setRetroGeneratorYaml } from './domains/strategies/retro-generator.js';
setRetroWriterFs(fsProvider);
setStrategyRoutesPorts(fsProvider, yamlLoader);
setStrategyParserYaml(yamlLoader);
setRetroGeneratorYaml(yamlLoader);

// Genesis domain
import { setCursorManagerPorts } from './domains/genesis/cursor-manager.js';
import { setPollingLoopPorts } from './domains/genesis/polling-loop.js';
setCursorManagerPorts(fsProvider, yamlLoader);
setPollingLoopPorts(fsProvider, yamlLoader);

// Triggers domain
import { setTriggerRouterPorts } from './domains/triggers/trigger-router.js';
import { setStartupScanFs } from './domains/triggers/startup-scan.js';
import { setTriggerParserYaml } from './domains/triggers/trigger-parser.js';
setTriggerRouterPorts(fsProvider, yamlLoader);
setStartupScanFs(fsProvider);
setTriggerParserYaml(yamlLoader);

// Projects domain
import { setDiscoveryServicePorts } from './domains/projects/discovery-service.js';
import { setDiscoveryRegistryPorts } from './domains/projects/discovery-registry-integration.js';
setDiscoveryServicePorts(fsProvider, yamlLoader);
setDiscoveryRegistryPorts(fsProvider, yamlLoader);

// PRD 026: Universal Event Bus — single event backbone for all domains
const eventBus = new InMemoryEventBus();

// PRD 026 Phase 3: PersistenceSink + ChannelSink (created early, initialized in start())
const persistenceSink = new PersistenceSink({
  fs: fsProvider,
  logPath: process.env.EVENT_LOG_PATH ?? join(ROOT_DIR, '.method', 'events.jsonl'),
  cursorsPath: join(ROOT_DIR, '.method', 'events-cursors.json'),
  replayWindowHours: parseInt(process.env.EVENT_REPLAY_WINDOW_HOURS ?? '24', 10),
});
persistenceSink.setOverflowCallback((msg) => {
  try {
    eventBus.emit({
      version: 1,
      domain: 'system',
      type: 'system.sink_overflow',
      severity: 'error',
      payload: { sink: 'persistence', error: msg },
      source: 'bridge/event-bus/persistence-sink',
    });
  } catch { /* double fault */ }
});

const channelSink = new ChannelSink({
  capacity: 200,
  pushToParent: (sessionId, event) => {
    try {
      const status = pool.status(sessionId);
      const parentId = status.chain.parent_session_id;
      if (parentId) {
        const parentStatus = pool.status(parentId);
        if (parentStatus.status !== 'dead') {
          const notification = [
            `BRIDGE NOTIFICATION — Child agent [${status.nickname}] event: ${event.type} (${event.severity})`,
            status.metadata?.commission_id
              ? `Commission: ${status.metadata.commission_id} — ${(status.metadata as Record<string, unknown>).task_summary ?? 'no summary'}`
              : `Session: ${status.nickname} (${sessionId.substring(0, 8)})`,
            `Details: ${JSON.stringify(event.payload)}`,
          ].join('\n');
          pool.prompt(parentId, notification).catch(() => { /* non-fatal */ });
        }
      }
    } catch { /* parent lookup failure is non-fatal */ }
  },
});

// PRD 026 Phase 2: Inject EventBus into all producing domains
setStrategyRoutesEventBus(eventBus);
setProjectRoutesEventBus(eventBus);

const pool = createPool({
  maxSessions: sessionsConfig.maxSessions,
  claudeBin: sessionsConfig.claudeBin,
  settleDelayMs: sessionsConfig.settleDelayMs,
  minSpawnGapMs: sessionsConfig.minSpawnGapMs,
  ptyProvider,
  llmProvider,
  fsProvider,
  eventBus,
});

// WS-3: Session persistence store for print-mode sessions
const sessionPersistence = createSessionPersistenceStore(ROOT_DIR, fsProvider);

const usagePoller = createUsagePoller({
  oauthToken: tokensConfig.oauthToken,
  pollIntervalMs: tokensConfig.pollIntervalMs,
});

const tokenTracker = createTokenTracker({
  sessionsDir: tokensConfig.sessionsDir,
  fs: fsProvider,
});

const transcriptReader = createTranscriptReader({
  sessionsDir: tokensConfig.sessionsDir,
  fs: fsProvider,
});

// PRD 026 Phase 4: GenesisSink replaces polling loop (module-scoped for shutdown disposal)
let genesisSink: import('./shared/event-bus/genesis-sink.js').GenesisSink | null = null;

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

// PRD 026: Register WebSocketSink — session domain events flow through the bus to WsHub
eventBus.registerSink(new WebSocketSink(wsHub));

// PRD 026 Phase 3: Register PersistenceSink + ChannelSink
eventBus.registerSink(persistenceSink);
eventBus.registerSink(channelSink);

// PRD 026 Phase 5: Declarative webhook connector via env vars
if (process.env.EVENT_CONNECTOR_WEBHOOK_URL) {
  const filterDomains = process.env.EVENT_CONNECTOR_WEBHOOK_FILTER_DOMAIN?.split(',').map(s => s.trim()).filter(Boolean);
  const filterSeverities = process.env.EVENT_CONNECTOR_WEBHOOK_FILTER_SEVERITY?.split(',').map(s => s.trim()).filter(Boolean) as EventSeverity[] | undefined;

  const connectorFilter: EventFilter | undefined =
    (filterDomains?.length || filterSeverities?.length)
      ? {
          ...(filterDomains?.length ? { domain: filterDomains } : {}),
          ...(filterSeverities?.length ? { severity: filterSeverities } : {}),
        }
      : undefined;

  const webhookConnector = new WebhookConnector({
    url: process.env.EVENT_CONNECTOR_WEBHOOK_URL,
    filter: connectorFilter,
  });
  eventBus.registerSink(webhookConnector);
}

// ---------- Live Output (PRD 007 Phase 2) ----------

registerLiveOutputRoutes(app, pool);

// ---------- Transcript Browser (PRD 007 Phase 3) ----------

registerTranscriptRoutes(app, pool, transcriptReader);

// ---------- Project Routes (PRD 020 Phase 2A) ----------

// F-I-2: Initialize and register project discovery routes
const discoveryService = new DiscoveryService();
const projectRegistry = new InMemoryProjectRegistry(undefined, { fs: fsProvider, yaml: yamlLoader });

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
    fs: fsProvider,
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

// ---------- Connectors Health (PRD 026 Phase 5) ----------

app.get('/api/connectors', async (_request, reply) => {
  const connectors = eventBus.connectorHealth();
  return reply.status(200).send({ connectors });
});

// ---------- Token & Usage API ----------

registerTokenRoutes(app, tokenTracker, usagePoller);

// ---------- Unified Events API (PRD 026 Phase 3) ----------

app.get<{
  Querystring: {
    domain?: string;
    type?: string;
    severity?: string;
    projectId?: string;
    sessionId?: string;
    since?: string;
    limit?: string;
  };
}>('/api/events', async (request, reply) => {
  const { domain, type, severity, projectId, sessionId, since, limit } = request.query;

  const filter: Record<string, unknown> = {};
  if (domain) filter.domain = domain;
  if (type) filter.type = type;
  if (severity) filter.severity = severity;
  if (projectId) filter.projectId = projectId;
  if (sessionId) filter.sessionId = sessionId;

  const events = eventBus.query(
    filter as any,
    {
      limit: limit ? parseInt(limit, 10) : undefined,
      since: since ?? undefined,
    },
  );

  const nextCursor = events.length > 0
    ? events[events.length - 1].timestamp
    : since ?? new Date().toISOString();

  return reply.status(200).send({
    events,
    nextCursor,
    hasMore: false,
  });
});

// ---------- Session Routes (extracted to domains/sessions/routes.ts) ----------
// NOTE: triggerChannels is created early so session routes can access it for cross-session aggregation

const triggerChannels = createSessionChannels();

registerSessionRoutes(app, {
  pool,
  tokenTracker,
  writePidFile,
  batchStaggerMs: sessionsConfig.batchStaggerMs,
  triggerChannels,
  gracefulShutdown,
  channelSink,
  eventBus,
});

// ---------- Session Persistence (WS-3) ----------

// Persist session state periodically by scanning pool
setInterval(() => {
  const sessions = pool.list();
  for (const s of sessions) {
    sessionPersistence.save({
      session_id: s.sessionId,
      workdir: s.workdir,
      nickname: s.nickname,
      purpose: s.purpose,
      mode: s.mode,
      status: s.status as any,
      created_at: s.lastActivityAt.toISOString(), // TODO: use actual createdAt when pool tracks it
      last_activity_at: s.lastActivityAt.toISOString(),
      prompt_count: s.promptCount,
      depth: s.chain.depth,
      parent_session_id: s.chain.parent_session_id,
      isolation: s.worktree.isolation,
      metadata: s.metadata,
    }).catch(() => { /* non-fatal */ });
  }
}, 30_000); // Every 30 seconds

registerPersistenceRoutes(app, {
  persistence: sessionPersistence,
  pool,
  tokenTracker,
  writePidFile,
});

// ---------- Strategy Pipelines (PRD 017) ----------

if (strategiesConfig.enabled) {
  registerStrategyRoutes(app, llmProvider);
}

// ---------- Registry API (PRD 019.2) ----------

registerRegistryRoutes(app, { fs: fsProvider, yaml: yamlLoader });

// ---------- Methodology API (PRD 021) ----------

const methodologySource = new StdlibSource();
const methodologyStore = new MethodologySessionStore(methodologySource);
registerMethodologyRoutes(app, methodologyStore, {
  pool,
  eventBus,
});

// ---------- Frontend SPA (PRD 019.1 — Narrative Flow) ----------

const FRONTEND_ENABLED = process.env.FRONTEND_ENABLED !== 'false';  // composition-level

if (FRONTEND_ENABLED) {
  registerFrontendRoutes(app);
}

// ---------- Event Triggers (PRD 018) ----------

// PRD 018 Phase 2a-4: triggerChannels created above with session routes registration

let triggerRouter: TriggerRouter | null = null;

if (triggersConfig.enabled) {
  triggerRouter = new TriggerRouter({
    baseDir: ROOT_DIR,
    bridgeUrl: `http://localhost:${PORT}`,
    logger: {
      info: (msg) => app.log.info(msg),
      warn: (msg) => app.log.warn(msg),
      error: (msg) => app.log.error(msg),
    },
    // PRD 026 Phase 2: EventBus replaces onTriggerFired, observation, and channel hooks
    eventBus,
  });

  // PRD 018 Phase 2a-3: Register trigger management API + webhook routes
  registerTriggerRoutes(app, triggerRouter, triggersConfig.strategyDir);
}

// ---------- Start ----------

async function start() {
  try {
    // PRD 026 Phase 3: Initialize sinks + replay events from disk
    await persistenceSink.init();
    const cursors = await persistenceSink.loadCursors();
    channelSink.initFromCursor(cursors['channels'] ?? 0);

    const replayedEvents = await persistenceSink.replay();
    if (replayedEvents.length > 0) {
      for (const event of replayedEvents) {
        eventBus.importEvent(event);
      }
      app.log.info(`Replayed ${replayedEvents.length} events from disk`);
    }

    // F-I-2: Register Genesis and Project routes before listening (prevents initialization race)
    await registerGenesisRoutes(app, genesisRouteContext);

    // PRD 026 Phase 4: JsonLineEventPersistence removed — PersistenceSink handles event persistence.
    // Pass undefined for eventPersistence; project routes still use in-memory eventLog.
    await registerProjectRoutes(app, discoveryService, projectRegistry, undefined, ROOT_DIR, {
      copyMethodology,
      copyStrategy,
    });

    await app.listen({ port: PORT, host: '0.0.0.0' });
    app.log.info(`@method/bridge listening on port ${PORT}`);

    // PRD 026 Phase 5: Connect all registered connectors
    await eventBus.connectAll();

    // Start usage polling after server is listening
    usagePoller.start();

    // Dead session cleanup timer
    setInterval(() => {
      const removed = pool.removeDead(sessionsConfig.deadSessionTtlMs);
      if (removed > 0) {
        app.log.info(`Cleaned up ${removed} dead session(s) (TTL: ${sessionsConfig.deadSessionTtlMs}ms)`);
      }
    }, 60_000); // Check every minute

    // PRD 018: Scan strategy files and register event triggers
    if (triggerRouter) {
      scanAndRegisterTriggers(triggerRouter, triggersConfig.strategyDir, {
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
    }, sessionsConfig.staleCheckIntervalMs);

    // PRD 026 Phase 4: system.bus_stats periodic emission (bus self-monitoring)
    setInterval(() => {
      try {
        const stats = eventBus.getStats();
        eventBus.emit({
          version: 1,
          domain: 'system',
          type: 'system.bus_stats',
          severity: 'info',
          payload: { ...stats } as Record<string, unknown>,
          source: 'bridge/event-bus',
        });
      } catch { /* stats emission failure is non-fatal */ }
    }, 60_000); // Every 60 seconds

    // PRD 020 Phase 2A + PRD 026 Phase 4: Spawn Genesis with bus-based event delivery
    if (genesisConfig.enabled) {
      try {
        const genesisResult = await spawnGenesis(pool, ROOT_DIR, 50000);
        app.log.info(
          `Genesis spawned: session_id=${genesisResult.sessionId}, budget=${genesisResult.budgetTokensPerDay} tokens/day`,
        );

        // PRD 026 Phase 4: GenesisSink replaces polling loop.
        // Narrow callback — GenesisSink never imports SessionPool directly (G-BOUNDARY).
        genesisSink = new GenesisSink({
          promptSession: (id, text) => pool.prompt(id, text, 10000).then(() => {}),
          sessionId: genesisResult.sessionId,
          batchWindowMs: 30_000,
          severityFilter: ['warning', 'error', 'critical'],
        });
        eventBus.registerSink(genesisSink);

        app.log.info('Genesis event sink registered (30s batch, severity: warning+error+critical)');
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

    // PRD 026 Phase 4: Dispose GenesisSink (stops batch timer)
    if (genesisSink) {
      genesisSink.dispose();
    }

    // PRD 026 Phase 5: Disconnect all connectors
    eventBus.disconnectAll().catch(() => { /* non-fatal */ });

    // PRD 026 Phase 3: Flush PersistenceSink + save ChannelSink cursor
    persistenceSink.dispose().catch(() => { /* non-fatal */ });
    persistenceSink.loadCursors()
      .then(cursors => persistenceSink.saveCursors({ ...cursors, channels: channelSink.cursor }))
      .catch(() => { /* non-fatal */ });

    // Stop trigger watchers (PRD 018)
    if (triggerRouter) {
      triggerRouter.shutdown().catch(() => { /* non-fatal */ });
    }

    // Close WebSocket connections during teardown
    wsHub.destroy();

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
