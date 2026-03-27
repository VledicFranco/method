/**
 * asFlatAgent — adapter that bridges CognitiveAgent to the flat Agent interface.
 *
 * Maps Agent.invoke(AgentRequest) -> cognitive.invoke(request.prompt) -> AgentResult.
 * Makes impedance mismatch between cognitive and flat agent models visible and testable.
 */

import type { Pact, AgentRequest, AgentResult, TokenUsage, CostReport } from '../../pact.js';
import type { AgentProvider } from '../../ports/agent-provider.js';
import type { Agent, AgentState } from '../../engine/create-agent.js';
import type { CognitiveAgent } from './create-cognitive-agent.js';

// ── Options ──────────────────────────────────────────────────────

export interface AsFlatAgentOptions {
  provider?: AgentProvider;
  pact?: Pact;
}

// ── Default Pact ─────────────────────────────────────────────────

function defaultPact(): Pact {
  return {
    mode: { type: 'oneshot' },
  };
}

// ── Default Provider Stub ────────────────────────────────────────

function noopProvider(): AgentProvider {
  return {
    name: 'cognitive-adapter',
    capabilities() {
      return {
        modes: ['oneshot'],
        streaming: false,
        resumable: false,
        budgetEnforcement: 'none' as const,
        outputValidation: 'none' as const,
        toolModel: 'none' as const,
      };
    },
    async invoke<T>(): Promise<AgentResult<T>> {
      throw new Error('Provider not available — use CognitiveAgent.invoke() directly');
    },
  };
}

// ── Token Usage Aggregation ──────────────────────────────────────

function aggregateTokenUsage(cognitive: CognitiveAgent): TokenUsage {
  const traces = cognitive.traces();
  const usage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
  };

  for (const trace of traces) {
    if (trace.tokenUsage) {
      usage.inputTokens += trace.tokenUsage.inputTokens;
      usage.outputTokens += trace.tokenUsage.outputTokens;
      usage.cacheReadTokens += trace.tokenUsage.cacheReadTokens;
      usage.cacheWriteTokens += trace.tokenUsage.cacheWriteTokens;
      usage.totalTokens += trace.tokenUsage.totalTokens;
    }
  }

  return usage;
}

// ── Factory ──────────────────────────────────────────────────────

export function asFlatAgent<TOutput = unknown>(
  cognitive: CognitiveAgent,
  options?: AsFlatAgentOptions,
): Agent<TOutput> {
  const pact = (options?.pact ?? defaultPact()) as Pact<TOutput>;
  const provider = options?.provider ?? cognitive.config.provider ?? noopProvider();

  const agentState: AgentState = {
    turnsExecuted: 0,
    totalUsd: 0,
    totalTokens: 0,
    invocationCount: 0,
  };

  return {
    pact,
    provider,

    get state(): AgentState {
      return { ...agentState };
    },

    async invoke(request: AgentRequest): Promise<AgentResult<TOutput>> {
      const startTime = Date.now();

      const cycleResult = await cognitive.invoke(request.prompt);

      const usage = aggregateTokenUsage(cognitive);
      const durationMs = Date.now() - startTime;

      // Determine completion status
      const completed = !cycleResult.aborted;
      const stopReason: AgentResult['stopReason'] = cycleResult.aborted
        ? 'error'
        : 'complete';

      const cost: CostReport = {
        totalUsd: 0,
        perModel: {},
      };

      // Update agent state
      agentState.invocationCount++;
      agentState.turnsExecuted += 1; // cycle count = 1 turn
      agentState.totalTokens += usage.totalTokens;

      return {
        output: cycleResult.output as TOutput,
        sessionId: `cognitive-${cycleResult.cycleNumber}`,
        completed,
        stopReason,
        usage,
        cost,
        durationMs,
        turns: 1,
      };
    },
  };
}
