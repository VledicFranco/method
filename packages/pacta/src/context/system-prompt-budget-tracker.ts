// SPDX-License-Identifier: Apache-2.0
/**
 * System Prompt Budget Tracker — tracks system prompt token consumption.
 *
 * Ensures the system prompt does not exceed the allocated budget.
 * Emits a budget_warning event when approaching the limit.
 * Uses a conservative 4 chars/token estimate for budget checking.
 */

import type { Pact, AgentRequest, AgentResult } from '../pact.js';
import type { AgentEvent, AgentBudgetWarning } from '../events.js';
import type { InvokeFn, ContextMiddleware } from './context-middleware.js';

const CHARS_PER_TOKEN_ESTIMATE = 4;
const WARNING_THRESHOLD = 0.8;

/**
 * Estimates the token count of a string using a chars/token heuristic.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

/**
 * Creates a context middleware that tracks system prompt token consumption
 * and warns when approaching the budget limit.
 *
 * @param budget - Maximum tokens allocated for the system prompt.
 * @returns A ContextMiddleware that wraps provider.invoke().
 */
export function systemPromptBudgetTracker(budget: number): ContextMiddleware {
  return <T>(
    inner: InvokeFn<T>,
    pact: Pact<T>,
    onEvent?: (event: AgentEvent) => void,
  ): InvokeFn<T> => {
    return async (p: Pact<T>, request: AgentRequest): Promise<AgentResult<T>> => {
      if (request.systemPrompt) {
        const estimatedTokens = estimateTokens(request.systemPrompt);
        const ratio = estimatedTokens / budget;

        if (ratio >= 1) {
          // Exceeds budget — emit warning and truncate
          if (onEvent) {
            const event: AgentBudgetWarning = {
              type: 'budget_warning',
              resource: 'tokens',
              consumed: estimatedTokens,
              limit: budget,
              percentUsed: Math.round(ratio * 100),
            };
            onEvent(event);
          }

          // Truncate system prompt to fit budget
          const maxChars = budget * CHARS_PER_TOKEN_ESTIMATE;
          const truncatedRequest: AgentRequest = {
            ...request,
            systemPrompt: request.systemPrompt.slice(0, maxChars),
          };
          return inner(p, truncatedRequest);
        }

        if (ratio >= WARNING_THRESHOLD) {
          // Approaching limit — emit warning
          if (onEvent) {
            const event: AgentBudgetWarning = {
              type: 'budget_warning',
              resource: 'tokens',
              consumed: estimatedTokens,
              limit: budget,
              percentUsed: Math.round(ratio * 100),
            };
            onEvent(event);
          }
        }
      }

      return inner(p, request);
    };
  };
}
