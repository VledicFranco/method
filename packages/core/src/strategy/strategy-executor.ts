/**
 * PRD 017: Strategy Pipelines — DAG Executor (Phase 1c)
 *
 * Core execution engine for Strategy DAGs. Runs nodes in topological
 * order, parallelizing independent nodes at the same level, evaluating
 * gates with retry-with-feedback, tracking costs, and enforcing
 * oversight rules.
 */

import type { LlmProvider, LlmResponse } from './llm-provider.js';
import type { ArtifactStore, ArtifactBundle } from './artifact-store.js';
import { createArtifactStore } from './artifact-store.js';
import type { GateResult, GateContext } from './gates.js';
import { evaluateGate, buildRetryFeedback } from './gates.js';
import type {
  StrategyDAG,
  StrategyNode,
  OversightRule,
  MethodologyNodeConfig,
  ScriptNodeConfig,
} from './strategy-parser.js';
import { validateStrategyDAG, topologicalSort } from './strategy-parser.js';

// ── Execution State Types ───────────────────────────────────────

export type NodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'gate_failed' | 'suspended';

export interface NodeResult {
  node_id: string;
  status: NodeStatus;
  output: Record<string, unknown>;
  cost_usd: number;
  duration_ms: number;
  num_turns: number;
  gate_results: GateResult[];
  retries: number;
  error?: string;
  side_report?: string;
}

export interface OversightEvent {
  rule: OversightRule;
  triggered_at: string;
  context: Record<string, unknown>;
}

export interface ExecutionState {
  strategy_id: string;
  strategy_name: string;
  status: 'running' | 'completed' | 'failed' | 'suspended';
  node_status: Map<string, NodeStatus>;
  node_results: Map<string, NodeResult>;
  artifacts: ArtifactStore;
  gate_results: GateResult[];
  cost_usd: number;
  started_at: string;
  completed_at?: string;
  levels: string[][];
  oversight_events: OversightEvent[];
}

/** Snapshot returned by getState() — artifacts is a frozen ArtifactBundle instead of a live store */
export interface ExecutionStateSnapshot {
  strategy_id: string;
  strategy_name: string;
  status: 'running' | 'completed' | 'failed' | 'suspended';
  node_status: Map<string, NodeStatus>;
  node_results: Map<string, NodeResult>;
  artifacts: ArtifactBundle;
  gate_results: GateResult[];
  cost_usd: number;
  started_at: string;
  completed_at?: string;
  levels: string[][];
  oversight_events: OversightEvent[];
}

export interface StrategyExecutionResult {
  strategy_id: string;
  status: 'completed' | 'failed' | 'suspended';
  node_results: Record<string, NodeResult>;
  artifacts: ArtifactBundle;
  gate_results: GateResult[];
  cost_usd: number;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  oversight_events: OversightEvent[];
}

// ── Configuration ───────────────────────────────────────────────

export interface StrategyExecutorConfig {
  maxParallel: number;
  defaultGateRetries: number;
  defaultTimeoutMs: number;
  defaultBudgetUsd?: number;
  retroDir: string;
}

// loadExecutorConfig() moved to @method/bridge (DR-03: core has zero transport/env deps)

// ── Executor ────────────────────────────────────────────────────

export class StrategyExecutor {
  private state: ExecutionState | null = null;
  private currentSessionId: string = '';

