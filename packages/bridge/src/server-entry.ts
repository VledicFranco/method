import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, appendFileSync, unlinkSync } from 'node:fs';
import { runStartupRecovery } from './startup-recovery.js';
import { createNodeNativeSessionDiscovery } from './ports/native-session-discovery.js';
import { SessionCheckpointSink } from './shared/event-bus/session-checkpoint-sink.js';
import Fastify from 'fastify';
import { createPool } from './domains/sessions/pool.js';
import { createUsagePoller } from './domains/tokens/usage-poller.js';
import { createTokenTracker } from './domains/tokens/tracker.js';
import { registerTokenRoutes } from './domains/tokens/routes.js';
import { registerTranscriptRoutes } from './domains/sessions/transcript-route.js';
import { createTranscriptReader } from './domains/sessions/transcript-reader.js';
import { registerStrategyRoutes } from './domains/strategies/strategy-routes.js';
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
import { setStrategyRoutesEventBus, setStrategyRoutesPool } from './domains/strategies/strategy-routes.js';
import { DiscoveryService } from './domains/projects/discovery-service.js';
import { InMemoryProjectRegistry } from './domains/registry/index.js';
// PRD 026 Phase 4: JsonLineEventPersistence removed — PersistenceSink handles unified event persistence
import { loadSessionsConfig } from './domains/sessions/config.js';
import { loadTokensConfig } from './domains/tokens/config.js';
import { loadTriggersConfig } from './domains/triggers/config.js';
import { loadGenesisConfig } from './domains/genesis/config.js';
import { loadStrategiesConfig } from './domains/strategies/config.js';
import { loadClusterConfig } from './domains/cluster/config.js';
import { ClusterDomain } from './domains/cluster/core.js';
import { registerClusterRoutes } from './domains/cluster/routes.js';
import { ClusterFederationSink } from './domains/cluster/federation-sink.js';
import { TailscaleDiscovery } from './domains/cluster/adapters/tailscale-discovery.js';
import { HttpNetwork } from './domains/cluster/adapters/http-network.js';
import { NodeResource } from './domains/cluster/adapters/node-resource.js';
import { CapacityWeightedRouter, EventRelay } from '@method/cluster';
import { NodeFileSystemProvider } from './ports/file-system.js';
import { JsYamlLoader } from './ports/yaml-loader.js';
import { StdlibSource } from './ports/stdlib-source.js';
import { InMemoryEventBus, WebSocketSink, PersistenceSink, ChannelSink, GenesisSink, WebhookConnector } from './shared/event-bus/index.js';
import type { EventFilter, EventSeverity } from './ports/event-bus.js';
import { setExperimentRoutesPorts, registerExperimentRoutes, createExperimentEventSink } from './domains/experiments/index.js';
import { CognitiveSink } from './domains/sessions/cognitive-sink.js';

// ── Domain configuration (Zod-validated, env-backed) ──────────
const sessionsConfig = loadSessionsConfig();
const tokensConfig = loadTokensConfig();
const triggersConfig = loadTriggersConfig();
const genesisConfig = loadGenesisConfig();
const strategiesConfig = loadStrategiesConfig();

// Composition-level config (stays in server-entry)
const ROOT_DIR = process.env.ROOT_DIR ?? process.cwd();
const PORT = parseInt(process.env.PORT ?? '3456', 10);
const INSTANCE_NAME = process.env.INSTANCE_NAME ?? 'default';

// PRD 023 D2: Instantiate port providers for dependency injection
const fsProvider = new NodeFileSystemProvider();
const yamlLoader = new JsYamlLoader();

// PRD 024 MG-1/MG-2: Wire ports into all domain modules
setResourceCopierPorts(fsProvider, yamlLoader);

// PRD 039: Cluster domain config + wiring
const clusterConfig = loadClusterConfig({
  readFileSync: (p, enc) => fsProvider.readFileSync(p, enc),
  writeFileSync: (p, data) => fsProvider.writeFileSync(p, data),
  mkdirSync: (p, opts) => fsProvider.mkdirSync(p, opts),
});

// Strategies domain
import { setRetroWriterFs } from './domains/strategies/retro-writer.js';
import { setStrategyRoutesPorts, setStrategyRoutesHumanApprovalResolver, setStrategyRoutesSubStrategySource } from './domains/strategies/strategy-routes.js';
import { setStrategyParserYaml } from './domains/strategies/strategy-parser.js';
import { setRetroGeneratorYaml } from './domains/strategies/retro-generator.js';
import { BridgeHumanApprovalResolver } from './domains/strategies/human-approval-resolver.js';
import { BridgeSubStrategySource } from './domains/strategies/sub-strategy-source.js';
setRetroWriterFs(fsProvider);
setStrategyRoutesPorts(fsProvider, yamlLoader);
setStrategyParserYaml(yamlLoader);
setRetroGeneratorYaml(yamlLoader);

// Genesis domain — polling loop + cursor manager removed (PRD 026 Phase 5, GenesisSink replaces)

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

// PRD 041: Experiments domain
setExperimentRoutesPorts(fsProvider, yamlLoader);

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

