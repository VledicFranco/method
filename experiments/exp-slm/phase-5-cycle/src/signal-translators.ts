/**
 * Signal Translators — bridge between cognitive module types and SLM DSL codec input types.
 *
 * The cognitive modules (Observer, Evaluator) use their own I/O types. The SLM codecs
 * use separate input types (ObserverSignalInput[], EvaluatorSignalInput[]). These
 * functions translate between the two representations and map SLM outputs back.
 */

import type { ObserverInput, ObserverOutput, ObserverState } from '../../../../packages/pacta/src/cognitive/modules/observer.js';
import type { EvaluatorInput, EvaluatorState } from '../../../../packages/pacta/src/cognitive/modules/evaluator.js';
import type { ObserverSignalInput, ObserverReport } from '../../phase-4-integration/src/observer-types.js';
import type { EvaluatorSignalInput, EvaluatorReport } from '../../phase-4-integration/src/evaluator-types.js';
import type { MonitoringSignal } from '../../../../packages/pacta/src/cognitive/algebra/index.js';

// ── Observer Translation ────────────────────────────────────────

/**
 * Convert ObserverInput + ObserverState into ObserverSignalInput[] for the SLM codec.
 * Uses the same char-diff novelty heuristic as observer.ts computeNovelty.
 */
export function translateToObserverSignals(input: ObserverInput, state: ObserverState): ObserverSignalInput[] {
  const novelty = computeNoveltyHeuristic(input.content, state.previousContent);
  const content = classifyContent(input.content);

  return [{
    id: 'main',
    novelty,
    processed: false,
    content,
  }];
}

/**
 * Map ObserverReport (SLM output) back to ObserverOutput (cognitive module output).
 */
export function mapObserverReportToOutput(report: ObserverReport, input: ObserverInput): ObserverOutput {
  return {
    observation: input.content,
    noveltyScore: report.novelty,
    filtered: false,
  };
}

// ── Evaluator Translation ───────────────────────────────────────

/**
 * Convert EvaluatorInput + EvaluatorState into EvaluatorSignalInput[] for the SLM codec.
 * Mirrors the evaluator.ts computeProgressFromSignals approach.
 */
export function translateToEvaluatorSignals(input: EvaluatorInput, state: EvaluatorState): EvaluatorSignalInput[] {
  // Compute progress from signals (same approach as evaluator.ts)
  const progress = computeProgressFromSignals(input.signals);

  // Diminishing: check if progress flat/declining for last 3 entries in history
  const history = state.progressHistory;
  let diminishing = false;
  if (history.length >= 3) {
    const recent = history.slice(-3);
    diminishing = recent.every((val: number, i: number) => i === 0 || val <= recent[i - 1]);
  }

  // Clarity: derive from reasoner confidence in signals
  const clarity = deriveClarity(input.signals);

  return [{
    id: 'main',
    progress,
    diminishing,
    steps: state.cycleCount,
    clarity,
  }];
}

/**
 * Map EvaluatorReport (SLM output) back to EvaluatorOutput (cognitive module output).
 */
export function mapEvaluatorReportToOutput(report: EvaluatorReport): { estimatedProgress: number; diminishingReturns: boolean } {
  const progressMap: Record<string, number> = {
    'on-track': 0.7,
    'stagnant': 0.4,
    'diverging': 0.2,
  };
  return {
    estimatedProgress: progressMap[report.progress] ?? 0.4,
    diminishingReturns: report.action === 'replan' || report.action === 'escalate',
  };
}

// ── Internal Helpers ────────────────────────────────────────────

/** Char-diff novelty heuristic (mirrors observer.ts computeNovelty). */
function computeNoveltyHeuristic(current: string, previous: string | null): number {
  const lengthScore = Math.min(0.9, Math.max(0.1, current.length / 500));

  if (previous === null) {
    return Math.max(0.5, lengthScore);
  }

  const maxLen = Math.max(current.length, previous.length);
  if (maxLen === 0) return 0;

  let diffCount = 0;
  for (let i = 0; i < maxLen; i++) {
    if (current[i] !== previous[i]) diffCount++;
  }
  const diffRatio = diffCount / maxLen;

  return Math.min(1, (lengthScore + diffRatio) / 2);
}

/** Classify content as text | code | error | tool-output using simple heuristics. */
function classifyContent(content: string): 'text' | 'code' | 'error' | 'tool-output' {
  const lower = content.toLowerCase();
  if (lower.includes('error:') || lower.includes('exception') || lower.includes('traceback')) {
    return 'error';
  }
  if (lower.startsWith('tool result:') || lower.includes('tool output') || lower.includes('result:')) {
    return 'tool-output';
  }
  if (content.includes('function ') || content.includes('import ') || content.includes('class ') || content.includes('=>')) {
    return 'code';
  }
  return 'text';
}

/** Compute progress from monitoring signals (same approach as evaluator.ts). */
function computeProgressFromSignals(signals: Map<unknown, MonitoringSignal>): number {
  let totalScore = 0;
  let totalWeight = 0;

  for (const signal of signals.values()) {
    const s = signal as unknown as Record<string, unknown>;
    if (s['type'] === 'reasoner' || s['type'] === 'reasoner-actor') {
      if (typeof s['confidence'] === 'number') {
        totalScore += s['confidence'];
        totalWeight += 1;
      }
    }
    if (s['type'] === 'actor' || s['type'] === 'reasoner-actor') {
      if (typeof s['success'] === 'boolean') {
        totalScore += s['success'] ? 1.0 : 0.0;
        totalWeight += 1;
      }
    }
  }

  if (totalWeight === 0) return 0;
  return Math.min(1, Math.max(0, totalScore / totalWeight));
}

/** Derive clarity from reasoner confidence in signals. */
function deriveClarity(signals: Map<unknown, MonitoringSignal>): 'high' | 'medium' | 'low' {
  for (const signal of signals.values()) {
    const s = signal as unknown as Record<string, unknown>;
    if ((s['type'] === 'reasoner' || s['type'] === 'reasoner-actor') && typeof s['confidence'] === 'number') {
      if (s['confidence'] > 0.7) return 'high';
      if (s['confidence'] > 0.4) return 'medium';
      return 'low';
    }
  }
  return 'medium';
}
