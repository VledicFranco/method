/**
 * SemanticNodeExecutor — Port + implementation for executing SPL algorithms
 * as strategy DAG nodes.
 *
 * PRD 046 C-2c: Makes SPL algorithms (explore, design, implement, review)
 * invocable from strategy DAG semantic nodes. The port interface is injected
 * into DagStrategyExecutor; the default implementation maps algorithm names
 * to the actual SPL functions and runs them via runSemantic().
 *
 * @see PRD 046 — Runtime Consolidation
 * @see strategy/dag-types.ts — SemanticNodeConfig
 * @see semantic/run.ts — runSemantic()
 */

import { Effect, Layer } from "effect";
import type { SemanticAlgorithm, SemanticNodeConfig } from "../strategy/dag-types.js";
import { runSemantic } from "./run.js";
import type { SemanticResult, SemanticFn } from "./fn.js";
import { AgentProvider } from "../provider/agent-provider.js";
import type { AgentProvider as AgentProviderType } from "../provider/agent-provider.js";

// SPL algorithm imports
import { exploreLevel } from "./algorithms/explore.js";
import { designLevel } from "./algorithms/design.js";
import { implementLevel } from "./algorithms/implement.js";
import { reviewLevel as review } from "./algorithms/review.js";

// ── Port Interface ─────────────────────────────────────────────

/**
 * Port for executing semantic (SPL) algorithms from strategy DAG nodes.
 *
 * The strategy executor injects this port to dispatch `semantic` type nodes.
 * Implementations map algorithm names to SPL functions and provide the
 * AgentProvider context needed by runSemantic().
 */
export interface SemanticNodeExecutor {
  /**
   * Execute a semantic algorithm with the given input.
   *
   * @param config - The semantic node configuration (algorithm, input_mapping, output_key)
   * @param inputBundle - Mapped input values (already resolved from strategy context via input_mapping)
   * @returns The algorithm result as a key-value output, plus cost metadata
   */
  execute(
    config: SemanticNodeConfig,
    inputBundle: Record<string, unknown>,
  ): Promise<{
    output: Record<string, unknown>;
    cost_usd: number;
    duration_ms: number;
  }>;
}

// ── Algorithm Registry ─────────────────────────────────────────

/**
 * Maps algorithm names to their SPL level functions.
 *
 * We use the *Level variants (exploreLevel, designLevel, implementLevel, review)
 * which are single-level AtomicFn instances — suitable for strategy node execution
 * where each node is one step. The full recursive variants (explore, design, implement)
 * would be used when the strategy itself wants multi-level recursion within a single node.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ALGORITHM_REGISTRY: Record<SemanticAlgorithm, SemanticFn<any, any>> = {
  explore: exploreLevel,
  design: designLevel,
  implement: implementLevel,
  review: review,
};

// ── Default Implementation ─────────────────────────────────────

/**
 * Default SemanticNodeExecutor implementation.
 *
 * Bridges the strategy executor's Promise-based world to the Effect-based
 * SPL execution. Requires an AgentProvider to execute LLM calls within
 * the semantic functions.
 */
export class DefaultSemanticNodeExecutor implements SemanticNodeExecutor {
  constructor(private agentProvider: AgentProviderType) {}

  async execute(
    config: SemanticNodeConfig,
    inputBundle: Record<string, unknown>,
  ): Promise<{
    output: Record<string, unknown>;
    cost_usd: number;
    duration_ms: number;
  }> {
    const fn = ALGORITHM_REGISTRY[config.algorithm];
    if (!fn) {
      throw new Error(
        `SemanticNodeExecutor: unknown algorithm "${config.algorithm}"`,
      );
    }

    // Build the Effect program
    const program = runSemantic(fn, inputBundle);

    // Provide the AgentProvider and run the Effect
    const providerLayer = Layer.succeed(AgentProvider, this.agentProvider);
    const runnable = Effect.provide(program, providerLayer);

    const startMs = Date.now();
    const result: SemanticResult<unknown> = await Effect.runPromise(runnable);
    const durationMs = Date.now() - startMs;

    // Package result under the output_key
    const output: Record<string, unknown> = {
      [config.output_key]: result.data,
      _truths: result.truths,
      _status: result.status,
    };

    return {
      output,
      cost_usd: result.cost.usd,
      duration_ms: durationMs,
    };
  }
}
