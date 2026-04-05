/**
 * Mock data for the build dashboard — enables UI development without a running backend.
 * Matches the 3 builds from the approved mockup (tmp/build-dashboard-mock.html).
 */

import type { BuildSummary, ConversationMessage } from './types';

// ── Mock Conversations ──────────────────────────────────────────────

const MOCK_CONVERSATIONS: Record<string, ConversationMessage[]> = {
  'build-rate-limiting': [
    {
      id: 'rl-1',
      sender: 'system',
      content: 'Phase 5: Implement started \u2014 s-fcd-commission-orch spawning 3 commissions',
      timestamp: '20:14:32',
    },
    {
      id: 'rl-2',
      sender: 'agent',
      content: 'Implementation started. I\'m running 3 parallel commissions: `rate-limit-port`, `gateway-middleware`, and `tenant-quota-store`. Each follows the FCA domain structure.',
      timestamp: '20:14:35',
    },
    {
      id: 'rl-3',
      sender: 'system',
      content: 'C-1 rate-limit-port completed ($1.20) \u2014 142 lines, 3 files',
      timestamp: '20:14:45',
    },
    {
      id: 'rl-4',
      sender: 'system',
      content: 'C-3 tenant-quota-store completed ($1.40) \u2014 89 lines, 2 files',
      timestamp: '20:15:12',
    },
    {
      id: 'rl-5',
      sender: 'agent',
      content: 'C-2 hit a gate failure. `G-NO-ANY` found 2 untyped parameters in `gateway/middleware.ts` (lines 47, 83). I\'m retrying with explicit `GatewayRequest<RateLimitPayload>` type injection.\n\nNo action needed \u2014 automatic retry in progress.',
      timestamp: '20:15:30',
    },
    {
      id: 'rl-6',
      sender: 'system',
      content: 's-fcd-commission-orch: 2/3 complete, 1 retrying',
      timestamp: '20:15:50',
    },
  ],

  'build-auth-extraction': [
    {
      id: 'auth-1',
      sender: 'system',
      content: 'Build started: Auth extraction',
      timestamp: '19:38:00',
    },
    {
      id: 'auth-2',
      sender: 'system',
      content: 'Phase 1: Explore completed. Phase 2: Specify started.',
      timestamp: '19:40:22',
    },
    {
      id: 'auth-3',
      sender: 'agent',
      content: 'I\'ve explored the codebase. Auth logic is scattered across 3 domains: `sessions/`, `strategies/`, `genesis/`. I found 18 direct imports and 4 shared auth utils.\n\nI also spawned a council debate \u2014 the recommendation is to extract an `AuthPort` and migrate consumers in 3 waves.',
      timestamp: '19:42:15',
      card: {
        type: 'debate-decision',
        data: {
          motion: 'Extract AuthPort as central auth interface',
          advisors: [
            { name: 'architecture', position: 'for', argument: 'Clean separation. Port pattern matches FCA.' },
            { name: 'security', position: 'for', argument: 'Centralizes auth surface. Easier to audit.' },
            { name: 'DX', position: 'for', argument: '3-wave migration avoids big-bang risk.' },
          ],
          verdict: 'unanimous approval',
        },
      },
    },
    {
      id: 'auth-4',
      sender: 'system',
      content: 'Debate spawned \u2014 council reviewing auth extraction approach',
      timestamp: '19:42:16',
    },
    {
      id: 'auth-5',
      sender: 'agent',
      content: 'Here\'s my proposed specification:',
      timestamp: '19:42:18',
      card: {
        type: 'feature-spec',
        data: {
          problem: 'Auth logic duplicated across 3 domains',
          scope: 'domains/auth/ (new), sessions/, strategies/, genesis/',
          approach: 'Extract AuthPort, 3-wave consumer migration',
          criteria: [
            'All auth imports resolve to domains/auth/',
            'Zero runtime auth logic in consumer domains',
            'tsc --noEmit: 0 errors',
            'Existing tests pass (no behavior change)',
            'AuthPort has full test coverage',
          ],
        },
      },
    },
    {
      id: 'auth-6',
      sender: 'agent',
      content: 'The success criteria I recommend are listed above. Do these look right, or would you adjust anything?',
      timestamp: '19:42:20',
    },
    {
      id: 'auth-7',
      sender: 'human',
      content: 'Add a criterion for no auth logic outside `domains/auth/` \u2014 I want that verified by grep.',
      timestamp: '19:44:03',
    },
    {
      id: 'auth-8',
      sender: 'agent',
      content: 'Added. Updated spec:',
      timestamp: '19:44:05',
      replyTo: 'auth-7',
      card: {
        type: 'feature-spec',
        data: {
          problem: 'Auth logic duplicated across 3 domains',
          scope: 'domains/auth/ (new), sessions/, strategies/, genesis/',
          approach: 'Extract AuthPort, 3-wave consumer migration',
          criteria: [
            'All auth imports resolve to domains/auth/',
            'Zero runtime auth logic in consumer domains',
            'tsc --noEmit: 0 errors',
            'Existing tests pass (no behavior change)',
            'AuthPort has full test coverage',
            'grep -r "auth" src/domains/ finds 0 matches outside domains/auth/',
          ],
          addedIndex: 5,
        },
      },
    },
  ],

  'build-health-endpoint': [
    {
      id: 'health-1',
      sender: 'system',
      content: 'Build started: Health endpoint',
      timestamp: '18:20:00',
    },
    {
      id: 'health-2',
      sender: 'agent',
      content: 'Starting build for health endpoint. I\'ll explore the codebase for existing health check patterns.',
      timestamp: '18:20:05',
    },
    {
      id: 'health-3',
      sender: 'system',
      content: 'Phase 1: Explore completed. Phase 2: Specify started.',
      timestamp: '18:20:48',
    },
    {
      id: 'health-4',
      sender: 'agent',
      content: 'Exploration complete. No existing health route found. The bridge server uses Express with domain-based routing. I propose adding a `GET /health` route that returns uptime, version, and connection status.',
      timestamp: '18:21:30',
    },
    {
      id: 'health-5',
      sender: 'system',
      content: 'Phase 3: Design started',
      timestamp: '18:23:45',
    },
    {
      id: 'health-6',
      sender: 'system',
      content: 'Checkpoint saved at phase 4/8',
      timestamp: '18:24:50',
    },
    {
      id: 'health-7',
      sender: 'system',
      content: 's-fcd-review: 4/4 advisors complete \u2014 all passed',
      timestamp: '18:29:20',
    },
    {
      id: 'health-8',
      sender: 'agent',
      content: 'Build complete. All 3 criteria passed. Health endpoint is live at `GET /health`. Evidence report generated.',
      timestamp: '18:31:50',
      card: {
        type: 'evidence-report',
        data: {
          verdict: 'FULLY_VALIDATED',
          totalCost: 1.80,
          overheadPct: 9,
          interventions: 3,
          durationMin: 12,
        },
      },
    },
    {
      id: 'health-9',
      sender: 'system',
      content: 'Build validated: FULLY VALIDATED. Total cost $1.80, duration 12m.',
      timestamp: '18:32:00',
    },
  ],
};

