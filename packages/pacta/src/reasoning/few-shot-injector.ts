// SPDX-License-Identifier: Apache-2.0
/**
 * Few-Shot Injector — injects example prompt-response pairs into the system prompt.
 *
 * Takes AgentExample[] and formats them into a structured few-shot section
 * appended to the system prompt. This gives the agent concrete demonstrations
 * of the expected behavior pattern.
 */

import type { Pact, AgentRequest } from '../pact.js';
import type { AgentEvent } from '../events.js';
import type { AgentExample } from './reasoning-policy.js';
import type { InvokeFn, ReasonerMiddleware } from './reasoner-middleware.js';

// ── Factory ──────────────────────────────────────────────────────

/**
 * Creates middleware that injects few-shot examples into the system prompt.
 *
 * Each example is formatted as a labeled prompt-response pair. The examples
 * section is appended after any existing system prompt content.
 */
export function fewShotInjector(examples: AgentExample[]): ReasonerMiddleware {
  return <T>(
    inner: InvokeFn<T>,
    _pact: Pact<T>,
    _onEvent?: (event: AgentEvent) => void,
  ): InvokeFn<T> => {
    // No examples — pass through
    if (!examples || examples.length === 0) {
      return inner;
    }

    const examplesBlock = formatExamples(examples);

    return async (pact: Pact<T>, request: AgentRequest) => {
      const parts: string[] = [];

      if (request.systemPrompt) {
        parts.push(request.systemPrompt);
      }

      parts.push(examplesBlock);

      const augmented: AgentRequest = {
        ...request,
        systemPrompt: parts.join('\n\n'),
      };

      return inner(pact, augmented);
    };
  };
}

// ── Formatting ───────────────────────────────────────────────────

function formatExamples(examples: AgentExample[]): string {
  const header = '--- Few-Shot Examples ---';

  const formatted = examples.map((ex, i) => {
    const num = i + 1;
    return `Example ${num}:\nUser: ${ex.prompt}\nAssistant: ${ex.response}`;
  });

  return `${header}\n\n${formatted.join('\n\n')}`;
}
