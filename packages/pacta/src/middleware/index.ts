/**
 * middleware/ — Composable agent provider middleware.
 *
 * budgetEnforcer(): token budget tracking — rejects calls exceeding the limit.
 * outputValidator(): Zod schema validation + retry on parse failure.
 * throttler(): rate limiting — queues calls when throughput exceeds limits.
 */

export { budgetEnforcer, BudgetExhaustedError } from './budget-enforcer.js';
export type { BudgetState } from './budget-enforcer.js';
export * from './output-validator.js';
export * from './throttler.js';
