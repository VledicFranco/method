/**
 * Strategy DAG Types — unified type definitions for strategy pipelines.
 *
 * These types represent the internal model for strategy DAGs, unifying
 * the bridge's PRD 017 strategy parser types with the methodts type system.
 *
 * The DAG model supports:
 * - Heterogeneous nodes (methodology + script)
 * - Parallel execution at each topological level
 * - Expression-based gates with retry semantics
 * - Artifact passing between nodes via an immutable versioned store
 * - Oversight rules for cost/duration/failure monitoring
 * - Strategy-level gates evaluated after all nodes complete
 *
 * @see PRD 017 — Strategy Pipelines
 * @see PRD 021 — MethodTS Typed Methodology SDK
 */

// ── Gate Types ──────────────────────────────────────────────────

/** Gate classification determines default retry and timeout behavior. */
export type DagGateType = "algorithmic" | "observation" | "human_approval";

/** Configuration for a single gate check on a DAG node. */
export interface DagGateConfig {
  readonly type: DagGateType;
  /** JavaScript expression evaluated against output/artifacts/execution_metadata */
  readonly check: string;
  readonly max_retries: number;
  readonly timeout_ms: number;
}

/** Context provided to gate expression evaluation. */
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

/** Result of evaluating a single gate. */
export interface DagGateResult {
  readonly gate_id: string;
  readonly type: DagGateType;
  readonly passed: boolean;
  readonly reason: string;
  readonly feedback?: string;
}

// ── Node Types ──────────────────────────────────────────────────

/** Configuration for a methodology node — invokes an LLM agent. */
export interface MethodologyNodeConfig {
  readonly type: "methodology";
  readonly methodology: string;
  readonly method_hint?: string;
  /** PRD-044: Optional prompt injected verbatim before the methodology context in the
   *  agent's prompt. Used by fcd-* strategies to encode phase-level instructions. */
  readonly prompt?: string;
  readonly capabilities: readonly string[];
}

/** Configuration for a script node — runs JS in a sandboxed scope. */
export interface ScriptNodeConfig {
  readonly type: "script";
  readonly script: string;
}

/** PRD-044: Configuration for a strategy sub-invocation node.
 *  Invokes another strategy by ID as a synchronous sub-process and passes its
 *  final artifacts to dependent nodes as this node's output. */
export interface StrategyNodeConfig {
  readonly type: "strategy";
  /** ID of the strategy to invoke (must exist in the strategy source). */
  readonly strategy_id: string;
  /** Maps this node's declared input names to sub-strategy context_input names.
   *  Key: input name as declared in this node's `inputs:` list.
   *  Value: context_input name in the sub-strategy's context.inputs. */
  readonly input_map?: Record<string, string>;
  /** Wait for sub-strategy completion before continuing. Default: true. */
  readonly await?: boolean;
}

/** PRD-046 C-2c: Valid SPL algorithm names for semantic nodes. */
export type SemanticAlgorithm = "explore" | "design" | "implement" | "review";

/** PRD-046 C-2c: Configuration for a semantic node — invokes an SPL algorithm.
 *  Maps context fields to the algorithm's typed input and stores the result
 *  in the strategy context under `output_key`. */
export interface SemanticNodeConfig {
  readonly type: "semantic";
  /** Which SPL algorithm to execute. */
  readonly algorithm: SemanticAlgorithm;
  /** Maps strategy context artifact names to algorithm input field names.
   *  Key: algorithm input field name. Value: artifact name in the strategy context. */
  readonly input_mapping: Record<string, string>;
  /** Artifact key where the algorithm result is stored in the strategy context. */
  readonly output_key: string;
}

/** PRD-044: Result returned by a completed strategy sub-invocation node. */
export interface SubStrategyResult {
  readonly strategy_id: string;
  readonly status: "completed" | "failed";
  readonly artifacts: ArtifactBundle;
  readonly cost_usd: number;
  readonly duration_ms: number;
  readonly error_message?: string;
}

/** PRD-044: Port for looking up a sub-strategy DAG by ID.
 *  Injected into DagStrategyExecutor at construction time.
 *  The bridge wires this with its .method/strategies/ YAML directory loader. */
export interface SubStrategySource {
  getStrategy(id: string): Promise<StrategyDAG | null>;
}

