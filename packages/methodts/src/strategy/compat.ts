/**
 * Strategy compatibility layer — bridge between PRD 017 static strategy DAGs
 * and MethodTS adaptive strategy controllers.
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

// ── Strategy types (inline — WU-5.1 may not be merged yet) ──

/** Decision returned by a StrategyController after a methodology completes. */
export type StrategyDecision<S> =
  | { readonly tag: "done"; readonly result: MethodologyResult<S> }
  | { readonly tag: "rerun"; readonly methodology?: Methodology<S>; readonly state?: WorldState<S> }
  | { readonly tag: "switch_methodology"; readonly methodology: Methodology<S> }
  | { readonly tag: "abort"; readonly reason: string };

/** Adaptive controller wrapping a methodology with gates and completion logic. */
export type StrategyController<S> = {
  readonly id: string;
  readonly name: string;
  readonly methodology: Methodology<S>;
  readonly gates: readonly Gate<S>[];
  readonly onComplete: (result: MethodologyResult<S>) => Effect.Effect<StrategyDecision<S>, never, never>;
  readonly safety: SafetyBounds;
};

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
    },
  };
  return yaml.dump(yamlObj);
}

// ── Internal helpers ──

/** Simple topological sort for DAG nodes using Kahn's algorithm. */
function topologicalSort<S>(nodes: readonly StrategyDAGNode<S>[]): StrategyDAGNode<S>[] {
  const result: StrategyDAGNode<S>[] = [];
  const visited = new Set<string>();
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    const node = nodeMap.get(id)!;
    for (const dep of node.dependsOn) {
      visit(dep);
    }
    result.push(node);
  }

  for (const node of nodes) visit(node.id);
  return result;
}
