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
        error: `Strategy "${strategyId}" not found in strategy source`,
      };
    }

    let result: DagExecutionResult;
    try {
      result = await this.executor.execute(dag, contextInputs);
    } catch (e) {
      return {
        success: false,
        output: `Strategy "${strategyId}" threw during execution`,
        cost: { tokens: 0, usd: 0 },
        executionId,
        error: (e as Error).message,
      };
    }

    return mapResult(result, executionId);
  }
}

// ── Result Mapping ──

function mapResult(
  result: DagExecutionResult,
  executionId: string,
): StrategyExecutionResult {
  const success = result.status === 'completed';
  const nodeResults: NodeResult[] = Object.values(result.node_results);
  const completedCount = nodeResults.filter(n => n.status === 'completed').length;
  const turns = nodeResults.reduce((sum, n) => sum + n.num_turns, 0);
  const artifacts = flattenArtifacts(result.artifacts);
  const hasArtifacts = Object.keys(artifacts).length > 0;

  const output = success
    ? `Strategy ${result.strategy_id} completed: ${completedCount}/${nodeResults.length} nodes`
    : `Strategy ${result.strategy_id} ${result.status}: ${completedCount}/${nodeResults.length} nodes`;

  if (success) {
    return {
      success: true,
      output,
      cost: { tokens: turns, usd: result.cost_usd },
      executionId,
      artifacts: hasArtifacts ? artifacts : undefined,
    };
  }

  const failedNodes = nodeResults.filter(n => n.error);
  const error = failedNodes.length > 0
    ? failedNodes.map(n => `${n.node_id}: ${n.error}`).join('; ')
    : `Strategy ${result.status}`;

  const failureContext = JSON.stringify({
    status: result.status,
    cost_usd: result.cost_usd,
    oversight_events: result.oversight_events.length,
    node_errors: failedNodes.map(n => ({ node: n.node_id, error: n.error })),
  });

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