/** PRD-044: Context provided to a HumanApprovalResolver when a human_approval gate fires. */
export interface HumanApprovalContext {
  readonly strategy_id: string;
  readonly execution_id: string;
  readonly gate_id: string;
  readonly node_id: string;
  /** GlyphJS markdown content to display to the human (surface contract, PRD excerpt, etc.). */
  readonly artifact_markdown?: string;
  readonly artifact_type?: 'surface_record' | 'prd' | 'plan' | 'review_report' | 'custom';
  /** Milliseconds to wait before triggering oversight escalation. */
  readonly timeout_ms: number;
}

/** PRD-044: Decision returned by a HumanApprovalResolver. */
export interface HumanApprovalDecision {
  readonly approved: boolean;
  /** Provided when approved:false — passed as retry context to the node. */
  readonly feedback?: string;
}

/** PRD-044: Port for resolving human_approval gates.
 *  Injected into DagStrategyExecutor at construction time.
 *  If null, human_approval gates immediately return passed:false (backward-compat stub).
 *  The bridge wires a concrete BridgeHumanApprovalResolver that emits events and
 *  awaits WebSocket approval_response events. methodts never knows about transport. */
export interface HumanApprovalResolver {
  requestApproval(ctx: HumanApprovalContext): Promise<HumanApprovalDecision>;
}

/** Union of all node configuration types. */
export type NodeConfig =
  | MethodologyNodeConfig
  | ScriptNodeConfig
  | StrategyNodeConfig
  | SemanticNodeConfig;

/** A node in the strategy DAG. */
export interface StrategyNode {
  readonly id: string;
  readonly type: "methodology" | "script" | "strategy" | "semantic";
  readonly depends_on: readonly string[];
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly gates: readonly DagGateConfig[];
  readonly config: MethodologyNodeConfig | ScriptNodeConfig | StrategyNodeConfig | SemanticNodeConfig;
  readonly refresh_context?: boolean;
}

// ── Oversight ───────────────────────────────────────────────────

/** An oversight rule that monitors execution health. */
export interface OversightRule {
  readonly condition: string;
  readonly action: "escalate_to_human" | "warn_human" | "kill_and_requeue";
}

// ── Strategy Gate ───────────────────────────────────────────────

/** A strategy-level gate evaluated after all nodes complete. */
export interface StrategyGateDecl {
  readonly id: string;
  readonly depends_on: readonly string[];
  readonly gate: DagGateConfig;
}

// ── Strategy DAG ────────────────────────────────────────────────

/** The complete parsed strategy DAG. */
export interface StrategyDAG {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly nodes: readonly StrategyNode[];
  readonly strategy_gates: readonly StrategyGateDecl[];
  readonly capabilities: Record<string, readonly string[]>;
  readonly oversight_rules: readonly OversightRule[];
  readonly context_inputs: readonly { name: string; type: string; default?: unknown }[];
}

// ── Raw YAML Types ──────────────────────────────────────────────

/** Raw YAML structure — what the user writes in .method/strategies/*.yaml */
export interface StrategyYaml {
  strategy: {
    id: string;
    name: string;
    version: string;

    triggers?: Array<{ type: string; tool?: string }>;

    context?: {
      inputs?: Array<{ name: string; type: string; default?: unknown }>;
    };

    capabilities?: Record<string, string[]>;

    dag: {
      nodes: Array<{
        id: string;
        type: "methodology" | "script" | "strategy" | "semantic";
        // methodology node fields
        methodology?: string;
        method_hint?: string;
        prompt?: string;
        capabilities?: string[];
        // script node fields
        script?: string;
        // strategy node fields (PRD-044)
        strategy_id?: string;
        input_map?: Record<string, string>;
        await?: boolean;
        // semantic node fields (PRD-046 C-2c)
        algorithm?: SemanticAlgorithm;
        input_mapping?: Record<string, string>;
        output_key?: string;
        // common fields
        inputs?: string[];
        outputs?: string[];
        depends_on?: string[];
        refresh_context?: boolean;
        gates?: Array<{
          type: DagGateType;
          check: string;
          max_retries?: number;
          timeout_ms?: number;
        }>;
      }>;
      strategy_gates?: Array<{
        id: string;
        depends_on: string[];
        type: DagGateType;
        check: string;
        max_retries?: number;
        timeout_ms?: number;
      }>;
    };

    oversight?: {
      rules?: Array<{
        condition: string;
        action: "escalate_to_human" | "warn_human" | "kill_and_requeue";
      }>;
    };

    outputs?: Array<{ type: string; target?: string }>;
  };
}

// ── Validation ──────────────────────────────────────────────────

