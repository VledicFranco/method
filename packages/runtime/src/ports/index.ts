// PRD-057 / S2 §3.1: @method/runtime/ports — unified public port surface.

// ── File system / YAML / native discovery (interfaces only; Node impls in bridge) ──
export type { FileSystemProvider, DirEntry, FileStat } from './file-system.js';
export type { YamlLoader } from './yaml-loader.js';
export type { NativeSessionDiscovery, NativeSessionInfo } from './native-session-discovery.js';

// ── Methodology source + in-memory test double ──
export type { MethodologySource } from './methodology-source.js';
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
