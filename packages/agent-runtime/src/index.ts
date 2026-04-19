// SPDX-License-Identifier: Apache-2.0
/**
 * `@methodts/agent-runtime` — Cortex-targeted public API (PRD-058 / S1).
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
 *     from `@methodts/pacta` directly)
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
  CortexEventsCtx,
  CortexStorageFacade,
  CortexJobsFacade,
  CortexScheduleFacade,
  CortexAuthFacade,
  CortexLogger,
  MethodTopicDescriptor,
  EventClassificationLevel,
  EventFieldClassification,
  RuntimeEventAuditMapping,
} from './cortex/ctx-types.js';
export { assertCtxCompatibility } from './cortex/assert-ctx-compatibility.js';

// ── CortexEventConnector (PRD-063 / S6) ──────────────────────────
export {
  CortexEventConnector,
  wrapPublishAsEmit,
} from './cortex/event-connector.js';
export type {
  CortexEventConnectorConfig,
  CortexEventConnectorDeps,
} from './cortex/event-connector.js';
export {
  METHOD_TOPIC_REGISTRY,
  METHOD_TOPIC_COUNT,
  METHOD_RUNTIME_EVENT_AUDIT_MAP,
  RUNTIME_EVENT_TYPE_TO_TOPIC,
} from './cortex/event-topic-registry.js';
export {
  mapRuntimeEventToEnvelope,
  mapRuntimeEventOrThrow,
  METHOD_AUDIT_ONLY_RUNTIME_EVENT_TYPES,
} from './cortex/event-envelope-mapper.js';
export type {
  CortexEnvelope,
  EnvelopeMapResult,
  EnvelopeMapperConfig,
  MapOutcome,
} from './cortex/event-envelope-mapper.js';
export {
  generateManifestEmitSection,
  emitEntriesToYaml,
} from './cortex/manifest-emit-section.js';
export type {
  ManifestEmitEntry,
  ManifestEmitOptions,
  ManifestEmitClassification,
} from './cortex/manifest-emit-section.js';

// ── Cortical workspace (PRD-068 / S10 + S11) ─────────────────────
export {
  CORTICAL_WORKSPACE_TOPICS,
  CORTICAL_WORKSPACE_HEARTBEAT_INTERVAL_MS,
  CORTICAL_WORKSPACE_HEARTBEAT_CRON,
  CORTICAL_WORKSPACE_IMPLICIT_OFFLINE_MS,
  WAVE_1_MODULE_ROLES,
  cognitiveEmitTopics,
  cognitiveSubscribeTopics,
  createWorkspaceEventEmitter,
  generateCortexCognitiveEmitSection,
  withCorticalWorkspaceMembership,
} from './cortex/cortical-workspace.js';
export type {
  ModuleRole,
  ManifestOnEntry,
  ModuleOnlinePayload,
  ModuleOfflinePayload,
  CorticalWorkspaceMembershipOptions,
  CorticalWorkspaceMembershipHandle,
  WorkspaceEventEmitter,
} from './cortex/cortical-workspace.js';

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
  SchemaDefinition,
  SchemaResult,
  ScopeContract,
  ContextPolicy,
  ReasoningPolicy,
  TokenUsage,
  CostReport,
  RecoveryIntent,
  AgentProvider,
} from '@methodts/pacta';

// ── PRD-062 / S5 re-exports — JobBackedExecutor + ScheduledPact ──
// Tenant apps consume these symbols from @methodts/agent-runtime rather
// than deep-importing @methodts/runtime/* (S5 §7 consumer-facing surface).
export { ScheduledPact, isScheduledPactPayload } from '@methodts/runtime/scheduling';
export type {
  ScheduleOptions,
  ScheduledPactPayload,
  ScheduleBindOptions,
} from '@methodts/runtime/scheduling';
export type {
  JobBackedExecutor,
  JobClient,
  JobHandlerCtx,
  PactFactory,
  PactStartInput,
  ContinuationEnvelope,
  CheckpointRef,
  BudgetRef,
  BudgetCarryStrategy,
  TokenContext,
  ContinuationNextAction,
  DlqObserver,
  DlqRecord,
  ScheduleClient,
} from '@methodts/runtime/ports';
export {
  EnvelopeVersionError,
  BudgetExpiredError,
  ENVELOPE_SIZE_SOFT_CAP_BYTES,
  parseContinuationEnvelope,
  DuplicateAttachError,
  PactRegistrationError,
  BudgetStrategyNotImplemented,
} from '@methodts/runtime/ports';
export type { PactDeadLetterEvent } from '@methodts/pacta';

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
} from '@methodts/pacta';
