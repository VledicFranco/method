/**
 * commission/ — Agent commission builder.
 *
 * commission(): creates a typed Commission<A> — agent task with provider config,
 *   retries, timeout, and bridge params. Primary unit of work for AgentProvider.
 * batchCommission(): runs multiple commissions in parallel, collects typed results.
 * templates.ts: prompt rendering helpers for structured commission prompts.
 */

export { commission, batchCommission } from './commission.js';
export type { Commission, CommissionMetadata, BridgeParams } from './commission.js';
export * from './templates.js';
