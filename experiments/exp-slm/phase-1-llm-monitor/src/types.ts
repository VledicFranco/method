/**
 * Local type aliases mirroring @method/pacta cognitive algebra types.
 *
 * Duplicated here because the experiment lives outside monorepo workspaces.
 * These are intentionally minimal and match the shapes consumed/produced
 * by the Monitor module in packages/pacta/src/cognitive/modules/monitor.ts.
 */

// ── Branded Types ───────────────────────────────────────────────

/** Branded string identifying a cognitive module instance. */
export type ModuleId = string & { readonly __brand: 'ModuleId' };

/** Create a ModuleId from a plain string. */
export function moduleId(id: string): ModuleId {
  return id as ModuleId;
}

// ── Monitoring Signals ──────────────────────────────────────────

/** Base monitoring signal. */
export interface MonitoringSignal {
  source: ModuleId;
  timestamp: number;
}

/** Reasoner monitoring: confidence tracking and conflict detection. */
export interface ReasonerMonitoring extends MonitoringSignal {
  type: 'reasoner';
  confidence: number;
  conflictDetected: boolean;
  effortLevel: string;
  tokensThisStep?: number;
}

/** Actor monitoring: action outcome tracking. */
export interface ActorMonitoring extends MonitoringSignal {
  type: 'actor';
  actionTaken: string;
  success: boolean;
  unexpectedResult: boolean;
}

/** Monitor monitoring: meta-level escalation and anomaly detection. */
export interface MonitorMonitoring extends MonitoringSignal {
  type: 'monitor';
  escalation?: string;
  anomalyDetected: boolean;
}

/** Aggregated monitoring signals from all modules in a cycle. */
export type AggregatedSignals = Map<ModuleId, MonitoringSignal>;

// ── Control Directives ──────────────────────────────────────────

/** Base control directive. */
export interface ControlDirective {
  target: ModuleId;
  timestamp: number;
}

/**
 * No-op control type for Monitor — top-level monitor accepts no control directives.
 */
export type NoControl = ControlDirective & { readonly __noControl: never };

// ── Step Result ─────────────────────────────────────────────────

/** Error produced by a module step. */
export interface StepError {
  message: string;
  recoverable: boolean;
  moduleId: ModuleId;
  phase?: string;
}

/** Result of a single module step execution. */
export interface StepResult<O, S, Mu extends MonitoringSignal> {
  output: O;
  state: S;
  monitoring: Mu;
  error?: StepError;
}

// ── Cognitive Module ────────────────────────────────────────────

/** A typed contract for a single cognitive processing unit. */
export interface CognitiveModule<
  I,
  O,
  S,
  Mu extends MonitoringSignal,
  Kappa extends ControlDirective,
> {
  readonly id: ModuleId;
  step(input: I, state: S, control: Kappa): Promise<StepResult<O, S, Mu>>;
  initialState(): S;
  stateInvariant?(state: S): boolean;
}

// ── Monitor Types ───────────────────────────────────────────────

/** Anomaly detected by the monitor. */
export interface Anomaly {
  moduleId: ModuleId;
  type: 'low-confidence' | 'unexpected-result' | 'compound';
  detail: string;
}

/** Output of the Monitor module. */
export interface MonitorReport {
  anomalies: Anomaly[];
  escalation: string | undefined;
  restrictedActions: string[];
  forceReplan: boolean;
}

// ── Provider Adapter ────────────────────────────────────────────

/** Token usage for a provider invocation. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

/** Cost report for a provider invocation. */
export interface CostReport {
  totalUsd: number;
  perModel: Record<string, { tokens: TokenUsage; costUsd: number }>;
}

/** Workspace entry for snapshot construction. */
export interface WorkspaceEntry {
  source: ModuleId;
  content: unknown;
  salience: number;
  timestamp: number;
  ttl?: number;
}

/** Readonly snapshot of workspace state. */
export type ReadonlyWorkspaceSnapshot = ReadonlyArray<Readonly<WorkspaceEntry>>;

/** Configuration for a provider adapter invocation. */
export interface AdapterConfig {
  pactTemplate: Record<string, unknown>;
  systemPrompt?: string;
  abortSignal?: AbortSignal;
}

/** Result of a provider adapter invocation. */
export interface ProviderAdapterResult {
  output: string;
  usage: TokenUsage;
  cost: CostReport;
}

/** Port interface for cognitive modules that need LLM invocation. */
export interface ProviderAdapter {
  invoke(
    workspaceSnapshot: ReadonlyWorkspaceSnapshot,
    config: AdapterConfig,
  ): Promise<ProviderAdapterResult>;
}
