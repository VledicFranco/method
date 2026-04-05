/**
 * StrategyExecutorAdapter — wraps a DAG executor + strategy source into the
 * StrategyExecutorPort shape consumed by the BuildOrchestrator.
 *
 * Responsibilities:
 *   1. Resolve a strategy ID to a StrategyDAG via the SubStrategySource port.
 *   2. Execute the DAG through the injected executor.
 *   3. Map methodts StrategyExecutionResult into the port's result shape.
 *
 * The adapter defines a minimal DagExecutor interface (the structural shape
 * of the strategies-domain StrategyExecutor.execute method) so that build/
 * never runtime-imports strategies/ (G-BOUNDARY). The composition root wires
 * the real StrategyExecutor at startup — it satisfies DagExecutor structurally.
 *
 * @see PRD 047 — Build Orchestrator
 * @see github.com/VledicFranco/method/issues/154
 */

import type {
  StrategyDAG,
  StrategyExecutionResult as DagExecutionResult,
  SubStrategySource,
  ArtifactBundle,
  NodeResult,
} from '@method/methodts/strategy/dag-types.js';
import type {
  StrategyExecutorPort,
  StrategyExecutionResult,
} from '../../ports/strategy-executor.js';

// ── Minimal DAG executor surface ──

/**
 * Structural interface the adapter needs from any DAG executor.
 * The strategies-domain StrategyExecutor satisfies this by shape without
 * an import dependency (G-BOUNDARY compliance).
 */
export interface DagExecutor {
  execute(
    dag: StrategyDAG,
    contextInputs: Record<string, unknown>,
  ): Promise<DagExecutionResult>;
}

// ── Adapter ──

export class StrategyExecutorAdapter implements StrategyExecutorPort {
  constructor(
    private readonly executor: DagExecutor,
    private readonly source: SubStrategySource,
  ) {}

  async executeStrategy(
    strategyId: string,
    contextInputs: Record<string, unknown>,
  ): Promise<StrategyExecutionResult> {
    const executionId = `exec-${strategyId}-${Date.now()}`;

    const dag = await this.source.getStrategy(strategyId);
    if (!dag) {
      return {
        success: false,
        output: `Strategy "${strategyId}" not found`,
        cost: { tokens: 0, usd: 0 },
        executionId,
        error: `Strategy "${strategyId}" not found in strategy source. Ensure ${strategyId}.yaml exists in .method/strategies/.`,
      };
    }

    // Gap 5: Validate that required (non-default) strategy inputs are provided
    const missingRequired: string[] = [];
    for (const input of dag.context_inputs) {
      if (input.default === undefined && !(input.name in contextInputs)) {
        missingRequired.push(input.name);
      }
    }
    if (missingRequired.length > 0) {
      const declaredInputs = dag.context_inputs.map((i) =>
        i.default !== undefined ? `${i.name}?` : i.name,
      );
      console.warn(JSON.stringify({
        level: 'warn',
        source: 'strategy-executor-adapter',
        event: 'strategy.inputs_missing',
        strategy_id: strategyId,
        missing_required: missingRequired,
        declared_inputs: declaredInputs,
        provided_inputs: Object.keys(contextInputs),
        warning: `Strategy "${strategyId}" requires inputs [${missingRequired.join(', ')}] — nodes will receive undefined`,
      }));
    }

    // Log strategy start with provided vs declared inputs
    console.log(JSON.stringify({
      level: 'info',
      source: 'strategy-executor-adapter',
      event: 'strategy.execute_start',
      strategy_id: strategyId,
      execution_id: executionId,
      node_count: dag.nodes.length,
      provided_inputs: Object.keys(contextInputs),
      declared_inputs: dag.context_inputs.map((i) => i.name),
    }));

    let result: DagExecutionResult;
    try {
      result = await this.executor.execute(dag, contextInputs);
    } catch (e) {
      const errMessage = (e as Error).message;
      console.error(JSON.stringify({
        level: 'error',
        source: 'strategy-executor-adapter',
        event: 'strategy.execute_threw',
        strategy_id: strategyId,
        execution_id: executionId,
        error: errMessage,
      }));
      return {
        success: false,
        output: `Strategy "${strategyId}" threw during execution`,
        cost: { tokens: 0, usd: 0 },
        executionId,
        error: errMessage,
        failureContext: JSON.stringify({
          strategy_id: strategyId,
          provided_inputs: Object.keys(contextInputs),
          missing_required: missingRequired,
        }),
      };
    }

    return mapResult(result, executionId, strategyId, contextInputs, missingRequired);
  }
}