// PRD-044: Wire HumanApprovalResolver and SubStrategySource into the strategies domain.
// Created once at startup and reused across all executions (singleton lifecycle).
const humanApprovalResolver = new BridgeHumanApprovalResolver(eventBus);
const subStrategySource = new BridgeSubStrategySource(
  process.env.TRIGGERS_STRATEGY_DIR ?? '.method/strategies',
  fsProvider,
);
setStrategyRoutesHumanApprovalResolver(humanApprovalResolver);
setStrategyRoutesSubStrategySource(subStrategySource);

// PRD 041: CognitiveSink — adapts algebra-level CognitiveEvents to BridgeEvent bus
const cognitiveSink = new CognitiveSink(eventBus);

const pool = createPool({
  maxSessions: sessionsConfig.maxSessions,
  claudeBin: sessionsConfig.claudeBin,
  settleDelayMs: sessionsConfig.settleDelayMs,
  minSpawnGapMs: sessionsConfig.minSpawnGapMs,
  fsProvider,
  eventBus,
  cognitiveSink,
});

// Adaptive oversight: wire pool into strategy routes for auto-spawn on escalation
setStrategyRoutesPool(pool);

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

const wsHub = new WsHub();
app.register(async function wsPlugin(fastify) {
  await fastify.register(websocket);
  registerWsRoute(fastify, wsHub);
});

// PRD 026: Register WebSocketSink — session domain events flow through the bus to WsHub
eventBus.registerSink(new WebSocketSink(wsHub));

// PRD 026 Phase 3: Register PersistenceSink + ChannelSink
eventBus.registerSink(persistenceSink);
eventBus.registerSink(channelSink);

// PRD 029: Register SessionCheckpointSink — event-driven session persistence
// (SessionCheckpointSink imported at top of file)
const checkpointSink = new SessionCheckpointSink({
  save: (input) => sessionPersistence.save(input as any),
  poolList: () => pool.list(),
});
eventBus.registerSink(checkpointSink);

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

// ---------- Project Discovery (hoisted for cluster resource callback) ----------

const discoveryService = new DiscoveryService();

// ---------- Cluster Domain (PRD 039) ----------

const clusterDiscovery = new TailscaleDiscovery(
  { bridgePort: PORT, seeds: clusterConfig.seeds },
  { info: (msg: string) => app.log.info(msg), warn: (msg: string) => app.log.warn(msg) },
);
const clusterNetwork = new HttpNetwork();
const clusterResources = new NodeResource(
  { nodeId: clusterConfig.nodeId, instanceName: INSTANCE_NAME, version: '0.3.0', sessionsMax: sessionsConfig.maxSessions },
  { getActiveSessions: () => pool.poolStats().activeSessions, getProjectCount: () => discoveryService.getCachedProjects().length },
);

const clusterDomain = new ClusterDomain(clusterConfig, {
  discovery: clusterDiscovery,
  network: clusterNetwork,
  resources: clusterResources,
}, {
  info: (msg) => app.log.info(msg),
  warn: (msg) => app.log.warn(msg),
  error: (msg) => app.log.error(msg),
});

const clusterRouter = clusterConfig.enabled
  ? new CapacityWeightedRouter()
  : undefined;

registerClusterRoutes(app, { domain: clusterDomain, router: clusterRouter });

// PRD 041: Register CognitiveSink on the event bus (onEvent is a no-op — sink emits TO the bus, not from it)
eventBus.registerSink(cognitiveSink);

// PRD 041: Experiment EventSink — persists cognitive events to per-run JSONL
eventBus.registerSink(createExperimentEventSink());

// PRD 039: Federation sink — relay local events to cluster peers
if (clusterConfig.enabled && clusterConfig.federationEnabled) {
  const severities = clusterConfig.federationFilterSeverity
    .split(',').map(s => s.trim()).filter(Boolean) as any[];
  const domains = clusterConfig.federationFilterDomain
    .split(',').map(s => s.trim()).filter(Boolean);

  const eventRelay = new EventRelay(clusterNetwork, {
    federationEnabled: true,
    severityFilter: severities,
    domainFilter: domains,
  });
  const federationSink = new ClusterFederationSink(eventRelay, clusterDomain, clusterConfig.nodeId);
  eventBus.registerSink(federationSink);
}

// ---------- Transcript Browser (PRD 007 Phase 3) ----------

registerTranscriptRoutes(app, pool, transcriptReader);

// ---------- Project Routes (PRD 020 Phase 2A) ----------

// F-I-2: Initialize and register project discovery routes
// NOTE: discoveryService declared above cluster domain wiring (TDZ prevention)
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
  const health: Record<string, unknown> = {
    status: 'ok',
    instance_name: INSTANCE_NAME,
    active_sessions: stats.activeSessions,
    max_sessions: stats.maxSessions,
    uptime_ms: Date.now() - BRIDGE_STARTED_AT.getTime(),
    version: '0.3.0',
  };

  // PRD 039: Include cluster info when enabled
  if (clusterDomain.isEnabled()) {
    const clusterState = clusterDomain.getState();
    if (clusterState) {
      let peersAlive = 0, peersSuspect = 0, peersDead = 0;
      for (const [, node] of clusterState.peers) {
        if (node.status === 'alive') peersAlive++;
        else if (node.status === 'suspect') peersSuspect++;
        else if (node.status === 'dead') peersDead++;
      }
      health.cluster = {
        enabled: true,
        node_id: clusterConfig.nodeId,
        peers_alive: peersAlive,
        peers_suspect: peersSuspect,
        peers_dead: peersDead,
      };
    }
  }

  return reply.status(200).send(health);
});

