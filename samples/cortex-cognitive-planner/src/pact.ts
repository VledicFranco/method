/**
 * Planner cognitive-module pact — PRD-068 Wave 1.
 *
 * Wraps pacta's `Planner` module behavior (packages/pacta/src/cognitive/
 * modules/planner.ts). Resumable pact with a MEDIUM budget — the Planner
 * carries the biggest single-turn reasoning cost in the cognitive cohort
 * (PRD-068 §5.1).
 */

import type { Pact, SchemaDefinition, SchemaResult } from '@method/agent-runtime';

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

/**
 * Hand-written SchemaDefinition for PlanUpdate.
 *
 * Accepts either a JSON string (CLI-style) or a structured object
 * (Cortex `ctx.llm.structured`). Validates field types and enforces
 * `changedSteps` is an array of strings.
 */
const planUpdateSchema: SchemaDefinition<PlanUpdate> = {
  description:
    'PlanUpdate { goalId, statement, planSummary, changedSteps, requiresMemoryRecall, rationale }',
  parse(raw: unknown): SchemaResult<PlanUpdate> {
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

    const goalId = obj.goalId;
    if (typeof goalId !== 'string' || goalId.length === 0) {
      errors.push('goalId must be a non-empty string');
    }
    const statement = obj.statement;
    if (typeof statement !== 'string') {
      errors.push(`statement must be a string, got ${typeof statement}`);
    }
    const planSummary = obj.planSummary;
    if (typeof planSummary !== 'string') {
      errors.push(`planSummary must be a string, got ${typeof planSummary}`);
    }
    const changedSteps = obj.changedSteps;
    if (!Array.isArray(changedSteps)) {
      errors.push(`changedSteps must be an array, got ${typeof changedSteps}`);
    } else if (!changedSteps.every((s) => typeof s === 'string')) {
      errors.push('changedSteps must contain only strings');
    }
    const requiresMemoryRecall = obj.requiresMemoryRecall;
    if (typeof requiresMemoryRecall !== 'boolean') {
      errors.push(
        `requiresMemoryRecall must be a boolean, got ${typeof requiresMemoryRecall}`,
      );
    }
    const rationale = obj.rationale;
    if (typeof rationale !== 'string') {
      errors.push(`rationale must be a string, got ${typeof rationale}`);
    }

    if (errors.length > 0) {
      return { success: false, errors };
    }
    return {
      success: true,
      data: {
        goalId: goalId as string,
        statement: statement as string,
        planSummary: planSummary as string,
        changedSteps: (changedSteps as string[]).slice(),
        requiresMemoryRecall: requiresMemoryRecall as boolean,
        rationale: rationale as string,
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

export const plannerPact: Pact<PlanUpdate> = {
  mode: { type: 'resumable' },
  budget: {
    maxTurns: 12,
    maxCostUsd: 0.35, // medium ceiling — reasoning LLM path
    onExhaustion: 'stop',
  },
  output: {
    schema: planUpdateSchema,
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
