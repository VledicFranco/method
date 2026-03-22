/**
 * StepDAG<S> — Step directed acyclic graph.
 *
 * F1-FTH Definition 4.4: Γ = (V, E, σ_init, σ_term)
 */

import type { Step } from "./step.js";
import { evaluate } from "../predicate/evaluate.js";

/** A directed edge in the step DAG. */
export type StepEdge = {
  readonly from: string;
  readonly to: string;
};

/** The step DAG. Acyclic by definition — edges represent composability. */
export type StepDAG<S> = {
  readonly steps: readonly Step<S>[];
  readonly edges: readonly StepEdge[];
  readonly initial: string;
  readonly terminal: string;
};

/** Compute topological order of steps. Returns steps in a valid execution sequence. */
export function topologicalOrder<S>(dag: StepDAG<S>): Step<S>[] {
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const stepMap = new Map<string, Step<S>>();

  for (const step of dag.steps) {
    stepMap.set(step.id, step);
    adjacency.set(step.id, []);
    inDegree.set(step.id, 0);
  }

  for (const edge of dag.edges) {
    adjacency.get(edge.from)!.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const result: Step<S>[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(stepMap.get(id)!);
    for (const neighbor of adjacency.get(id) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  return result;
}

/**
 * Verify step composability: post(A) ⊆ pre(B) over test states.
 * F1-FTH Definition 4.3.
 */
export function checkComposability<S>(
  stepA: Step<S>,
  stepB: Step<S>,
  testStates: S[],
): { composable: boolean; counterexample: S | null } {
  for (const state of testStates) {
    if (evaluate(stepA.postcondition, state) && !evaluate(stepB.precondition, state)) {
      return { composable: false, counterexample: state };
    }
  }
  return { composable: true, counterexample: null };
}