// ---------- Connectors Health (PRD 026 Phase 5) ----------

app.get('/api/connectors', async (_request, reply) => {
  const connectors = eventBus.connectorHealth();
  return reply.status(200).send({ connectors });
});

// ---------- Token & Usage API ----------

registerTokenRoutes(app, tokenTracker, usagePoller);

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

// PRD 029 C-3: 30-second persistence interval removed — checkpoint sink (C-2) replaces it.

registerPersistenceRoutes(app, {
  persistence: sessionPersistence,
  pool,
  tokenTracker,
  writePidFile,
});

// ---------- Strategy Pipelines (PRD 017) ----------

if (strategiesConfig.enabled) {
  registerStrategyRoutes(app);
}

// ---------- Experiment Lab API (PRD 041) ----------

registerExperimentRoutes(app);

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
    // PRD 029 C-3: Emit bridge_starting lifecycle event
    eventBus.emit({
      version: 1,
      domain: 'system',
      type: 'system.bridge_starting',
      severity: 'info',
      payload: { version: '0.3.0', port: PORT },
      source: 'bridge/server-entry',
    });

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

    // PRD 039: Start cluster domain (no-op when disabled)
    await clusterDomain.start();

    await app.listen({ port: PORT, host: '0.0.0.0' });
    app.log.info(`@method/bridge listening on port ${PORT}`);

    // PRD 026 Phase 5: Connect all registered connectors
    await eventBus.connectAll();

    // PRD 029 C-3: Startup recovery — reconcile persisted sessions with live native sessions
    const nativeDiscovery = createNodeNativeSessionDiscovery();
    const recoveryReport = await runStartupRecovery({
      persistence: sessionPersistence,
      discovery: nativeDiscovery,
      restoreSession: (snapshot) => {
        // pool.restoreSession will exist after C-1 merges — conditional check
        if (typeof (pool as any).restoreSession === 'function') {
          (pool as any).restoreSession(snapshot);
        } else {
          app.log.warn(
            `[startup-recovery] pool.restoreSession not available — skipping restore of ${snapshot.sessionId}`,
          );
        }
      },
      eventBus,
    });

    if (recoveryReport.recovered > 0 || recoveryReport.tombstoned > 0) {
      app.log.info(
        `Startup recovery: ${recoveryReport.recovered} recovered, ${recoveryReport.tombstoned} tombstoned, ${recoveryReport.failed} failed (${recoveryReport.durationMs}ms)`,
      );
    }

    // PRD 029 C-3: Emit bridge_ready after recovery + listen
    const sessionsActive = pool.poolStats().activeSessions;
    eventBus.emit({
      version: 1,
      domain: 'system',
      type: 'system.bridge_ready',
      severity: 'info',
      payload: {
        uptimeMs: Date.now() - BRIDGE_STARTED_AT.getTime(),
        sessionsActive,
        recoveredSessions: recoveryReport.recovered,
      },
      source: 'bridge/server-entry',
    });

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
        genesisRouteContext.genesisSessionId = genesisResult.sessionId;
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

  // PRD 029 C-3: Emit bridge_stopping lifecycle event
  const activeSessions = pool.poolStats().activeSessions;
  try {
    eventBus.emit({
      version: 1,
      domain: 'system',
      type: 'system.bridge_stopping',
      severity: 'info',
      payload: { signal, activeSessions },
      source: 'bridge/server-entry',
    });
  } catch { /* non-fatal — bus may already be disposed */ }

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

    // PRD 039: Stop cluster domain
    clusterDomain.stop().catch(() => { /* non-fatal */ });

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

// PRD 029 C-3: Crash handler — synchronous write to events JSONL, then exit.
// Does NOT use the async EventBus — process may be in an unstable state.
process.on('uncaughtException', (err) => {
  try {
    const crashEvent = {
      id: `crash-${Date.now()}`,
      version: 1,
      timestamp: new Date().toISOString(),
      sequence: -1,
      domain: 'system',
      type: 'system.bridge_crash',
      severity: 'critical',
      payload: {
        error: err.message,
        stack: err.stack,
        uptimeMs: Date.now() - BRIDGE_STARTED_AT.getTime(),
      },
      source: 'bridge/crash-handler',
    };
    const logPath = process.env.EVENT_LOG_PATH ?? join(ROOT_DIR, '.method', 'events.jsonl');
    appendFileSync(logPath, JSON.stringify(crashEvent) + '\n', { encoding: 'utf-8' });
  } catch {
    // Crash handler itself failed — nothing more we can do
  }
  process.exit(1);
});

start();
