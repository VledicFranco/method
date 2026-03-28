/**
 * LLM Monitor v2 — CognitiveModule implementation backed by a ProviderAdapter.
 *
 * Same input/output types as the deterministic Monitor in packages/pacta, but
 * delegates anomaly analysis to an LLM call instead of threshold arithmetic.
 * This is the **compilation target** — the module whose LLM calls the SLM
 * will eventually replace.
 *
 * Key differences from the deterministic Monitor:
 * - Uses ProviderAdapter.invoke() to call an LLM for anomaly analysis
 * - Can detect subtle patterns beyond simple threshold comparisons
 * - Expensive: one LLM call per invocation
 * - Tracks LLM-specific state: token usage and call latency
 */

import type {
  CognitiveModule,
  AggregatedSignals,
  MonitorReport,
  MonitorMonitoring,
  NoControl,
  ProviderAdapter,
  Anomaly,
  TokenUsage,
  StepResult,
} from './types.js';
import { moduleId } from './types.js';
import { MONITOR_SYSTEM_PROMPT, buildMonitorUserPrompt } from './llm-monitor-prompt.js';

// ── LLM Monitor State ───────────────────────────────────────────

/** State tracked by the LLM Monitor across invocations. */
export interface LlmMonitorState {
  /** Number of times the LLM Monitor has been invoked. */
  invocationCount: number;
  /** Cumulative input tokens consumed across all invocations. */
  totalInputTokens: number;
  /** Cumulative output tokens consumed across all invocations. */
  totalOutputTokens: number;
  /** Cumulative total tokens consumed across all invocations. */
  totalTokens: number;
  /** Latency in ms of the most recent LLM call. */
  lastLatencyMs: number;
  /** Cumulative latency across all LLM calls. */
  totalLatencyMs: number;
}

// ── Config ──────────────────────────────────────────────────────

export interface LlmMonitorConfig {
  /** Confidence threshold hint for the LLM (included in prompt context). Default: 0.3. */
  confidenceThreshold?: number;
}

// ── Safe Default Report ─────────────────────────────────────────

/** Fallback report when LLM output is malformed or unparseable. */
function safeDefaultReport(): MonitorReport {
  return {
    anomalies: [],
    escalation: undefined,
    restrictedActions: [],
    forceReplan: false,
  };
}

// ── Response Parser ─────────────────────────────────────────────

/**
 * Parse LLM output into a MonitorReport. Gracefully falls back to a safe
 * default if the output is malformed.
 */
export function parseLlmResponse(raw: string): MonitorReport {
  try {
    // Strip markdown code fences if the LLM wraps the JSON
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    const parsed = JSON.parse(cleaned);

    // Validate required fields
    if (!parsed || typeof parsed !== 'object') return safeDefaultReport();

    const anomalies: Anomaly[] = [];
    if (Array.isArray(parsed.anomalies)) {
      for (const a of parsed.anomalies) {
        if (
          a &&
          typeof a.moduleId === 'string' &&
          (a.type === 'low-confidence' || a.type === 'unexpected-result' || a.type === 'compound') &&
          typeof a.detail === 'string'
        ) {
          anomalies.push({
            moduleId: a.moduleId as Anomaly['moduleId'],
            type: a.type,
            detail: a.detail,
          });
        }
      }
    }

    const escalation = typeof parsed.escalation === 'string' ? parsed.escalation :
      parsed.escalation === null ? undefined : undefined;

    const restrictedActions: string[] = [];
    if (Array.isArray(parsed.restrictedActions)) {
      for (const action of parsed.restrictedActions) {
        if (typeof action === 'string') restrictedActions.push(action);
      }
    }

    const forceReplan = typeof parsed.forceReplan === 'boolean' ? parsed.forceReplan : false;

    return { anomalies, escalation, restrictedActions, forceReplan };
  } catch {
    return safeDefaultReport();
  }
}

// ── Factory ─────────────────────────────────────────────────────

/**
 * Create an LLM-backed Monitor v2 cognitive module.
 *
 * Uses a ProviderAdapter to call an LLM for anomaly analysis.
 * Same input (AggregatedSignals) and output (MonitorReport) as the
 * deterministic Monitor, but delegates analysis to an LLM call.
 */
export function createLlmMonitor(
  providerAdapter: ProviderAdapter,
  config?: LlmMonitorConfig,
): CognitiveModule<AggregatedSignals, MonitorReport, LlmMonitorState, MonitorMonitoring, NoControl> {
  const confidenceThreshold = config?.confidenceThreshold ?? 0.3;
  const id = moduleId('llm-monitor');

  return {
    id,

    async step(
      input: AggregatedSignals,
      state: LlmMonitorState,
      _control: NoControl,
    ): Promise<StepResult<MonitorReport, LlmMonitorState, MonitorMonitoring>> {
      const userPrompt = buildMonitorUserPrompt(input);

      // Build a minimal workspace snapshot containing the user prompt
      const workspaceSnapshot = [
        {
          source: id,
          content: userPrompt,
          salience: 1.0,
          timestamp: Date.now(),
        },
      ];

      const startTime = Date.now();
      let report: MonitorReport;
      let usage: TokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
      };

      try {
        const result = await providerAdapter.invoke(workspaceSnapshot, {
          pactTemplate: { mode: { type: 'oneshot' } },
          systemPrompt: MONITOR_SYSTEM_PROMPT + `\nConfidence threshold for anomaly detection: ${confidenceThreshold}`,
        });

        usage = result.usage;
        report = parseLlmResponse(result.output);
      } catch {
        // On provider failure, return safe default — don't crash the cycle
        report = safeDefaultReport();
      }

      const latencyMs = Date.now() - startTime;

      const newState: LlmMonitorState = {
        invocationCount: state.invocationCount + 1,
        totalInputTokens: state.totalInputTokens + usage.inputTokens,
        totalOutputTokens: state.totalOutputTokens + usage.outputTokens,
        totalTokens: state.totalTokens + usage.totalTokens,
        lastLatencyMs: latencyMs,
        totalLatencyMs: state.totalLatencyMs + latencyMs,
      };

      const monitoring: MonitorMonitoring = {
        type: 'monitor',
        source: id,
        timestamp: Date.now(),
        anomalyDetected: report.anomalies.length > 0,
        escalation: report.escalation,
      };

      return {
        output: report,
        state: newState,
        monitoring,
      };
    },

    initialState(): LlmMonitorState {
      return {
        invocationCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        lastLatencyMs: 0,
        totalLatencyMs: 0,
      };
    },

    stateInvariant(state: LlmMonitorState): boolean {
      return (
        state.invocationCount >= 0 &&
        state.totalInputTokens >= 0 &&
        state.totalOutputTokens >= 0 &&
        state.totalTokens >= 0 &&
        state.lastLatencyMs >= 0 &&
        state.totalLatencyMs >= 0
      );
    },
  };
}
