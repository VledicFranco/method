/**
 * PRD 018: Event Triggers — TriggerRouter (Phase 2a-1 + Phase 2a-3)
 *
 * Central coordinator managing watcher lifecycle. Registers strategies,
 * creates watchers for event triggers, debounces events, and invokes
 * strategy execution when triggers fire.
 *
 * Phase 2a-3 additions: WebhookTrigger support, hot reload, management API support.
 *
 * Architectural constraint (DR-03): lives entirely in @method/bridge.
 * Invokes POST /strategies/execute via internal HTTP call.
 */

import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { NodeFileSystemProvider, type FileSystemProvider } from '../../ports/file-system.js';
import { JsYamlLoader, type YamlLoader } from '../../ports/yaml-loader.js';
import type { EventBus, EventSubscription, BridgeEvent } from '../../ports/event-bus.js';

// PRD 024 MG-1/MG-2: Module-level ports for trigger-router read/write
let _fs: FileSystemProvider | null = null;
let _yaml: YamlLoader | null = null;

/** PRD 024: Configure ports for trigger-router. Called from composition root. */
export function setTriggerRouterPorts(fs: FileSystemProvider, yaml: YamlLoader): void {
  _fs = fs;
  _yaml = yaml;
}

function getFs(): FileSystemProvider {
  if (!_fs) _fs = new NodeFileSystemProvider();
  return _fs;
}
function getYamlPort(): YamlLoader {
  if (!_yaml) _yaml = new JsYamlLoader();
  return _yaml;
}
import { DebounceEngine } from './debounce.js';
import { FileWatchTrigger } from './file-watch-trigger.js';
import { GitCommitTrigger } from './git-commit-trigger.js';
import { ScheduleTrigger } from './schedule-trigger.js';
import { PtyWatcherTrigger, type PtyObservation } from './pty-watcher-trigger.js';
import { ChannelEventTrigger, type ChannelMessageEvent } from './channel-event-trigger.js';
import { WebhookTrigger } from './webhook-trigger.js';
import { hasEventTriggers } from './trigger-parser.js';
import type {
  TriggerConfig,
  TriggerRegistration,
  TriggerEvent,
  TriggerWatcher,
  TriggerType,
  TimerInterface,
  DebouncedTriggerFire,
  FileWatchTriggerConfig,
  GitCommitTriggerConfig,
  ScheduleTriggerConfig,
  PtyWatcherTriggerConfig,
  ChannelEventTriggerConfig,
  WebhookTriggerConfig,
  DebounceConfig,
} from './types.js';
import { realTimers } from './types.js';

// ── Configuration ───────────────────────────────────────────────

const DEFAULTS = {
  debounce_ms: parseInt(process.env.TRIGGERS_DEFAULT_DEBOUNCE_MS ?? '5000', 10),
  max_batch_size: parseInt(process.env.TRIGGERS_MAX_BATCH_SIZE ?? '10', 10),
  max_watchers: parseInt(process.env.TRIGGERS_MAX_WATCHERS ?? '50', 10),
  history_size: parseInt(process.env.TRIGGERS_HISTORY_SIZE ?? '200', 10),
  log_fires: process.env.TRIGGERS_LOG_FIRES !== 'false',
};

// Trigger types that are event-driven (not manual/mcp_tool)
const EVENT_TRIGGER_TYPES = new Set<TriggerType>([
  'git_commit',
  'file_watch',
  'schedule',
  'webhook',
  'pty_watcher',
  'channel_event',
]);

// Default debounce strategy per trigger type
const DEFAULT_DEBOUNCE_STRATEGY: Record<string, 'leading' | 'trailing'> = {
  git_commit: 'leading',
  file_watch: 'trailing',
  schedule: 'leading',
  webhook: 'trailing',
  pty_watcher: 'trailing',
  channel_event: 'trailing',
};

// ── Interfaces ──────────────────────────────────────────────────

