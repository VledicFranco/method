/**
 * SLM Monitor Module — SLM-backed Monitor wrapping the rule-based createMonitor as fallback.
 *
 * Attempts SLM inference first. Falls back to rule-based monitor when:
 *   1. SLM output fails to parse (parseDsl returns null)
 *   2. SLM confidence is below the configured threshold
 *
 * Uses the SAME MonitorState shape as the rule-based module so fallback is seamless.
 */

import type {
  CognitiveModule,
  AggregatedSignals,
  MonitorMonitoring,
  StepResult,
} from '../../../../packages/pacta/src/cognitive/algebra/index.js';
import { moduleId } from '../../../../packages/pacta/src/cognitive/algebra/index.js';
import { createMonitor, type MonitorReport, type MonitorState, type MonitorConfig, type NoControl } from '../../../../packages/pacta/src/cognitive/modules/monitor.js';
import type { SLMInference } from '../../phase-4-integration/src/slm-inference.js';
import { encodeSignals, parseDsl } from '../../phase-4-integration/src/dsl-codec.js';

// ── Types ───────────────────────────────────────────────────────

export interface SLMMonitorConfig {
  slm: SLMInference;
  /** SLM confidence below which we fall back to rule-based. Default: 0.4. */
  confidenceThreshold?: number;
  /** Config passed through to the rule-based fallback monitor. */
  fallbackConfig?: MonitorConfig;
}

/** Extended monitoring with SLM metadata. */
interface SLMMonitorMetrics {
  slmLatencyMs: number;
  slmConfidence: number;
  slmParseSuccess: boolean;
  usedFallback: boolean;
  slmInputTokens: number;
  slmOutputTokens: number;
}

// ── Factory ─────────────────────────────────────────────────────

export function createSLMMonitor(
  config: SLMMonitorConfig,
): CognitiveModule<AggregatedSignals, MonitorReport, MonitorState, MonitorMonitoring, NoControl> & { lastMetrics?: SLMMonitorMetrics } {
  const { slm, confidenceThreshold = 0.4, fallbackConfig } = config;
  const fallback = createMonitor(fallbackConfig);
  const id = moduleId('monitor');

  const mod: CognitiveModule<AggregatedSignals, MonitorReport, MonitorState, MonitorMonitoring, NoControl> & { lastMetrics?: SLMMonitorMetrics } = {
    id,
    lastMetrics: undefined,

    async step(
      input: AggregatedSignals,
      state: MonitorState,
      control: NoControl,
    ): Promise<StepResult<MonitorReport, MonitorState, MonitorMonitoring>> {
      let metrics: SLMMonitorMetrics = {
        slmLatencyMs: 0,
        slmConfidence: 0,
        slmParseSuccess: false,
        usedFallback: true,
        slmInputTokens: 0,
        slmOutputTokens: 0,
      };

      try {
        // 1. Encode signals to DSL
        const dslInput = encodeSignals(input);

        // 2. SLM inference
        const slmResult = await slm.generate(dslInput);
        metrics.slmLatencyMs = slmResult.latencyMs;
        metrics.slmConfidence = slmResult.confidence;
        metrics.slmInputTokens = slmResult.inputTokenCount;
        metrics.slmOutputTokens = slmResult.outputTokenCount;

        // 3. Parse DSL output
        const parsed = parseDsl(slmResult.tokens);
        metrics.slmParseSuccess = parsed !== null;

        // 4. Confidence check — fall back if too low or parse failed
        if (parsed !== null && slmResult.confidence >= confidenceThreshold) {
          metrics.usedFallback = false;
          mod.lastMetrics = metrics;

          // Update state using same logic as rule-based (increment cycleCount, etc.)
          const newState: MonitorState = {
            confidenceAverage: state.confidenceObservations > 0
              ? state.confidenceAverage  // SLM doesn't update internal averages
              : state.confidenceAverage,
            confidenceObservations: state.confidenceObservations,
            conflictCount: state.conflictCount,
            cycleCount: state.cycleCount + 1,
            consecutiveReadOnlyCycles: state.consecutiveReadOnlyCycles,
            recentActionInputs: [...state.recentActionInputs],
          };

          const monitoring: MonitorMonitoring = {
            type: 'monitor',
            source: id,
            timestamp: Date.now(),
            anomalyDetected: parsed.anomalies.length > 0,
            escalation: parsed.escalation,
          };

          return { output: parsed, state: newState, monitoring };
        }
      } catch {
        // SLM call failed — fall through to fallback
      }

      // Fallback: run rule-based monitor
      metrics.usedFallback = true;
      mod.lastMetrics = metrics;
      return fallback.step(input, state, control);
    },

    initialState(): MonitorState {
      return fallback.initialState();
    },

    stateInvariant(state: MonitorState): boolean {
      return fallback.stateInvariant?.(state) ?? true;
    },
  };

  return mod;
}
