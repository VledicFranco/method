/**
 * PRD 017: Strategy Pipelines — Retrospective Generator (Phase 1d)
 *
 * Generates mandatory retrospective YAML after Strategy execution completes.
 * Captures timing, cost, gate results, oversight events, and artifacts
 * produced during execution.
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
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
            (gr) => gr.gate_id.includes(nr.node_id),
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
 * Compute the critical path through the DAG by total duration.
 * The critical path is the longest path from any root to any leaf,
 * weighted by actual node durations.
 */
export function computeCriticalPath(
  dag: StrategyDAG,
  nodeResults: Record<string, NodeResult>,
): string[] {
  // Build adjacency: for each node, which nodes depend on it (children)
  const children = new Map<string, string[]>();
  for (const node of dag.nodes) {
    if (!children.has(node.id)) {
      children.set(node.id, []);
    }
    for (const dep of node.depends_on) {
      if (!children.has(dep)) {
        children.set(dep, []);
      }
      children.get(dep)!.push(node.id);
    }
  }

  // Find root nodes (no dependencies)
  const roots = dag.nodes
    .filter((n) => n.depends_on.length === 0)
    .map((n) => n.id);

  // DFS to find longest path from each root
  let longestPath: string[] = [];
  let longestDuration = 0;

  function dfs(nodeId: string, currentPath: string[], currentDuration: number): void {
    const nr = nodeResults[nodeId];
    const nodeDuration = nr?.duration_ms ?? 0;
    const newDuration = currentDuration + nodeDuration;
    const newPath = [...currentPath, nodeId];

    const nodeChildren = children.get(nodeId) ?? [];
    if (nodeChildren.length === 0) {
      // Leaf node — check if this is the longest path
      if (newDuration > longestDuration) {
        longestDuration = newDuration;
        longestPath = newPath;
      }
      return;
    }

    for (const child of nodeChildren) {
      dfs(child, newPath, newDuration);
    }
  }

  for (const root of roots) {
    dfs(root, [], 0);
  }

  // If no paths found (empty DAG), return empty
  if (longestPath.length === 0 && dag.nodes.length > 0) {
    // Fallback: just return all node IDs
    return dag.nodes.map((n) => n.id);
  }

  return longestPath;
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

/**
 * Save a retrospective to disk.
 * Filename: retro-strategy-YYYY-MM-DD-NNN.yaml
 * Returns the full file path.
 */
export async function saveRetro(
  retro: StrategyRetro,
  retroDir: string,
): Promise<string> {
  // Ensure directory exists
  await fs.mkdir(retroDir, { recursive: true });

  // Determine sequence number for today
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const prefix = `retro-strategy-${today}-`;

  let maxSeq = 0;
  try {
    const files = await fs.readdir(retroDir);
    for (const file of files) {
      if (file.startsWith(prefix) && file.endsWith('.yaml')) {
        const seqStr = file.slice(prefix.length, -5); // Remove prefix and .yaml
        const seq = parseInt(seqStr, 10);
        if (!isNaN(seq) && seq > maxSeq) {
          maxSeq = seq;
        }
      }
    }
  } catch {
    // Directory may not have any files yet — that's fine
  }

  const nextSeq = String(maxSeq + 1).padStart(3, '0');
  const filename = `${prefix}${nextSeq}.yaml`;
  const filePath = join(retroDir, filename);

  const yamlContent = retroToYaml(retro);
  await fs.writeFile(filePath, yamlContent, 'utf-8');

  return filePath;
}
