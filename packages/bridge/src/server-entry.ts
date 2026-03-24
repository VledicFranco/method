import { tmpdir } from 'node:os';
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
import { addOnMessageHook, createSessionChannels, appendMessage } from './domains/sessions/channels.js';
import { registerSessionRoutes } from './domains/sessions/routes.js';
import { createSessionPersistenceStore, type SessionPersistenceStore } from './domains/sessions/session-persistence.js';
import { registerPersistenceRoutes } from './domains/sessions/persistence-routes.js';
import { registerFrontendRoutes } from './shared/frontend-route.js';
import { registerRegistryRoutes } from './domains/registry/routes.js';
import { MethodologySessionStore } from './domains/methodology/store.js';
import { registerMethodologyRoutes } from './domains/methodology/routes.js';
import { spawnGenesis, getGenesisSessionId } from './domains/genesis/spawner.js';
import { GenesisPollingLoop } from './domains/genesis/polling-loop.js';
import { CursorMaintenanceJob } from './domains/genesis/cursor-manager.js';
import { registerGenesisRoutes } from './domains/genesis/routes.js';
import { registerProjectRoutes, eventLog, cursorMap, getEventsFromLog, setOnEventHook } from './domains/projects/routes.js';
import { copyMethodology, copyStrategy, setResourceCopierPorts } from './domains/registry/resource-copier.js';
import websocket from '@fastify/websocket';
import { WsHub } from './shared/websocket/hub.js';
import { registerWsRoute } from './shared/websocket/route.js';
import { setOnExecutionChangeHook } from './domains/strategies/strategy-routes.js';
import { DiscoveryService } from './domains/projects/discovery-service.js';
import { InMemoryProjectRegistry } from './domains/registry/index.js';
import { JsonLineEventPersistence, YamlEventPersistence } from './domains/projects/events/index.js';
import { loadSessionsConfig } from './domains/sessions/config.js';
import { loadTokensConfig } from './domains/tokens/config.js';
import { loadTriggersConfig } from './domains/triggers/config.js';
import { loadGenesisConfig } from './domains/genesis/config.js';
import { loadStrategiesConfig } from './domains/strategies/config.js';
import { NodePtyProvider } from './ports/pty-provider.js';
import { NodeFileSystemProvider } from './ports/file-system.js';
import { JsYamlLoader } from './ports/yaml-loader.js';

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

const pool = createPool({
  maxSessions: sessionsConfig.maxSessions,
  claudeBin: sessionsConfig.claudeBin,
  settleDelayMs: sessionsConfig.settleDelayMs,
  minSpawnGapMs: sessionsConfig.minSpawnGapMs,
  ptyProvider,
  llmProvider,
  fsProvider,
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
      created_at: new Date(Date.now() - (Date.now() - s.lastActivityAt.getTime())).toISOString(),
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

const methodologyStore = new MethodologySessionStore(resolve(ROOT_DIR, 'registry'));
registerMethodologyRoutes(app, methodologyStore, {
  pool,
  appendMessage,
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
  registerTriggerRoutes(app, triggerRouter, triggersConfig.strategyDir);
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

    await registerProjectRoutes(app, discoveryService, projectRegistry, eventPersistence, ROOT_DIR, {
      copyMethodology,
      copyStrategy,
    });

    await app.listen({ port: PORT, host: '0.0.0.0' });
    app.log.info(`@method/bridge listening on port ${PORT}`);

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

    // PRD 020 Phase 2A: Spawn Genesis on startup if enabled
    if (genesisConfig.enabled) {
      try {
        const genesisResult = await spawnGenesis(pool, ROOT_DIR, 50000);
        app.log.info(
          `Genesis spawned: session_id=${genesisResult.sessionId}, budget=${genesisResult.budgetTokensPerDay} tokens/day`,
        );

        // F-A-3: Instantiate and start Genesis polling loop
        genesisPollingLoop = new GenesisPollingLoop({
          intervalMs: genesisConfig.pollingIntervalMs,
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

        app.log.info(`Genesis polling loop started (interval: ${genesisConfig.pollingIntervalMs}ms)`);

        // F-T-2: Start cursor maintenance job
        cursorMaintenanceJob = new CursorMaintenanceJob(
          join(ROOT_DIR, '.method', 'genesis-cursors.yaml'),
          genesisConfig.cursorCleanupIntervalMs,
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
