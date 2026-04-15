/**
 * PRD 017: Strategy Pipelines — HTTP Routes (Phase 1d)
 *
 * Registers Strategy-related routes on the Fastify app.
 * Keeps the bridge index.ts clean (DR-04: thin wrappers).
 */

import { join, resolve, isAbsolute } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { claudeCliProvider } from '@method/pacta-provider-claude-cli';
import { NodeFileSystemProvider, type FileSystemProvider } from '../../ports/file-system.js';
import { JsYamlLoader, type YamlLoader } from '../../ports/yaml-loader.js';
import type { EventBus } from '../../ports/event-bus.js';

// PRD 024 MG-1/MG-2: Module-level ports, set via setStrategyRoutesPorts()
let _fs: FileSystemProvider | null = null;
let _yaml: YamlLoader | null = null;

/** PRD 024: Configure ports for strategy routes. Called from composition root. */
export function setStrategyRoutesPorts(fs: FileSystemProvider, yaml: YamlLoader): void {
  _fs = fs;
  _yaml = yaml;
}

// PRD 026: EventBus port for strategy events
let _eventBus: EventBus | null = null;

/** PRD 026: Configure EventBus for strategy domain events. Called from composition root. */
export function setStrategyRoutesEventBus(bus: EventBus): void {
  _eventBus = bus;
}

// Adaptive oversight: SessionPool port for auto-spawning oversight sessions
import type { SessionPool } from '@method/runtime/sessions';
let _pool: SessionPool | null = null;

/** Configure SessionPool for adaptive oversight auto-spawn. Called from composition root. */
export function setStrategyRoutesPool(pool: SessionPool): void {
  _pool = pool;
}

// PRD-044: HumanApprovalResolver + SubStrategySource ports
// PRD-057 / S2 §3.2 / C2: engine logic moved to @method/runtime/strategy.
import type { SubStrategySource, HumanApprovalResolver } from '@method/runtime/strategy';
import { FsSubStrategySource } from '@method/runtime/strategy';

let _humanApprovalResolver: HumanApprovalResolver | null = null;
let _subStrategySource: SubStrategySource | null = null;

/** PRD-044: Configure HumanApprovalResolver for human_approval gates. Called from composition root. */
export function setStrategyRoutesHumanApprovalResolver(resolver: HumanApprovalResolver): void {
  _humanApprovalResolver = resolver;
}

/** PRD-044: Configure SubStrategySource for strategy sub-invocation nodes. Called from composition root. */
export function setStrategyRoutesSubStrategySource(source: SubStrategySource): void {
  _subStrategySource = source;
}

import {
  parseStrategyYaml,
  validateStrategyDAG,
  StrategyExecutor,
  ContextLoadExecutorImpl,
} from '@method/runtime/strategy';
import type {
  StrategyYaml,
  StrategyExecutorConfig,
  StrategyExecutionResult,
  ContextLoadExecutor,
} from '@method/runtime/strategy';

/** Build executor config from environment variables with defaults (DR-03: env access in bridge only) */
export function loadExecutorConfig(): StrategyExecutorConfig {
  return {
    maxParallel: parseInt(process.env.STRATEGY_MAX_PARALLEL ?? '3', 10),
    defaultGateRetries: parseInt(process.env.STRATEGY_DEFAULT_GATE_RETRIES ?? '3', 10),
    defaultTimeoutMs: parseInt(process.env.STRATEGY_DEFAULT_TIMEOUT_MS ?? '600000', 10),
    defaultBudgetUsd: process.env.STRATEGY_DEFAULT_BUDGET_USD
      ? parseFloat(process.env.STRATEGY_DEFAULT_BUDGET_USD)
      : undefined,
    retroDir: process.env.STRATEGY_RETRO_DIR ?? '.method/retros',
    projectRoot: process.cwd(),
  };
}

// ── Context Load Executor — lazy init when VOYAGE_API_KEY is available ────────

