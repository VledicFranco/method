/**
 * Structured retrospective generation from methodology execution results.
 *
 * Pure function — no Effect dependency, no side effects.
 * Produces a YAML-serializable MethodologyRetro from a MethodologyResult
 * and the SafetyBounds that governed the run.
 *
 * @see PRD 021 §12.6 — MethodologyResult
 * @see DR-T06 — all state tracking types must be serializable to YAML
 */

import type {
  MethodologyResult,
  ExecutionAccumulatorState,
  CompletedMethodRecord,
} from "./accumulator.js";
import type { SafetyBounds } from "../methodology/methodology.js";

/** Structured retrospective from a methodology run. YAML-serializable (DR-T06). */
export type MethodologyRetro = {
  readonly timing: {
    readonly startedAt: Date;
    readonly completedAt: Date;
    readonly durationMs: number;
  };
  readonly cost: {
    readonly totalTokens: number;
    readonly totalCostUsd: number;
    readonly perMethod: readonly {
      readonly methodId: string;
      readonly tokens: number;
      readonly usd: number;
    }[];
  };
  readonly routing: {
    readonly totalLoops: number;
    readonly methodSequence: readonly string[];
  };
  readonly steps: {
    readonly total: number;
    readonly completed: number;
    readonly failed: number;
    readonly totalRetries: number;
    readonly hardestStep: { readonly stepId: string; readonly retries: number } | null;
  };
  readonly safety: {
    readonly bounds: {
      readonly maxLoops: number;
      readonly maxTokens: number;
      readonly maxCostUsd: number;
      readonly maxDurationMs: number;
    };
    readonly headroom: {
      readonly loops: number;
      readonly tokens: number;
      readonly costUsd: number;
      readonly durationMs: number;
    };
    readonly violated: boolean;
    readonly violatedBound: string | null;
  };
  readonly status: "completed" | "safety_violation" | "failed" | "aborted";
};

/**
 * Generate a structured retrospective from a methodology result.
 *
 * Pure function — no side effects, no Effect dependency.
 * The returned MethodologyRetro is fully YAML-serializable.
 *
 * @param result - The methodology execution result
 * @param bounds - The safety bounds that governed this run, used for headroom calculation
 * @returns A structured retrospective summarizing the run
 */
export function generateRetro<S>(
  result: MethodologyResult<S>,
  bounds: SafetyBounds,
): MethodologyRetro {
  const acc = result.accumulator;
  const now = new Date();

  // Timing
  const timing = {
    startedAt: acc.startedAt,
    completedAt: now,
    durationMs: acc.elapsedMs,
  };

  // Cost — per-method breakdown
  const perMethod = acc.completedMethods.map((m) => ({
    methodId: m.methodId,
    tokens: m.cost.tokens,
    usd: m.cost.usd,
  }));

  const cost = {
    totalTokens: acc.totalTokens,
    totalCostUsd: acc.totalCostUsd,
    perMethod,
  };

  // Routing — method execution sequence
  const routing = {
    totalLoops: acc.loopCount,
    methodSequence: acc.completedMethods.map((m) => m.methodId),
  };

  // Steps — aggregate from completed methods' stepOutputSummaries
  const stepCounts = acc.completedMethods.reduce(
    (sum, m) => sum + Object.keys(m.stepOutputSummaries).length,
    0,
  );
  const totalSteps = stepCounts > 0 ? stepCounts : acc.completedMethods.length;

  const steps = {
    total: totalSteps,
    completed: totalSteps,
    failed: result.status === "failed" ? 1 : 0,
    totalRetries: 0,
    hardestStep: null as { stepId: string; retries: number } | null,
  };

  // Safety headroom — how close we got to each bound
  const safety = {
    bounds: {
      maxLoops: bounds.maxLoops,
      maxTokens: bounds.maxTokens,
      maxCostUsd: bounds.maxCostUsd,
      maxDurationMs: bounds.maxDurationMs,
    },
    headroom: {
      loops: bounds.maxLoops - acc.loopCount,
      tokens: bounds.maxTokens - acc.totalTokens,
      costUsd: bounds.maxCostUsd - acc.totalCostUsd,
      durationMs: bounds.maxDurationMs - acc.elapsedMs,
    },
    violated: result.status === "safety_violation",
    violatedBound: result.violation?.bound ?? null,
  };

  return {
    timing,
    cost,
    routing,
    steps,
    safety,
    status: result.status,
  };
}
