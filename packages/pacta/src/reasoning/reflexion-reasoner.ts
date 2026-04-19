// SPDX-License-Identifier: Apache-2.0
/**
 * Reflexion Reasoner — multi-trial with verbal self-critique.
 *
 * Strategy: run the provider, check the result. If the result indicates
 * failure (non-complete stopReason or an error event), construct a critique
 * prompt and retry. Respects maxReflectionTrials.
 *
 * Emits AgentReflection events for each retry so the observability surface
 * captures the reflection loop.
 *
 * Reference: Shinn et al., "Reflexion: Language Agents with Verbal Reinforcement Learning" (2023)
 */

import type { Pact, AgentRequest, AgentResult } from '../pact.js';
import type { AgentEvent, AgentReflection } from '../events.js';
import type { ReasoningPolicy } from './reasoning-policy.js';
import type { InvokeFn, ReasonerMiddleware } from './reasoner-middleware.js';

const DEFAULT_MAX_TRIALS = 3;

// ── Factory ──────────────────────────────────────────────────────

/**
 * Creates a Reflexion-style reasoning middleware.
 *
 * Wraps the invoke function with retry logic:
 * 1. Call inner invoke
 * 2. If result indicates failure, emit AgentReflection and retry with critique
 * 3. Repeat up to maxReflectionTrials times
 * 4. Return the last result (success or final failure)
 */
export function reflexionReasoner(policy?: Partial<ReasoningPolicy>): ReasonerMiddleware {
  const maxTrials = policy?.maxReflectionTrials ?? DEFAULT_MAX_TRIALS;
  const reflectOnFailure = policy?.reflectOnFailure ?? true;

  return <T>(
    inner: InvokeFn<T>,
    _pact: Pact<T>,
    onEvent?: (event: AgentEvent) => void,
  ): InvokeFn<T> => {
    if (!reflectOnFailure || maxTrials <= 0) {
      return inner;
    }

    return async (pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>> => {
      let result = await inner(pact, request);
      let trial = 0;

      while (trial < maxTrials && isRetriable(result)) {
        trial++;

        const critique = buildCritique(result, trial);

        // Emit reflection event
        if (onEvent) {
          const reflectionEvent: AgentReflection = {
            type: 'reflection',
            trial,
            critique,
          };
          onEvent(reflectionEvent);
        }

        // Retry with critique injected into the prompt
        const retryRequest: AgentRequest = {
          ...request,
          prompt: `${request.prompt}\n\n--- Reflection (trial ${trial}/${maxTrials}) ---\n${critique}\n\nPlease try again, addressing the issues above.`,
        };

        result = await inner(pact, retryRequest);
      }

      return result;
    };
  };
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Determines if a result warrants a retry.
 * Budget exhaustion, timeout, and kill are non-retriable — the agent cannot fix those.
 */
function isRetriable<T>(result: AgentResult<T>): boolean {
  if (result.completed) return false;
  // These stop reasons are external — retrying won't help
  if (result.stopReason === 'budget_exhausted') return false;
  if (result.stopReason === 'timeout') return false;
  if (result.stopReason === 'killed') return false;
  // 'error' stopReason indicates a potentially fixable failure
  return result.stopReason === 'error';
}

/**
 * Constructs a verbal critique from the failed result.
 */
function buildCritique<T>(result: AgentResult<T>, trial: number): string {
  const parts: string[] = [];

  parts.push(`Attempt ${trial} failed with stop reason: ${result.stopReason}.`);

  if (result.output !== undefined && result.output !== null) {
    const outputStr = typeof result.output === 'string'
      ? result.output
      : JSON.stringify(result.output, null, 2);

    if (outputStr.length > 0) {
      parts.push(`Previous output: ${outputStr.slice(0, 500)}`);
    }
  }

  parts.push('Analyze what went wrong and correct the approach.');

  return parts.join('\n');
}
