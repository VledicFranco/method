/**
 * Output Validator Middleware — validates agent results against output schemas.
 *
 * If OutputContract.schema is defined, validates the result through schema.parse().
 * On failure, retries with verbal feedback (up to maxRetries).
 * Respects remaining budget — budget wins if exhausted during retry.
 *
 * Middleware ordering: Budget Enforcer → Output Validator → Provider
 * (output validator wraps the provider directly).
 */

import type { Pact, AgentRequest, AgentResult } from '../pact.js';
import type { AgentEvent, AgentReflection } from '../events.js';
import type { OutputContract, SchemaDefinition } from '../output/output-contract.js';

type InvokeFn<T> = (pact: Pact<T>, request: AgentRequest) => Promise<AgentResult<T>>;

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_PROMPT = 'Your output did not match the required schema. Errors:\n';

/**
 * Wraps an invoke function with output validation and retry logic.
 */
export function outputValidator<T>(
  inner: InvokeFn<T>,
  pact: Pact<T>,
  onEvent?: (event: AgentEvent) => void,
): InvokeFn<T> {
  const output: OutputContract<T> = pact.output ?? {};
  const schema: SchemaDefinition<T> | undefined = output.schema;

  if (!schema) {
    // No schema to validate — pass through
    return inner;
  }

  const retryEnabled = output.retryOnValidationFailure !== false;
  const maxRetries = output.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryPromptPrefix = output.retryPrompt ?? DEFAULT_RETRY_PROMPT;

  return async (p: Pact<T>, request: AgentRequest): Promise<AgentResult<T>> => {
    let result = await inner(p, request);
    let attempt = 0;

    while (attempt <= maxRetries) {
      // If the agent was stopped by budget, don't retry
      if (result.stopReason === 'budget_exhausted' || result.stopReason === 'timeout' || result.stopReason === 'killed') {
        return result;
      }

      const parsed = schema.parse(result.output);

      if (parsed.success) {
        // Valid output — return with parsed data
        return { ...result, output: parsed.data };
      }

      // Validation failed
      attempt++;

      if (!retryEnabled || attempt > maxRetries) {
        // No more retries — return with validation error
        if (onEvent) {
          onEvent({
            type: 'error',
            message: `Output validation failed after ${attempt} attempt(s): ${parsed.errors.join('; ')}`,
            recoverable: false,
          });
        }
        return {
          ...result,
          completed: false,
          stopReason: 'error',
        };
      }

      // Emit reflection event for observability
      if (onEvent) {
        onEvent({
          type: 'reflection',
          trial: attempt,
          critique: `Output validation failed: ${parsed.errors.join('; ')}`,
        } satisfies AgentReflection);
      }

      // Retry with verbal feedback
      const retryRequest: AgentRequest = {
        ...request,
        prompt: `${retryPromptPrefix}${parsed.errors.join('\n')}\n\nPlease fix your output to match the required schema.`,
      };

      result = await inner(p, retryRequest);
    }

    return result;
  };
}