// ── Mock Builds ─────────────────────────────────────────────────────

export const MOCK_BUILDS: BuildSummary[] = [
  // ── Build 1: Rate Limiting (running, in implement phase) ──────────
  {
    id: 'build-rate-limiting',
    name: 'Rate limiting',
    requirement:
      'Add rate limiting middleware to the gateway with per-tenant quotas, X-RateLimit headers, and 429 responses',
    status: 'running',
    currentPhase: 'implement',
    autonomy: 'discuss-all',
    costUsd: 6.2,
    budgetUsd: 15.0,
    phases: [
      { phase: 'explore', status: 'completed', durationMin: 1.2 },
      { phase: 'specify', status: 'recovered', durationMin: 3.5, retryCount: 1 },
      { phase: 'design', status: 'completed', durationMin: 2.1 },
      { phase: 'plan', status: 'completed', durationMin: 1.8 },
      { phase: 'implement', status: 'running', durationMin: 4.6 },
      { phase: 'review', status: 'future' },
      { phase: 'validate', status: 'future' },
      { phase: 'measure', status: 'future' },
    ],
    commissions: [
      { id: 'c-1', name: 'C-1 rate-limit-port', progressPct: 100, status: 'completed' },
      {
        id: 'c-2',
        name: 'C-2 gateway-middleware',
        progressPct: 60,
        status: 'retrying',
        activity: 'Retrying with typed context',
      },
      { id: 'c-3', name: 'C-3 tenant-quota-store', progressPct: 100, status: 'completed' },
    ],
    criteria: [
      { name: 'X-RateLimit headers present', status: 'pending' },
      { name: '429 with Retry-After on exceed', status: 'pending' },
      { name: 'tsc --noEmit: 0 errors', status: 'pending' },
      { name: 'No new any types in ports', status: 'pending' },
      { name: 'All tests pass', status: 'pending' },
    ],
    failures: [
      {
        commissionId: 'c-2',
        commissionName: 'C-2 gateway-middleware',
        gateName: 'G-NO-ANY',
        description:
          '2 `any` types detected in gateway/middleware.ts — Lines 47, 83: untyped request handler parameters',
        recovery:
          'Retrying with typed context... injecting GatewayRequest<RateLimitPayload> type constraint',
      },
    ],
    gantt: [
      { phase: 'explore', label: 'Explore', leftPct: 0, widthPct: 7.5, status: 'completed' },
      { phase: 'specify', label: 'Specify', leftPct: 7.5, widthPct: 10, status: 'completed' },
      {
        phase: 'specify',
        label: 'Spec gate',
        leftPct: 17.5,
        widthPct: 8,
        status: 'gate',
        tooltip: 'Human gate: approve spec',
      },
      { phase: 'specify', label: 'Specify retry', leftPct: 25.5, widthPct: 5, status: 'completed' },
      { phase: 'design', label: 'Design', leftPct: 30.5, widthPct: 13, status: 'completed' },
      { phase: 'plan', label: 'Plan', leftPct: 43.5, widthPct: 11, status: 'completed' },
      {
        phase: 'implement',
        label: 'C-1 rate-limit-port',
        leftPct: 54.5,
        widthPct: 14,
        status: 'completed',
        stack: 0,
        tooltip: 'C-1 rate-limit-port',
      },
      {
        phase: 'implement',
        label: 'C-2 gateway-middleware',
        leftPct: 54.5,
        widthPct: 20,
        status: 'running',
        stack: 0,
        tooltip: 'C-2 gateway-middleware (retrying)',
      },
      {
        phase: 'implement',
        label: 'C-3 tenant-quota-store',
        leftPct: 54.5,
        widthPct: 16,
        status: 'completed',
        stack: 1,
        tooltip: 'C-3 tenant-quota-store',
      },
      { phase: 'review', label: 'Review', leftPct: 78, widthPct: 8, status: 'future' },
      { phase: 'validate', label: 'Validate', leftPct: 86, widthPct: 8, status: 'future' },
      { phase: 'measure', label: 'Measure', leftPct: 94, widthPct: 6, status: 'future' },
    ],
    events: [
      { time: '20:00:01', type: 'build.started', target: 'build', detail: 'Rate limiting build initiated', category: 'system' },
      { time: '20:00:03', type: 'build.phase_started', target: 'explore', detail: 'scanning codebase for patterns' },
      { time: '20:01:15', type: 'build.phase_completed', target: 'explore', detail: '18 auth imports found ($0.35)' },
      { time: '20:01:18', type: 'build.phase_started', target: 'specify', detail: 'generating feature spec' },
      { time: '20:02:40', type: 'build.gate_waiting', target: 'specify', detail: 'human-approve-spec: awaiting input', category: 'gate' },
      { time: '20:04:10', type: 'build.human_input', target: 'specify', detail: 'criteria added: X-RateLimit headers' },
      { time: '20:05:20', type: 'build.gate_passed', target: 'specify', detail: 'spec approved ($0.55)', category: 'gate' },
      { time: '20:05:22', type: 'build.phase_started', target: 'design', detail: 'architectural design phase' },
      { time: '20:07:18', type: 'build.gate_passed', target: 'design', detail: 'design approved ($0.80)', category: 'gate' },
      { time: '20:07:20', type: 'build.checkpoint', target: 'plan', detail: 'Checkpoint saved at phase 4/8', category: 'system' },
      { time: '20:12:05', type: 'build.phase_started', target: 'plan', detail: '3 commissions planned' },
      { time: '20:13:18', type: 'build.phase_completed', target: 'plan', detail: 'approved ($0.90)' },
      { time: '20:14:32', type: 'build.phase_started', target: 'impl', detail: 's-fcd-commission-orch: 3 agents' },
      { time: '20:14:45', type: 'build.commission', target: 'C-1', detail: 'completed ($1.20)' },
      { time: '20:15:12', type: 'build.commission', target: 'C-3', detail: 'completed ($1.40)' },
      { time: '20:15:30', type: 'build.failure_detected', target: 'C-2', detail: 'G-NO-ANY: 2 any types in gateway/middleware.ts', category: 'failure' },
      { time: '20:15:31', type: 'build.failure_recovery', target: 'C-2', detail: 'retrying with typed context injection', category: 'recovery' },
      { time: '20:15:44', type: 'build.commission', target: 'C-2', detail: 'retry started ($0.00)' },
      { time: '20:15:50', type: 'strategy.status', target: 'orch', detail: 's-fcd-commission-orch: 2/3 complete, 1 retrying', category: 'system' },
    ],
    refinements: [],
    conversation: MOCK_CONVERSATIONS['build-rate-limiting'],
  },

  // ── Build 2: Auth Extraction (waiting for human input) ────────────
  {
    id: 'build-auth-extraction',
    name: 'Auth extraction',
    requirement:
      'Extract shared auth logic into a dedicated AuthPort interface and consolidate auth middleware across domains',
    status: 'waiting',
    currentPhase: 'specify',
    autonomy: 'discuss-all',
    costUsd: 0.8,
    budgetUsd: 15.0,
    phases: [
      { phase: 'explore', status: 'completed', durationMin: 2.4 },
      { phase: 'specify', status: 'waiting' },
      { phase: 'design', status: 'future' },
      { phase: 'plan', status: 'future' },
      { phase: 'implement', status: 'future' },
      { phase: 'review', status: 'future' },
      { phase: 'validate', status: 'future' },
      { phase: 'measure', status: 'future' },
    ],
    commissions: [],
    criteria: [],
    failures: [],
    gantt: [
      { phase: 'explore', label: 'Explore', leftPct: 0, widthPct: 35, status: 'completed' },
      { phase: 'specify', label: 'Specify', leftPct: 35, widthPct: 15, status: 'completed' },
      {
        phase: 'specify',
        label: 'Awaiting human approval',
        leftPct: 50,
        widthPct: 50,
        status: 'gate',
        tooltip: 'Awaiting human approval',
      },
    ],
    events: [
      { time: '19:38:01', type: 'build.started', target: 'build', detail: 'Auth extraction build initiated', category: 'system' },
      { time: '19:38:03', type: 'build.phase_started', target: 'explore', detail: 'scanning codebase for auth patterns' },
      { time: '19:40:30', type: 'build.phase_completed', target: 'explore', detail: '18 auth imports found ($0.35)' },
      { time: '19:40:32', type: 'build.phase_started', target: 'specify', detail: 'generating feature spec' },
      { time: '19:42:10', type: 'build.gate_waiting', target: 'specify', detail: 'human-approve-spec: awaiting input', category: 'gate' },
    ],
    refinements: [],
    activeGate: 'specify',
    conversation: MOCK_CONVERSATIONS['build-auth-extraction'],
  },

  // ── Build 3: Health Endpoint (completed, fully validated) ─────────
  {
    id: 'build-health-endpoint',
    name: 'Health endpoint',
    requirement:
      'Add GET /health endpoint returning 200 with uptime, version, and connection status',
    status: 'completed',
    currentPhase: 'completed',
    autonomy: 'discuss-all',
    costUsd: 1.8,
    budgetUsd: 15.0,
    verdict: 'FULLY_VALIDATED',
    evidence: {
      totalCost: 1.8,
      overheadPct: 9,
      interventions: 3,
      durationMin: 12,
      failureRecoveries: 0,
    },
    phaseCosts: {
      explore: 0.2,
      specify: 0.25,
      design: 0.15,
      plan: 0.2,
      implement: 0.7,
      review: 0.2,
      validate: 0.05,
      measure: 0.05,
    },
    phases: [
      { phase: 'explore', status: 'completed', durationMin: 0.8 },
      { phase: 'specify', status: 'completed', durationMin: 1.5 },
      { phase: 'design', status: 'completed', durationMin: 1.2 },
      { phase: 'plan', status: 'completed', durationMin: 0.9 },
      { phase: 'implement', status: 'completed', durationMin: 4.8 },
      { phase: 'review', status: 'completed', durationMin: 1.6 },
      { phase: 'validate', status: 'completed', durationMin: 0.7 },
      { phase: 'measure', status: 'completed', durationMin: 0.5 },
    ],
    commissions: [
      { id: 'c-1', name: 'C-1 health-route', progressPct: 100, status: 'completed' },
    ],
    criteria: [
      { name: 'GET /health returns 200 with uptime, version', status: 'passed' },
      { name: 'tsc --noEmit: 0 errors', status: 'passed' },
      { name: 'All tests pass (4 new, 127 total)', status: 'passed' },
    ],
    failures: [],
    gantt: [
      { phase: 'explore', label: 'Explore', leftPct: 0, widthPct: 7, status: 'completed' },
      { phase: 'specify', label: 'Specify', leftPct: 7, widthPct: 12, status: 'completed' },
      { phase: 'specify', label: 'Spec gate', leftPct: 19, widthPct: 3, status: 'gate' },
      { phase: 'design', label: 'Design', leftPct: 22, widthPct: 10, status: 'completed' },
      { phase: 'plan', label: 'Plan', leftPct: 32, widthPct: 8, status: 'completed' },
      { phase: 'implement', label: 'Implement', leftPct: 40, widthPct: 38, status: 'completed' },
      { phase: 'review', label: 'Review', leftPct: 78, widthPct: 12, status: 'completed' },
      { phase: 'validate', label: 'Validate', leftPct: 90, widthPct: 5, status: 'completed' },
      { phase: 'measure', label: 'Measure', leftPct: 95, widthPct: 5, status: 'completed' },
    ],
    events: [
      { time: '18:20:01', type: 'build.started', target: 'build', detail: 'Health endpoint build initiated', category: 'system' },
      { time: '18:20:03', type: 'build.phase_started', target: 'explore', detail: 'scanning codebase' },
      { time: '18:20:50', type: 'build.phase_completed', target: 'explore', detail: 'trivial complexity ($0.20)' },
      { time: '18:22:30', type: 'build.phase_completed', target: 'specify', detail: '3 criteria ($0.25)' },
      { time: '18:23:45', type: 'build.phase_completed', target: 'design', detail: 'simple route ($0.15)' },
      { time: '18:24:40', type: 'build.phase_completed', target: 'plan', detail: '1 commission ($0.20)' },
      { time: '18:29:30', type: 'build.phase_completed', target: 'implement', detail: '+42 lines ($0.70)' },
      { time: '18:31:10', type: 'build.phase_completed', target: 'review', detail: '4/4 advisors passed ($0.20)' },
      { time: '18:31:50', type: 'build.phase_completed', target: 'validate', detail: '3/3 criteria passed ($0.05)' },
      { time: '18:32:20', type: 'build.completed', target: 'build', detail: 'FULLY VALIDATED ($1.80)', category: 'system' },
    ],
    refinements: [],
    conversation: MOCK_CONVERSATIONS['build-health-endpoint'],
  },
];
