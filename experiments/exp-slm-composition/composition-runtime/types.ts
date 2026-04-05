/**
 * CLM Composition Runtime — Port Interfaces
 *
 * Defines the contracts for pipeline stages, validation gates, inference
 * backends, and metrics. All pipeline components implement these interfaces.
 *
 * See: docs/arch/composition-runtime.md
 */

// ── Pipeline Context ─────────────────────────────────────────

/** Metadata and accumulated state carried through a pipeline execution. */
export interface PipelineContext {
  readonly runId: string;
  readonly pipelineId: string;
  readonly originalInput: string;
  readonly metadata: Record<string, unknown>;
  /** Accumulated state from gates/stages (e.g., compiled parsers). */
  readonly state: ReadonlyMap<string, unknown>;
}

// ── Stage Port ───────────────────────────────────────────────

export interface StageInput {
  /** The data to process. String for SLM text, structured for deterministic. */
  readonly data: string;
  /** Metadata carried through the pipeline. */
  readonly context: PipelineContext;
}

export interface StageOutput {
  /** The stage's output data. */
  readonly data: string;
  /** Confidence score (0-1). SLM stages report model confidence; deterministic = 1.0. */
  readonly confidence: number;
  /** Latency of this stage in ms. */
  readonly latencyMs: number;
  /** Optional state entries to add to PipelineContext.state. */
  readonly stateUpdates?: ReadonlyMap<string, unknown>;
}

/**
 * A single stage in a CLM pipeline. Either an SLM inference call,
 * a deterministic transform, or a sub-CLM.
 */
export interface StagePort {
  readonly id: string;
  readonly type: 'slm' | 'deterministic' | 'clm';
  execute(input: StageInput): Promise<StageOutput>;
}

// ── Gate Port ────────────────────────────────────────────────

export interface GateInput {
  /** The output from the preceding stage. */
  readonly data: string;
  /** The expected format/schema (optional — some gates are format-agnostic). */
  readonly schema?: unknown;
  /** Pipeline context for stateful gates. */
  readonly context: PipelineContext;
}

export interface GateResult {
  readonly pass: boolean;
  /** Why it failed (for logging/debugging). */
  readonly reason?: string;
  /** Parsed/validated data (gates may transform on pass). */
  readonly validatedData?: unknown;
  /** Optional state entries to add to PipelineContext.state. */
  readonly stateUpdates?: ReadonlyMap<string, unknown>;
}

/**
 * A validation gate between pipeline stages.
 * Returns pass/fail + reason. Pipeline runtime decides retry/escalate.
 */
export interface GatePort {
  readonly id: string;
  validate(input: GateInput): Promise<GateResult>;
}

// ── Inference Port ───────────────────────────────────────────

/**
 * Backend-agnostic SLM inference. Wraps Ollama, ONNX, HTTP bridge, or
 * pre-generated predictions.
 */
export interface InferencePort {
  readonly modelId: string;
  generate(input: string): Promise<InferenceResult>;
}

export interface InferenceResult {
  readonly output: string;
  readonly confidence: number;
  readonly latencyMs: number;
}

// ── Pipeline Definition ──────────────────────────────────────

export interface FailurePolicy {
  /** Max retries before escalation. */
  readonly maxRetries: number;
  /** Escalation strategy when retries exhausted. */
  readonly escalation: 'abort' | 'skip' | 'frontier';
  /** Frontier LLM fallback config (if escalation = 'frontier'). */
  readonly frontierConfig?: {
    readonly provider: string;
    readonly model: string;
    readonly prompt: string;
  };
}

export type PipelineStep =
  | { readonly type: 'stage'; readonly stage: StagePort }
  | { readonly type: 'gate'; readonly gate: GatePort; readonly onFail: FailurePolicy }
  | { readonly type: 'competitive'; readonly candidates: readonly StagePort[]; readonly selector: GatePort };

/**
 * Competitive composition (A ⊕ B): run N candidate stages in parallel,
 * validate each through the selector gate, pick the first that passes.
 * Falls back to highest-confidence candidate if none pass.
 */

export interface PipelineDefinition {
  readonly id: string;
  readonly stages: readonly PipelineStep[];
}

// ── Metrics ──────────────────────────────────────────────────

export interface StageMetrics {
  readonly stageId: string;
  readonly latencyMs: number;
  readonly confidence: number;
  readonly retryCount: number;
  readonly escalated: boolean;
  readonly escalationTarget?: string;
}

export interface GateMetrics {
  readonly gateId: string;
  readonly pass: boolean;
  readonly reason?: string;
}

export interface PipelineMetrics {
  readonly pipelineId: string;
  readonly totalLatencyMs: number;
  readonly stages: readonly StageMetrics[];
  readonly gates: readonly GateMetrics[];
  readonly gatePassRate: number;
  readonly escalationRate: number;
  readonly endToEndSuccess: boolean;
}

export interface AggregateMetrics {
  readonly totalRuns: number;
  readonly successRate: number;
  readonly gateEffectiveness: number;
  readonly meanLatencyMs: number;
  readonly escalationRate: number;
}

// ── Pipeline Result ──────────────────────────────────────────

export interface PipelineResult {
  readonly success: boolean;
  readonly data: string;
  readonly metrics: PipelineMetrics;
  readonly error?: string;
}