export interface TriggerRouterOptions {
  /** Base directory for resolving relative paths in strategies */
  baseDir: string;
  /** Bridge URL for invoking POST /strategies/execute */
  bridgeUrl: string;
  /** Injectable timer interface for testing */
  timer?: TimerInterface;
  /** Optional logger (defaults to console) */
  logger?: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
  /** Override max watchers limit */
  maxWatchers?: number;
  /** Override history size */
  historySize?: number;
  /** Override log_fires setting */
  logFires?: boolean;
  /** Strategy executor function (alternative to HTTP call, for testing) */
  executor?: (strategyPath: string, contextInputs: Record<string, unknown>) => Promise<{ execution_id: string }>;
  /**
   * PRD 018 Phase 2a-4: Callback to emit trigger_fired events to the channel system.
   * Called after a trigger successfully fires. Used to inject events into
   * GET /channels/events for dashboard visibility.
   */
  onTriggerFired?: (event: TriggerEvent) => void;
  /** PRD 026: EventBus for trigger domain events and bus-based subscriptions */
  eventBus?: EventBus;
}

// ── Internal state for a registered trigger (extends TriggerRegistration) ──

interface InternalRegistration extends TriggerRegistration {
  debounce: DebounceEngine | null;
}

// ── TriggerRouter Implementation ────────────────────────────────

export class TriggerRouter {
  private readonly registrations = new Map<string, InternalRegistration>();
  private readonly history: TriggerEvent[] = [];
  /** Stores content hashes per strategy ID for hot reload change detection */
  private readonly contentHashes = new Map<string, string>();
  private readonly options: Required<Pick<TriggerRouterOptions, 'baseDir' | 'bridgeUrl' | 'maxWatchers' | 'historySize' | 'logFires'>> & {
    timer: TimerInterface;
    logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
    executor: ((strategyPath: string, contextInputs: Record<string, unknown>) => Promise<{ execution_id: string }>) | null;
    onTriggerFired: ((event: TriggerEvent) => void) | null;
  };

  /** PRD 026: EventBus for bus-based event production and subscription */
  private readonly eventBus: EventBus | null;
  private readonly busSubscriptions: EventSubscription[] = [];

  private paused = false;
  private totalWatcherCount = 0;

  constructor(options: TriggerRouterOptions) {
    this.options = {
      baseDir: options.baseDir,
      bridgeUrl: options.bridgeUrl,
      timer: options.timer ?? realTimers,
      logger: options.logger ?? {
        info: (msg) => console.log(`[triggers] ${msg}`),
        warn: (msg) => console.warn(`[triggers] ${msg}`),
        error: (msg) => console.error(`[triggers] ${msg}`),
      },
      maxWatchers: options.maxWatchers ?? DEFAULTS.max_watchers,
      historySize: options.historySize ?? DEFAULTS.history_size,
      logFires: options.logFires ?? DEFAULTS.log_fires,
      executor: options.executor ?? null,
      onTriggerFired: options.onTriggerFired ?? null,
    };
    this.eventBus = options.eventBus ?? null;

    // PRD 026: Subscribe to bus events for observations and channel messages
    if (this.eventBus) {
      // Subscribe to PTY observations → route to PtyWatcherTrigger instances
      this.busSubscriptions.push(
        this.eventBus.subscribe(
          { domain: 'session', type: 'session.observation' },
          (event: BridgeEvent) => {
            const observation: PtyObservation = {
              category: event.payload.category as string,
              detail: (event.payload.detail as Record<string, unknown>) ?? {},
              session_id: event.sessionId ?? '',
            };
            this.onObservation(observation);
          },
        ),
      );

      // Subscribe to all domain events → route to ChannelEventTrigger instances
      // Map BridgeEvent → ChannelMessageEvent shape for backward compat
      this.busSubscriptions.push(
        this.eventBus.subscribe(
          {}, // all events
          (event: BridgeEvent) => {
            // Skip trigger domain events to avoid feedback loops
            if (event.domain === 'trigger') return;
            const message: ChannelMessageEvent = {
              channel_name: event.domain,
              sender: event.source,
              type: event.type,
              content: event.payload,
              session_id: event.sessionId,
            };
            this.onChannelMessage(message);
          },
        ),
      );
    }
  }

