/**
 * PRD 017: Strategy Pipelines — Retrospective Generator (Phase 1d)
 *
 * Generates mandatory retrospective YAML after Strategy execution completes.
 * Captures timing, cost, gate results, oversight events, and artifacts
 * produced during execution.
 *
 * Pure logic only — filesystem operations (saveRetro) live in @method/bridge.
 */

import yaml from 'js-yaml';
import type { StrategyExecutionResult, NodeResult } from './strategy-executor.js';
import type { StrategyDAG } from './strategy-parser.js';

// ── Types ──────────────────────────────────────────────────────

export interface StrategyRetro {
  retro: {
    strategy_id: string;
    generated_by: 'strategy-executor';
    generated_at: string;
    timing: {
      started_at: string;
      completed_at: string;
      duration_minutes: number;
      critical_path: string[];
    };
    execution_summary: {
      nodes_total: number;
      nodes_completed: number;
      nodes_failed: number;
      parallelization_efficiency: number;
    };
    cost: {
      total_usd: number;
      per_node: Array<{ node: string; cost_usd: number }>;
    };
    gates: {
      total: number;
      passed: number;
      failed_then_passed: number;
      failed_final: number;
      retries: Array<{
        node: string;
        gate: string;
        attempts: number;
        final: 'passed' | 'failed';
      }>;
    };
    oversight_events: Array<{
      rule_condition: string;
      action: string;
      triggered_at: string;
    }>;
    artifacts_produced: Array<{ id: string; producer: string }>;
  };
}

// ── Core Functions ─────────────────────────────────────────────

/**
 * Generate a retrospective from a completed Strategy execution.
 */
export function generateRetro(
  dag: StrategyDAG,
  result: StrategyExecutionResult,
): StrategyRetro {
  const now = new Date().toISOString();
  const durationMinutes = result.duration_ms / 60000;

  // Build critical path
  const criticalPath = computeCriticalPath(dag, result.node_results);

  // Compute parallelization efficiency = actual_time / sequential_time
  const sequentialTime = Object.values(result.node_results)
    .reduce((sum, nr) => sum + nr.duration_ms, 0);
  const parallelizationEfficiency = sequentialTime > 0
    ? Math.min(result.duration_ms / sequentialTime, 1.0)
    : 1.0;

  // Count completed / failed nodes
  const nodeResults = Object.values(result.node_results);
  const nodesCompleted = nodeResults.filter((nr) => nr.status === 'completed').length;
  const nodesFailed = nodeResults.filter(
    (nr) => nr.status === 'failed' || nr.status === 'gate_failed',
  ).length;

  // Cost per node
  const perNode = nodeResults.map((nr) => ({
    node: nr.node_id,
    cost_usd: nr.cost_usd,
  }));

  // Gate aggregation
  const totalGates = result.gate_results.length;
  const passedGates = result.gate_results.filter((gr) => gr.passed).length;

  // Build retry data from node results
  const retries: StrategyRetro['retro']['gates']['retries'] = [];
  let failedThenPassed = 0;
  let failedFinal = 0;

  for (const nr of nodeResults) {
    if (nr.retries > 0) {
      // This node had gate retries
      const nodeObj = dag.nodes.find((n) => n.id === nr.node_id);
      if (nodeObj) {
        for (const gate of nodeObj.gates) {
          const gateResults = nr.gate_results.filter(
            (gr) => gr.gate_id.startsWith(nr.node_id + ':'),
          );
          if (gateResults.length > 0) {
            const finalResult = gateResults[gateResults.length - 1];
            const entry = {
              node: nr.node_id,
              gate: gate.check,
              attempts: nr.retries + 1,
              final: (finalResult.passed ? 'passed' : 'failed') as 'passed' | 'failed',
            };
            retries.push(entry);
            if (finalResult.passed) {
              failedThenPassed++;
            } else {
              failedFinal++;
            }
          }
        }
      }
    }
  }

  // Oversight events
  const oversightEvents = result.oversight_events.map((oe) => ({
    rule_condition: oe.rule.condition,
    action: oe.rule.action,
    triggered_at: oe.triggered_at,
  }));

  // Artifacts produced
  const artifactsProduced: Array<{ id: string; producer: string }> = [];
  for (const [id, version] of Object.entries(result.artifacts)) {
    if (version.producer_node_id !== '__context__') {
      artifactsProduced.push({ id, producer: version.producer_node_id });
    }
  }

  return {
    retro: {
      strategy_id: result.strategy_id,
      generated_by: 'strategy-executor',
      generated_at: now,
      timing: {
        started_at: result.started_at,
        completed_at: result.completed_at,
        duration_minutes: Math.round(durationMinutes * 100) / 100,
        critical_path: criticalPath,
      },
      execution_summary: {
        nodes_total: dag.nodes.length,
        nodes_completed: nodesCompleted,
        nodes_failed: nodesFailed,
        parallelization_efficiency: Math.round(parallelizationEfficiency * 100) / 100,
      },
      cost: {
        total_usd: result.cost_usd,
        per_node: perNode,
      },
      gates: {
        total: totalGates,
        passed: passedGates,
        failed_then_passed: failedThenPassed,
        failed_final: failedFinal,
        retries,
      },
      oversight_events: oversightEvents,
      artifacts_produced: artifactsProduced,
    },
  };
}

