/**
 * PRD 017: Strategy Pipelines — HTTP Routes (Phase 1d)
 *
 * Registers Strategy-related routes on the Fastify app.
 * Keeps the bridge index.ts clean (DR-04: thin wrappers).
 */

import { promises as fs } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { LlmProvider } from './llm-provider.js';
import { parseStrategyYaml, validateStrategyDAG } from './strategy-parser.js';
import { StrategyExecutor, loadExecutorConfig } from './strategy-executor.js';
import type { StrategyExecutorConfig, StrategyExecutionResult } from './strategy-executor.js';
import { generateRetro, saveRetro } from './retro-generator.js';
import type { StrategyDAG } from './strategy-parser.js';

// ── In-memory execution store ──────────────────────────────────

interface ExecutionEntry {
  execution_id: string;
  strategy_id: string;
  strategy_name: string;
  executor: StrategyExecutor;
  dag: StrategyDAG;
  status: 'started' | 'running' | 'completed' | 'failed' | 'suspended';
  started_at: string;
  result?: StrategyExecutionResult;
  retro_path?: string;
  cost_usd: number;
}

const executions = new Map<string, ExecutionEntry>();

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
    executor
      .execute(dag, context_inputs ?? {})
      .then(async (result) => {
        entry.status = result.status;
        entry.result = result;
        entry.cost_usd = result.cost_usd;

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
      cost_usd: entry.cost_usd,
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
}