  /**
   * Register all event triggers from a Strategy YAML file.
   * Parses the YAML, extracts triggers, creates watchers.
   * Skips manual and mcp_tool triggers (Phase 1).
   */
  async registerStrategy(strategyPath: string): Promise<TriggerRegistration[]> {
    // Read and parse strategy YAML
    const yamlContent = getFs().readFileSync(strategyPath, 'utf-8');
    const raw = getYamlPort().load(yamlContent) as { strategy?: { id?: string; triggers?: unknown[] } };

    if (!raw?.strategy?.id) {
      throw new Error(`Invalid strategy YAML: missing strategy.id in ${strategyPath}`);
    }

    const strategyId = raw.strategy.id;
    // Store content hash for hot reload change detection
    this.contentHashes.set(strategyId, createHash('sha256').update(yamlContent).digest('hex'));
    const rawTriggers = raw.strategy.triggers ?? [];

    if (!Array.isArray(rawTriggers)) {
      throw new Error(`Invalid strategy YAML: triggers must be an array in ${strategyPath}`);
    }

    const results: TriggerRegistration[] = [];
    let triggerIndex = 0;

    for (const rawTrigger of rawTriggers) {
      if (!rawTrigger || typeof rawTrigger !== 'object' || !('type' in rawTrigger)) {
        triggerIndex++;
        continue;
      }

      const triggerType = (rawTrigger as { type: string }).type as TriggerType;

      // Skip non-event triggers (manual, mcp_tool)
      if (!EVENT_TRIGGER_TYPES.has(triggerType)) {
        triggerIndex++;
        continue;
      }

      // Check watcher limit
      if (this.totalWatcherCount >= this.options.maxWatchers) {
        this.options.logger.warn(
          `Max watchers limit reached (${this.options.maxWatchers}). Skipping trigger ${triggerType} for ${strategyId}`,
        );
        triggerIndex++;
        continue;
      }

      const triggerId = `${strategyId}:${triggerType}:${triggerIndex}`;
      const config = this.parseTriggerConfig(rawTrigger as Record<string, unknown>);

      if (!config) {
        triggerIndex++;
        continue;
      }

      const registration = this.createRegistration(
        triggerId,
        strategyId,
        strategyPath,
        config,
      );

      this.registrations.set(triggerId, registration);
      this.totalWatcherCount++;

      // Start the watcher immediately unless paused
      if (!this.paused && registration.enabled) {
        this.startWatcher(registration);
      }

      results.push(this.toPublicRegistration(registration));
      triggerIndex++;
    }

    if (results.length > 0) {
      this.options.logger.info(
        `Registered ${results.length} trigger(s) for strategy ${strategyId}`,
      );
    }

    return results;
  }

