/**
 * PRD 017: Strategy Pipelines — DAG Executor (Phase 1c)
 *
 * WS-2: Now a thin adapter over @method/methodts DagStrategyExecutor.
 * The bridge StrategyExecutor wires the AgentProvider into the methodts
 * DagNodeExecutor port, then delegates all execution logic to methodts.
 *
 * PRD 028 C-5: Migrated from LlmProvider to AgentProvider (@method/pacta).
 */

import type { AgentProvider, AgentResult, Pact } from '@method/pacta';
import { createAgent } from '@method/pacta';
import type {
  StrategyDAG,
  StrategyNode,
  MethodologyNodeConfig,
} from './strategy-parser.js';
import {
  DagStrategyExecutor,
  type DagNodeExecutor,
} from '@method/methodts/strategy/dag-executor.js';
import type { StrategyExecutorConfig, SubStrategySource, HumanApprovalResolver } from '@method/methodts/strategy/dag-types.js';
import type { SemanticNodeExecutor } from '@method/methodts/semantic/node-executor.js';

// Re-export types from methodts (preserving bridge's type surface)
export type {
  NodeStatus,
  NodeResult,
  OversightEvent,
  ExecutionStateSnapshot,
  StrategyExecutionResult,
  StrategyExecutorConfig,
  SubStrategySource,
  HumanApprovalResolver,
} from '@method/methodts/strategy/dag-types.js';

// Re-export SemanticNodeExecutor port type for bridge composition root
export type { SemanticNodeExecutor } from '@method/methodts/semantic/node-executor.js';

// Re-export ExecutionState as an opaque type (callers use getState() snapshot)
export type { ExecutionStateSnapshot as ExecutionState } from '@method/methodts/strategy/dag-types.js';

// ── Bridge Adapter: AgentProvider -> DagNodeExecutor ────────────

/**
 * Adapts Pacta's AgentProvider to the methodts DagNodeExecutor port.
 *
 * This is the only bridge-specific logic remaining — it builds prompts
 * from methodology node configs, invokes the agent, and parses the output.
 * All execution orchestration (DAG walking, gates, retries, oversight)
 * is handled by methodts DagStrategyExecutor.
 */
class PactaNodeExecutor implements DagNodeExecutor {
  constructor(
    private provider: AgentProvider,
    private defaultTimeoutMs: number,
    private defaultBudgetUsd?: number,
  ) {}

  async executeMethodologyNode(
    dag: StrategyDAG,
    node: StrategyNode,
    config: MethodologyNodeConfig,
    inputBundle: Record<string, unknown>,
    _sessionId: string,
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

    const pact: Pact = {
      mode: { type: 'oneshot' },
      budget: this.defaultBudgetUsd !== undefined
        ? { maxCostUsd: this.defaultBudgetUsd }
        : undefined,
      scope: allowedTools.length > 0 ? { allowedTools } : undefined,
    };

    const timeoutMs = this.defaultTimeoutMs;
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

    let result: AgentResult;
    try {
      const agent = createAgent({ pact, provider: this.provider });
      result = await Promise.race([
        agent.invoke({ prompt, workdir: process.cwd(), abortSignal: abortController.signal }),
        timeoutPromise,
      ]);
    } finally {
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    }

    // Parse output from response
    const output = parseNodeOutput(String(result.output));

    return {
      output,
      cost_usd: result.cost.totalUsd,
      num_turns: result.turns,
      duration_ms: result.durationMs,
    };
  }
}

// ── Output Parsing ──────────────────────────────────────────────

/**
 * Parse structured output from an LLM response.
 * Looks for ```json ... ``` blocks first, then tries to parse the whole result.
 */
function parseNodeOutput(result: string): Record<string, unknown> {
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

// ── Executor ────────────────────────────────────────────────────

/**
 * Bridge-level StrategyExecutor — thin wrapper over methodts DagStrategyExecutor.
 *
 * Wires Pacta's AgentProvider into the methodts DagNodeExecutor port,
 * then delegates all execution orchestration to methodts.
 *
 * PRD-044: Accepts optional SubStrategySource and HumanApprovalResolver ports
 * injected from the composition root. Both default to null for backward compat.
 *
 * PRD-046 C-2c: Accepts optional SemanticNodeExecutor for SPL algorithm nodes.
 */
export class StrategyExecutor {
  private inner: DagStrategyExecutor;

  constructor(
    provider: AgentProvider,
    config: StrategyExecutorConfig,
    subStrategySource?: SubStrategySource | null,
    humanApprovalResolver?: HumanApprovalResolver | null,
    _semanticNodeExecutor?: SemanticNodeExecutor | null,
  ) {
    // NOTE: semanticNodeExecutor is accepted for API compatibility but not yet
    // wired to DagStrategyExecutor. The methodts-side support for semantic
    // nodes (PRD 046 C-2c) was reverted during merge conflict resolution.
    // Track via TODO: re-integrate semantic node dispatch in methodts.
    const nodeExecutor = new PactaNodeExecutor(
      provider,
      config.defaultTimeoutMs,
      config.defaultBudgetUsd,
    );

    this.inner = new DagStrategyExecutor(
      nodeExecutor,
      {
        maxParallel: config.maxParallel,
        defaultGateRetries: config.defaultGateRetries,
        defaultTimeoutMs: config.defaultTimeoutMs,
        defaultBudgetUsd: config.defaultBudgetUsd,
        retroDir: config.retroDir,
      },
      subStrategySource ?? null,
      humanApprovalResolver ?? null,
      undefined, // sharedChain — not used at top level
    );
  }

  /** Execute a Strategy DAG end-to-end. Delegates to methodts. */
  async execute(
    dag: StrategyDAG,
    contextInputs: Record<string, unknown>,
  ) {
    return this.inner.execute(dag, contextInputs);
  }

  /** Returns a snapshot of current execution state. Delegates to methodts. */
  getState() {
    return this.inner.getState();
  }
}