let _contextLoadExecutor: ContextLoadExecutor | null = null;

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
if (VOYAGE_API_KEY) {
  const projectRoot = process.cwd();
  import('@method/fca-index').then(({ createDefaultFcaIndex }) =>
    createDefaultFcaIndex({ projectRoot, voyageApiKey: VOYAGE_API_KEY })
  ).then((fcaIndex) => {
    _contextLoadExecutor = new ContextLoadExecutorImpl(fcaIndex.query);
  }).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    // Non-fatal: context-load nodes will fail with INDEX_NOT_FOUND at runtime
    console.error('[fca-index] context-load executor failed to initialize:', msg);
  });
}
import { generateRetro, saveRetro } from '@method/runtime/strategy';
import type { StrategyDAG } from '@method/runtime/strategy';

// ── In-memory execution store ──────────────────────────────────

const EXECUTION_TTL_MS = parseInt(process.env.STRATEGY_EXECUTION_TTL_MS ?? '3600000', 10);
const MAX_EXECUTIONS = parseInt(process.env.STRATEGY_MAX_EXECUTIONS ?? '50', 10);

interface ExecutionEntry {
  execution_id: string;
  strategy_id: string;
  strategy_name: string;
  executor: StrategyExecutor;
  dag: StrategyDAG;
  status: 'started' | 'running' | 'completed' | 'failed' | 'suspended';
  started_at: string;
  completed_at?: string;
  result?: StrategyExecutionResult;
  retro_path?: string;
  cost_usd: number;
  error?: string;
}

const executions = new Map<string, ExecutionEntry>();

// ── Execution status hook (wired by WsHub in index.ts) ──────

type OnExecutionChangeCallback = (entry: { execution_id: string; strategy_id: string; status: string }) => void;
let _onExecutionChangeHook: OnExecutionChangeCallback | null = null;

export function setOnExecutionChangeHook(hook: OnExecutionChangeCallback | null): void {
  _onExecutionChangeHook = hook;
}

function notifyExecutionChange(entry: ExecutionEntry): void {
  // PRD 026: Emit enriched event to the Universal Event Bus
  if (_eventBus) {
    try {
      const eventType = entry.status === 'failed'
        ? 'strategy.failed'
        : entry.status === 'completed' || entry.status === 'suspended'
          ? 'strategy.completed'
          : 'strategy.started';

      _eventBus.emit({
        version: 1,
        domain: 'strategy',
        type: eventType,
        severity: entry.status === 'failed' ? 'error' : 'info',
        payload: {
          execution_id: entry.execution_id,
          strategy_id: entry.strategy_id,
          strategy_name: entry.strategy_name,
          status: entry.status,
          cost_usd: entry.cost_usd,
          retro_path: entry.retro_path ?? null,
          error: entry.error ?? null,
        },
        source: 'bridge/strategies/routes',
      });
    } catch { /* non-fatal — bus emission must never block execution */ }
  }

  // Legacy hook — retained during migration, removed in T6
  if (_onExecutionChangeHook) {
    try {
      _onExecutionChangeHook({
        execution_id: entry.execution_id,
        strategy_id: entry.strategy_id,
        status: entry.status,
      });
    } catch { /* non-fatal */ }
  }
}

/**
 * Evict stale completed executions from the in-memory store.
 * 1. Remove completed executions older than EXECUTION_TTL_MS.
 * 2. If the map still exceeds MAX_EXECUTIONS, remove the oldest completed
 *    executions until within bounds.
 */
export function evictStaleExecutions(): void {
  const now = Date.now();

  // Pass 1: remove completed entries past TTL
  for (const [id, entry] of executions) {
    if (isTerminal(entry.status) && entry.completed_at) {
      const age = now - new Date(entry.completed_at).getTime();
      if (age > EXECUTION_TTL_MS) {
        executions.delete(id);
      }
    }
  }

  // Pass 2: if still over capacity, evict oldest completed first
  if (executions.size > MAX_EXECUTIONS) {
    const completedEntries = Array.from(executions.entries())
      .filter(([, e]) => isTerminal(e.status))
      .sort((a, b) => {
        const aTime = a[1].completed_at ? new Date(a[1].completed_at).getTime() : 0;
        const bTime = b[1].completed_at ? new Date(b[1].completed_at).getTime() : 0;
        return aTime - bTime; // oldest first
      });

    for (const [id] of completedEntries) {
      if (executions.size <= MAX_EXECUTIONS) break;
      executions.delete(id);
    }
  }
}

