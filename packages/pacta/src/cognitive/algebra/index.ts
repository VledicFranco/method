/**
 * Cognitive Algebra — barrel export.
 *
 * Pure types, composition operators, workspace types, and provider adapter.
 * Zero awareness of specific module implementations.
 */

// ── Module types ─────────────────────────────────────────────────

export type {
  ModuleId,
  MonitoringSignal,
  ReasonerMonitoring,
  ActorMonitoring,
  ReasonerActorMonitoring,
  ObserverMonitoring,
  MemoryMonitoring,
  MonitorMonitoring,
  EvaluatorMonitoring,
  PlannerMonitoring,
  ReflectorMonitoring,
  ModuleMonitoringSignal,
  AggregatedSignals,
  ControlDirective,
  StepError,
  StepResult,
  CognitiveModule,
} from './module.js';

export { moduleId, CompositionError } from './module.js';

// ── Workspace types ──────────────────────────────────────────────

export type {
  EntryContentType,
  WorkspaceEntry,
  WorkspaceFilter,
  ReadonlyWorkspaceSnapshot,
  WorkspaceReadPort,
  WorkspaceWritePort,
  SalienceFunction,
  SalienceContext,
  SelectionOutcome,
  WorkspaceConfig,
} from './workspace-types.js';

// ── Trace types ──────────────────────────────────────────────────

export type { TraceRecord, TraceSink } from './trace.js';

// ── Control policy ───────────────────────────────────────────────

export type { ControlPolicy, ControlPolicyViolation } from './control-policy.js';

// ── Cognitive events ─────────────────────────────────────────────

export type {
  CognitiveEvent,
  CognitiveModuleStep,
  CognitiveMonitoringSignal,
  CognitiveControlDirective,
  CognitiveControlPolicyViolation,
  CognitiveWorkspaceWrite,
  CognitiveWorkspaceEviction,
  CognitiveCyclePhase,
  CognitiveLEARNFailed,
  CognitiveCycleAborted,
  CognitiveConstraintPinned,
  CognitiveConstraintViolation,
  CognitiveMonitorDirectiveApplied,
} from './events.js';

// ── Provider adapter ─────────────────────────────────────────────

export type {
  ProviderAdapter,
  AdapterConfig,
  ProviderAdapterResult,
} from './provider-adapter.js';

export { createProviderAdapter } from './provider-adapter.js';

// ── Composition operators ───────────────────────────────────────

export {
  sequential,
  parallel,
  competitive,
  hierarchical,
} from './composition.js';

export type {
  ComposedMonitoring,
  ComposedControl,
  HierarchicalState,
  ParallelSideResult,
  ParallelMerge,
  ParallelErrorMerge,
  CompetitiveSelectorState,
  CompetitiveSelector,
} from './composition.js';

// ── Tower ───────────────────────────────────────────────────────

export { tower, validateTowerDepth, MAX_TOWER_DEPTH } from './tower.js';

// ── Workspace engine ────────────────────────────────────────────

export {
  createWorkspace,
  defaultSalienceFunction,
  recencyScore,
  sourcePriority,
  goalOverlap,
} from './workspace.js';

export type {
  WorkspaceManager,
  EvictionInfo,
  WriteLogEntry,
} from './workspace.js';

// ── Trace sinks ─────────────────────────────────────────────────

export { InMemoryTraceSink, ConsoleTraceSink } from './trace-sinks.js';

// ── Enriched signals (PRD 035 — v2 modules) ────────────────────

export type {
  MetacognitiveJudgment,
  EnrichedMonitoringSignal,
  ModuleExpectation,
  MonitorV2State,
  MonitorV2Config,
  ImpasseType,
  ImpasseSignal,
  ReasonerActorV2Monitoring,
  ReasonerActorV2Config,
  PriorityScore,
  PriorityAttendConfig,
  EVCConfig,
} from './enriched-signals.js';

// ── Precision adapter (PRD 035 — effort allocation) ────────────

export type {
  PrecisionConfig,
  PrecisionAdapterConfig,
  PrecisionProviderAdapter,
} from './precision-adapter.js';

export { precisionToConfig, createPrecisionAdapter } from './precision-adapter.js';