/** Result of validating a strategy DAG. */
export interface StrategyValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

// ── Artifact Store ──────────────────────────────────────────────

/** A versioned artifact entry. */
export interface ArtifactVersion {
  readonly artifact_id: string;
  readonly version: number;
  readonly content: unknown;
  readonly producer_node_id: string;
  readonly timestamp: string;
}

/** A frozen snapshot of latest artifact versions (keyed by artifact_id). */
export interface ArtifactBundle {
  readonly [artifact_id: string]: ArtifactVersion;
}

/** Immutable versioned store for pipeline artifacts. */
export interface ArtifactStore {
  /** Get the latest version of an artifact, or null if it doesn't exist */
  get(artifact_id: string): ArtifactVersion | null;
  /** Get a specific version (1-indexed), or null if it doesn't exist */
  getVersion(artifact_id: string, version: number): ArtifactVersion | null;
  /** Create a new version of an artifact (never overwrites) */
  put(artifact_id: string, content: unknown, producer: string): ArtifactVersion;
  /** Read-only frozen snapshot of latest versions for passing to nodes */
  snapshot(): ArtifactBundle;
  /** All versions for an artifact, in order */
  history(artifact_id: string): ArtifactVersion[];
}

// ── Execution Types ─────────────────────────────────────────────

/** Status of an individual node during execution. */
export type NodeStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "gate_failed"
  | "suspended";

/** Result of executing a single node. */
export interface NodeResult {
  readonly node_id: string;
  readonly status: NodeStatus;
  readonly output: Record<string, unknown>;
  readonly cost_usd: number;
  readonly duration_ms: number;
  readonly num_turns: number;
  readonly gate_results: readonly DagGateResult[];
  readonly retries: number;
  readonly error?: string;
  readonly side_report?: string;
}

/** An oversight event that was triggered during execution. */
export interface OversightEvent {
  readonly rule: OversightRule;
  readonly triggered_at: string;
  readonly context: Record<string, unknown>;
}

/** Final result of executing a strategy DAG. */
export interface StrategyExecutionResult {
  readonly strategy_id: string;
  readonly status: "completed" | "failed" | "suspended";
  readonly node_results: Record<string, NodeResult>;
  readonly artifacts: ArtifactBundle;
  readonly gate_results: readonly DagGateResult[];
  readonly cost_usd: number;
  readonly started_at: string;
  readonly completed_at: string;
  readonly duration_ms: number;
  readonly oversight_events: readonly OversightEvent[];
}

/** Snapshot of execution state (for status polling). */
export interface ExecutionStateSnapshot {
  readonly strategy_id: string;
  readonly strategy_name: string;
  readonly status: "running" | "completed" | "failed" | "suspended";
  readonly node_status: ReadonlyMap<string, NodeStatus>;
  readonly node_results: ReadonlyMap<string, NodeResult>;
  readonly artifacts: ArtifactBundle;
  readonly gate_results: readonly DagGateResult[];
  readonly cost_usd: number;
  readonly started_at: string;
  readonly completed_at?: string;
  readonly levels: readonly (readonly string[])[];
  readonly oversight_events: readonly OversightEvent[];
}

// ── Executor Configuration ──────────────────────────────────────

/** Configuration for the strategy DAG executor. */
export interface StrategyExecutorConfig {
  readonly maxParallel: number;
  readonly defaultGateRetries: number;
  readonly defaultTimeoutMs: number;
  readonly defaultBudgetUsd?: number;
  readonly retroDir: string;
}

// ── Retro Types ─────────────────────────────────────────────────

/** A strategy execution retrospective. */
export interface StrategyRetro {
  retro: {
    strategy_id: string;
    generated_by: "strategy-executor";
    generated_at: string;
    timing: {
      started_at: string;
      completed_at: string;
      duration_minutes: number;
      critical_path: string[];
    };
    execution_summary: {
      nodes_total: number;
      nodes_completed: number;
      nodes_failed: number;
      speedup_ratio: number;
    };
    cost: {
      total_usd: number;
      per_node: Array<{ node: string; cost_usd: number }>;
    };
    gates: {
      total: number;
      passed: number;
      failed_then_passed: number;
      failed_final: number;
      retries: Array<{
        node: string;
        gate: string;
        attempts: number;
        final: "passed" | "failed";
      }>;
    };
    oversight_events: Array<{
      rule_condition: string;
      action: string;
      triggered_at: string;
    }>;
    artifacts_produced: Array<{ id: string; producer: string }>;
  };
}
