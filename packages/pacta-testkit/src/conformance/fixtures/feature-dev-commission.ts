// SPDX-License-Identifier: Apache-2.0
/**
 * feature-dev-commission — resumable, depth-2 delegation, high-budget.
 * Primary vehicle for C4 (token exchange depth) and C6 (resume roundtrip).
 * Exercises all six S1 checks. PRD-065 §8.2.
 */

import type { AgentResult } from '@methodts/pacta';
import type { ConformanceFixture } from './index.js';
import { usage, cost } from './index.js';

const finalResult: AgentResult<{ prUrl: string }> = {
  output: { prUrl: 'https://github.com/VledicFranco/method/pull/999' },
  sessionId: 'fixture-feature-dev-commission',
  completed: true,
  stopReason: 'complete',
  usage: usage(18_400, 6_200),
  cost: cost(1.62),
  durationMs: 42_000,
  turns: 6,
};

export const featureDevCommissionFixture: ConformanceFixture = {
  id: 'feature-dev-commission',
  displayName: 'Feature-dev commission (resumable, depth-2 delegation)',
  pact: {
    mode: {
      type: 'resumable',
      checkpointEvery: { turns: 3 },
    } as never,
    budget: { maxCostUsd: 2.0, maxTurns: 40, onExhaustion: 'warn' },
    scope: { allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Grep'] },
    reasoning: { effort: 'high' },
  },
  request: {
    prompt: 'Commission a feature-dev agent to implement PRD-999 and open a PR.',
  },
  script: [{ result: finalResult }],
  scriptedLlm: [
    {
      text: 'Reading PRD-999 and planning.',
      usage: usage(3200, 800),
      costUsd: 0.21,
      toolsRequested: ['Read'],
    },
    {
      text: 'Delegating implementation to subagent.',
      usage: usage(3400, 900),
      costUsd: 0.24,
      toolsRequested: ['Bash'],
    },
    {
      text: 'Suspending after delegation ack.',
      usage: usage(3100, 700),
      costUsd: 0.20,
      toolsRequested: [],
    },
    {
      text: 'Resumed: collecting subagent result.',
      usage: usage(3000, 1100),
      costUsd: 0.28,
      toolsRequested: ['Read'],
    },
    {
      text: 'Running tests.',
      usage: usage(3200, 1300),
      costUsd: 0.31,
      toolsRequested: ['Bash'],
    },
    {
      text: 'Opening PR.',
      usage: usage(2500, 1400),
      costUsd: 0.38,
      toolsRequested: ['Write'],
    },
  ],
  minimumExpectations: {
    minAuditEvents: 8,
    requiredAuditKinds: [
      'method.agent.started',
      'method.agent.turn_complete',
      'method.agent.suspended',
      'method.agent.resumed',
      'method.agent.completed',
    ],
    expectsDelegation: true,
    expectsScopeCheck: false,
    expectsResume: true,
  },
};
