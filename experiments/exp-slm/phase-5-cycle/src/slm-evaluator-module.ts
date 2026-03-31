/**
 * SLM Evaluator Module — SLM-backed Evaluator with rule-based fallback.
 *
 * The SLM Evaluator translates EvaluatorInput + EvaluatorState into
 * EvaluatorSignalInput[], encodes to DSL, runs SLM inference, parses
 * the EvaluatorReport, and maps it back to EvaluatorOutput.
 *
 * Falls back to inline rule-based logic when the SLM fails to parse
 * or confidence is too low.
 */

import type {
  CognitiveModule,
  EvaluatorMonitoring,
  StepResult,
  MonitoringSignal,
} from '../../../../packages/pacta/src/cognitive/algebra/index.js';
import { moduleId } from '../../../../packages/pacta/src/cognitive/algebra/index.js';
import type { EvaluatorInput, EvaluatorOutput, EvaluatorState, EvaluatorControl } from '../../../../packages/pacta/src/cognitive/modules/evaluator.js';
import type { SLMInference } from '../../phase-4-integration/src/slm-inference.js';
import { encodeEvaluatorSignals, parseEvaluatorDsl } from '../../phase-4-integration/src/evaluator-dsl-codec.js';
import type { EvaluatorReport } from '../../phase-4-integration/src/evaluator-types.js';
import { translateToEvaluatorSignals, mapEvaluatorReportToOutput } from './signal-translators.js';

// ── Types ───────────────────────────────────────────────────────

export interface SLMEvaluatorConfig {
  slm: SLMInference;
  /** SLM confidence below which we fall back to rule-based. Default: 0.4. */
  confidenceThreshold?: number;
}

/** Extended metrics for SLM Evaluator invocations. */
interface SLMEvaluatorMetrics {
  slmLatencyMs: number;
  slmConfidence: number;
  slmParseSuccess: boolean;
  usedFallback: boolean;
  slmInputTokens: number;
  slmOutputTokens: number;
}

/** SLM Evaluator module with metrics + last report exposed for control-merge. */
export type SLMEvaluatorModule = CognitiveModule<EvaluatorInput, EvaluatorOutput, EvaluatorState, EvaluatorMonitoring, EvaluatorControl> & {
  lastMetrics?: SLMEvaluatorMetrics;
  lastReport?: EvaluatorReport | null;
};

// ── Factory ─────────────────────────────────────────────────────

export function createSLMEvaluator(
  config: SLMEvaluatorConfig,
): SLMEvaluatorModule {
  const { slm, confidenceThreshold = 0.4 } = config;
  const id = moduleId('evaluator');

  const mod: SLMEvaluatorModule = {
    id,
    lastMetrics: undefined,
    lastReport: undefined,

    async step(
      input: EvaluatorInput,
      state: EvaluatorState,
      control: EvaluatorControl,
    ): Promise<StepResult<EvaluatorOutput, EvaluatorState, EvaluatorMonitoring>> {
      let metrics: SLMEvaluatorMetrics = {
        slmLatencyMs: 0,
        slmConfidence: 0,
        slmParseSuccess: false,
        usedFallback: true,
        slmInputTokens: 0,
        slmOutputTokens: 0,
      };

      try {
        // 1. Translate cognitive types to SLM codec types
        const signals = translateToEvaluatorSignals(input, state);

        // 2. Encode to DSL
        const dslInput = encodeEvaluatorSignals(signals);

        // 3. SLM inference
        const slmResult = await slm.generate(dslInput);
        metrics.slmLatencyMs = slmResult.latencyMs;
        metrics.slmConfidence = slmResult.confidence;
        metrics.slmInputTokens = slmResult.inputTokenCount;
        metrics.slmOutputTokens = slmResult.outputTokenCount;

        // 4. Parse DSL output
        const report = parseEvaluatorDsl(slmResult.tokens);
        metrics.slmParseSuccess = report !== null;

        // 5. Confidence gate
        if (report !== null && slmResult.confidence >= confidenceThreshold) {
          metrics.usedFallback = false;
          mod.lastMetrics = metrics;
          mod.lastReport = report;

          // Map SLM output back to cognitive module output
          const mapped = mapEvaluatorReportToOutput(report);

          const newState: EvaluatorState = {
            progressHistory: [...state.progressHistory, mapped.estimatedProgress],
            cycleCount: state.cycleCount + 1,
          };

          const monitoring: EvaluatorMonitoring = {
            type: 'evaluator',
            source: id,
            timestamp: Date.now(),
            estimatedProgress: mapped.estimatedProgress,
            diminishingReturns: mapped.diminishingReturns,
          };

          return { output: mapped, state: newState, monitoring };
        }
      } catch {
        // SLM call failed — fall through to fallback
      }

      // Fallback: inline rule-based evaluator logic
      metrics.usedFallback = true;
      mod.lastMetrics = metrics;
      mod.lastReport = null;

      return runFallbackEvaluator(input, state, control, id);
    },

    initialState(): EvaluatorState {
      return {
        progressHistory: [],
        cycleCount: 0,
      };
    },

    stateInvariant(state: EvaluatorState): boolean {
      return (
        state.cycleCount >= 0 &&
        state.progressHistory.every((p: number) => p >= 0 && p <= 1)
      );
    },
  };

  return mod;
}

// ── Fallback ────────────────────────────────────────────────────

/** Inline rule-based evaluator logic (mirrors evaluator.ts). */
function runFallbackEvaluator(
  input: EvaluatorInput,
  state: EvaluatorState,
  control: EvaluatorControl,
  id: ReturnType<typeof moduleId>,
): StepResult<EvaluatorOutput, EvaluatorState, EvaluatorMonitoring> {
  // Compute current-cycle progress from signals
  const currentProgress = computeProgressFromSignals(input.signals);

  let estimatedProgress: number;
  let diminishingReturns: boolean;

  if (control.evaluationHorizon === 'immediate') {
    estimatedProgress = currentProgress;
    diminishingReturns = false;
  } else {
    const history = [...state.progressHistory, currentProgress];
    estimatedProgress = currentProgress;
    diminishingReturns = detectDiminishingReturns(history, 3);
  }

  const newState: EvaluatorState = {
    progressHistory: [...state.progressHistory, currentProgress],
    cycleCount: state.cycleCount + 1,
  };

  const monitoring: EvaluatorMonitoring = {
    type: 'evaluator',
    source: id,
    timestamp: Date.now(),
    estimatedProgress,
    diminishingReturns,
  };

  return {
    output: { estimatedProgress, diminishingReturns },
    state: newState,
    monitoring,
  };
}

/** Estimate progress from monitoring signals (mirrors evaluator.ts). */
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

/** Detect diminishing returns: progress flat or declining for `window` consecutive cycles. */
function detectDiminishingReturns(history: number[], window: number): boolean {
  if (history.length < window) return false;

  const recent = history.slice(-window);
  for (let i = 1; i < recent.length; i++) {
    if (recent[i] > recent[i - 1]) return false;
  }
  return true;
}
