/**
 * Execution accumulator and result types.
 *
 * Tracks methodology progress (loop count, tokens, cost, completed methods)
 * and defines the result shapes for methodology, method, and step execution.
 *
 * All types are serializable to YAML — no functions, no class instances (DR-T06).
 *
 * @see PRD 021 §12.6 — ExecutionAccumulator, MethodologyResult
 * @see PRD 021 §12.9 — MethodResult, StepResult
 */

import type { WorldState, StateTrace, Snapshot } from "../state/world-state.js";

/** Per-model cost breakdown (from AgentResult.modelUsage). */
export type ModelCostRecord = {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
};

/** Record of a completed method within a methodology run. */
export type CompletedMethodRecord = {
  readonly methodId: string;
  readonly objectiveMet: boolean;
  readonly stepOutputSummaries: Readonly<Record<string, string>>;
  readonly cost: {
    readonly tokens: number;
    readonly usd: number;
    readonly duration_ms: number;
    readonly modelBreakdown?: readonly ModelCostRecord[];
    readonly cacheCreationTokens?: number;
    readonly cacheReadTokens?: number;
  };
};

/** Enriched execution accumulator tracking methodology progress. */
export type ExecutionAccumulatorState = {
  readonly loopCount: number;
  readonly totalTokens: number;
  readonly totalCostUsd: number;
  readonly startedAt: Date;
  readonly elapsedMs: number;
  readonly suspensionCount: number;
  readonly completedMethods: readonly CompletedMethodRecord[];
};

/** Final result of a methodology run. */
export type MethodologyResult<S> = {
  readonly status: "completed" | "safety_violation" | "failed" | "aborted";
  readonly finalState: WorldState<S>;
  readonly trace: StateTrace<S>;
  readonly accumulator: ExecutionAccumulatorState;
  readonly violation?: {
    readonly bound: string;
    readonly limit: number;
    readonly actual: number;
  };
};

/** Result of running a single method's step DAG. */
export type MethodResult<S> = {
  readonly status: "completed" | "step_failed" | "objective_not_met";
  readonly finalState: WorldState<S>;
  readonly stepResults: readonly StepResult<S>[];
  readonly objectiveMet: boolean;
};

/** Result of executing a single step. */
export type StepResult<S> = {
  readonly stepId: string;
  readonly status: "completed" | "postcondition_failed" | "gate_failed" | "error";
  readonly before: Snapshot<S>;
  readonly after: Snapshot<S>;
  readonly cost: {
    readonly tokens: number;
    readonly usd: number;
    readonly duration_ms: number;
  };
  readonly retries: number;
  readonly executionTag: "agent" | "script";
};

/** Create an initial (zero) accumulator state. */
export function initialAccumulator(): ExecutionAccumulatorState {
  return {
    loopCount: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    startedAt: new Date(),
    elapsedMs: 0,
    suspensionCount: 0,
    completedMethods: [],
  };
}

/** Add a completed method record to the accumulator. */
export function recordMethod(
  acc: ExecutionAccumulatorState,
  record: CompletedMethodRecord,
): ExecutionAccumulatorState {
  return {
    ...acc,
    loopCount: acc.loopCount + 1,
    totalTokens: acc.totalTokens + record.cost.tokens,
    totalCostUsd: acc.totalCostUsd + record.cost.usd,
    elapsedMs: acc.elapsedMs + record.cost.duration_ms,
    completedMethods: [...acc.completedMethods, record],
  };
}

/**
 * Aggregate model breakdown across multiple cost records.
 *
 * Pure function — sums inputTokens, outputTokens, and costUsd per model
 * across all provided cost records. Records without modelBreakdown are skipped.
 */
export function aggregateModelCosts(
  costs: readonly { modelBreakdown?: readonly ModelCostRecord[] }[],
): ModelCostRecord[] {
  const byModel = new Map<string, { inputTokens: number; outputTokens: number; costUsd: number }>();
  for (const cost of costs) {
    for (const m of cost.modelBreakdown ?? []) {
      const existing = byModel.get(m.model) ?? { inputTokens: 0, outputTokens: 0, costUsd: 0 };
      byModel.set(m.model, {
        inputTokens: existing.inputTokens + m.inputTokens,
        outputTokens: existing.outputTokens + m.outputTokens,
        costUsd: existing.costUsd + m.costUsd,
      });
    }
  }
  return [...byModel.entries()].map(([model, data]) => ({ model, ...data }));
}
