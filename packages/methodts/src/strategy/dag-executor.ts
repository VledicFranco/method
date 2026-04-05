/**
 * Strategy DAG Executor — core execution engine for Strategy DAGs.
 *
 * Migrated from bridge strategy-executor.ts (PRD 017 Phase 1c).
 * This is now the canonical executor — the bridge delegates to this module.
 *
 * Runs nodes in topological order, parallelizing independent nodes at the
 * same level, evaluating gates with retry-with-feedback, tracking costs,
 * and enforcing oversight rules.
 *
 * Transport-agnostic (DR-03): does not import HTTP, MCP SDK, or socket modules.
 * External dependencies (LLM invocation) are injected via the DagNodeExecutor port.
 *
 * @see PRD 017 — Strategy Pipelines
 * @see DR-03 — Core has zero transport dependencies
 */

import { Effect } from "effect";
import type {
  StrategyDAG,
  StrategyNode,
  MethodologyNodeConfig,
  ScriptNodeConfig,
  StrategyNodeConfig,
  SubStrategySource,
  SubStrategyResult,
  HumanApprovalResolver,
  HumanApprovalContext,
  DagGateConfig,
  DagGateContext,
  DagGateResult,
  NodeStatus,
  NodeResult,
  OversightEvent,
  ArtifactStore,
  ArtifactBundle,
  StrategyExecutionResult,
  ExecutionStateSnapshot,
  StrategyExecutorConfig,
} from "./dag-types.js";
import { createArtifactStore } from "./dag-artifact-store.js";
import { evaluateGate, buildRetryFeedback } from "./dag-gates.js";
import { validateStrategyDAG, topologicalSort } from "./dag-parser.js";
import { executeWithRetry, type RetryExhausted } from "../gate/gate.js";

// ── Node Executor Port ──────────────────────────────────────────

/**
 * Port interface for executing methodology nodes.
 *
 * The DAG executor delegates actual LLM invocation to this port,
 * keeping itself transport-agnostic. The bridge wires a concrete
 * implementation (ClaudeCodeProvider adapter) at the composition root.
 */
export interface DagNodeExecutor {
  /**
   * Execute a methodology node and return its output.
   *
   * @param dag - The full strategy DAG (for context like capabilities)
   * @param node - The node being executed
   * @param config - The methodology node configuration
   * @param inputBundle - Filtered artifact bundle for this node's declared inputs
   * @param sessionId - Session ID for conversation continuity
   * @param retryFeedback - Optional feedback from a failed gate retry
   * @returns Node output, cost, turns, and duration
   */
  executeMethodologyNode(
    dag: StrategyDAG,
    node: StrategyNode,
    config: MethodologyNodeConfig,
    inputBundle: Record<string, unknown>,
    sessionId: string,
    retryFeedback?: string,
  ): Promise<{
    output: Record<string, unknown>;
    cost_usd: number;
    num_turns: number;
    duration_ms: number;
  }>;
}

// ── Execution State ─────────────────────────────────────────────

interface ExecutionState {
  strategy_id: string;
  strategy_name: string;
  status: "running" | "completed" | "failed" | "suspended";
  node_status: Map<string, NodeStatus>;
  node_results: Map<string, NodeResult>;
  artifacts: ArtifactStore;
  gate_results: DagGateResult[];
  cost_usd: number;
  started_at: string;
  completed_at?: string;
  levels: string[][];
  oversight_events: OversightEvent[];
}

// ── Executor ────────────────────────────────────────────────────

export class DagStrategyExecutor {
  private state: ExecutionState | null = null;
  private currentSessionId: string = "";
  /** Tracks strategy IDs currently in the execution chain to detect cycles.
   *  Shared (by reference) across all child executors created for sub-strategies. */
  private executionChain: string[];

  constructor(
    private nodeExecutor: DagNodeExecutor,
    private config: StrategyExecutorConfig,
    private subStrategySource?: SubStrategySource | null,
    private humanApprovalResolver?: HumanApprovalResolver | null,
    /** Internal: shared chain reference for cycle detection across nested executors. */
    sharedChain?: string[],
  ) {
    this.executionChain = sharedChain ?? [];
  }

