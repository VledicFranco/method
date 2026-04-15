/**
 * `@method/agent-runtime` — Cortex-targeted public API (PRD-058 / S1).
 *
 * Public surface is frozen by co-design record S1 (MethodAgentPort):
 *   - `createMethodAgent<T>(options)` — sync factory producing a `MethodAgent<T>`
 *   - `MethodAgent<T>` handle — invoke / resume / abort / events / dispose
 *   - `MethodAgentResult<T>` — pacta AgentResult<T> + Cortex annotations
 *   - `Resumption` — opaque resumption descriptor (internal payload hidden)
 *   - `CortexCtx` + facades — structural type for the Cortex injection
 *   - `assertCtxCompatibility(ctx)` — opt-in R1 (dual-ctx-drift) guard
 *   - Errors: `ConfigurationError`, `MissingCtxError`, `UnknownSessionError`,
 *     `IllegalStateError`
 *   - Re-exported pacta types + error taxonomy (so tenant apps never import
 *     from `@method/pacta` directly)
 *
 * The internal `ResumptionPayload` is intentionally NOT exported — tenant
 * apps MUST treat `Resumption.opaque` as a black box (S1 Q5).
 */

// ── Factory + handle ─────────────────────────────────────────────
export { createMethodAgent } from './create-method-agent.js';
export type {
  CreateMethodAgentOptions,
  MethodAgent,
  MethodAgentResult,
  Resumption,
} from './create-method-agent.js';

// ── CortexCtx structural seam ────────────────────────────────────
export type {
  CortexCtx,
  CortexAppFacade,
  CortexLlmFacade,
  CortexAuditFacade,
  CortexEventsFacade,
  CortexStorageFacade,
  CortexJobsFacade,
  CortexScheduleFacade,
  CortexAuthFacade,
  CortexLogger,
} from './cortex/ctx-types.js';
export { assertCtxCompatibility } from './cortex/assert-ctx-compatibility.js';

// ── Errors (new taxonomy) ────────────────────────────────────────
export {
  ConfigurationError,
  MissingCtxError,
  UnknownSessionError,
  IllegalStateError,
} from './errors.js';

// ── Session-store adapter (port + default impls) ─────────────────
export type { SessionStoreAdapter } from './session-store-adapter.js';
export {
  InMemorySessionStore,
  CtxStorageSessionStore,
} from './session-store-adapter.js';

// ── Re-exported pacta types (S1 §4.7) ────────────────────────────
export type {
  Pact,
  AgentRequest,
  AgentResult,
  AgentState,
  AgentEvent,
  AgentStarted,
  AgentText,
  AgentThinking,
  AgentToolUse,
  AgentToolResult,
  AgentTurnComplete,
  AgentContextCompacted,
  AgentReflection,
  AgentBudgetWarning,
  AgentBudgetExhausted,
  AgentError,
  AgentCompleted,
  ExecutionMode,
  OneshotMode,
  ResumableMode,
  PersistentMode,
  BudgetContract,
  OutputContract,
  ScopeContract,
  ContextPolicy,
  ReasoningPolicy,
  TokenUsage,
  CostReport,
  RecoveryIntent,
  AgentProvider,
} from '@method/pacta';

// ── Re-exported pacta error taxonomy (S1 §4.6) ───────────────────
export {
  ProviderError,
  TransientError,
  PermanentError,
  RateLimitError,
  NetworkError,
  TimeoutError,
  AuthError,
  InvalidRequestError,
  CliExecutionError,
  CliSpawnError,
  CliAbortError,
  CapabilityError,
  BudgetExhaustedError,
  isProviderError,
  isTransientError,
  isPermanentError,
} from '@method/pacta';
