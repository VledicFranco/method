/**
 * Context Middleware — wraps agent provider invocations with context management.
 *
 * Context middleware intercepts invoke() calls to manage the agent's context
 * window. Each middleware monitors token usage, applies a strategy when context
 * pressure is detected, and emits events for observability.
 *
 * Middleware ordering: Budget Enforcer -> Context Middleware -> Output Validator -> Provider
 */

import type { Pact, AgentRequest, AgentResult } from '../pact.js';
import type { AgentEvent } from '../events.js';

/** A function that invokes the agent pipeline. */
export type InvokeFn<T = unknown> = (pact: Pact<T>, request: AgentRequest) => Promise<AgentResult<T>>;

/**
 * Context middleware wraps an InvokeFn, returning a new InvokeFn with
 * context management behavior applied.
 */
export type ContextMiddleware<T = unknown> = (
  inner: InvokeFn<T>,
  pact: Pact<T>,
  onEvent?: (event: AgentEvent) => void,
) => InvokeFn<T>;
