// SPDX-License-Identifier: Apache-2.0
/**
 * middleware/ — Composable agent provider middleware.
 *
 * budgetEnforcer(): token budget tracking — rejects calls exceeding the limit.
 * outputValidator(): Zod schema validation + retry on parse failure.
 * throttler(): rate limiting — queues calls when throughput exceeds limits.
 * tracingMiddleware(): emits OPERATION TraceEvents around invocations (PRD 058).
 */

export { budgetEnforcer, BudgetExhaustedError } from './budget-enforcer.js';
export type { BudgetState } from './budget-enforcer.js';
export * from './output-validator.js';
export * from './throttler.js';
export { tracingMiddleware } from './tracing-middleware.js';
export type { TracingMiddlewareOptions, TracingSink } from './tracing-middleware.js';
