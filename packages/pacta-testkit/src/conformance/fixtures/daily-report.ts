// SPDX-License-Identifier: Apache-2.0
/**
 * daily-report — oneshot, no tools, events + schedule. Exercises
 * `ctx.events.publish`, `ctx.schedule.register`, pure-LLM path. PRD-065 §8.3.
 */

import type { AgentResult } from '@methodts/pacta';
import type { ConformanceFixture } from './index.js';
import { usage, cost } from './index.js';

const result: AgentResult<{ digest: string }> = {
  output: { digest: 'Engineering velocity: 12 PRs merged; 1 incident (resolved).' },
  sessionId: 'fixture-daily-report',
  completed: true,
  stopReason: 'complete',
  usage: usage(2200, 700),
  cost: cost(0.12),
  durationMs: 3400,
  turns: 2,
};

export const dailyReportFixture: ConformanceFixture = {
  id: 'daily-report',
  displayName: 'Daily report (events + schedule, no tools)',
  pact: {
    mode: { type: 'oneshot' },
    budget: { maxCostUsd: 0.2, maxTurns: 2, onExhaustion: 'stop' },
    reasoning: { effort: 'medium' },
  },
  request: { prompt: 'Generate the daily engineering digest and publish it.' },
  script: [{ result }],
  scriptedLlm: [
    {
      text: 'Collecting signals.',
      usage: usage(1200, 250),
      costUsd: 0.05,
    },
    {
      text: 'Engineering velocity: 12 PRs merged; 1 incident (resolved).',
      usage: usage(1000, 450),
      costUsd: 0.07,
    },
  ],
  minimumExpectations: {
    minAuditEvents: 3,
    requiredAuditKinds: [
      'method.agent.started',
      'method.agent.turn_complete',
      'method.agent.completed',
    ],
    expectsDelegation: false,
    expectsScopeCheck: false,
    expectsResume: false,
  },
};