  /**
   * Unregister all triggers for a strategy.
   */
  unregisterStrategy(strategyId: string): void {
    const toRemove: string[] = [];

    for (const [id, reg] of this.registrations) {
      if (reg.strategy_id === strategyId) {
        this.stopWatcher(reg);
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      this.registrations.delete(id);
      this.totalWatcherCount = Math.max(0, this.totalWatcherCount - 1);
    }

    if (toRemove.length > 0) {
      this.contentHashes.delete(strategyId);
      this.options.logger.info(
        `Unregistered ${toRemove.length} trigger(s) for strategy ${strategyId}`,
      );
    }
  }

  /**
   * Enable or disable a specific trigger.
   */
  setTriggerEnabled(triggerId: string, enabled: boolean): void {
    const reg = this.registrations.get(triggerId);
    if (!reg) throw new Error(`Trigger not found: ${triggerId}`);

    reg.enabled = enabled;

    if (enabled && !this.paused) {
      this.startWatcher(reg);
    } else {
      this.stopWatcher(reg);
    }
  }

  /**
   * Pause all triggers (maintenance mode).
   */
  pauseAll(): void {
    this.paused = true;
    for (const reg of this.registrations.values()) {
      this.stopWatcher(reg);
    }
    this.options.logger.info('All triggers paused');
  }

  /**
   * Resume all triggers.
   */
  resumeAll(): void {
    this.paused = false;
    for (const reg of this.registrations.values()) {
      if (reg.enabled) {
        this.startWatcher(reg);
      }
    }
    this.options.logger.info('All triggers resumed');
  }

  /**
   * Get status of all registered triggers.
   */
  getStatus(): TriggerRegistration[] {
    return Array.from(this.registrations.values()).map((r) =>
      this.toPublicRegistration(r),
    );
  }

  /**
   * Get the registrations map (for internal use / testing).
   */
  getRegistrations(): Map<string, TriggerRegistration> {
    const result = new Map<string, TriggerRegistration>();
    for (const [id, reg] of this.registrations) {
      result.set(id, this.toPublicRegistration(reg));
    }
    return result;
  }

  /**
   * Get trigger fire history.
   */
  getHistory(limit?: number): TriggerEvent[] {
    const n = limit ?? this.options.historySize;
    return this.history.slice(-n);
  }

  /**
   * Whether triggers are currently paused.
   */
  get isPaused(): boolean {
    return this.paused;
  }

  /**
   * Total active watcher count.
   */
  get watcherCount(): number {
    return this.totalWatcherCount;
  }

  /**
   * Shutdown: stop all watchers, clear all state.
   */
  async shutdown(): Promise<void> {
    // PRD 026: Unsubscribe from bus events
    for (const sub of this.busSubscriptions) {
      sub.unsubscribe();
    }
    this.busSubscriptions.length = 0;

    for (const reg of this.registrations.values()) {
      this.stopWatcher(reg);
    }
    this.registrations.clear();
    this.totalWatcherCount = 0;
    this.contentHashes.clear();
    this.options.logger.info('TriggerRouter shut down');
  }

  // ── External event hooks (Phase 2a-2) ───────────────────────

  /**
   * PRD 018 Phase 2a-2: Forward a PTY watcher observation to all registered
   * pty_watcher triggers. Called by the pool's diagnosticsCallback wrapper.
   */
  onObservation(observation: PtyObservation): void {
    if (this.paused) return;

    for (const reg of this.registrations.values()) {
      if (!reg.enabled || reg.trigger_config.type !== 'pty_watcher') continue;
      const watcher = reg.watcher;
      if (watcher && watcher.active && watcher instanceof PtyWatcherTrigger) {
        try {
          watcher.handleObservation(observation);
        } catch {
          // Non-fatal — individual watcher errors shouldn't affect others
        }
      }
    }
  }

  /**
   * PRD 018 Phase 2a-2: Forward a channel message to all registered
   * channel_event triggers. Called by the channels.ts onMessage hook.
   */
  onChannelMessage(message: ChannelMessageEvent): void {
    if (this.paused) return;

    for (const reg of this.registrations.values()) {
      if (!reg.enabled || reg.trigger_config.type !== 'channel_event') continue;
      const watcher = reg.watcher;
      if (watcher && watcher.active && watcher instanceof ChannelEventTrigger) {
        try {
          watcher.handleChannelMessage(message);
        } catch {
          // Non-fatal — individual watcher errors shouldn't affect others
        }
      }
    }
  }

  // ── Webhook Route Integration (Phase 2a-3) ──────────────────

  /**
   * Get all registered webhook triggers. Used by the route registration
   * layer to create/update Fastify routes.
   */
  getWebhookTriggers(): Array<{ triggerId: string; watcher: WebhookTrigger }> {
    const result: Array<{ triggerId: string; watcher: WebhookTrigger }> = [];
    for (const [id, reg] of this.registrations) {
      if (reg.trigger_config.type === 'webhook' && reg.watcher instanceof WebhookTrigger) {
        result.push({ triggerId: id, watcher: reg.watcher });
      }
    }
    return result;
  }

  // ── Hot Reload (Phase 2a-3) ────────────────────────────────

  /**
   * Hot reload: re-scan a strategy directory and reconcile registrations.
   * - New strategy files → register
   * - Changed strategy files → unregister old, register new
   * - Deleted strategy files → unregister
   *
   * @returns Summary of changes: { added, updated, removed, errors }
   */
  async reloadStrategies(
    strategyDir: string,
  ): Promise<{ added: string[]; updated: string[]; removed: string[]; errors: Array<{ file: string; error: string }> }> {
    const resolvedDir = resolve(strategyDir);
    const result = {
      added: [] as string[],
      updated: [] as string[],
      removed: [] as string[],
      errors: [] as Array<{ file: string; error: string }>,
    };

    if (!getFs().existsSync(resolvedDir)) {
      this.options.logger.warn(`Strategy directory not found for reload: ${resolvedDir}`);
      return result;
    }

    // Read current files
    let files: string[];
    try {
      files = getFs().readdirSync(resolvedDir).filter(
        (f) => f.endsWith('.yaml') || f.endsWith('.yml'),
      );
    } catch (err) {
      this.options.logger.error(`Failed to read strategy directory for reload: ${(err as Error).message}`);
      return result;
    }

    // Build map of current file → strategy ID + content hash
    const currentFiles = new Map<string, { strategyId: string; contentHash: string }>();
    for (const file of files) {
      const filePath = join(resolvedDir, file);
      try {
        const content = getFs().readFileSync(filePath, 'utf-8');
        if (!hasEventTriggers(content)) continue;

        const raw = getYamlPort().load(content) as { strategy?: { id?: string } };
        if (!raw?.strategy?.id) continue;

        currentFiles.set(filePath, {
          strategyId: raw.strategy.id,
          contentHash: createHash('sha256').update(content).digest('hex'),
        });
      } catch (err) {
        result.errors.push({ file, error: (err as Error).message });
      }
    }

    // Build map of existing registrations by strategy ID → strategy path
    const existingStrategies = new Map<string, string>();
    for (const reg of this.registrations.values()) {
      existingStrategies.set(reg.strategy_id, reg.strategy_path);
    }

    // Get set of strategy IDs from current files
    const currentStrategyIds = new Set<string>();
    for (const { strategyId } of currentFiles.values()) {
      currentStrategyIds.add(strategyId);
    }

    // 1. Remove strategies whose files no longer exist
    for (const [strategyId] of existingStrategies) {
      if (!currentStrategyIds.has(strategyId)) {
        this.unregisterStrategy(strategyId);
        result.removed.push(strategyId);
      }
    }

    // 2. Add new or update changed strategies
    for (const [filePath, { strategyId, contentHash }] of currentFiles) {
      const existingPath = existingStrategies.get(strategyId);

      if (!existingPath) {
        // New strategy
        try {
          await this.registerStrategy(filePath);
          result.added.push(strategyId);
        } catch (err) {
          result.errors.push({ file: filePath, error: (err as Error).message });
        }
      } else {
        // Check if content changed using stored hash
        const existingHash = this.contentHashes.get(strategyId);
        if (existingHash !== contentHash) {
          try {
            this.unregisterStrategy(strategyId);
            await this.registerStrategy(filePath);
            result.updated.push(strategyId);
          } catch (err) {
            result.errors.push({ file: filePath, error: (err as Error).message });
          }
        }
      }
    }

    this.options.logger.info(
      `Reload complete: ${result.added.length} added, ${result.updated.length} updated, ` +
      `${result.removed.length} removed, ${result.errors.length} error(s)`,
    );

    return result;
  }

  // ── Internal ──────────────────────────────────────────────────

  private parseTriggerConfig(raw: Record<string, unknown>): TriggerConfig | null {
    const type = raw.type as string;

    switch (type) {
      case 'file_watch': {
        const paths = raw.paths as string[] | undefined;
        if (!paths || !Array.isArray(paths) || paths.length === 0) {
          this.options.logger.warn('file_watch trigger missing required "paths" field');
          return null;
        }
        return {
          type: 'file_watch',
          paths,
          events: raw.events as Array<'create' | 'modify' | 'delete'> | undefined,
          debounce_ms: raw.debounce_ms as number | undefined,
          debounce_strategy: raw.debounce_strategy as 'leading' | 'trailing' | undefined,
          max_concurrent: raw.max_concurrent as number | undefined,
          max_batch_size: raw.max_batch_size as number | undefined,
        };
      }

      case 'git_commit': {
        return {
          type: 'git_commit',
          branch_pattern: raw.branch_pattern as string | undefined,
          path_pattern: raw.path_pattern as string | undefined,
          debounce_ms: raw.debounce_ms as number | undefined,
          debounce_strategy: raw.debounce_strategy as 'leading' | 'trailing' | undefined,
          max_concurrent: raw.max_concurrent as number | undefined,
          max_batch_size: raw.max_batch_size as number | undefined,
        };
      }

      case 'schedule': {
        const cron = raw.cron as string | undefined;
        if (!cron || typeof cron !== 'string') {
          this.options.logger.warn('schedule trigger missing required "cron" field');
          return null;
        }
        return {
          type: 'schedule',
          cron,
          debounce_ms: raw.debounce_ms as number | undefined,
          debounce_strategy: raw.debounce_strategy as 'leading' | 'trailing' | undefined,
          max_concurrent: raw.max_concurrent as number | undefined,
          max_batch_size: raw.max_batch_size as number | undefined,
        };
      }

      case 'pty_watcher': {
        const pattern = raw.pattern as string | undefined;
        if (!pattern || typeof pattern !== 'string') {
          this.options.logger.warn('pty_watcher trigger missing required "pattern" field');
          return null;
        }
        return {
          type: 'pty_watcher',
          pattern,
          condition: raw.condition as string | undefined,
          debounce_ms: raw.debounce_ms as number | undefined,
          debounce_strategy: raw.debounce_strategy as 'leading' | 'trailing' | undefined,
          max_concurrent: raw.max_concurrent as number | undefined,
          max_batch_size: raw.max_batch_size as number | undefined,
        };
      }

      case 'channel_event': {
        const eventTypes = raw.event_types as string[] | undefined;
        if (!eventTypes || !Array.isArray(eventTypes) || eventTypes.length === 0) {
          this.options.logger.warn('channel_event trigger missing required "event_types" field');
          return null;
        }
        return {
          type: 'channel_event',
          event_types: eventTypes,
          filter: raw.filter as string | undefined,
          debounce_ms: raw.debounce_ms as number | undefined,
          debounce_strategy: raw.debounce_strategy as 'leading' | 'trailing' | undefined,
          max_concurrent: raw.max_concurrent as number | undefined,
          max_batch_size: raw.max_batch_size as number | undefined,
        };
      }

      case 'webhook': {
        const path = raw.path as string | undefined;
        if (!path || typeof path !== 'string') {
          this.options.logger.warn('webhook trigger missing required "path" field');
          return null;
        }
        return {
          type: 'webhook',
          path,
          secret_env: raw.secret_env as string | undefined,
          filter: raw.filter as string | undefined,
          methods: raw.methods as string[] | undefined,
          debounce_ms: raw.debounce_ms as number | undefined,
          debounce_strategy: raw.debounce_strategy as 'leading' | 'trailing' | undefined,
          max_concurrent: raw.max_concurrent as number | undefined,
          max_batch_size: raw.max_batch_size as number | undefined,
        };
      }

      default:
        return null;
    }
  }

  private createRegistration(
    triggerId: string,
    strategyId: string,
    strategyPath: string,
    config: TriggerConfig,
  ): InternalRegistration {
    const maxConcurrent =
      ('max_concurrent' in config ? config.max_concurrent : undefined) ?? 1;

    return {
      trigger_id: triggerId,
      strategy_id: strategyId,
      strategy_path: strategyPath,
      trigger_config: config,
      watcher: null,
      enabled: true,
      max_concurrent: maxConcurrent,
      active_executions: 0,
      stats: {
        total_fires: 0,
        last_fired_at: null,
        last_execution_id: null,
        debounced_events: 0,
        errors: 0,
      },
      debounce: null,
    };
  }

  private createWatcher(config: TriggerConfig): TriggerWatcher | null {
    switch (config.type) {
      case 'file_watch':
        return new FileWatchTrigger(config as FileWatchTriggerConfig, this.options.baseDir);

      case 'git_commit':
        return new GitCommitTrigger(config as GitCommitTriggerConfig, this.options.baseDir, {
          timer: this.options.timer,
        });

      case 'schedule':
        return new ScheduleTrigger(config as ScheduleTriggerConfig, {
          timer: this.options.timer,
        });

      case 'pty_watcher':
        return new PtyWatcherTrigger(config as PtyWatcherTriggerConfig);

      case 'channel_event':
        return new ChannelEventTrigger(config as ChannelEventTriggerConfig);

      case 'webhook':
        return new WebhookTrigger(config as WebhookTriggerConfig);

      default:
        return null;
    }
  }

  private getDebounceConfig(config: TriggerConfig): DebounceConfig {
    const type = config.type;
    const defaultStrategy = DEFAULT_DEBOUNCE_STRATEGY[type] ?? 'trailing';

    let debounceMs = DEFAULTS.debounce_ms;
    let strategy: 'leading' | 'trailing' = defaultStrategy;
    let maxBatchSize = DEFAULTS.max_batch_size;

    if ('debounce_ms' in config && config.debounce_ms !== undefined) {
      debounceMs = config.debounce_ms;
    }
    if ('debounce_strategy' in config && config.debounce_strategy !== undefined) {
      strategy = config.debounce_strategy;
    }
    if ('max_batch_size' in config && config.max_batch_size !== undefined) {
      maxBatchSize = config.max_batch_size;
    }

    return {
      window_ms: debounceMs,
      strategy,
      max_batch_size: maxBatchSize,
    };
  }

  private startWatcher(reg: InternalRegistration): void {
    if (reg.watcher?.active) return;

    const watcher = this.createWatcher(reg.trigger_config);
    if (!watcher) return;

    reg.watcher = watcher;

    // Create debounce engine
    const debounceConfig = this.getDebounceConfig(reg.trigger_config);
    const debounce = new DebounceEngine(
      debounceConfig,
      (batch) => {
        // PRD 018 Phase 2a-4: Catch debounce/routing errors so they don't crash the router
        try {
          this.onTriggerFired(reg, batch);
        } catch (err) {
          reg.stats.errors++;
          this.options.logger.error(
            `Debounce fire failed for ${reg.trigger_id}: ${(err as Error).message}`,
          );
        }
      },
      this.options.timer,
    );
    reg.debounce = debounce;

    // PRD 018 Phase 2a-4: Watcher crash recovery — if start() throws,
    // catch the error, log it, mark as errored, continue with other watchers
    try {
      watcher.start((payload) => {
        if (!reg.enabled || this.paused) return;
        try {
          debounce.push(payload);
        } catch {
          // Malformed event resilience — never crash from a push failure
        }
      });
    } catch (err) {
      reg.stats.errors++;
      reg.watcher = null;
      reg.debounce = null;
      this.options.logger.error(
        `Watcher start failed for ${reg.trigger_id}: ${(err as Error).message}`,
      );
    }
  }

  private stopWatcher(reg: InternalRegistration): void {
    if (reg.watcher) {
      reg.watcher.stop();
      reg.watcher = null;
    }
    if (reg.debounce) {
      reg.debounce.cancel();
      reg.debounce = null;
    }
  }

  private async onTriggerFired(
    reg: InternalRegistration,
    batch: DebouncedTriggerFire,
  ): Promise<void> {
    // max_concurrent guard
    if (reg.active_executions >= reg.max_concurrent) {
      if (this.options.logFires) {
        this.options.logger.warn(
          `Skipping trigger ${reg.trigger_id}: max_concurrent (${reg.max_concurrent}) reached`,
        );
      }
      reg.stats.debounced_events += batch.count;
      return;
    }

    // Reserve execution slot immediately after guard check (Fix 7: F-R-1)
    reg.active_executions++;

    // Build trigger event
    const triggerEvent: TriggerEvent = {
      trigger_type: reg.trigger_config.type as TriggerType,
      strategy_id: reg.strategy_id,
      trigger_id: reg.trigger_id,
      timestamp: new Date(this.options.timer.now()).toISOString(),
      payload: this.mergePayloads(reg.trigger_config.type, batch),
      debounced_count: batch.count,
    };

    // Update stats
    reg.stats.total_fires++;
    reg.stats.last_fired_at = triggerEvent.timestamp;
    reg.stats.debounced_events += Math.max(0, batch.count - 1);

    // Add to history
    this.history.push(triggerEvent);
    if (this.history.length > this.options.historySize) {
      this.history.shift();
    }

    if (this.options.logFires) {
      this.options.logger.info(
        `Trigger fired: ${reg.trigger_id} (${batch.count} event(s) debounced)`,
      );
    }

    // PRD 026: Emit trigger.fired event to Universal Event Bus
    if (this.eventBus) {
      try {
        this.eventBus.emit({
          version: 1,
          domain: 'trigger',
          type: 'trigger.fired',
          severity: 'info',
          payload: {
            trigger_id: triggerEvent.trigger_id,
            trigger_type: triggerEvent.trigger_type,
            strategy_id: triggerEvent.strategy_id,
            debounced_count: triggerEvent.debounced_count,
            payload: triggerEvent.payload,
          },
          source: 'bridge/triggers/router',
        });
      } catch { /* bus emission must never block trigger execution */ }
    }

    // Legacy callback — retained during migration, removed in T6
    if (this.options.onTriggerFired) {
      try {
        this.options.onTriggerFired(triggerEvent);
      } catch {
        // Channel emission failure is non-fatal — never block trigger execution
      }
    }

    // Execute strategy
    try {
      const result = await this.executeStrategy(reg, triggerEvent);
      reg.stats.last_execution_id = result.execution_id;
    } catch (err) {
      reg.stats.errors++;
      this.options.logger.error(
        `Trigger execution failed for ${reg.trigger_id}: ${(err as Error).message}`,
      );
    } finally {
      reg.active_executions = Math.max(0, reg.active_executions - 1);
    }
  }

  private mergePayloads(
    triggerType: string,
    batch: DebouncedTriggerFire,
  ): Record<string, unknown> {
    if (batch.events.length === 1) {
      return {
        ...batch.events[0].payload,
        debounced_count: batch.count,
      };
    }

    // Merge multiple events based on trigger type
    switch (triggerType) {
      case 'git_commit':
        return {
          commits: batch.events.map((e) => ({
            sha: e.payload.commit_sha,
            message: e.payload.commit_message,
            branch: e.payload.branch,
          })),
          latest_sha: batch.events[batch.events.length - 1].payload.commit_sha,
          branch: batch.events[batch.events.length - 1].payload.branch,
          debounced_count: batch.count,
        };

      case 'file_watch':
        return {
          changed_files: batch.events.map((e) => ({
            path: e.payload.path,
            event: e.payload.event_type,
          })),
          debounced_count: batch.count,
        };

      default:
        return {
          events: batch.events.map((e) => e.payload),
          debounced_count: batch.count,
        };
    }
  }

  private async executeStrategy(
    reg: InternalRegistration,
    triggerEvent: TriggerEvent,
  ): Promise<{ execution_id: string }> {
    const contextInputs: Record<string, unknown> = {
      trigger_event: {
        trigger_type: triggerEvent.trigger_type,
        trigger_id: triggerEvent.trigger_id,
        fired_at: triggerEvent.timestamp,
        debounced_count: triggerEvent.debounced_count,
        ...triggerEvent.payload,
      },
    };

    // Use injected executor if provided (testing)
    if (this.options.executor) {
      return this.options.executor(reg.strategy_path, contextInputs);
    }

    // Otherwise, use HTTP call to bridge
    const response = await fetch(`${this.options.bridgeUrl}/strategies/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        strategy_path: reg.strategy_path,
        context_inputs: contextInputs,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Strategy execution failed (${response.status}): ${body}`);
    }

    const result = (await response.json()) as { execution_id: string };
    return result;
  }

  private toPublicRegistration(reg: InternalRegistration): TriggerRegistration {
    return {
      trigger_id: reg.trigger_id,
      strategy_id: reg.strategy_id,
      strategy_path: reg.strategy_path,
      trigger_config: reg.trigger_config,
      watcher: reg.watcher,
      enabled: reg.enabled,
      max_concurrent: reg.max_concurrent,
      active_executions: reg.active_executions,
      stats: { ...reg.stats },
    };
  }
}
