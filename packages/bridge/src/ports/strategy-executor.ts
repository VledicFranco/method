// SPDX-License-Identifier: Apache-2.0
/**
 * StrategyExecutorPort — Strategy DAG execution for the Build Orchestrator.
 *
 * Lets the BuildOrchestrator invoke compiled strategy DAGs by ID without
 * importing from the strategies domain (G-BOUNDARY). An adapter wraps the
 * strategies-domain StrategyExecutor and handles strategy loading, parsing,
 * and result-type mapping.
 *
 * TRIVIAL surface (per fcd-design Phase 3.2): 1 method, result type. Defined
 * inline without a separate /fcd-surface session.
 *
 * @see PRD 047 — Build Orchestrator §Surfaces
 * @see github.com/VledicFranco/method/issues/154
 */

// ── Port Interface ──

export interface StrategyExecutorPort {
  /**
   * Execute a strategy DAG by ID and wait for completion.
   *
   * The adapter resolves the strategy ID to a DAG (typically by scanning
   * `.method/strategies/`), executes it with the supplied context inputs,
   * and returns a normalized result. Strategy loading failures surface as
   * `{ success: false, error }`; runtime failures surface via the DAG's
   * own failure semantics mapped into the same shape.
   */
  executeStrategy(
    strategyId: string,
    contextInputs: Record<string, unknown>,
  ): Promise<StrategyExecutionResult>;
}

// ── Result Type ──

export interface StrategyExecutionResult {
  /** True iff the DAG completed (status === "completed"). */
  readonly success: boolean;
  /** Human-readable summary of the execution outcome. */
  readonly output: string;
  /** Cost accumulated during execution. `tokens` is best-effort. */
  readonly cost: { tokens: number; usd: number };
  /** Unique identifier for this execution (for retro correlation). */
  readonly executionId: string;
  /** Flattened artifact_id → serialized content, if any artifacts were produced. */
  readonly artifacts?: Record<string, string>;
  /** Error message when success=false (loading error or node failure). */
  readonly error?: string;
  /** Additional failure context (e.g., suspended-gate details) for retry prompts. */
  readonly failureContext?: string;
}
