/**
 * Monitor cognitive-module pact — PRD-068 Wave 1.
 *
 * Wraps pacta's `MonitorV2` module behavior (packages/pacta/src/cognitive/
 * modules/monitor-v2.ts) in the shape expected by `@method/agent-runtime`.
 *
 * This Wave 1 scaffold ships a `resumable` pact with a tight budget ceiling
 * (Monitor is the cheapest module — rule-based + small-LLM path). It is
 * resumable because the Monitor reacts to a stream of workspace events —
 * between events it suspends via the S5 continuation envelope.
 *
 * The in-process MonitorV2 implementation in pacta has a richer
 * `CognitiveModule` interface (prediction-error tracking, precision
 * weighting, metacognitive taxonomy). This sample does NOT wire that full
 * pipeline — research integration is gated on R-26c (see PRD-068 §10 D4
 * and README). For Wave 1 the pact declares the budget + output contract;
 * the tenant app's onEvent logic translates workspace events into
 * anomaly/confidence emissions.
 */

import type { Pact, SchemaDefinition, SchemaResult } from '@method/agent-runtime';

/** Summary of the most recent Monitor pass — returned by the oneshot pact. */
export interface MonitorReport {
  readonly severity: 'ok' | 'warning' | 'anomaly';
  readonly confidence: number;
  readonly detail: string;
}

/**
 * Hand-written SchemaDefinition for MonitorReport.
 *
 * Accepts either a JSON string (CLI-style agent output) or a structured
 * object (native API / Cortex `ctx.llm.structured` path). Both are
 * normalized into a validated `MonitorReport` object on success.
 *
 * Uses no schema library — pacta's `SchemaDefinition<T>` contract is a
 * plain `parse(raw) → { success, data | errors }` pair.
 */
const monitorReportSchema: SchemaDefinition<MonitorReport> = {
  description: 'MonitorReport { severity, confidence, detail }',
  parse(raw: unknown): SchemaResult<MonitorReport> {
    const value = typeof raw === 'string' ? tryJsonParse(raw) : raw;
    if (value === undefined) {
      return { success: false, errors: ['output is not a valid JSON object'] };
    }
    if (value === null || typeof value !== 'object') {
      return {
        success: false,
        errors: [`expected object, got ${value === null ? 'null' : typeof value}`],
      };
    }
    const obj = value as Record<string, unknown>;
    const errors: string[] = [];

    const severity = obj.severity;
    if (severity !== 'ok' && severity !== 'warning' && severity !== 'anomaly') {
      errors.push(
        `severity must be 'ok' | 'warning' | 'anomaly', got ${JSON.stringify(severity)}`,
      );
    }
    const confidence = obj.confidence;
    if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
      errors.push(`confidence must be a finite number, got ${typeof confidence}`);
    } else if (confidence < 0 || confidence > 1) {
      errors.push(`confidence must be in [0, 1], got ${confidence}`);
    }
    const detail = obj.detail;
    if (typeof detail !== 'string') {
      errors.push(`detail must be a string, got ${typeof detail}`);
    }

    if (errors.length > 0) {
      return { success: false, errors };
    }
    return {
      success: true,
      data: {
        severity: severity as MonitorReport['severity'],
        confidence: confidence as number,
        detail: detail as string,
      },
    };
  },
};

function tryJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Monitor pact — resumable mode. Budget is INTENTIONALLY LOW per PRD-068
 * §5.1: "Low ceiling (rule-based + small-LLM — should be the cheapest
 * module)". Per-module fixed budget; no rebalancing.
 */
export const monitorPact: Pact<MonitorReport> = {
  mode: { type: 'resumable' },
  budget: {
    maxTurns: 6,
    maxCostUsd: 0.05,
    onExhaustion: 'stop',
  },
  output: {
    schema: monitorReportSchema,
    retryOnValidationFailure: true,
    maxRetries: 2,
  },
  reasoning: { effort: 'low' },
  scope: {
    allowedTools: ['read-only/*'],
    deniedTools: ['fs/Write', 'shell/Bash'],
    permissionMode: 'deny',
  },
};
