/**
 * Planner cognitive-module pact — PRD-068 Wave 1.
 *
 * Wraps pacta's `Planner` module behavior (packages/pacta/src/cognitive/
 * modules/planner.ts). Resumable pact with a MEDIUM budget — the Planner
 * carries the biggest single-turn reasoning cost in the cognitive cohort
 * (PRD-068 §5.1).
 */

import type { Pact } from '@method/agent-runtime';

/**
 * Plan update shape — returned by a single Planner pass.
 */
export interface PlanUpdate {
  readonly goalId: string;
  readonly statement: string;
  readonly planSummary: string;
  readonly changedSteps: ReadonlyArray<string>;
  readonly requiresMemoryRecall: boolean;
  readonly rationale: string;
}

export const plannerPact: Pact<PlanUpdate> = {
  mode: { type: 'resumable' },
  budget: {
    maxTurns: 12,
    maxCostUsd: 0.35, // medium ceiling — reasoning LLM path
    onExhaustion: 'stop',
  },
  output: {
    schema: {
      type: 'object',
      required: [
        'goalId',
        'statement',
        'planSummary',
        'changedSteps',
        'requiresMemoryRecall',
        'rationale',
      ],
      properties: {
        goalId: { type: 'string' },
        statement: { type: 'string' },
        planSummary: { type: 'string' },
        changedSteps: { type: 'array', items: { type: 'string' } },
        requiresMemoryRecall: { type: 'boolean' },
        rationale: { type: 'string' },
      },
    },
    retryOnValidationFailure: true,
    maxRetries: 2,
  },
  reasoning: { effort: 'medium' },
  scope: {
    allowedTools: ['read-only/*'],
    deniedTools: ['fs/Write', 'shell/Bash'],
    permissionMode: 'deny',
  },
};
