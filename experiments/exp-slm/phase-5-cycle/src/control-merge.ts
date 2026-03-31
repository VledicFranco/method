/**
 * Control Merge — combine Monitor and Evaluator reports into ReasonerActor control patches.
 *
 * Priority order:
 *   1. Evaluator 'escalate' -> forceReplan + strategy 'think'
 *   2. Monitor forceReplan -> forceReplan + strategy 'think'
 *   3. Evaluator 'replan' -> forceReplan + strategy 'plan'
 *   4. Monitor restricted -> restricted actions carried through
 *   5. Default -> no restrictions, no replan
 *
 * If evaluator confidence < 0.3, the evaluator is discounted (treated as 'continue').
 */

import type { MonitorReport } from '../../../../packages/pacta/src/cognitive/modules/monitor.js';
import type { EvaluatorReport } from '../../phase-4-integration/src/evaluator-types.js';

// ── Types ───────────────────────────────────────────────────────

export interface ReasonerActorControlPatch {
  restrictedActions: string[];
  forceReplan: boolean;
  strategy: 'plan' | 'think';
}

// ── Merge Function ──────────────────────────────────────────────

export function mergeMetacognitiveReports(
  monitorReport: MonitorReport,
  evaluatorReport: EvaluatorReport | null,
): ReasonerActorControlPatch {
  // Default: no restrictions
  const patch: ReasonerActorControlPatch = {
    restrictedActions: [],
    forceReplan: false,
    strategy: 'plan',
  };

  // Discount low-confidence evaluator reports
  const effectiveEvaluator = evaluatorReport && evaluatorReport.confidence >= 0.3
    ? evaluatorReport
    : null;

  // Priority 1: Evaluator 'escalate' overrides everything
  if (effectiveEvaluator?.action === 'escalate') {
    patch.forceReplan = true;
    patch.strategy = 'think';
    patch.restrictedActions = [...monitorReport.restrictedActions];
    return patch;
  }

  // Priority 2: Monitor forceReplan
  if (monitorReport.forceReplan) {
    patch.forceReplan = true;
    patch.strategy = 'think';
    patch.restrictedActions = [...monitorReport.restrictedActions];
    return patch;
  }

  // Priority 3: Evaluator 'replan'
  if (effectiveEvaluator?.action === 'replan') {
    patch.forceReplan = true;
    patch.strategy = 'plan';
    patch.restrictedActions = [...monitorReport.restrictedActions];
    return patch;
  }

  // Priority 4: Monitor restricted actions (no replan)
  if (monitorReport.restrictedActions.length > 0) {
    patch.restrictedActions = [...monitorReport.restrictedActions];
  }

  return patch;
}
