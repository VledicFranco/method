/**
 * Compaction Manager — monitors token usage and triggers context compaction.
 *
 * When cumulative token usage exceeds the compaction threshold (fraction of
 * context window), injects a compaction request that asks the provider to
 * summarize and compress the conversation. Emits AgentContextCompacted with
 * before/after token counts.
 *
 * Strategy: 'compact' in ContextPolicy.
 */

import type { Pact, AgentRequest, AgentResult } from '../pact.js';
import type { AgentEvent, AgentContextCompacted } from '../events.js';
import type { ContextPolicy } from './context-policy.js';
import type { InvokeFn, ContextMiddleware } from './context-middleware.js';

const DEFAULT_COMPACTION_THRESHOLD = 0.8;
const DEFAULT_COMPACTION_INSTRUCTIONS =
  'Summarize the conversation so far, preserving all key decisions, facts, and pending tasks. ' +
  'Drop redundant detail and failed approaches.';

interface CompactionState {
  cumulativeTokens: number;
  contextWindowSize: number;
  compactionCount: number;
}

/**
 * Estimates a context window size from the pact's budget.
 * Falls back to a conservative default if no budget is declared.
 */
function estimateContextWindow(pact: Pact): number {
  if (pact.budget?.maxTokens) return pact.budget.maxTokens;
  // Conservative default — most models have at least 100k tokens
  return 100_000;
}

/**
 * Creates a context middleware that monitors token usage and triggers
 * compaction when the threshold is reached.
 *
 * @param policy - Context policy configuration (optional).
 * @returns A ContextMiddleware that wraps provider.invoke().
 */
export function compactionManager(policy?: Partial<ContextPolicy>): ContextMiddleware {
  const threshold = policy?.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD;
  const instructions = policy?.compactionInstructions ?? DEFAULT_COMPACTION_INSTRUCTIONS;

  return <T>(
    inner: InvokeFn<T>,
    pact: Pact<T>,
    onEvent?: (event: AgentEvent) => void,
  ): InvokeFn<T> => {
    const state: CompactionState = {
      cumulativeTokens: 0,
      contextWindowSize: estimateContextWindow(pact),
      compactionCount: 0,
    };

    return async (p: Pact<T>, request: AgentRequest): Promise<AgentResult<T>> => {
      // Check if compaction is needed before invocation
      const pressure = state.cumulativeTokens / state.contextWindowSize;

      if (pressure >= threshold && state.cumulativeTokens > 0) {
        // Trigger compaction by sending a compaction request first
        const compactionPrompt = `[CONTEXT COMPACTION REQUESTED]\n\n${instructions}`;
        const compactionRequest: AgentRequest = {
          ...request,
          prompt: compactionPrompt,
          metadata: { ...request.metadata, _contextCompaction: true },
        };

        const fromTokens = state.cumulativeTokens;
        const compactionResult = await inner(p, compactionRequest);

        // After compaction, the context window usage is reset to the compacted size
        state.cumulativeTokens = compactionResult.usage.totalTokens;
        state.compactionCount++;

        const toTokens = state.cumulativeTokens;

        // Emit compaction event
        if (onEvent) {
          const event: AgentContextCompacted = {
            type: 'context_compacted',
            fromTokens,
            toTokens,
          };
          onEvent(event);
        }
      }

      // Normal invocation
      const result = await inner(p, request);
      state.cumulativeTokens += result.usage.totalTokens;

      return result;
    };
  };
}
