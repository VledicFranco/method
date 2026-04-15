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

import type { Pact } from '@method/agent-runtime';

/** Summary of the most recent Monitor pass — returned by the oneshot pact. */
export interface MonitorReport {
  readonly severity: 'ok' | 'warning' | 'anomaly';
  readonly confidence: number;
  readonly detail: string;
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
    schema: {
      type: 'object',
      required: ['severity', 'confidence', 'detail'],
      properties: {
        severity: { enum: ['ok', 'warning', 'anomaly'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        detail: { type: 'string' },
      },
    },
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
