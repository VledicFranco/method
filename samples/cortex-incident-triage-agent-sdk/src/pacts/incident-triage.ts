// SPDX-License-Identifier: Apache-2.0
/**
 * Incident triage pact (C-4 sample, mirrors PRD-058 §7.3).
 *
 * SDK-flavor variant: the inner agentic loop runs inside
 * `@anthropic-ai/claude-agent-sdk` (subprocess: `claude` CLI), so the
 * scope here applies to tools the SDK is allowed to invoke during its
 * loop. Conservative read-only defaults — Slack notifications still
 * route through `ctx.notify` via the tenant app's onEvent handler, not
 * via a tool call.
 *
 *   - oneshot mode (the SDK provider only advertises `oneshot`)
 *   - $0.10 cost budget, 10 turn cap (predictive enforcer; hard ceiling
 *     in production comes from ctx.llm budget once Cortex O1 lands)
 *   - structured output (triageSchema from ../types.ts)
 *   - medium reasoning effort
 *   - read-only scope; explicit deny on Write/Bash so the SDK refuses if
 *     a tool wires them up unexpectedly
 */

import type { Pact } from '@methodts/agent-runtime';
import { triageSchema, type TriageOutput } from '../types.js';

export const incidentTriagePact: Pact<TriageOutput> = {
  mode: { type: 'oneshot' },
  budget: {
    maxTurns: 10,
    maxCostUsd: 0.1,
    onExhaustion: 'stop',
  },
  output: {
    schema: triageSchema,
    retryOnValidationFailure: true,
    maxRetries: 2,
  },
  reasoning: {
    effort: 'medium',
  },
  scope: {
    allowedTools: ['read-only/*'],
    deniedTools: ['fs/Write', 'shell/Bash'],
    permissionMode: 'deny',
  },
};
