/**
 * Fixture catalog — three canonical pacts per PRD-065 §8.
 *
 * A `ConformanceFixture` bundles a pact, an `AgentRequest`, a scripted LLM
 * response stream, and minimum expectations the built-in plugins assert
 * against. Tenant apps may extend via `opts.fixtures`, but custom fixtures
 * don't count toward core certification (S8 Q6).
 */

import type { Pact, AgentRequest, TokenUsage } from '@method/pacta';
import type { ScriptedResponse } from '../../recording-provider.js';
import type { ScriptedLlmResponse } from '../mock-cortex-ctx.js';

// ── Fixture identity ────────────────────────────────────────────

export type FixtureId =
  | 'incident-triage'
  | 'feature-dev-commission'
  | 'daily-report'
  | `custom:${string}`;

export interface FixtureExpectations {
  readonly minAuditEvents: number;
  readonly requiredAuditKinds: ReadonlyArray<string>;
  readonly expectsDelegation: boolean;
  readonly expectsScopeCheck: boolean;
  readonly expectsResume: boolean;
}

export interface ConformanceFixture {
  readonly id: FixtureId;
  readonly displayName: string;
  readonly pact: Pact<unknown>;
  readonly request: AgentRequest;
  readonly script: ReadonlyArray<ScriptedResponse>;
  readonly scriptedLlm: ReadonlyArray<ScriptedLlmResponse>;
  readonly minimumExpectations: FixtureExpectations;
}

// Utility — build a TokenUsage without leaking pacta internals
export function usage(input: number, output: number): TokenUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: input + output,
  };
}

// Utility — build a CostReport with a single total.
export function cost(totalUsd: number): {
  readonly totalUsd: number;
  readonly perModel: Record<string, never>;
} {
  return { totalUsd, perModel: {} };
}

// ── Canonical fixtures ──────────────────────────────────────────

export { incidentTriageFixture } from './incident-triage.js';
export { featureDevCommissionFixture } from './feature-dev-commission.js';
export { dailyReportFixture } from './daily-report.js';

import { incidentTriageFixture } from './incident-triage.js';
import { featureDevCommissionFixture } from './feature-dev-commission.js';
import { dailyReportFixture } from './daily-report.js';

export const DEFAULT_FIXTURES: ReadonlyArray<ConformanceFixture> = [
  incidentTriageFixture,
  featureDevCommissionFixture,
  dailyReportFixture,
];