// ── Result Mapping ──

function mapResult(
  result: DagExecutionResult,
  executionId: string,
  strategyId: string,
  contextInputs: Record<string, unknown>,
  missingRequired: string[],
): StrategyExecutionResult {
  const success = result.status === 'completed';
  const nodeResults: NodeResult[] = Object.values(result.node_results);
  const completedCount = nodeResults.filter(n => n.status === 'completed').length;
  const pendingCount = nodeResults.filter(n => n.status === 'pending').length;
  const failedCount = nodeResults.filter(n => n.error).length;
  const turns = nodeResults.reduce((sum, n) => sum + n.num_turns, 0);
  const artifacts = flattenArtifacts(result.artifacts);
  const hasArtifacts = Object.keys(artifacts).length > 0;

  // Gap 7: Richer completion log
  console.log(JSON.stringify({
    level: success ? 'info' : 'warn',
    source: 'strategy-executor-adapter',
    event: 'strategy.execute_complete',
    strategy_id: strategyId,
    execution_id: executionId,
    status: result.status,
    total_nodes: nodeResults.length,
    completed: completedCount,
    pending: pendingCount,
    failed: failedCount,
    cost_usd: result.cost_usd,
    artifact_count: Object.keys(artifacts).length,
  }));

  const output = success
    ? `Strategy ${result.strategy_id} completed: ${completedCount}/${nodeResults.length} nodes, $${result.cost_usd.toFixed(4)}`
    : `Strategy ${result.strategy_id} ${result.status}: ${completedCount}/${nodeResults.length} completed, ${failedCount} failed, ${pendingCount} pending`;

  if (success) {
    return {
      success: true,
      output,
      cost: { tokens: turns, usd: result.cost_usd },
      executionId,
      artifacts: hasArtifacts ? artifacts : undefined,
    };
  }

  // Gap 7: Richer failure diagnostics
  const failedNodes = nodeResults.filter(n => n.error);
  const error = failedNodes.length > 0
    ? failedNodes.map(n => `${n.node_id}: ${n.error}`).join('; ')
    : `Strategy finished with status "${result.status}" (${completedCount}/${nodeResults.length} nodes). ${
        nodeResults.length === 0 ? 'No nodes executed — likely a DAG configuration issue.' : ''
      }${missingRequired.length > 0 ? ` Missing required inputs: [${missingRequired.join(', ')}].` : ''}`;

  const failureContext = JSON.stringify({
    strategy_id: strategyId,
    status: result.status,
    cost_usd: result.cost_usd,
    oversight_events: result.oversight_events.length,
    provided_inputs: Object.keys(contextInputs),
    missing_required_inputs: missingRequired,
    total_nodes: nodeResults.length,
    completed_nodes: completedCount,
    failed_nodes: failedCount,
    pending_nodes: pendingCount,
    node_errors: failedNodes.map(n => ({ node: n.node_id, error: n.error })),
  }, null, 2);

  return {
    success: false,
    output,
    cost: { tokens: turns, usd: result.cost_usd },
    executionId,
    artifacts: hasArtifacts ? artifacts : undefined,
    error,
    failureContext,
  };
}

function flattenArtifacts(bundle: ArtifactBundle): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, version] of Object.entries(bundle)) {
    out[id] = typeof version.content === 'string'
      ? version.content
      : JSON.stringify(version.content);
  }
  return out;
}