function isTerminal(status: ExecutionEntry['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'suspended';
}

// ── Route Registration ─────────────────────────────────────────

export function registerStrategyRoutes(
  app: FastifyInstance,
  _provider?: unknown, // deprecated — ignored, StrategyExecutor creates its own provider
  config?: Partial<StrategyExecutorConfig>,
): void {
  const executorConfig: StrategyExecutorConfig = {
    ...loadExecutorConfig(),
    ...config,
  };

  /**
   * POST /strategies/execute — Start a Strategy execution.
   */
  app.post<{
    Body: {
      strategy_yaml?: string;
      strategy_path?: string;
      context_inputs?: Record<string, unknown>;
    };
  }>('/strategies/execute', async (request, reply) => {
    // Evict stale completed executions before creating a new one
    evictStaleExecutions();

    const { strategy_yaml, strategy_path, context_inputs } = request.body ?? {};

    // Resolve YAML content
    let yamlContent: string;
    if (strategy_yaml) {
      yamlContent = strategy_yaml;
    } else if (strategy_path) {
      // Path traversal guard: reject absolute paths and '..' segments
      if (isAbsolute(strategy_path) || strategy_path.includes('..')) {
        return reply.status(400).send({
          error: 'Invalid strategy_path: absolute paths and ".." segments are not allowed',
        });
      }
      const strategyBaseDir = process.env.TRIGGERS_STRATEGY_DIR ?? '.method/strategies';
      const resolvedPath = resolve(strategyBaseDir, strategy_path);
      const resolvedBase = resolve(strategyBaseDir);
      if (!resolvedPath.startsWith(resolvedBase)) {
        return reply.status(400).send({
          error: 'Invalid strategy_path: path escapes the strategy directory',
        });
      }
      try {
        yamlContent = await (_fs ?? new NodeFileSystemProvider()).readFile(strategy_path, 'utf-8');
      } catch (e) {
        return reply.status(400).send({
          error: `Failed to read strategy file: ${(e as Error).message}`,
        });
      }
    } else {
      return reply.status(400).send({
        error: 'Missing required field: strategy_yaml or strategy_path',
      });
    }

    // Parse and validate
    let dag: StrategyDAG;
    try {
      dag = parseStrategyYaml(yamlContent);
    } catch (e) {
      return reply.status(400).send({
        error: `Failed to parse strategy YAML: ${(e as Error).message}`,
      });
    }

    const validation = validateStrategyDAG(dag);
    if (!validation.valid) {
      return reply.status(400).send({
        error: `Invalid strategy DAG: ${validation.errors.join('; ')}`,
      });
    }

    // PRD-044: Resolve sub-strategy source (default: scan .method/strategies/ in cwd)
    const subStrategyDir = process.env.TRIGGERS_STRATEGY_DIR ?? '.method/strategies';
    const subStrategySource = _subStrategySource
      ?? new FsSubStrategySource(subStrategyDir, _fs ?? new NodeFileSystemProvider());

    // Create executor with claudeCliProvider, wiring PRD-044 ports
    const executor = new StrategyExecutor(
      claudeCliProvider(),
      executorConfig,
      subStrategySource,
      _humanApprovalResolver,
      null, // semanticNodeExecutor — not yet wired
      _contextLoadExecutor,
    );
    const executionId = `exec-${dag.id}-${Date.now()}`;
    const startedAt = new Date().toISOString();

    const entry: ExecutionEntry = {
      execution_id: executionId,
      strategy_id: dag.id,
      strategy_name: dag.name,
      executor,
      dag,
      status: 'started',
      started_at: startedAt,
      cost_usd: 0,
    };

    executions.set(executionId, entry);

    // Start execution asynchronously
    entry.status = 'running';
    notifyExecutionChange(entry);
    executor
      .execute(dag, context_inputs ?? {})
      .then(async (result) => {
        entry.status = result.status;
        entry.result = result;
        entry.cost_usd = result.cost_usd;
        entry.completed_at = new Date().toISOString();
        notifyExecutionChange(entry);

        // Generate and save retrospective
        try {
          const retro = generateRetro(dag, result);
          const retroPath = await saveRetro(retro, executorConfig.retroDir);
          entry.retro_path = retroPath;
          app.log.info(
            `Strategy ${dag.id} execution ${executionId} ${result.status} — retro: ${retroPath}`,
          );
        } catch (e) {
          app.log.error(
            `Failed to save strategy retro for ${executionId}: ${(e as Error).message}`,
          );
        }

        // Adaptive oversight: auto-spawn oversight session on escalation
        if (result.status === 'suspended' && _pool) {
          try {
            const state = entry.executor.getState();
            const completedNodes = state
              ? Array.from(state.node_status.values()).filter(s => s === 'completed').length
              : 0;
            const totalNodes = dag.nodes.length;
            const artifactCount = result.artifacts
              ? Object.keys(result.artifacts).length
              : 0;

            const oversightLines = result.oversight_events.map(
              (e) => `- ${e.rule.action}: ${e.rule.condition} (triggered at ${e.triggered_at})`,
            ).join('\n');

            const oversightPrompt = [
              `Strategy "${dag.name}" (${dag.id}) execution ${executionId} has been SUSPENDED.`,
              '',
              '## Oversight Events',
              oversightLines,
              '',
              '## Current State',
              `- Status: suspended`,
              `- Cost: $${result.cost_usd.toFixed(4)}`,
              `- Nodes completed: ${completedNodes}/${totalNodes}`,
              `- Artifacts: ${artifactCount}`,
              '',
              '## Available Actions',
              'You have MCP tools to act on this:',
              `- strategy_execution_status { execution_id: "${executionId}" } — view full state`,
              `- strategy_update { strategy_id: "${dag.id}", yaml: "..." } — modify the strategy`,
              `- strategy_resume { execution_id: "${executionId}" } — resume execution`,
              `- strategy_abort { execution_id: "${executionId}", reason: "..." } — cancel`,
              '',
              '## Instructions',
              '1. Read the execution status to understand what happened',
              '2. If the issue is fixable (e.g., budget too low), update the strategy and resume',
              '3. If the issue is fundamental, abort with a clear reason',
              '4. For complex decisions, use /forge-debate to analyze alternatives',
            ].join('\n');

            // Fire-and-forget: spawn oversight session
            _pool.create({
              workdir: process.cwd(),
              initialPrompt: oversightPrompt,
              nickname: `oversight-${dag.id}`,
              purpose: `Adaptive oversight for suspended strategy ${dag.id} execution ${executionId}`,
            }).then((spawnResult) => {
              app.log.info(
                `Oversight session spawned for suspended strategy ${dag.id}: ${spawnResult.sessionId} (${spawnResult.nickname})`,
              );
            }).catch((spawnErr) => {
              app.log.error(
                `Failed to spawn oversight session for ${executionId}: ${(spawnErr as Error).message}`,
              );
            });
          } catch (e) {
            app.log.error(
              `Failed to prepare oversight spawn for ${executionId}: ${(e as Error).message}`,
            );
          }
        }
      })
      .catch((e) => {
        entry.status = 'failed';
        entry.result = undefined;
        entry.error = (e as Error).message;
        entry.completed_at = new Date().toISOString();
        notifyExecutionChange(entry);
        app.log.error(
          `Strategy ${dag.id} execution ${executionId} failed: ${(e as Error).message}`,
        );
      });

    return reply.status(202).send({
      execution_id: executionId,
      status: 'started',
    });
  });

  /**
   * GET /strategies/:id/status — Get execution status.
   */
  app.get<{
    Params: { id: string };
  }>('/strategies/:id/status', async (request, reply) => {
    const { id } = request.params;
    const entry = executions.get(id);

    if (!entry) {
      return reply.status(404).send({ error: `Execution not found: ${id}` });
    }

    // Build status snapshot
    const state = entry.executor.getState();
    const response: Record<string, unknown> = {
      execution_id: entry.execution_id,
      strategy_id: entry.strategy_id,
      strategy_name: entry.strategy_name,
      status: entry.status,
      started_at: entry.started_at,
      cost_usd: state ? state.cost_usd : entry.cost_usd,
    };

    if (state) {
      const nodeStatuses: Record<string, string> = {};
      for (const [nodeId, status] of state.node_status) {
        nodeStatuses[nodeId] = status;
      }
      response.node_statuses = nodeStatuses;

      const nodeResults: Record<string, unknown> = {};
      for (const [nodeId, result] of state.node_results) {
        nodeResults[nodeId] = {
          status: result.status,
          cost_usd: result.cost_usd,
          duration_ms: result.duration_ms,
          retries: result.retries,
          error: result.error,
        };
      }
      response.node_results = nodeResults;
      response.gate_results = state.gate_results;
    }

    if (entry.result) {
      response.completed_at = entry.result.completed_at;
      response.duration_ms = entry.result.duration_ms;
      response.artifacts = entry.result.artifacts;
      response.oversight_events = entry.result.oversight_events;
    }

    if (entry.retro_path) {
      response.retro_path = entry.retro_path;
    }

    if (entry.error && entry.status === 'failed') {
      response.error = entry.error;
    }

    return reply.status(200).send(response);
  });

  /**
   * POST /strategies/:id/resume — Resume a suspended strategy execution.
   *
   * NOT YET IMPLEMENTED: The DAG executor does not support resumption from a
   * suspended state. Re-execute the strategy instead. This endpoint is reserved
   * for Phase 2b when checkpoint-based resumption is available.
   */
  app.post<{
    Params: { id: string };
    Body: {
      modified_inputs?: Record<string, unknown>;
    };
  }>('/strategies/:id/resume', async (_request, reply) => {
    return reply.status(501).send({
      error: 'Resume is not yet implemented. The DAG executor does not support resumption from a suspended state. Re-execute the strategy instead.',
      phase: '2b',
    });
  });

  /**
   * POST /strategies/:id/abort — Abort a running or suspended strategy execution.
   * Sets the execution status to 'failed' with the provided reason.
   *
   * CAVEAT: For 'running' executions, this sets the status to 'failed' but does
   * NOT cancel in-flight LLM calls. The current node may continue until it
   * completes. Full cancellation via AbortController is planned for Phase 2b.
   */
  app.post<{
    Params: { id: string };
    Body: {
      reason?: string;
    };
  }>('/strategies/:id/abort', async (request, reply) => {
    const { id } = request.params;
    const entry = executions.get(id);

    if (!entry) {
      return reply.status(404).send({ error: `Execution not found: ${id}` });
    }

    if (entry.status !== 'running' && entry.status !== 'suspended' && entry.status !== 'started') {
      return reply.status(400).send({
        error: `Cannot abort execution with status '${entry.status}'. Only 'running', 'started', or 'suspended' executions can be aborted.`,
      });
    }

    const { reason } = request.body ?? {};
    const wasRunning = entry.status === 'running' || entry.status === 'started';

    entry.status = 'failed';
    entry.error = reason ?? 'Aborted by user';
    entry.completed_at = new Date().toISOString();
    notifyExecutionChange(entry);

    app.log.info(
      `Strategy ${entry.strategy_id} execution ${id} aborted: ${entry.error}`,
    );

    return reply.status(200).send({
      execution_id: entry.execution_id,
      strategy_id: entry.strategy_id,
      strategy_name: entry.strategy_name,
      status: entry.status,
      reason: entry.error,
      aborted: true,
      ...(wasRunning ? { caveat: 'In-flight LLM calls may continue until the current node completes. Full cancellation is planned for Phase 2b.' } : {}),
    });
  });

  /**
   * GET /strategies — List all strategy executions.
   */
  app.get('/strategies', async (_request, reply) => {
    const list = Array.from(executions.values()).map((entry) => ({
      execution_id: entry.execution_id,
      strategy_id: entry.strategy_id,
      strategy_name: entry.strategy_name,
      status: entry.status,
      started_at: entry.started_at,
      cost_usd: entry.cost_usd,
      retro_path: entry.retro_path ?? null,
    }));

    return reply.status(200).send(list);
  });

  /**
   * GET /api/strategies/:id/dag — Return the parsed DAG structure for the visualizer.
   * Includes node definitions, edges (depends_on), strategy gates, and capabilities.
   */
  app.get<{
    Params: { id: string };
  }>('/api/strategies/:id/dag', async (request, reply) => {
    const { id } = request.params;
    const entry = executions.get(id);

    if (!entry) {
      return reply.status(404).send({ error: `Execution not found: ${id}` });
    }

    const dag = entry.dag;

    return reply.status(200).send({
      id: dag.id,
      name: dag.name,
      version: dag.version,
      nodes: dag.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        depends_on: node.depends_on,
        inputs: node.inputs,
        outputs: node.outputs,
        gates: node.gates,
        config: node.config,
      })),
      strategy_gates: dag.strategy_gates.map((sg) => ({
        id: sg.id,
        depends_on: sg.depends_on,
        gate: sg.gate,
      })),
      capabilities: dag.capabilities,
      oversight_rules: dag.oversight_rules,
      context_inputs: dag.context_inputs,
    });
  });

  /**
   * POST /api/strategies/definitions — Create a new strategy definition.
   * Body: { id: string, yaml: string } OR { id: string, strategy: object }
   * Writes to {strategyDir}/{id}.yaml, triggers reload.
   */
  app.post<{
    Body: {
      id?: string;
      yaml?: string;
      strategy?: Record<string, unknown>;
    };
  }>('/api/strategies/definitions', async (request, reply) => {
    const strategyDir = process.env.TRIGGERS_STRATEGY_DIR ?? '.method/strategies';
    const { id, yaml: yamlContent, strategy: strategyObj } = request.body ?? {};

    if (!id) {
      return reply.status(400).send({ error: 'Missing required field: id' });
    }

    // Validate ID: alphanumeric + hyphens only, normalize to lowercase kebab-case
    const normalizedId = id.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!normalizedId) {
      return reply.status(400).send({ error: 'Invalid strategy ID: must contain alphanumeric characters or hyphens' });
    }

    const filePath = join(strategyDir, `${normalizedId}.yaml`);
    const fs = _fs ?? new NodeFileSystemProvider();

    // Check if file already exists
    if (fs.existsSync(filePath)) {
      return reply.status(409).send({ error: `Strategy '${normalizedId}' already exists` });
    }

    // Resolve YAML content
    let content: string;
    if (yamlContent) {
      content = yamlContent;
    } else if (strategyObj) {
      const yaml = _yaml ?? new JsYamlLoader();
      content = yaml.dump(strategyObj);
    } else {
      return reply.status(400).send({ error: 'Missing required field: yaml or strategy' });
    }

    // Ensure directory exists
    try {
      fs.mkdirSync(strategyDir, { recursive: true });
    } catch { /* directory may already exist */ }

    // Write file
    try {
      fs.writeFileSync(filePath, content);
    } catch (e) {
      return reply.status(500).send({ error: `Failed to write strategy file: ${(e as Error).message}` });
    }

    // Hot-reload triggers so new webhook routes get registered
    try {
      await fetch(`http://localhost:${process.env.PORT ?? 3456}/triggers/reload`, { method: 'POST' });
    } catch { /* non-fatal — triggers reload on next manual reload */ }

    return reply.status(201).send({
      id: normalizedId,
      file_path: `${normalizedId}.yaml`,
      message: `Strategy '${normalizedId}' created successfully.`,
    });
  });

  /**
   * PUT /api/strategies/definitions/:id — Update an existing strategy definition.
   * Body: { yaml: string }
   * Overwrites {strategyDir}/{id}.yaml, triggers reload.
   */
  app.put<{
    Params: { id: string };
    Body: { yaml?: string };
  }>('/api/strategies/definitions/:id', async (request, reply) => {
    const strategyDir = process.env.TRIGGERS_STRATEGY_DIR ?? '.method/strategies';
    const { id } = request.params;
    const { yaml: yamlContent } = request.body ?? {};

    if (!yamlContent) {
      return reply.status(400).send({ error: 'Missing required field: yaml' });
    }

    // Normalize ID
    const normalizedId = id.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const filePath = join(strategyDir, `${normalizedId}.yaml`);
    const fs = _fs ?? new NodeFileSystemProvider();

    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: `Strategy '${normalizedId}' not found` });
    }

    try {
      fs.writeFileSync(filePath, yamlContent);
    } catch (e) {
      return reply.status(500).send({ error: `Failed to write strategy file: ${(e as Error).message}` });
    }

    // Hot-reload triggers so webhook routes get updated
    try {
      await fetch(`http://localhost:${process.env.PORT ?? 3456}/triggers/reload`, { method: 'POST' });
    } catch { /* non-fatal */ }

    return reply.status(200).send({
      id: normalizedId,
      file_path: `${normalizedId}.yaml`,
      message: `Strategy '${normalizedId}' updated successfully.`,
    });
  });

  /**
   * DELETE /api/strategies/definitions/:id — Delete a strategy definition.
   * Removes {strategyDir}/{id}.yaml, triggers reload.
   */
  app.delete<{
    Params: { id: string };
  }>('/api/strategies/definitions/:id', async (request, reply) => {
    const strategyDir = process.env.TRIGGERS_STRATEGY_DIR ?? '.method/strategies';
    const { id } = request.params;

    // Normalize ID
    const normalizedId = id.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const filePath = join(strategyDir, `${normalizedId}.yaml`);
    const fs = _fs ?? new NodeFileSystemProvider();

    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: `Strategy '${normalizedId}' not found` });
    }

    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      return reply.status(500).send({ error: `Failed to delete strategy file: ${(e as Error).message}` });
    }

    // Hot-reload triggers so deleted webhook routes return 404
    try {
      await fetch(`http://localhost:${process.env.PORT ?? 3456}/triggers/reload`, { method: 'POST' });
    } catch { /* non-fatal */ }

    return reply.status(200).send({
      id: normalizedId,
      deleted: true,
      message: `Strategy '${normalizedId}' deleted successfully.`,
    });
  });

  /**
   * POST /api/strategies/reload — Force reload all strategy definitions.
   * Re-reads all YAML files from the strategy directory.
   */
  app.post('/api/strategies/reload', async (_request, reply) => {
    const strategyDir = process.env.TRIGGERS_STRATEGY_DIR ?? '.method/strategies';
    const fs = _fs ?? new NodeFileSystemProvider();

    let files: string[];
    try {
      const entries = await fs.readdir(strategyDir);
      files = entries.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
    } catch (e) {
      return reply.status(200).send({
        reloaded: true,
        definition_count: 0,
        error: `Failed to read strategy directory: ${(e as Error).message}`,
      });
    }

    // Also hot-reload trigger registrations + webhook routes
    try {
      await fetch(`http://localhost:${process.env.PORT ?? 3456}/triggers/reload`, { method: 'POST' });
    } catch { /* non-fatal */ }

    return reply.status(200).send({
      reloaded: true,
      definition_count: files.length,
    });
  });

  /**
   * GET /api/strategies/definitions — List all strategy definitions parsed from
   * .method/strategies/ YAML files (PRD 019.3 Component 1).
   *
   * Returns parsed strategy definitions with last execution info cross-referenced
   * from the in-memory execution store. Files that fail to parse are included with
   * an error field instead of the full definition.
   */
  app.get('/api/strategies/definitions', async (_request, reply) => {
    const strategyDir = process.env.TRIGGERS_STRATEGY_DIR ?? '.method/strategies';

    let files: string[];
    try {
      const entries = await (_fs ?? new NodeFileSystemProvider()).readdir(strategyDir);
      files = entries.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
    } catch (e) {
      return reply.status(200).send({
        definitions: [],
        error: `Failed to read strategy directory: ${(e as Error).message}`,
      });
    }

    const definitions: Array<Record<string, unknown>> = [];

    for (const file of files) {
      const filePath = join(strategyDir, file);
      try {
        const content = await (_fs ?? new NodeFileSystemProvider()).readFile(filePath, 'utf-8');
        const raw = (_yaml ?? new JsYamlLoader()).load(content) as StrategyYaml;
        const s = raw?.strategy;

        if (!s || !s.id) {
          definitions.push({
            file_path: file,
            error: 'Missing strategy.id in YAML',
          });
          continue;
        }

        // Extract trigger info from raw YAML (preserves full trigger config)
        const triggers = (s.triggers ?? []).map((t: Record<string, unknown>) => ({
          type: t.type as string,
          config: Object.fromEntries(
            Object.entries(t).filter(([k]) => k !== 'type'),
          ),
        }));

        // Parse nodes from raw YAML
        const nodes = (s.dag?.nodes ?? []).map(
          (n: Record<string, unknown>) => ({
            id: n.id,
            type: n.type,
            methodology: n.methodology ?? undefined,
            method_hint: n.method_hint ?? undefined,
            depends_on: (n.depends_on as string[]) ?? [],
            inputs: (n.inputs as string[]) ?? [],
            outputs: (n.outputs as string[]) ?? [],
            gates: ((n.gates as Array<Record<string, unknown>>) ?? []).map(
              (g: Record<string, unknown>) => ({
                type: g.type,
                check: g.check,
                max_retries: g.max_retries ?? 3,
              }),
            ),
          }),
        );

        // Strategy gates
        const strategyGates = (s.dag?.strategy_gates ?? []).map(
          (sg: Record<string, unknown>) => ({
            id: sg.id,
            depends_on: sg.depends_on,
            type: sg.type,
            check: sg.check,
          }),
        );

        // Oversight rules
        const oversightRules = (s.oversight?.rules ?? []).map(
          (r: Record<string, unknown>) => ({
            condition: r.condition,
            action: r.action,
          }),
        );

        // Context inputs
        const contextInputs = (s.context?.inputs ?? []).map(
          (ci: Record<string, unknown>) => ({
            name: ci.name,
            type: ci.type,
            default: ci.default,
          }),
        );

        // Outputs
        const outputs = (s.outputs ?? []).map(
          (o: Record<string, unknown>) => ({
            type: o.type,
            target: o.target,
          }),
        );

        // Cross-reference with in-memory executions for last execution info
        let lastExecution: Record<string, unknown> | undefined;
        const matchingExecutions = Array.from(executions.values())
          .filter((e) => e.strategy_id === s.id)
          .sort((a, b) => {
            const aTime = new Date(a.started_at).getTime();
            const bTime = new Date(b.started_at).getTime();
            return bTime - aTime; // newest first
          });

        if (matchingExecutions.length > 0) {
          const latest = matchingExecutions[0];
          const state = latest.executor.getState();
          const gateResults = state?.gate_results ?? {};
          const gatesPassed = Object.values(gateResults).filter(
            (r: unknown) => (r as Record<string, unknown>)?.passed === true,
          ).length;
          const gatesFailed = Object.values(gateResults).filter(
            (r: unknown) => (r as Record<string, unknown>)?.passed === false,
          ).length;

          lastExecution = {
            execution_id: latest.execution_id,
            status: latest.status,
            cost_usd: state ? state.cost_usd : latest.cost_usd,
            duration_ms: latest.result?.duration_ms ?? 0,
            completed_at: latest.completed_at ?? null,
            started_at: latest.started_at,
            gates_passed: gatesPassed,
            gates_failed: gatesFailed,
          };
        }

        definitions.push({
          id: s.id,
          name: s.name,
          version: s.version,
          file_path: file,
          triggers,
          nodes,
          strategy_gates: strategyGates,
          oversight_rules: oversightRules,
          context_inputs: contextInputs,
          outputs,
          last_execution: lastExecution ?? null,
          raw_yaml: content,
        });
      } catch (e) {
        definitions.push({
          file_path: file,
          error: `Failed to parse: ${(e as Error).message}`,
        });
      }
    }

    return reply.status(200).send({ definitions });
  });
}
