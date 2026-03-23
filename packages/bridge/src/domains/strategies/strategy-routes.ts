/**
 * PRD 017: Strategy Pipelines — HTTP Routes (Phase 1d)
 *
 * Registers Strategy-related routes on the Fastify app.
 * Keeps the bridge index.ts clean (DR-04: thin wrappers).
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import yaml from 'js-yaml';
import type { LlmProvider } from './llm-provider.js';
import { parseStrategyYaml, validateStrategyDAG } from './strategy-parser.js';
import type { StrategyYaml } from './strategy-parser.js';
import { StrategyExecutor } from './strategy-executor.js';
import type { StrategyExecutorConfig, StrategyExecutionResult } from './strategy-executor.js';

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
  };
}
import { generateRetro } from './retro-generator.js';
import { saveRetro } from './retro-writer.js';
import type { StrategyDAG } from './strategy-parser.js';

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
  provider: LlmProvider,
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
      try {
        yamlContent = await fs.readFile(strategy_path, 'utf-8');
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

    // Create executor
    const executor = new StrategyExecutor(provider, executorConfig);
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
      const entries = await fs.readdir(strategyDir);
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
        const content = await fs.readFile(filePath, 'utf-8');
        const raw = yaml.load(content) as StrategyYaml;
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
