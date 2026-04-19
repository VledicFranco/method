// SPDX-License-Identifier: Apache-2.0
/**
 * Effort Mapper — translates reasoning effort levels to provider-specific parameters.
 *
 * Maps 'low' / 'medium' / 'high' to concrete values that providers can consume:
 * - thinkingBudgetTokens: how many tokens the model may use for internal reasoning
 * - temperature: sampling temperature hint
 * - maxTokens: output token limit hint
 *
 * These are placed in request.metadata.effortParams so providers can read them
 * without coupling to the reasoning module's internals.
 */

import type { Pact, AgentRequest } from '../pact.js';
import type { AgentEvent } from '../events.js';
import type { ReasoningPolicy } from './reasoning-policy.js';
import type { InvokeFn, ReasonerMiddleware } from './reasoner-middleware.js';

// ── Effort Parameters ────────────────────────────────────────────

export interface EffortParams {
  /** Token budget for model thinking / chain-of-thought */
  thinkingBudgetTokens: number;

  /** Sampling temperature hint (0.0 - 1.0) */
  temperature: number;

  /** Maximum output tokens hint */
  maxTokens: number;
}

const EFFORT_MAP: Record<NonNullable<ReasoningPolicy['effort']>, EffortParams> = {
  low: {
    thinkingBudgetTokens: 1024,
    temperature: 0.0,
    maxTokens: 2048,
  },
  medium: {
    thinkingBudgetTokens: 4096,
    temperature: 0.3,
    maxTokens: 4096,
  },
  high: {
    thinkingBudgetTokens: 16384,
    temperature: 0.5,
    maxTokens: 8192,
  },
};

// ── Factory ──────────────────────────────────────────────────────

/**
 * Creates middleware that maps a reasoning effort level to provider-specific parameters.
 *
 * The parameters are placed in `request.metadata.effortParams` as an EffortParams object.
 * Providers read this to configure their internal reasoning budget.
 */
export function effortMapper(effort: ReasoningPolicy['effort']): ReasonerMiddleware {
  return <T>(
    inner: InvokeFn<T>,
    _pact: Pact<T>,
    _onEvent?: (event: AgentEvent) => void,
  ): InvokeFn<T> => {
    if (!effort) {
      return inner;
    }

    const params = EFFORT_MAP[effort];

    return async (pact: Pact<T>, request: AgentRequest) => {
      const augmented: AgentRequest = {
        ...request,
        metadata: {
          ...request.metadata,
          effortParams: params,
        },
      };

      return inner(pact, augmented);
    };
  };
}

/**
 * Returns the concrete effort parameters for a given level.
 * Useful for providers that want to read the mapping without applying middleware.
 */
export function getEffortParams(effort: NonNullable<ReasoningPolicy['effort']>): EffortParams {
  return { ...EFFORT_MAP[effort] };
}
