/**
 * Cognitive Module — the fundamental type of the cognitive composition algebra.
 *
 * A cognitive module M = (I, O, S, mu, kappa) with step: (I, S, kappa) -> (O, S', mu).
 * This is the atomic unit of cognitive composition. Modules compose via operators
 * (sequential, parallel, competitive, hierarchical) defined elsewhere.
 *
 * Grounded in: ACT-R buffer-mediated parallelism, Nelson & Narens monitor/control,
 * GWT competitive workspace access. See docs/rfcs/001-cognitive-composition.md.
 */

// ── Branded Types ────────────────────────────────────────────────

/** Branded string identifying a cognitive module instance. */
export type ModuleId = string & { readonly __brand: 'ModuleId' };

/** Create a ModuleId from a plain string. */
export function moduleId(id: string): ModuleId {
  return id as ModuleId;
}

// ── Monitoring Signals ───────────────────────────────────────────

/** Base monitoring signal — all per-module signals extend this. */
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
  tokensThisStep?: number;  // actual tokens consumed by this LLM invocation (undefined in test stubs)
}

/** Actor monitoring: action outcome tracking. */
export interface ActorMonitoring extends MonitoringSignal {
  type: 'actor';
  actionTaken: string;
  success: boolean;
  unexpectedResult: boolean;
}

/** Reasoner-Actor (merged) monitoring: combined reasoning + action outcome. */
export interface ReasonerActorMonitoring extends MonitoringSignal {
  type: 'reasoner-actor';
  actionTaken: string;
  success: boolean;
  unexpectedResult: boolean;
  tokensThisStep: number;
  confidence: number;
  declaredPlanAction: string;
}

/** Observer monitoring: input processing status. */
export interface ObserverMonitoring extends MonitoringSignal {
  type: 'observer';
  inputProcessed: boolean;
  noveltyScore: number;
}

/** Memory monitoring: retrieval performance. */
export interface MemoryMonitoring extends MonitoringSignal {
  type: 'memory';
  retrievalCount: number;
  relevanceScore: number;
}

/** Monitor monitoring: meta-level escalation and anomaly detection. */
export interface MonitorMonitoring extends MonitoringSignal {
  type: 'monitor';
  escalation?: string;
  anomalyDetected: boolean;
}

/** Evaluator monitoring: progress estimation. */
export interface EvaluatorMonitoring extends MonitoringSignal {
  type: 'evaluator';
  estimatedProgress: number;
  diminishingReturns: boolean;
}

/** Planner monitoring: plan revision tracking. */
export interface PlannerMonitoring extends MonitoringSignal {
  type: 'planner';
  planRevised: boolean;
  subgoalCount: number;
}

/** Reflector monitoring: lesson extraction. */
export interface ReflectorMonitoring extends MonitoringSignal {
  type: 'reflector';
  lessonsExtracted: number;
}

/** Discriminated union of all per-module monitoring signal types. */
export type ModuleMonitoringSignal =
  | ReasonerMonitoring
  | ActorMonitoring
  | ReasonerActorMonitoring
  | ObserverMonitoring
  | MemoryMonitoring
  | MonitorMonitoring
  | EvaluatorMonitoring
  | PlannerMonitoring
  | ReflectorMonitoring
  | GoalDiscrepancy
  | TerminateSignal;

// Re-export goal-state types into the monitoring signal namespace (PRD 045)
import type { GoalDiscrepancy, TerminateSignal } from './goal-types.js';
export type { GoalDiscrepancy, TerminateSignal };

/** Aggregated monitoring signals from all modules in a cycle. */
export type AggregatedSignals = Map<ModuleId, MonitoringSignal>;

// ── Control Directives ───────────────────────────────────────────

/** Base control directive — issued by meta-level to object-level. */
export interface ControlDirective {
  target: ModuleId;
  timestamp: number;
}

// ── Step Result ──────────────────────────────────────────────────

/** Trace record reference — full definition in trace.ts. */
import type { TraceRecord } from './trace.js';

/** Error produced by a module step. Explicit error channel. */
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
  trace?: TraceRecord;
}

// ── The Cognitive Module ─────────────────────────────────────────

/**
 * CognitiveModule — a typed contract for a single cognitive processing unit.
 *
 * @typeParam I     Input type — what the module reads
 * @typeParam O     Output type — what the module produces
 * @typeParam S     State type — private, opaque to other modules
 * @typeParam Mu    Monitoring signal type — what the module reports upward
 * @typeParam Kappa Control directive type — what the module accepts from above
 */
export interface CognitiveModule<
  I,
  O,
  S,
  Mu extends MonitoringSignal,
  Kappa extends ControlDirective,
> {
  readonly id: ModuleId;

  /**
   * PRD 045 — type-driven context binding.
   *
   * When present, the cycle orchestrator uses TypeResolver to map the declared
   * entry types to partitions and builds context from those partitions only.
   * When absent, falls back to DEFAULT_MODULE_SELECTORS (backward compatible).
   */
  contextBinding?: import('./partition-types.js').ModuleContextBinding;

  step(input: I, state: S, control: Kappa): Promise<StepResult<O, S, Mu>>;
  initialState(): S;
  stateInvariant?(state: S): boolean;
}

// ── Module Working Memory (RFC 005) ─────────────────────────────

/**
 * Per-module working memory — the W in Module :: (I, S, W, κ) → (O, S, W, μ).
 *
 * Each cognitive module may maintain a bounded private workspace that persists
 * across cycles, independent of shared workspace eviction. This creates algebraic
 * closure: every module has the same structure, and composition operators can
 * reason about working memory uniformly.
 *
 * Grounded in Baddeley's working memory model (2000): the central executive
 * maintains task-relevant representations independent of the sensory input stream.
 *
 * **Design:** W is embedded in S (the state is already opaque and generic).
 * The module includes workingMemory entries in its state, and the orchestrator
 * injects them into the module's input alongside the shared workspace snapshot.
 *
 * @see docs/rfcs/005-anticipatory-monitoring.md — §Module Working Memory
 */

import type { WorkspaceEntry } from './workspace-types.js';

/** Configuration for a module's working memory. */
export interface WorkingMemoryConfig {
  /** Maximum entries the module can hold in working memory. */
  capacity: number;
  /** Whether this module's working memory should be included in its prompt context. */
  includeInContext: boolean;
}

/**
 * Working memory state — included in a module's S type.
 *
 * The module reads from `entries` at the start of each step and may
 * return updated entries in its new state. The orchestrator is responsible
 * for injecting these into the module's input (typically prepended to
 * the shared workspace snapshot).
 */
export interface ModuleWorkingMemory {
  /** The module's private working memory entries. */
  entries: WorkspaceEntry[];
  /** Configuration (capacity, context inclusion). */
  config: WorkingMemoryConfig;
}

/**
 * Create an initial empty working memory with the given config.
 */
export function createWorkingMemory(config: WorkingMemoryConfig): ModuleWorkingMemory {
  return { entries: [], config };
}

/**
 * Update working memory: replace entries, enforcing capacity limit.
 * Newest entries are kept (FIFO eviction from front).
 */
export function updateWorkingMemory(
  wm: ModuleWorkingMemory,
  newEntries: WorkspaceEntry[],
): ModuleWorkingMemory {
  const entries = newEntries.length > wm.config.capacity
    ? newEntries.slice(-wm.config.capacity)
    : newEntries;
  return { ...wm, entries };
}

// ── Composition Error ────────────────────────────────────────────

/** Error thrown when composition operators detect invalid configurations at runtime. */
export class CompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompositionError';
  }
}
