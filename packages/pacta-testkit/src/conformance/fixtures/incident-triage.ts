// SPDX-License-Identifier: Apache-2.0
/**
 * incident-triage — oneshot, scoped to `['Grep','Read','Slack']`, low-budget.
 * Exercises budget handlers (C2), audit minimum (C3), scope respect (C5), and
 * the vacuous no-resume path (C6 skipped). PRD-065 §8.1.
 */

import type { AgentResult } from '@methodts/pacta';
import type { ConformanceFixture } from './index.js';
import { usage, cost } from './index.js';

const result: AgentResult<{ summary: string }> = {
  output: { summary: 'Resolved: elevated 5xx rate from deploy at 14:02 UTC.' },
  sessionId: 'fixture-incident-triage',
  completed: true,
  stopReason: 'complete',
  usage: usage(1400, 380),
  cost: cost(0.04),
  durationMs: 1820,
  turns: 2,
};

export const incidentTriageFixture: ConformanceFixture = {
  id: 'incident-triage',
  displayName: 'Incident triage (oneshot, scoped tools)',
  pact: {
    mode: { type: 'oneshot' },
    budget: { maxCostUsd: 0.05, maxTurns: 4, onExhaustion: 'stop' },
    scope: { allowedTools: ['Grep', 'Read', 'Slack'] },
    reasoning: { effort: 'low' },
  },
  request: {
    prompt:
      'Triage incident INC-4821: find the deploy that preceded the 5xx spike and post a Slack summary.',
  },
  script: [{ result }],
  scriptedLlm: [
    {
      text: 'Investigating: grep error logs then summarise.',
      usage: usage(900, 120),
      costUsd: 0.025,
      toolsRequested: ['Grep', 'Read'],
    },
    {
      text: 'Resolved: elevated 5xx rate from deploy at 14:02 UTC. Posted Slack summary.',
      usage: usage(500, 260),
      costUsd: 0.015,
      toolsRequested: ['Slack'],
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
    expectsScopeCheck: true,
    expectsResume: false,
  },
};
