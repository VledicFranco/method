/**
 * Safety bounds checking for methodology execution.
 */

import type { SafetyBounds } from "./methodology.js";

/** Accumulated execution metrics checked against SafetyBounds. */
export type ExecutionAccumulator = {
  loopCount: number;
  totalTokens: number;
  totalCostUsd: number;
  startedAt: Date;
  elapsedMs: number;
  suspensionCount: number;
};

/** Check if any safety bound is exceeded. */
export function checkSafety(
  bounds: SafetyBounds,
  acc: ExecutionAccumulator,
): { safe: boolean; violation?: { bound: keyof SafetyBounds; limit: number; actual: number } } {
  // Note: maxDepth is not checked here — it is enforced at the strategy level
  // when nested methodology calls are supported (Phase 2).
  if (acc.loopCount >= bounds.maxLoops) {
    return { safe: false, violation: { bound: "maxLoops", limit: bounds.maxLoops, actual: acc.loopCount } };
  }
  if (acc.totalTokens >= bounds.maxTokens) {
    return { safe: false, violation: { bound: "maxTokens", limit: bounds.maxTokens, actual: acc.totalTokens } };
  }
  if (acc.totalCostUsd >= bounds.maxCostUsd) {
    return { safe: false, violation: { bound: "maxCostUsd", limit: bounds.maxCostUsd, actual: acc.totalCostUsd } };
  }
  if (acc.elapsedMs >= bounds.maxDurationMs) {
    return { safe: false, violation: { bound: "maxDurationMs", limit: bounds.maxDurationMs, actual: acc.elapsedMs } };
  }
  return { safe: true };
}
