// SPDX-License-Identifier: Apache-2.0
/**
 * @methodts/pacta-provider-cortex — Cortex service adapters for Pacta.
 *
 * Public surface (PRD-059 §5.1):
 *   - cortexLLMProvider            — AgentProvider over ctx.llm (PRD-068)
 *   - cortexAuditMiddleware        — event → ctx.audit mapping (PRD-065)
 *   - cortexTokenExchangeMiddleware — RFC-8693 exchange + depth cap (PRD-061 / RFC-005 §4.1.5)
 *   - CortexServiceAdapter<> pattern (shared shape; S3 §1)
 *
 * This package is the single seam between `@methodts/pacta` and
 * `@t1/cortex-sdk` — gate `G-CORTEX-ONLY-PATH` forbids any other
 * source from importing the SDK (allow-list: ctx-types.ts).
 */

// Shared adapter pattern (S3 §1)
export {
  CortexAdapterComposeError,
  type CortexServiceAdapter,
  type ComposedAdapter,
  type CtxSlice,
} from './adapter.js';

// LLM provider (S3 §2)
export { cortexLLMProvider } from './llm-provider.js';
export type {
  CortexLLMProviderConfig,
  CortexLLMProviderAdapter,
  ComposedCortexLLMProvider,
  TierFromEffortFn,
} from './llm-provider.js';

// Audit middleware (S3 §3)
export {
  cortexAuditMiddleware,
  AUDIT_EVENT_MAP,
} from './audit-middleware.js';
export type {
  CortexAuditMiddlewareConfig,
  CortexAuditMiddlewareAdapter,
  ComposedCortexAuditMiddleware,
  AuditMappingEntry,
} from './audit-middleware.js';

// Token-exchange middleware (S3 §5)
export {
  cortexTokenExchangeMiddleware,
  MAX_DELEGATION_DEPTH,
  CortexDelegationDepthExceededError,
  CortexSubjectUnauthorizedError,
  CortexScopeEscalationError,
  parseActChain,
} from './token-exchange-middleware.js';
export type {
  CortexTokenExchangeConfig,
  CortexTokenExchangeMiddlewareAdapter,
  ComposedCortexTokenExchangeMiddleware,
} from './token-exchange-middleware.js';

// Narrow re-declaration of Cortex SDK shapes (the single seam)
export type {
  LlmTier,
  BudgetStatus,
  CompletionRequest,
  CompletionResult,
  StructuredResult,
  EmbeddingResult,
  LlmBudgetHandlers,
  CortexLlmCtx,
  AuditEvent,
  CortexAuditCtx,
  ActAsEntry,
  ScopedToken,
  TokenExchangeRequest,
  CortexAuthCtx,
} from './ctx-types.js';