  /**
   * Execute a Strategy DAG end-to-end.
   *
   * Algorithm:
   * 1. Validate the DAG
   * 2. Initialize execution state with context inputs as initial artifacts
   * 3. Compute topological sort -> levels
   * 4. Execute each level in parallel (respecting maxParallel)
   * 5. Evaluate gates with retry-with-feedback
   * 6. Evaluate oversight rules after each level
   * 7. Run strategy-level gates after all nodes complete
   * 8. Return final result
   */
  async execute(
    dag: StrategyDAG,
    contextInputs: Record<string, unknown>,
  ): Promise<StrategyExecutionResult> {
    // 1. Validate
    const validation = validateStrategyDAG(dag);
    if (!validation.valid) {
      throw new Error(
        `Invalid Strategy DAG: ${validation.errors.join("; ")}`,
      );
    }

    // Cycle detection: check if this strategy is already executing in the chain
    if (this.executionChain.includes(dag.id)) {
      throw new Error(
        `Strategy cycle detected: "${dag.id}" is already in the execution chain [${this.executionChain.join(" -> ")}]`,
      );
    }
    this.executionChain.push(dag.id);

    // 2. Initialize state and session
    const artifacts = createArtifactStore();
    const startedAt = new Date().toISOString();
    this.currentSessionId = crypto.randomUUID();

    // Store context inputs as initial artifacts
    for (const [key, value] of Object.entries(contextInputs)) {
      artifacts.put(key, value, "__context__");
    }

    // 3. Topological sort
    const levels = topologicalSort(dag);

    this.state = {
      strategy_id: dag.id,
      strategy_name: dag.name,
      status: "running",
      node_status: new Map(
        dag.nodes.map((n) => [n.id, "pending" as NodeStatus]),
      ),
      node_results: new Map(),
      artifacts,
      gate_results: [],
      cost_usd: 0,
      started_at: startedAt,
      levels,
      oversight_events: [],
    };

    // Build node lookup
    const nodeMap = new Map(dag.nodes.map((n) => [n.id, n]));

    // 4. Execute levels
    for (const level of levels) {
      const pendingNodes = level.filter(
        (id) => this.state!.node_status.get(id) === "pending",
      );

      // Execute in chunks of maxParallel
      for (
        let i = 0;
        i < pendingNodes.length;
        i += this.config.maxParallel
      ) {
        const chunk = pendingNodes.slice(i, i + this.config.maxParallel);

        const results = await Promise.allSettled(
          chunk.map((nodeId) =>
            this.executeNode(dag, nodeMap.get(nodeId)!),
          ),
        );

        // Process results — accumulate costs and gate results from all settled nodes
        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          const nodeId = chunk[j];

          if (result.status === "rejected") {
            const nodeResult: NodeResult = {
              node_id: nodeId,
              status: "failed",
              output: {},
              cost_usd: 0,
              duration_ms: 0,
              num_turns: 0,
              gate_results: [],
              retries: 0,
              error:
                result.reason instanceof Error
                  ? result.reason.message
                  : String(result.reason),
            };
            this.state!.node_status.set(nodeId, "failed");
            this.state!.node_results.set(nodeId, nodeResult);
          } else {
            // Accumulate cost and gate results from the completed NodeResult
            const nr = result.value;
            this.state!.cost_usd += nr.cost_usd;
            this.state!.gate_results.push(...nr.gate_results);
          }
        }
      }

      // 4d. Evaluate oversight rules after each level
      this.evaluateOversightRules(dag);

      // Check for suspension
      const shouldSuspend = this.state!.oversight_events.some(
        (e) => e.rule.action === "escalate_to_human",
      );
      if (shouldSuspend) {
        this.state!.status = "suspended";
        break;
      }
    }

    // 5. Run strategy gates (only if not suspended)
    if (this.state!.status !== "suspended") {
      await this.evaluateStrategyGates(dag);
    }

    // 6. Compute final status
    const completedAt = new Date().toISOString();
    let finalStatus: "completed" | "failed" | "suspended";

    if (this.state!.status === "suspended") {
      finalStatus = "suspended";
    } else {
      const allNodesCompleted = dag.nodes.every(
        (n) => this.state!.node_status.get(n.id) === "completed",
      );
      const allStrategyGatesPassed = this.state!.gate_results
        .filter((gr) => gr.gate_id.startsWith("strategy:"))
        .every((gr) => gr.passed);

      finalStatus =
        allNodesCompleted && allStrategyGatesPassed ? "completed" : "failed";
    }

