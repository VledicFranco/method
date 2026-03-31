/**
 * Evaluator DSL types — typed representations for Evaluator module input/output.
 *
 * The Evaluator module processes progress signals from task execution and
 * produces a progress assessment report (PROGRESS, CONFIDENCE, ACTION, NOTE).
 *
 * Training format defined in phase-2-dsl/scripts/generate-evaluator-corpus.py.
 */

// ── Input Signal ───────────────────────────────────────────────

/** Clarity level of an evaluator signal. */
export type EvaluatorClarity = 'high' | 'medium' | 'low';

/** Valid evaluator IDs used in the training corpus. */
export type EvaluatorId = 'main' | 'secondary' | 'aux';

/** A single evaluator input signal. */
export interface EvaluatorSignalInput {
  id: string;
  progress: number;
  diminishing: boolean;
  steps: number;
  clarity: EvaluatorClarity;
}

// ── Output Report ──────────────────────────────────────────────

/** Progress label emitted by the Evaluator. */
export type EvaluatorProgress = 'on-track' | 'stagnant' | 'diverging';

/** Action recommendation emitted by the Evaluator. */
export type EvaluatorAction = 'continue' | 'replan' | 'escalate';

/** Structured report parsed from Evaluator DSL output. */
export interface EvaluatorReport {
  progress: EvaluatorProgress;
  confidence: number;
  action: EvaluatorAction;
  note: string | null;
}
