/**
 * DagGateEvaluator — Port interface for strategy DAG gate evaluation.
 *
 * The existing gate/gate.ts has typed Gate<S> for methodology use.
 * Strategy uses DagGateConfig with expression-based evaluation.
 * These two models are intentionally separate (PRD 046 review F-S-001):
 * typed Gate<S> requires a state type parameter, DagGateConfig operates
 * on stringly-typed context bags. Merging erases the type parameter.
 *
 * This port extracts strategy-specific gate evaluation so the strategy
 * executor doesn't own gate logic directly.
 *
 * @see PRD 046 §Surfaces — DagGateEvaluator
 * @see strategy/dag-types.ts — DagGateConfig, DagGateContext, DagGateResult
 */

// ── Port interface ──

/**
 * Port for evaluating strategy DAG gates.
 *
 * Owner: methodts/gate
 * Consumer: methodts/strategy (dag-executor)
 *
 * The interface matches the existing evaluateGate() signature exactly.
 * One method — no speculative additions.
 */
export interface DagGateEvaluator {
  /** Evaluate a single DAG gate against its context. */
  evaluate(
    gate: DagGateConfig,
    gateId: string,
    context: DagGateContext,
    resolver?: HumanApprovalResolver,
    approvalCtx?: HumanApprovalContext,
  ): Promise<DagGateResult>;
}

// ── Re-exported types from strategy (consumed, not owned) ──
// These are type-only imports — no runtime dependency on strategy module.

/** Strategy gate configuration — from dag-types.ts */
export interface DagGateConfig {
  readonly type: 'algorithmic' | 'observation' | 'human_approval';
  readonly check: string;
  readonly max_retries: number;
  readonly timeout_ms: number;
}

/** Context provided to gate evaluation — from dag-types.ts */
export interface DagGateContext {
  readonly output: Record<string, unknown>;
  readonly artifacts: Record<string, unknown>;
  readonly execution_metadata: {
    readonly num_turns: number;
    readonly cost_usd: number;
    readonly tool_call_count: number;
    readonly duration_ms: number;
  };
}

/** Result of evaluating a DAG gate — from dag-types.ts */
export interface DagGateResult {
  readonly passed: boolean;
  readonly detail: string;
  readonly expression_result?: unknown;
}

/** Resolver for human approval gates. */
export interface HumanApprovalResolver {
  requestApproval(ctx: HumanApprovalContext): Promise<{ approved: boolean; feedback?: string }>;
}

/** Context for human approval requests. */
export interface HumanApprovalContext {
  readonly execution_id: string;
  readonly gate_id: string;
  readonly artifact_markdown?: string;
  readonly timeout_ms: number;
}
