import type { SessionBudget } from './types.js';

export type BudgetValidationResult =
  | { allowed: true }
  | { allowed: false; error: 'DEPTH_EXCEEDED' | 'BUDGET_EXHAUSTED'; message: string; budget: SessionBudget };

/**
 * Validate whether a new agent can be spawned under the given budget constraints.
 * Returns { allowed: true } if the spawn is permitted, or an error object if not.
 */
export function validateSessionBudget(
  depth: number,
  budget: SessionBudget,
): BudgetValidationResult {
  if (depth >= budget.max_depth) {
    return {
      allowed: false,
      error: 'DEPTH_EXCEEDED',
      message: `Depth limit exceeded: depth ${depth} >= max_depth ${budget.max_depth}. Cannot spawn deeper.`,
      budget,
    };
  }

  if (budget.agents_spawned >= budget.max_agents) {
    return {
      allowed: false,
      error: 'BUDGET_EXHAUSTED',
      message: `Agent budget exceeded: ${budget.agents_spawned}/${budget.max_agents} agents spawned. Increase budget or complete existing work.`,
      budget,
    };
  }

  return { allowed: true };
}
