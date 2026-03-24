/**
 * Strategy compatibility layer — bridge between PRD 017 static strategy DAGs
 * and MethodTS adaptive strategy controllers.
 *
 * @deprecated WS-2: This module is superseded by the unified DAG pipeline
 * (dag-executor.ts, dag-parser.ts, dag-gates.ts). The DAG pipeline is the
 * canonical execution model for strategy YAML. This compat layer mapped typed
 * DAGs to the adaptive controller loop, which is no longer the production path.
 * Retained for backward compatibility — will be removed in a future release.
 *
 * fromStrategyDAG: wraps a static DAG as a StrategyController that advances
 * through nodes in dependency order.
 *
 * compileToYaml: serializes a StrategyDAG to PRD 017-compatible YAML.
 *
 * @see PRD 017 — Static Strategy DAGs
 * @see PRD 021 — MethodTS Typed Methodology SDK
 */

import { Effect } from "effect";
import yaml from "js-yaml";
import type { Methodology, SafetyBounds } from "../methodology/methodology.js";
import type { MethodologyResult } from "../runtime/accumulator.js";
import type { WorldState } from "../state/world-state.js";
import type { Gate } from "../gate/gate.js";
import type { StrategyController, StrategyDecision } from "./controller.js";

// ── Static DAG types (PRD 017) ──

/** A node in a static strategy DAG (PRD 017 format). */
export type StrategyDAGNode<S> = {
  readonly id: string;
  readonly methodology: Methodology<S>;
  readonly dependsOn: readonly string[];
};

/** A static strategy DAG (PRD 017 format). */
export type StrategyDAG<S> = {
  readonly id: string;
  readonly name: string;
  readonly nodes: readonly StrategyDAGNode<S>[];
  readonly gates: readonly Gate<S>[];
  readonly safety: SafetyBounds;
};

// ── Conversion ──

/**
 * Wrap a static PRD 017 StrategyDAG as a StrategyController.
 *
 * The controller runs nodes in topological (dependency) order, advancing
 * to the next node after each methodology completion. When all nodes are
 * exhausted, it returns a "done" decision.
 *
 * Note: the controller uses closure state to track progress through the DAG.
 * Each call to onComplete advances the cursor. This means a single controller
 * instance should only be used for one execution run.
 */
export function fromStrategyDAG<S>(dag: StrategyDAG<S>): StrategyController<S> {
  if (dag.nodes.length === 0) {
    throw new Error("StrategyDAG must have at least one node");
  }
  const ordered = topologicalSort(dag.nodes);
  let currentIndex = 0;

  return {
    id: dag.id,
    name: dag.name,
    methodology: ordered[0].methodology,
    gates: dag.gates,
    onComplete: (result) => {
      currentIndex++;
      if (currentIndex >= ordered.length) {
        return Effect.succeed({ tag: "done", result } as StrategyDecision<S>);
      }
      return Effect.succeed({
        tag: "switch_methodology",
        methodology: ordered[currentIndex].methodology,
      } as StrategyDecision<S>);
    },
    safety: dag.safety,
  };
}

/**
 * Compile a static StrategyDAG to PRD 017-compatible YAML.
 *
 * Serializes the DAG structure, mapping TypeScript camelCase fields to
 * YAML snake_case conventions. Methodology objects are referenced by ID,
 * not inlined — the consuming system resolves IDs from the registry.
 */
export function compileToYaml<S>(dag: StrategyDAG<S>): string {
  const yamlObj = {
    id: dag.id,
    name: dag.name,
    nodes: dag.nodes.map((n) => ({
      id: n.id,
      methodology_id: n.methodology.id,
      depends_on: [...n.dependsOn],
    })),
    gates: dag.gates.map((g) => ({
      id: g.id,
      description: g.description,
    })),
    safety: {
      max_loops: dag.safety.maxLoops,
      max_tokens: dag.safety.maxTokens,
      max_cost_usd: dag.safety.maxCostUsd,
      max_duration_ms: dag.safety.maxDurationMs,
      max_depth: dag.safety.maxDepth,
    },
  };
  return yaml.dump(yamlObj);
}

// ── Internal helpers ──

/** Topological sort for DAG nodes using Kahn's algorithm with cycle detection. */
function topologicalSort<S>(nodes: readonly StrategyDAGNode<S>[]): StrategyDAGNode<S>[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!nodeMap.has(dep)) {
        throw new Error(`StrategyDAG node "${node.id}" depends on unknown node "${dep}"`);
      }
      adjacency.get(dep)!.push(node.id);
      inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
    }
  }

  const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const result: StrategyDAGNode<S>[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(nodeMap.get(id)!);
    for (const neighbor of adjacency.get(id) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (result.length < nodes.length) {
    throw new Error(`Cycle detected in StrategyDAG: only ${result.length} of ${nodes.length} nodes reachable`);
  }

  return result;
}