  constructor(
    private provider: LlmProvider,
    private config: StrategyExecutorConfig,
  ) {}

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
      throw new Error(`Invalid Strategy DAG: ${validation.errors.join('; ')}`);
    }

    // 2. Initialize state and session
    const artifacts = createArtifactStore();
    const startedAt = new Date().toISOString();
    this.currentSessionId = crypto.randomUUID();

    // Store context inputs as initial artifacts
    for (const [key, value] of Object.entries(contextInputs)) {
      artifacts.put(key, value, '__context__');
    }

    // 3. Topological sort
    const levels = topologicalSort(dag);

    this.state = {
      strategy_id: dag.id,
      strategy_name: dag.name,
      status: 'running',
      node_status: new Map(dag.nodes.map((n) => [n.id, 'pending' as NodeStatus])),
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
        (id) => this.state!.node_status.get(id) === 'pending',
      );

      // Execute in chunks of maxParallel
      for (let i = 0; i < pendingNodes.length; i += this.config.maxParallel) {
        const chunk = pendingNodes.slice(i, i + this.config.maxParallel);

        const results = await Promise.allSettled(
          chunk.map((nodeId) => this.executeNode(dag, nodeMap.get(nodeId)!)),
        );

        // Process results — accumulate costs and gate results from all settled nodes
        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          const nodeId = chunk[j];

          if (result.status === 'rejected') {
            const nodeResult: NodeResult = {
              node_id: nodeId,
              status: 'failed',
              output: {},
              cost_usd: 0,
              duration_ms: 0,
              num_turns: 0,
              gate_results: [],
              retries: 0,
              error: result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
            };
            this.state!.node_status.set(nodeId, 'failed');
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
        (e) => e.rule.action === 'escalate_to_human',
      );
      if (shouldSuspend) {
        this.state!.status = 'suspended';
        break;
      }
    }

    // 5. Run strategy gates (only if not suspended)
    if (this.state!.status !== 'suspended') {
      await this.evaluateStrategyGates(dag);
    }

    // 6. Compute final status
    const completedAt = new Date().toISOString();
    let finalStatus: 'completed' | 'failed' | 'suspended';

    if (this.state!.status === 'suspended') {
      finalStatus = 'suspended';
    } else {
      const allNodesCompleted = dag.nodes.every(
        (n) => this.state!.node_status.get(n.id) === 'completed',
      );
      const allStrategyGatesPassed = this.state!.gate_results
        .filter((gr) => gr.gate_id.startsWith('strategy:'))
        .every((gr) => gr.passed);

      finalStatus = allNodesCompleted && allStrategyGatesPassed ? 'completed' : 'failed';
    }

    this.state!.status = finalStatus;
    this.state!.completed_at = completedAt;

    // Build result
    const nodeResults: Record<string, NodeResult> = {};
    for (const [id, result] of this.state!.node_results) {
      nodeResults[id] = result;
    }

    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

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

  /** Returns a shallow-copy snapshot of current execution state (for status endpoints) */
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
   * Returns the NodeResult — callers accumulate costs and gate results after Promise.allSettled.
   */
  private async executeNode(dag: StrategyDAG, node: StrategyNode): Promise<NodeResult> {
    this.state!.node_status.set(node.id, 'running');

    const startTime = Date.now();
    let totalCost = 0;
    let totalTurns = 0;
    let retries = 0;
    let lastOutput: Record<string, unknown> = {};
    let lastGateResults: GateResult[] = [];
    let lastError: string | undefined;

    // Build input artifact bundle (filtered to declared inputs)
    const inputBundle = this.buildInputBundle(node);

    // Determine max retries across all gates
    const maxRetries = node.gates.length > 0
      ? Math.max(...node.gates.map((g) => g.max_retries))
      : 0;

    let attempt = 0;
    let allGatesPassed = false;
    let retryFeedback: string | undefined;

    while (attempt <= maxRetries) {
      try {
        let nodeOutput: Record<string, unknown>;
        let responseCost: number;
        let responseTurns: number;
        let responseDurationMs: number;

        if (node.config.type === 'methodology') {
          const result = await this.executeMethodologyNode(
            dag,
            node,
            node.config as MethodologyNodeConfig,
            inputBundle,
            retryFeedback,
          );
          nodeOutput = result.output;
          responseCost = result.cost_usd;
          responseTurns = result.num_turns;
          responseDurationMs = result.duration_ms;
        } else {
          const result = await this.executeScriptNode(
            node.config as ScriptNodeConfig,
            inputBundle,
            node.id,
          );
          nodeOutput = result;
          responseCost = 0;
          responseTurns = 0;
          responseDurationMs = 0;
        }

        totalCost += responseCost;
        totalTurns += responseTurns;
        lastOutput = nodeOutput;

        // Run gates
        if (node.gates.length > 0) {
          const gateContext: GateContext = {
            output: nodeOutput,
            artifacts: this.flattenBundle(this.state!.artifacts.snapshot()),
            execution_metadata: {
              num_turns: responseTurns,
              cost_usd: responseCost,
              tool_call_count: 0,
              duration_ms: responseDurationMs,
            },
          };

          lastGateResults = [];
          allGatesPassed = true;

          for (let gi = 0; gi < node.gates.length; gi++) {
            const gate = node.gates[gi];
            const gateResult = await evaluateGate(
              gate,
              `${node.id}:gate[${gi}]`,
              gateContext,
            );
            lastGateResults.push(gateResult);

            if (!gateResult.passed) {
              allGatesPassed = false;
              // Build retry feedback for the first failing gate
              if (attempt < maxRetries) {
                retryFeedback = buildRetryFeedback(
                  gate,
                  gateResult,
                  attempt + 1,
                  maxRetries,
                );
                // If output was a parse fallback (raw text), warn the node to produce JSON
                if (nodeOutput._parse_fallback) {
                  retryFeedback = 'Note: node output was not valid JSON and was wrapped as { result: <raw text> }. Ensure the node produces JSON output.\n\n' + retryFeedback;
                }
              }
              break; // Stop evaluating remaining gates
            }
          }

          if (allGatesPassed) break;

          // Increment attempt; retries counts only actual re-executions (not the initial attempt)
          attempt++;
          if (attempt <= maxRetries) {
            retries++;
          }
        } else {
          // No gates — node passes automatically
          allGatesPassed = true;
          break;
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        // On execution error, don't retry — mark as failed
        break;
      }
    }

    const durationMs = Date.now() - startTime;

    if (lastError) {
      const nodeResult: NodeResult = {
        node_id: node.id,
        status: 'failed',
        output: lastOutput,
        cost_usd: totalCost,
        duration_ms: durationMs,
        num_turns: totalTurns,
        gate_results: lastGateResults,
        retries,
        error: lastError,
      };
      this.state!.node_status.set(node.id, 'failed');
      this.state!.node_results.set(node.id, nodeResult);
      return nodeResult;
    }

    const finalStatus: NodeStatus = allGatesPassed ? 'completed' : 'gate_failed';

    const nodeResult: NodeResult = {
      node_id: node.id,
      status: finalStatus,
      output: lastOutput,
      cost_usd: totalCost,
      duration_ms: durationMs,
      num_turns: totalTurns,
      gate_results: lastGateResults,
      retries,
    };

    this.state!.node_status.set(node.id, finalStatus);
    this.state!.node_results.set(node.id, nodeResult);

    // Store outputs in artifact store
    if (finalStatus === 'completed') {
      for (const outputName of node.outputs) {
        const value = lastOutput[outputName] ?? lastOutput;
        this.state!.artifacts.put(outputName, value, node.id);
      }

      // If this node has refresh_context, generate a new session ID for subsequent nodes
      if (node.refresh_context) {
        this.currentSessionId = crypto.randomUUID();
      }
    }

    return nodeResult;
  }

  /**
   * Execute a methodology node by invoking the LLM provider.
   */
  private async executeMethodologyNode(
    dag: StrategyDAG,
    node: StrategyNode,
    config: MethodologyNodeConfig,
    inputBundle: Record<string, unknown>,
    retryFeedback?: string,
  ): Promise<{
    output: Record<string, unknown>;
    cost_usd: number;
    num_turns: number;
    duration_ms: number;
  }> {
    // Build prompt
    const promptParts: string[] = [
      `You are executing strategy node "${node.id}" as part of strategy "${dag.name}".`,
      '',
      `Methodology: ${config.methodology}`,
    ];

    if (config.method_hint) {
      promptParts.push(`Method hint: ${config.method_hint}`);
    }

    promptParts.push('');
    promptParts.push('Context inputs:');
    promptParts.push(JSON.stringify(inputBundle, null, 2));
    promptParts.push('');
    promptParts.push(
      'Produce your output as a JSON object. Your response must end with a JSON code block containing your structured output.',
    );

    if (retryFeedback) {
      promptParts.push('');
      promptParts.push(retryFeedback);
    }

    const prompt = promptParts.join('\n');

    // Resolve allowed tools from capabilities
    const allowedTools: string[] = [];
    for (const capName of config.capabilities) {
      const tools = dag.capabilities[capName];
      if (tools) {
        allowedTools.push(...tools);
      }
    }

    const timeoutMs = this.config.defaultTimeoutMs;
    const abortController = new AbortController();
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutTimer = setTimeout(
        () => {
          abortController.abort();
          reject(new Error(`Node "${node.id}" timed out after ${timeoutMs}ms`));
        },
        timeoutMs,
      );
      if (timeoutTimer && typeof timeoutTimer === 'object' && 'unref' in timeoutTimer) {
        timeoutTimer.unref();
      }
    });
    let response: LlmResponse;
    try {
      response = await Promise.race([
        this.provider.invoke({
          prompt,
          sessionId: this.currentSessionId,
          refreshSessionId: node.refresh_context ? crypto.randomUUID() : undefined,
          maxBudgetUsd: this.config.defaultBudgetUsd,
          allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
          signal: abortController.signal,
        }),
        timeoutPromise,
      ]);
    } finally {
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    }

    // Parse output from response
    const output = this.parseNodeOutput(response.result);

    return {
      output,
      cost_usd: response.total_cost_usd,
      num_turns: response.num_turns,
      duration_ms: response.duration_ms,
    };
  }

  /**
   * SECURITY NOTE: This is defense-in-depth against accidental misuse, NOT a
   * security sandbox. Gate expressions are trusted input from Strategy authors.
   * Known escape vectors: dynamic import(), constructor chain traversal,
   * uncontrolled `this` binding. OS-level sandboxing is deferred (PRD 017 §7).
   */

  /**
   * Execute a script node in a sandboxed scope.
   */
  private async executeScriptNode(
    config: ScriptNodeConfig,
    inputBundle: Record<string, unknown>,
    nodeId: string,
  ): Promise<Record<string, unknown>> {
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function(
        'inputs',
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

      // NOTE: Timeout protects against async hangs but cannot interrupt synchronous
      // infinite loops (would require worker_threads). Acceptable for Phase 1 —
      // script authors are trusted Strategy authors.
      const scriptTimeoutMs = this.config.defaultTimeoutMs;
      const scriptPromise = new Promise<unknown>((resolve, reject) => {
        try {
          const result = fn(inputBundle);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
      let scriptTimer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        scriptTimer = setTimeout(
          () => reject(new Error(`Script node "${nodeId}" timed out after ${scriptTimeoutMs}ms`)),
          scriptTimeoutMs,
        );
        if (scriptTimer && typeof scriptTimer === 'object' && 'unref' in scriptTimer) {
          scriptTimer.unref();
        }
      });
      let result: unknown;
      try {
        result = await Promise.race([scriptPromise, timeoutPromise]);
      } finally {
        if (scriptTimer !== undefined) clearTimeout(scriptTimer);
      }

      if (result !== null && typeof result === 'object') {
        return result as Record<string, unknown>;
      }

      return { result };
    } catch (err) {
      throw new Error(
        `Script execution failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
      const artifact = snapshot[inputName];
      if (artifact) {
        bundle[inputName] = artifact.content;
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

  /**
   * Parse structured output from an LLM response.
   * Looks for ```json ... ``` blocks first, then tries to parse the whole result.
   */
  private parseNodeOutput(result: string): Record<string, unknown> {
    // Try to extract JSON from a code block
    const jsonBlockMatch = result.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);
    if (jsonBlockMatch) {
      try {
        const parsed = JSON.parse(jsonBlockMatch[1].trim());
        if (parsed !== null && typeof parsed === 'object') {
          return parsed as Record<string, unknown>;
        }
        return { result: parsed };
      } catch {
        // Fall through to try other patterns
      }
    }

    // Try to extract JSON from any code block
    const anyBlockMatch = result.match(/```\s*\n?([\s\S]*?)\n?\s*```/);
    if (anyBlockMatch) {
      try {
        const parsed = JSON.parse(anyBlockMatch[1].trim());
        if (parsed !== null && typeof parsed === 'object') {
          return parsed as Record<string, unknown>;
        }
        return { result: parsed };
      } catch {
        // Fall through
      }
    }

    // Try to parse the whole result as JSON
    try {
      const parsed = JSON.parse(result.trim());
      if (parsed !== null && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
      return { result: parsed };
    } catch {
      // Return the raw text as a result field with parse fallback flag
      return { result, _parse_fallback: true };
    }
  }

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
    const gateFailureMatch = condition.match(/gate_failures\s*>=\s*(\d+)\s+on\s+same\s+step/);
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
    const artifactContents = this.flattenBundle(this.state!.artifacts.snapshot());

    for (const sg of dag.strategy_gates) {
      const gateContext: GateContext = {
        output: {},
        artifacts: artifactContents,
        execution_metadata: {
          num_turns: 0,
          cost_usd: this.state!.cost_usd,
          tool_call_count: 0,
          duration_ms: 0,
        },
      };

      const result = await evaluateGate(sg.gate, `strategy:${sg.id}`, gateContext);
      this.state!.gate_results.push(result);
    }
  }
}
