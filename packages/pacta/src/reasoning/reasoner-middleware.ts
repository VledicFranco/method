/**
 * Reasoner Middleware — type definition for reasoning strategy wrappers.
 *
 * A ReasonerMiddleware takes an invoke function and returns a wrapped version
 * that implements a reasoning strategy (think tool injection, reflection loops,
 * few-shot prompting, etc.).
 *
 * Follows the same wrapping pattern as budgetEnforcer and outputValidator.
 */

import type { Pact, AgentRequest, AgentResult } from '../pact.js';
import type { AgentEvent } from '../events.js';

/** The invoke function signature that middleware wraps. */
export type InvokeFn<T = unknown> = (pact: Pact<T>, request: AgentRequest) => Promise<AgentResult<T>>;

/**
 * A ReasonerMiddleware wraps an invoke function with reasoning behavior.
 *
 * It receives the inner invoke function, the pact, and an optional event callback.
 * It returns a new invoke function with the reasoning strategy applied.
 */
export type ReasonerMiddleware = <T>(
  inner: InvokeFn<T>,
  pact: Pact<T>,
  onEvent?: (event: AgentEvent) => void,
) => InvokeFn<T>;