    this.state!.status = finalStatus;
    this.state!.completed_at = completedAt;

    // Build result
    const nodeResults: Record<string, NodeResult> = {};
    for (const [id, result] of this.state!.node_results) {
      nodeResults[id] = result;
    }

    const durationMs =
      new Date(completedAt).getTime() - new Date(startedAt).getTime();

    // Pop the execution chain so this executor can be reused
    this.executionChain.pop();

    return {
      strategy_id: dag.id,
      status: finalStatus,
      node_results: nodeResults,
      artifacts: this.state!.artifacts.snapshot(),
      gate_results: [...this.state!.gate_results],
      cost_usd: this.state!.cost_usd,
      started_at: startedAt,
      completed_at: completedAt,
      duration_ms: durationMs,
      oversight_events: [...this.state!.oversight_events],
    };
  }

  /** Returns a shallow-copy snapshot of current execution state (for status endpoints). */
  getState(): ExecutionStateSnapshot | null {
    if (!this.state) return null;
    return {
      ...this.state,
      node_status: new Map(this.state.node_status),
      node_results: new Map(this.state.node_results),
      artifacts: this.state.artifacts.snapshot(),
      gate_results: [...this.state.gate_results],
      oversight_events: [...this.state.oversight_events],
    };
  }

  // ── Private: Node Execution ─────────────────────────────────

  /**
   * Execute a single node with gate evaluation and retry logic.
   *
   * PRD 046: Uses executeWithRetry() from gate/gate.ts for the retry loop.
   * The execute callback runs the node and evaluates gates. The check callback
   * inspects the pre-computed gate results. The buildFeedback callback produces
   * retry prompts from the first failing gate.
   *
   * Returns the NodeResult — callers accumulate costs and gate results after Promise.allSettled.
   */
  private async executeNode(
    dag: StrategyDAG,
    node: StrategyNode,
  ): Promise<NodeResult> {
    this.state!.node_status.set(node.id, "running");

    const startTime = Date.now();
    let totalCost = 0;
    let totalTurns = 0;
    let lastOutput: Record<string, unknown> = {};
    let lastGateResults: DagGateResult[] = [];

    // Build input artifact bundle (filtered to declared inputs)
    const inputBundle = this.buildInputBundle(node);

    // Determine max retries across all gates
    const maxRetries =
      node.gates.length > 0
        ? Math.max(...node.gates.map((g) => g.max_retries))
        : 0;

    // ── No gates: single execution, no retry loop ──

    if (node.gates.length === 0) {
      try {
        const execResult = await this.runNodeOnce(dag, node, inputBundle, undefined);
        totalCost += execResult.cost_usd;
        totalTurns += execResult.num_turns;
        lastOutput = execResult.output;
      } catch (err) {
        const durationMs = Date.now() - startTime;
        const nodeResult: NodeResult = {
          node_id: node.id,
          status: "failed",
          output: lastOutput,
          cost_usd: totalCost,
          duration_ms: durationMs,
          num_turns: totalTurns,
          gate_results: [],
          retries: 0,
          error: err instanceof Error ? err.message : String(err),
        };
        this.state!.node_status.set(node.id, "failed");
        this.state!.node_results.set(node.id, nodeResult);
        return nodeResult;
      }

      const durationMs = Date.now() - startTime;
      const nodeResult: NodeResult = {
        node_id: node.id,
        status: "completed",
        output: lastOutput,
        cost_usd: totalCost,
        duration_ms: durationMs,
        num_turns: totalTurns,
        gate_results: [],
        retries: 0,
      };
      this.state!.node_status.set(node.id, "completed");
      this.state!.node_results.set(node.id, nodeResult);

      // Store outputs in artifact store
      for (const outputName of node.outputs) {
        const value = lastOutput[outputName as string] ?? lastOutput;
        this.state!.artifacts.put(outputName as string, value, node.id);
      }
      if (node.refresh_context) {
        this.currentSessionId = crypto.randomUUID();
      }

      return nodeResult;
    }

    // ── With gates: use executeWithRetry from gate/gate.ts ──

    // Capture mutable state for closures
    const self = this;
    let attemptCounter = 0;

    type AttemptOutput = {
      output: Record<string, unknown>;
      cost_usd: number;
      num_turns: number;
      duration_ms: number;
      gateResults: DagGateResult[];
      allGatesPassed: boolean;
      firstFailingGate?: { gate: DagGateConfig; result: DagGateResult };
    };

    try {
      const retryResult = await Effect.runPromise(
        executeWithRetry<Record<string, unknown>, AttemptOutput, Error, never>({
          name: node.id,
          maxRetries,
          input: inputBundle,

          execute: (_input, attempt, feedback) =>
            Effect.tryPromise({
              try: async () => {
                attemptCounter = attempt;
                // Run the node
                const execResult = await self.runNodeOnce(dag, node, inputBundle, feedback);
                totalCost += execResult.cost_usd;
                totalTurns += execResult.num_turns;
                lastOutput = execResult.output;

                // Evaluate gates
                const gateContext: DagGateContext = {
                  output: execResult.output,
                  artifacts: self.flattenBundle(self.state!.artifacts.snapshot()),
                  execution_metadata: {
                    num_turns: execResult.num_turns,
                    cost_usd: execResult.cost_usd,
                    tool_call_count: 0,
                    duration_ms: execResult.duration_ms,
                  },
                };

                const gateResults: DagGateResult[] = [];
                let allGatesPassed = true;
                let firstFailingGate: { gate: DagGateConfig; result: DagGateResult } | undefined;

                // Build a markdown summary of artifacts for human review (F-D-2)
                const artifactSnapshot = self.state!.artifacts.snapshot();
                const artifactEntries = Object.entries(artifactSnapshot);
                const nodeArtifactMarkdown = artifactEntries.length > 0
                  ? artifactEntries.map(([id, val]) => `## ${id}\n\`\`\`json\n${JSON.stringify(val, null, 2)}\n\`\`\``).join('\n\n')
                  : '_No artifacts produced yet._';

                for (let gi = 0; gi < node.gates.length; gi++) {
                  const gate = node.gates[gi];
                  const gateId = `${node.id}:gate[${gi}]`;
                  const approvalCtx: HumanApprovalContext = {
                    strategy_id: dag.id,
                    execution_id: self.currentSessionId,
                    gate_id: gateId,
                    node_id: node.id,
                    artifact_markdown: nodeArtifactMarkdown,
                    timeout_ms: gate.timeout_ms,
                  };
                  const gateResult = await evaluateGate(
                    gate,
                    gateId,
                    gateContext,
                    self.humanApprovalResolver,
                    approvalCtx,
                  );
                  gateResults.push(gateResult);

                  if (!gateResult.passed) {
                    allGatesPassed = false;
                    firstFailingGate = { gate, result: gateResult };
                    break; // Stop evaluating remaining gates
                  }
                }

                lastGateResults = gateResults;

                return {
                  output: execResult.output,
                  cost_usd: execResult.cost_usd,
                  num_turns: execResult.num_turns,
                  duration_ms: execResult.duration_ms,
                  gateResults,
                  allGatesPassed,
                  firstFailingGate,
                };
              },
              catch: (err) => err instanceof Error ? err : new Error(String(err)),
            }),

          check: (attemptOutput) => {
            if (attemptOutput.allGatesPassed) {
              return { passed: true, failures: [] };
            }
            const failures = attemptOutput.gateResults
              .filter((gr) => !gr.passed)
              .map((gr) => `${gr.gate_id}: ${gr.reason}`);
            return { passed: false, failures };
          },

          buildFeedback: (attemptOutput, _failures) => {
            if (!attemptOutput.firstFailingGate) {
              return "Gate evaluation failed";
            }
            const { gate, result } = attemptOutput.firstFailingGate;
            // buildRetryFeedback expects 1-indexed attempt and maxRetries
            let feedback = buildRetryFeedback(
              gate,
              result,
              attemptCounter + 1,
              maxRetries,
            );
            // If output was a parse fallback (raw text), warn the node to produce JSON
            if (attemptOutput.output._parse_fallback) {
              feedback =
                "Note: node output was not valid JSON and was wrapped as { result: <raw text> }. Ensure the node produces JSON output.\n\n" +
                feedback;
            }
            return feedback;
          },
        }),
      );

      // Success path — all gates passed after retryResult.attempts attempts
      const durationMs = Date.now() - startTime;
      const retries = retryResult.attempts - 1; // attempts includes the initial try

      const nodeResult: NodeResult = {
        node_id: node.id,
        status: "completed",
        output: lastOutput,
        cost_usd: totalCost,
        duration_ms: durationMs,
        num_turns: totalTurns,
        gate_results: lastGateResults,
        retries,
      };
      this.state!.node_status.set(node.id, "completed");
      this.state!.node_results.set(node.id, nodeResult);

      // Store outputs in artifact store
      for (const outputName of node.outputs) {
        const value = lastOutput[outputName as string] ?? lastOutput;
        this.state!.artifacts.put(outputName as string, value, node.id);
      }
      if (node.refresh_context) {
        this.currentSessionId = crypto.randomUUID();
      }

      return nodeResult;
    } catch (err) {
      const durationMs = Date.now() - startTime;

      // RetryExhausted: all attempts failed gate checks
      if (
        err != null &&
        typeof err === "object" &&
        "_tag" in err &&
        (err as RetryExhausted)._tag === "RetryExhausted"
      ) {
        const exhausted = err as RetryExhausted;
        const retries = exhausted.attempts - 1;

        const nodeResult: NodeResult = {
          node_id: node.id,
          status: "gate_failed",
          output: lastOutput,
          cost_usd: totalCost,
          duration_ms: durationMs,
          num_turns: totalTurns,
          gate_results: lastGateResults,
          retries,
        };
        this.state!.node_status.set(node.id, "gate_failed");
        this.state!.node_results.set(node.id, nodeResult);
        return nodeResult;
      }

      // Execution error (node threw, not a gate failure)
      const nodeResult: NodeResult = {
        node_id: node.id,
        status: "failed",
        output: lastOutput,
        cost_usd: totalCost,
        duration_ms: durationMs,
        num_turns: totalTurns,
        gate_results: lastGateResults,
        retries: 0,
        error: err instanceof Error ? err.message : String(err),
      };
      this.state!.node_status.set(node.id, "failed");
      this.state!.node_results.set(node.id, nodeResult);
      return nodeResult;
    }
  }

  /**
   * Run a node once (no retry logic). Factored out for use by executeWithRetry.
   */
  private async runNodeOnce(
    dag: StrategyDAG,
    node: StrategyNode,
    inputBundle: Record<string, unknown>,
    feedback?: string,
  ): Promise<{
    output: Record<string, unknown>;
    cost_usd: number;
    num_turns: number;
    duration_ms: number;
  }> {
    if (node.config.type === "methodology") {
      const methConfig = node.config as MethodologyNodeConfig;
      // PRD-044: if config.prompt is set, prepend it to feedback (or standalone)
      let effectiveFeedback = feedback;
      if (methConfig.prompt) {
        effectiveFeedback = feedback
          ? `${methConfig.prompt}\n\n${feedback}`
          : methConfig.prompt;
      }
      return this.nodeExecutor.executeMethodologyNode(
        dag,
        node,
        methConfig,
        inputBundle,
        this.currentSessionId,
        effectiveFeedback,
      );
    } else if (node.config.type === "strategy") {
      const stratResult = await this.executeStrategyNode(
        dag,
        node,
        node.config as StrategyNodeConfig,
        inputBundle,
      );
      if (stratResult.status === "failed") {
        // F-D-5: propagate the underlying error message
        const detail = stratResult.error_message
          ? `: ${stratResult.error_message}`
          : "";
        throw new Error(
          `Sub-strategy "${stratResult.strategy_id}" failed${detail}`,
        );
      }
      return {
        output: { ...stratResult.artifacts },
        cost_usd: stratResult.cost_usd,
        num_turns: 0,
        duration_ms: stratResult.duration_ms,
      };
    } else {
      const result = this.executeScriptNode(
        node.config as ScriptNodeConfig,
        inputBundle,
        node.id,
      );
      return {
        output: result,
        cost_usd: 0,
        num_turns: 0,
        duration_ms: 0,
      };
    }
  }

  /**
   * Execute a script node in a sandboxed scope.
   *
   * SECURITY NOTE: This is defense-in-depth against accidental misuse, NOT a
   * security sandbox. Script content is trusted input from Strategy authors.
   */
  private executeScriptNode(
    config: ScriptNodeConfig,
    inputBundle: Record<string, unknown>,
    _nodeId: string,
  ): Record<string, unknown> {
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function(
        "inputs",
        `var require = undefined;
var process = undefined;
var fs = undefined;
var globalThis = undefined;
var eval = undefined;
var Function = undefined;
var global = undefined;
var module = undefined;
var exports = undefined;
var __dirname = undefined;
var __filename = undefined;
var setTimeout = undefined;
var setInterval = undefined;
var setImmediate = undefined;
${config.script}`,
      );

      const result = fn(inputBundle);

      if (result !== null && typeof result === "object") {
        return result as Record<string, unknown>;
      }

      return { result };
    } catch (err) {
      throw new Error(
        `Script execution failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Execute a strategy sub-invocation node.
   *
   * Looks up the sub-strategy by ID from the injected SubStrategySource,
   * executes it recursively using the same executor (sharing the execution
   * chain for cycle detection), and returns a SubStrategyResult whose
   * artifacts become this node's output.
   *
   * Throws if SubStrategySource is not injected or the strategy is not found.
   */
  private async executeStrategyNode(
    _parentDag: StrategyDAG,
    node: StrategyNode,
    config: StrategyNodeConfig,
    inputBundle: Record<string, unknown>,
  ): Promise<SubStrategyResult> {
    if (this.subStrategySource == null) {
      throw new Error(
        `Node "${node.id}": strategy node requires a SubStrategySource to be injected but none was provided`,
      );
    }

    const subDag = await this.subStrategySource.getStrategy(config.strategy_id);
    if (subDag == null) {
      throw new Error(
        `Node "${node.id}": sub-strategy "${config.strategy_id}" not found in SubStrategySource`,
      );
    }

    // Build context inputs for the sub-strategy using input_map if provided
    const subContextInputs: Record<string, unknown> = {};
    if (config.input_map) {
      for (const [inputName, subContextName] of Object.entries(config.input_map)) {
        if (inputBundle[inputName] !== undefined) {
          subContextInputs[subContextName] = inputBundle[inputName];
        }
      }
    } else {
      // Pass all inputs through directly
      Object.assign(subContextInputs, inputBundle);
    }

    // Create a child executor that shares our execution chain (for cycle detection)
    // but has its own isolated state. This prevents the recursive call from
    // clobbering this executor's this.state.
    const childExecutor = new DagStrategyExecutor(
      this.nodeExecutor,
      this.config,
      this.subStrategySource,
      this.humanApprovalResolver,
      this.executionChain, // shared by reference — cycle detection works across levels
    );

    const startMs = Date.now();
    let subResult: StrategyExecutionResult;
    try {
      subResult = await childExecutor.execute(subDag, subContextInputs);
    } catch (err) {
      // Re-throw cycle errors so executeNode propagates the message correctly
      if (err instanceof Error && err.message.includes("cycle detected")) {
        throw err;
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - startMs;
      return {
        strategy_id: config.strategy_id,
        status: "failed",
        artifacts: {},
        cost_usd: 0,
        duration_ms: durationMs,
        error_message: errorMsg,
      };
    }

    // Extract error details from the sub-strategy's failed nodes (F-D-5)
    let subErrorMessage: string | undefined;
    if (subResult.status !== "completed") {
      const failedNode = Object.values(subResult.node_results).find(nr => nr.error);
      if (failedNode?.error) {
        subErrorMessage = failedNode.error;
      }
    }

    return {
      strategy_id: config.strategy_id,
      status: subResult.status === "completed" ? "completed" : "failed",
      artifacts: subResult.artifacts,
      cost_usd: subResult.cost_usd,
      duration_ms: subResult.duration_ms,
      error_message: subErrorMessage,
    };
  }

  // ── Private: Artifact Helpers ─────────────────────────────────

  /**
   * Build an input bundle for a node by filtering the artifact store
   * to only the artifacts listed in the node's inputs.
   */
  private buildInputBundle(node: StrategyNode): Record<string, unknown> {
    const bundle: Record<string, unknown> = {};
    const snapshot = this.state!.artifacts.snapshot();

    for (const inputName of node.inputs) {
      const artifact = snapshot[inputName as string];
      if (artifact) {
        bundle[inputName as string] = artifact.content;
      }
    }

    return bundle;
  }

  /**
   * Flatten an ArtifactBundle to a plain key-value map of contents
   * (for gate context).
   */
  private flattenBundle(bundle: ArtifactBundle): Record<string, unknown> {
    const flat: Record<string, unknown> = {};
    for (const [id, version] of Object.entries(bundle)) {
      flat[id] = version.content;
    }
    return flat;
  }

  // ── Private: Output Parsing ───────────────────────────────────

  // Note: Output parsing is delegated to the DagNodeExecutor implementation.
  // The bridge's ClaudeCodeProvider handles JSON extraction from LLM responses.

  // ── Private: Oversight Rules ──────────────────────────────────

  /**
   * Evaluate oversight rules against current execution state.
   * Supports pattern-based conditions:
   * - "gate_failures >= N on same step"
   * - "total_cost_usd > N"
   * - "step_duration_ms > N"
   */
  private evaluateOversightRules(dag: StrategyDAG): void {
    for (const rule of dag.oversight_rules) {
      const triggered = this.evaluateOversightCondition(rule.condition);
      if (triggered) {
        // Don't duplicate events for the same rule
        const alreadyTriggered = this.state!.oversight_events.some(
          (e) => e.rule.condition === rule.condition,
        );
        if (!alreadyTriggered) {
          this.state!.oversight_events.push({
            rule,
            triggered_at: new Date().toISOString(),
            context: {
              total_cost_usd: this.state!.cost_usd,
              node_statuses: Object.fromEntries(this.state!.node_status),
            },
          });
        }
      }
    }
  }

  /**
   * Evaluate a single oversight condition string.
   */
  private evaluateOversightCondition(condition: string): boolean {
    // Pattern: "gate_failures >= N on same step"
    const gateFailureMatch = condition.match(
      /gate_failures\s*>=\s*(\d+)\s+on\s+same\s+step/,
    );
    if (gateFailureMatch) {
      const threshold = parseInt(gateFailureMatch[1], 10);
      for (const [, nodeResult] of this.state!.node_results) {
        if (nodeResult.retries >= threshold) {
          return true;
        }
      }
      return false;
    }

    // Pattern: "total_cost_usd > N"
    const costMatch = condition.match(/total_cost_usd\s*>\s*([\d.]+)/);
    if (costMatch) {
      const threshold = parseFloat(costMatch[1]);
      return this.state!.cost_usd > threshold;
    }

    // Pattern: "step_duration_ms > N"
    const durationMatch = condition.match(/step_duration_ms\s*>\s*(\d+)/);
    if (durationMatch) {
      const threshold = parseInt(durationMatch[1], 10);
      for (const [, nodeResult] of this.state!.node_results) {
        if (nodeResult.duration_ms > threshold) {
          return true;
        }
      }
      return false;
    }

    // Unknown condition format — don't trigger
    return false;
  }

  // ── Private: Strategy Gates ───────────────────────────────────

  /**
   * Evaluate strategy-level gates after all nodes complete.
   */
  private async evaluateStrategyGates(dag: StrategyDAG): Promise<void> {
    const stratArtifactSnapshot = this.state!.artifacts.snapshot();
    const artifactContents = this.flattenBundle(stratArtifactSnapshot);

    // Build a markdown summary of artifacts for strategy-level human review (F-D-2)
    const stratArtifactEntries = Object.entries(stratArtifactSnapshot);
    const stratArtifactMarkdown = stratArtifactEntries.length > 0
      ? stratArtifactEntries.map(([id, val]) => `## ${id}\n\`\`\`json\n${JSON.stringify(val, null, 2)}\n\`\`\``).join('\n\n')
      : '_No artifacts produced yet._';

    for (const sg of dag.strategy_gates) {
      const gateContext: DagGateContext = {
        output: {},
        artifacts: artifactContents,
        execution_metadata: {
          num_turns: 0,
          cost_usd: this.state!.cost_usd,
          tool_call_count: 0,
          duration_ms: 0,
        },
      };

      const stratGateId = `strategy:${sg.id}`;
      const approvalCtx: HumanApprovalContext = {
        strategy_id: dag.id,
        execution_id: this.currentSessionId,
        gate_id: stratGateId,
        node_id: sg.id,
        artifact_markdown: stratArtifactMarkdown,
        timeout_ms: sg.gate.timeout_ms,
      };
      const result = await evaluateGate(
        sg.gate,
        stratGateId,
        gateContext,
        this.humanApprovalResolver,
        approvalCtx,
      );
      this.state!.gate_results.push(result);
    }
  }
}
