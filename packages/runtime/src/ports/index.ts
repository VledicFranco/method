// PRD-057 / S2 §3.1: @method/runtime/ports — unified public port surface.

// ── File system / YAML / native discovery (interfaces only; Node impls in bridge) ──
export type { FileSystemProvider, DirEntry, FileStat } from './file-system.js';
export type { YamlLoader } from './yaml-loader.js';
export type { NativeSessionDiscovery, NativeSessionInfo } from './native-session-discovery.js';

// ── Methodology source + in-memory test double ──
export type { MethodologySource, MethodologyChange } from './methodology-source.js';
export { InMemorySource } from './in-memory-source.js';

// ── Event bus ──
export type {
  EventBus,
  EventSink,
  EventConnector,
  EventFilter,
  EventSubscription,
  ConnectorHealth,
  RuntimeEvent,
  RuntimeEventInput,
  EventDomain,
  EventSeverity,
  StrategyGateAwaitingApprovalPayload,
  StrategyGateApprovalResponsePayload,
} from './event-bus.js';

// ── Session pool + SessionProviderFactory (S2 §6) ──
export type {
  SessionBudget,
  SessionChainInfo,
  SessionMode,
  IsolationMode,
  WorktreeAction,
  WorktreeInfo,
  SessionStatusInfo,
  SessionSnapshot,
  StreamEvent,
  PtySessionHandle,
  SessionProviderOptions,
  SessionProviderFactory,
} from './session-pool.js';

// ── Cost governor ports (PRD 051) ──
export type { CostOracle, NodeEstimate, StrategyEstimate } from './cost-oracle.js';
export type { RuntimeRateGovernor } from './rate-governor.js';
export type { HistoricalObservations, Observation, AppendToken } from './historical-observations.js';
export { createAppendToken } from './historical-observations.js';

// ── Build orchestrator ports (PRD 047) ──
export type {
  CheckpointPort,
  PipelineCheckpoint,
  PipelineCheckpointSummary,
  Phase,
  FeatureSpec,
  TestableAssertion,
  ConversationMessage,
} from './checkpoint.js';
export type {
  ConversationPort,
  AgentMessage,
  HumanMessage,
  GateDecision,
  GateType,
  SkillRequest,
  StructuredCard,
} from './conversation.js';
export { GATE_ACTIONS } from './conversation.js';

// ── Projection-based persistence ports ──
export type { Projection } from './projection.js';
export type { ProjectionStore, StartResult } from './projection-store.js';
export type { EventReader } from './event-reader.js';
export type { EventRotator, RotateOptions, RotateResult } from './event-rotator.js';

// ── Session store (PRD-061 / S4) ──
// NOTE: `SessionSnapshot` is re-exported under `PersistedSessionSnapshot` to
// avoid a name clash with `./session-pool.js`'s runtime snapshot type. Deep
// import from `./session-store-types.js` when the original name is needed.
export type { SessionStore } from './session-store.js';
export type {
  SessionStatus,
  PactRef,
  SessionSnapshot as PersistedSessionSnapshot,
  EventCursor,
  AgentStateBlob,
  BudgetReservation,
  NextAction,
  Checkpoint,
  CheckpointMeta,
  ResumeOptions,
  ResumeContext,
} from './session-store-types.js';
export type {
  SessionStoreErrorCode,
  SessionStoreErrorOptions,
} from './session-store-errors.js';
export {
  SessionStoreError,
  isSessionStoreError,
} from './session-store-errors.js';
export type {
  CheckpointSink,
  CheckpointSinkOptions,
  CheckpointCapture,
} from './checkpoint-sink.js';

// ── Job-backed executor + continuation envelope (PRD-062 / S5) ──
// NOTE: `NextAction` from `./continuation-envelope.js` is intentionally
// NOT re-exported here — it collides with the S4 `NextAction` (checkpoint
// resume hint) above. Consumers import the envelope-scoped variant via
// `@method/runtime/ports/continuation-envelope` directly, or as
// `ContinuationNextAction` below.
export type {
  ContinuationEnvelope,
  CheckpointRef,
  BudgetRef,
  BudgetCarryStrategy,
  TokenContext,
  CrossAppContinuationContext,
  NextAction as ContinuationNextAction,
} from './continuation-envelope.js';
export {
  EnvelopeVersionError,
  BudgetExpiredError,
  ENVELOPE_SIZE_SOFT_CAP_BYTES,
  parseContinuationEnvelope,
} from './continuation-envelope.js';
export type {
  JobBackedExecutor,
  JobClient,
  JobHandlerCtx,
  PactFactory,
  PactStartInput,
} from './job-backed-executor.js';
export {
  DuplicateAttachError,
  PactRegistrationError,
  BudgetStrategyNotImplemented,
} from './job-backed-executor.js';
export type {
  DlqObserver,
  DlqRecord,
} from './dlq-observer.js';
export type { ScheduleClient } from './schedule-client.js';

// ── Cross-app invoker (PRD-067) ──
export type {
  CrossAppInvoker,
  CrossAppInvokeRequest,
  CrossAppInvokeResult,
  CrossAppInvokerCapabilities,
  DelegationCarry,
} from './cross-app-invoker.js';
export {
  CrossAppNotConfiguredError,
  CrossAppTargetNotDeclaredError,
  CrossAppScopeMissingError,
  CrossAppDelegationDepthExceededError,
  CrossAppTargetError,
  CrossAppTargetUnknownError,
  NullCrossAppInvoker,
  CROSS_APP_DEFAULT_MAX_DELEGATION_DEPTH,
  assertCrossAppTargetsAllowed,
} from './cross-app-invoker.js';
