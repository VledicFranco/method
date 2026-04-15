/**
 * Incident triage pact (PRD-058 §7.3).
 *
 * Realistic shape for the April-21 incident-triage demo:
 *   - oneshot mode
 *   - $0.10 cost budget, 10 turn cap
 *   - structured output (triageSchema from ../types.ts)
 *   - medium reasoning effort
 *   - read-only scope (no write tools; Slack goes through ctx.notify via
 *     the tenant app's onEvent handler, not the pact's scope)
 */

import type { Pact } from '@method/agent-runtime';
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

/**
 * Resumable variant used only by the resumption round-trip test. Keeps the
 * shape identical to the primary pact so a suspended invocation can be
 * resumed through the same handle.
 */
export const incidentTriagePactResumable: Pact<TriageOutput> = {
  ...incidentTriagePact,
  mode: { type: 'resumable' },
};
