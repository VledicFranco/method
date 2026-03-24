/**
 * PRD 017: Strategy Pipelines — DAG Executor (Phase 1c)
 *
 * WS-2: Now a thin adapter over @method/methodts DagStrategyExecutor.
 * The bridge StrategyExecutor wires the LlmProvider into the methodts
 * DagNodeExecutor port, then delegates all execution logic to methodts.
 *
 * This file preserves the bridge's API surface (StrategyExecutor class,
 * type exports) for backward compatibility with strategy-routes.ts.
 */

import type { LlmProvider, LlmResponse } from '../../ports/llm-provider.js';
import type {
  StrategyDAG,
  StrategyNode,
  MethodologyNodeConfig,
} from './strategy-parser.js';
import {
  DagStrategyExecutor,
  type DagNodeExecutor,
} from '@method/methodts/strategy/dag-executor.js';
import type { StrategyExecutorConfig } from '@method/methodts/strategy/dag-types.js';

// Re-export types from methodts (preserving bridge's type surface)
export type {
  NodeStatus,
  NodeResult,
  OversightEvent,
  ExecutionStateSnapshot,
  StrategyExecutionResult,
  StrategyExecutorConfig,
} from '@method/methodts/strategy/dag-types.js';

// Re-export ExecutionState as an opaque type (callers use getState() snapshot)
export type { ExecutionStateSnapshot as ExecutionState } from '@method/methodts/strategy/dag-types.js';

// ── Bridge Adapter: LlmProvider -> DagNodeExecutor ─────────────

/**
 * Adapts the bridge's LlmProvider to the methodts DagNodeExecutor port.
 *
 * This is the only bridge-specific logic remaining — it builds prompts
 * from methodology node configs, invokes the LLM, and parses the output.
 * All execution orchestration (DAG walking, gates, retries, oversight)
 * is handled by methodts DagStrategyExecutor.
 */
class LlmNodeExecutor implements DagNodeExecutor {
  private currentSessionId: string = '';

  constructor(
    private provider: LlmProvider,
    private defaultTimeoutMs: number,
    private defaultBudgetUsd?: number,
  ) {}

  setSessionId(id: string): void {
    this.currentSessionId = id;
  }

  async executeMethodologyNode(
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

    let response: LlmResponse;
    try {
      response = await Promise.race([
        this.provider.invoke({
          prompt,
          sessionId,
          refreshSessionId: node.refresh_context ? crypto.randomUUID() : undefined,
          maxBudgetUsd: this.defaultBudgetUsd,
          allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
          signal: abortController.signal,
        }),
        timeoutPromise,
      ]);
    } finally {
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    }

    // Parse output from response
    const output = parseNodeOutput(response.result);

    return {
      output,
      cost_usd: response.total_cost_usd,
      num_turns: response.num_turns,
      duration_ms: response.duration_ms,
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
 * Wires the bridge's LlmProvider into the methodts DagNodeExecutor port,
 * then delegates all execution orchestration to methodts.
 */
export class StrategyExecutor {
  private inner: DagStrategyExecutor;

  constructor(
    provider: LlmProvider,
    config: StrategyExecutorConfig,
  ) {
    const nodeExecutor = new LlmNodeExecutor(
      provider,
      config.defaultTimeoutMs,
      config.defaultBudgetUsd,
    );

    this.inner = new DagStrategyExecutor(nodeExecutor, {
      maxParallel: config.maxParallel,
      defaultGateRetries: config.defaultGateRetries,
      defaultTimeoutMs: config.defaultTimeoutMs,
      defaultBudgetUsd: config.defaultBudgetUsd,
      retroDir: config.retroDir,
    });
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
