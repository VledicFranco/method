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
  WorkspaceEntry,
  WorkspaceFilter,
  ReadonlyWorkspaceSnapshot,
  WorkspaceReadPort,
  WorkspaceWritePort,
  SalienceFunction,
  SalienceContext,
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
} from './events.js';

// ── Provider adapter ─────────────────────────────────────────────

export type {
  ProviderAdapter,
  AdapterConfig,
  ProviderAdapterResult,
} from './provider-adapter.js';

export { createProviderAdapter } from './provider-adapter.js';