/**
 * Compute the critical path through a parallel DAG by earliest completion time.
 *
 * In a parallel DAG where `depends_on` means "waits for ALL deps", the
 * earliest a node can start is max(earliest_completion_time of all deps).
 * Its earliest completion time = that start time + own_duration.
 *
 * Algorithm:
 * 1. Process nodes in topological order, computing each node's earliest
 *    completion time (ECT) = max(ECT of all deps) + own_duration.
 * 2. The critical path ends at the node with the highest ECT.
 * 3. Trace back through deps, choosing the dep with the highest ECT at each step.
 */
export function computeCriticalPath(
  dag: StrategyDAG,
  nodeResults: Record<string, NodeResult>,
): string[] {
  if (dag.nodes.length === 0) return [];

  const nodeMap = new Map(dag.nodes.map((n) => [n.id, n]));

  // Compute earliest completion time (ECT) for each node in topological order.
  // ECT(n) = max(ECT(dep) for dep in n.depends_on) + duration(n)
  // For root nodes (no deps): ECT(n) = duration(n)
  const ect = new Map<string, number>();
  // Track which dep contributed the max ECT (for backtracking)
  const criticalPredecessor = new Map<string, string | null>();

  // Kahn's algorithm for topological processing
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const node of dag.nodes) {
    inDegree.set(node.id, node.depends_on.length);
    if (!dependents.has(node.id)) dependents.set(node.id, []);
    for (const dep of node.depends_on) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(node.id);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const node = nodeMap.get(nodeId)!;
    const duration = nodeResults[nodeId]?.duration_ms ?? 0;

    // Earliest start = max ECT among all dependencies
    let earliestStart = 0;
    let bestPredecessor: string | null = null;

    for (const dep of node.depends_on) {
      const depEct = ect.get(dep) ?? 0;
      if (depEct > earliestStart) {
        earliestStart = depEct;
        bestPredecessor = dep;
      }
    }

    ect.set(nodeId, earliestStart + duration);
    criticalPredecessor.set(nodeId, bestPredecessor);

    for (const dependent of dependents.get(nodeId) ?? []) {
      const newDeg = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDeg);
      if (newDeg === 0) queue.push(dependent);
    }
  }

  // Find the node with the highest ECT — that's the end of the critical path
  let maxEct = -1;
  let endNode = '';
  for (const [id, time] of ect) {
    if (time > maxEct) {
      maxEct = time;
      endNode = id;
    }
  }

  if (!endNode) return [];

  // Trace back from endNode through critical predecessors
  const path: string[] = [];
  let current: string | null = endNode;
  while (current !== null) {
    path.push(current);
    current = criticalPredecessor.get(current) ?? null;
  }

  path.reverse();
  return path;
}

/**
 * Serialize a StrategyRetro to YAML string.
 */
export function retroToYaml(retro: StrategyRetro): string {
  return yaml.dump(retro, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
  });
}
