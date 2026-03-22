/**
 * Promotion readiness evaluation for methods.
 *
 * Evaluates whether a method has accumulated enough evidence (via retrospectives)
 * to justify promotion from "proposed" to "compiled" or "trial" to "standard".
 *
 * Pure function — no Effect dependency, no side effects.
 *
 * @see F1-FTH §8 — Method lifecycle and promotion criteria
 */

import type { Method } from "../method/method.js";
import type { MethodologyRetro } from "../runtime/retro.js";

/** Promotion readiness evaluation result. */
export type PromotionResult = {
  readonly eligible: boolean;
  readonly criteria: readonly PromotionCriterion[];
  readonly recommendation: "promote" | "needs_work" | "insufficient_evidence";
};

/** A single promotion criterion with pass/fail and human-readable detail. */
export type PromotionCriterion = {
  readonly name: string;
  readonly met: boolean;
  readonly detail: string;
};

/**
 * Evaluate whether a method is ready for promotion from "proposed" to "compiled"
 * or from "trial" to "standard".
 *
 * Criteria:
 * 1. Minimum execution count (at least N successful runs)
 * 2. Success rate above threshold
 * 3. Average cost within budget
 * 4. No unresolved safety violations
 *
 * @param method - The method under evaluation
 * @param retros - Retrospectives from executions of this method
 * @param config - Optional thresholds (defaults: 3 runs, 80% success, $10 avg cost)
 * @returns PromotionResult with eligibility, criteria breakdown, and recommendation
 */
export function evaluatePromotion<S>(
  _method: Method<S>,
  retros: MethodologyRetro[],
  config?: { minRuns?: number; minSuccessRate?: number; maxAvgCostUsd?: number },
): PromotionResult {
  const minRuns = config?.minRuns ?? 3;
  const minSuccessRate = config?.minSuccessRate ?? 0.8;
  const maxAvgCost = config?.maxAvgCostUsd ?? 10;

  const criteria: PromotionCriterion[] = [];

  // Criterion 1: Minimum runs
  const totalRuns = retros.length;
  criteria.push({
    name: "minimum_runs",
    met: totalRuns >= minRuns,
    detail: `${totalRuns}/${minRuns} runs completed`,
  });

  // Criterion 2: Success rate
  const successCount = retros.filter((r) => r.status === "completed").length;
  const successRate = totalRuns > 0 ? successCount / totalRuns : 0;
  criteria.push({
    name: "success_rate",
    met: successRate >= minSuccessRate,
    detail: `${(successRate * 100).toFixed(0)}% success (${successCount}/${totalRuns}), threshold ${(minSuccessRate * 100).toFixed(0)}%`,
  });

  // Criterion 3: Average cost
  const totalCost = retros.reduce((sum, r) => sum + r.cost.totalCostUsd, 0);
  const avgCost = totalRuns > 0 ? totalCost / totalRuns : 0;
  criteria.push({
    name: "average_cost",
    met: avgCost <= maxAvgCost,
    detail: `$${avgCost.toFixed(2)} avg (limit $${maxAvgCost.toFixed(2)})`,
  });

  // Criterion 4: No safety violations
  const safetyViolations = retros.filter((r) => r.safety.violated).length;
  criteria.push({
    name: "no_safety_violations",
    met: safetyViolations === 0,
    detail:
      safetyViolations === 0
        ? "No safety violations"
        : `${safetyViolations} safety violation${safetyViolations > 1 ? "s" : ""}`,
  });

  const allMet = criteria.every((c) => c.met);
  const recommendation = allMet
    ? "promote"
    : totalRuns < minRuns
      ? "insufficient_evidence"
      : "needs_work";

  return { eligible: allMet, criteria, recommendation };
}
