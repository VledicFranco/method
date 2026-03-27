/**
 * Cognitive Module — the fundamental type of the cognitive composition algebra.
 *
 * A cognitive module M = (I, O, S, mu, kappa) with step: (I, S, kappa) -> (O, S', mu).
 * This is the atomic unit of cognitive composition. Modules compose via operators
 * (sequential, parallel, competitive, hierarchical) defined elsewhere.
 *
 * Grounded in: ACT-R buffer-mediated parallelism, Nelson & Narens monitor/control,
 * GWT competitive workspace access. See docs/rfcs/rfc-cognitive-composition.md.
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
}

/** Actor monitoring: action outcome tracking. */
export interface ActorMonitoring extends MonitoringSignal {
  type: 'actor';
  actionTaken: string;
  success: boolean;
  unexpectedResult: boolean;
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
  | ObserverMonitoring
  | MemoryMonitoring
  | MonitorMonitoring
  | EvaluatorMonitoring
  | PlannerMonitoring
  | ReflectorMonitoring;

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
  step(input: I, state: S, control: Kappa): Promise<StepResult<O, S, Mu>>;
  initialState(): S;
  stateInvariant?(state: S): boolean;
}

// ── Composition Error ────────────────────────────────────────────

/** Error thrown when composition operators detect invalid configurations at runtime. */
export class CompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompositionError';
  }
}
