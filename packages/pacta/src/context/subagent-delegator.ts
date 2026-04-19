// SPDX-License-Identifier: Apache-2.0
/**
 * Subagent Delegator — delegates to fresh context windows under pressure.
 *
 * When context pressure is detected (cumulative tokens exceed threshold),
 * spawns a sub-request with a summary of the conversation so far. The
 * sub-request runs in a fresh context window, and the result is summarized
 * within the token budget before being returned.
 *
 * Strategy: 'subagent' in ContextPolicy.
 */

import type { Pact, AgentRequest, AgentResult } from '../pact.js';
import type { AgentEvent, AgentContextCompacted } from '../events.js';
import type { ContextPolicy } from './context-policy.js';
import type { InvokeFn, ContextMiddleware } from './context-middleware.js';

const DEFAULT_COMPACTION_THRESHOLD = 0.8;
const DEFAULT_SUMMARY_TOKENS = 500;

interface DelegationState {
  cumulativeTokens: number;
  contextWindowSize: number;
  conversationSummary: string;
  delegationCount: number;
}

/**
 * Estimates a context window size from the pact's budget.
 */
function estimateContextWindow(pact: Pact): number {
  if (pact.budget?.maxTokens) return pact.budget.maxTokens;
  return 100_000;
}

/**
 * Truncates text to approximate a token budget.
 * Uses a conservative 4 chars/token estimate.
 */
function truncateToTokenBudget(text: string, tokenBudget: number): string {
  const charBudget = tokenBudget * 4;
  if (text.length <= charBudget) return text;
  return text.slice(0, charBudget) + '...';
}

/**
 * Creates a context middleware that delegates to fresh context windows
 * when context pressure is detected.
 *
 * @param policy - Context policy configuration (optional).
 * @returns A ContextMiddleware that wraps provider.invoke().
 */
export function subagentDelegator(policy?: Partial<ContextPolicy>): ContextMiddleware {
  const threshold = policy?.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD;
  const summaryTokens = policy?.subagentSummaryTokens ?? DEFAULT_SUMMARY_TOKENS;

  return <T>(
    inner: InvokeFn<T>,
    pact: Pact<T>,
    onEvent?: (event: AgentEvent) => void,
  ): InvokeFn<T> => {
    const state: DelegationState = {
      cumulativeTokens: 0,
      contextWindowSize: estimateContextWindow(pact),
      conversationSummary: '',
      delegationCount: 0,
    };

    return async (p: Pact<T>, request: AgentRequest): Promise<AgentResult<T>> => {
      const pressure = state.cumulativeTokens / state.contextWindowSize;

      if (pressure >= threshold && state.cumulativeTokens > 0) {
        // Delegate to a fresh context window
        const fromTokens = state.cumulativeTokens;

        // Build a summary-prefixed request for the sub-agent
        const summaryPrefix = state.conversationSummary
          ? `[CONTEXT SUMMARY FROM PRIOR WINDOW]\n${truncateToTokenBudget(state.conversationSummary, summaryTokens)}\n\n`
          : '';

        const delegatedRequest: AgentRequest = {
          ...request,
          prompt: `${summaryPrefix}${request.prompt}`,
          metadata: { ...request.metadata, _subagentDelegation: true, _delegationCount: state.delegationCount + 1 },
        };

        const result = await inner(p, delegatedRequest);

        // Update state: reset cumulative tokens, store summary for next delegation
        state.delegationCount++;
        const toTokens = result.usage.totalTokens;
        state.cumulativeTokens = toTokens;

        // Extract summary from the result for future delegations
        const outputStr = typeof result.output === 'string'
          ? result.output
          : JSON.stringify(result.output);
        state.conversationSummary = truncateToTokenBudget(outputStr, summaryTokens);

        // Emit compaction event
        if (onEvent) {
          const event: AgentContextCompacted = {
            type: 'context_compacted',
            fromTokens,
            toTokens,
          };
          onEvent(event);
        }

        return result;
      }

      // Normal invocation — track tokens and accumulate summary
      const result = await inner(p, request);
      state.cumulativeTokens += result.usage.totalTokens;

      // Accumulate conversation summary
      const outputStr = typeof result.output === 'string'
        ? result.output
        : JSON.stringify(result.output);
      state.conversationSummary += `\n${truncateToTokenBudget(outputStr, Math.floor(summaryTokens / 3))}`;

      return result;
    };
  };
}
