/**
 * Pacta-Bridge Session Integration (Spike)
 *
 * Provides a Pacta-based session creation path alongside the existing PTY
 * session pool. Creates agents using createAgent() + claudeCliProvider,
 * mapping bridge session parameters to Pacta's Pact contract.
 *
 * This is ADDITIVE — the existing session pool is not modified.
 */

import type {
  Pact,
  AgentRequest,
  AgentResult,
  Agent,
  CreateAgentOptions,
  BudgetContract,
  ScopeContract,
  ReasoningPolicy,
  AgentProvider,
  AgentEvent,
} from '@method/pacta';
import { createAgent } from '@method/pacta';
import { claudeCliProvider } from '@method/pacta-provider-claude-cli';

// ── Bridge Session Parameters ───────────────────────────────────

/** Bridge-level session configuration that maps to Pacta concepts. */
export interface PactaSessionParams {
  /** Session nickname (used as metadata) */
  nickname: string;

  /** Working directory for the agent */
  workdir: string;

  /** The prompt / commission text */
  prompt: string;

  /** System prompt to prepend */
  systemPrompt?: string;

  /** Maximum cost in USD (maps to budget.maxCostUsd) */
  maxCostUsd?: number;

  /** Maximum duration in ms (maps to budget.maxDurationMs) */
  maxDurationMs?: number;

  /** Maximum turns / tool cycles (maps to budget.maxTurns) */
  maxTurns?: number;

  /** Allowed tools whitelist (maps to scope.allowedTools) */
  allowedTools?: string[];

  /** Allowed filesystem paths (maps to scope.allowedPaths) */
  allowedPaths?: string[];

  /** Model to use (maps to scope.model) */
  model?: string;

  /** Reasoning effort level */
  reasoningEffort?: 'low' | 'medium' | 'high';

  /** Session mode — oneshot or resumable */
  mode?: 'oneshot' | 'resumable';

  /** Session ID for resumable sessions */
  resumeSessionId?: string;

  /** Event handler for agent events */
  onEvent?: (event: AgentEvent) => void;
}

// ── Pact Builder from Bridge Params ─────────────────────────────

/**
 * Build a Pacta Pact from bridge session parameters.
 *
 * This is the core mapping function: bridge session config -> Pact contract.
 * The Pact is a declarative constraint object — no runtime behavior.
 */
export function buildPactFromSessionParams(params: PactaSessionParams): Pact {
  const budget: BudgetContract | undefined =
    (params.maxCostUsd !== undefined ||
     params.maxDurationMs !== undefined ||
     params.maxTurns !== undefined)
      ? {
          maxCostUsd: params.maxCostUsd,
          maxDurationMs: params.maxDurationMs,
          maxTurns: params.maxTurns,
        }
      : undefined;

  const scope: ScopeContract | undefined =
    (params.allowedTools !== undefined ||
     params.allowedPaths !== undefined ||
     params.model !== undefined)
      ? {
          allowedTools: params.allowedTools,
          allowedPaths: params.allowedPaths,
          model: params.model,
        }
      : undefined;

  const reasoning: ReasoningPolicy | undefined =
    params.reasoningEffort !== undefined
      ? { effort: params.reasoningEffort }
      : undefined;

  return {
    mode: { type: params.mode ?? 'oneshot' },
    budget,
    scope,
    reasoning,
  };
}

/**
 * Build an AgentRequest from bridge session parameters.
 */
export function buildRequestFromSessionParams(
  params: PactaSessionParams,
): AgentRequest {
  return {
    prompt: params.prompt,
    workdir: params.workdir,
    systemPrompt: params.systemPrompt,
    resumeSessionId: params.resumeSessionId,
    metadata: { nickname: params.nickname },
  };
}

// ── Pacta Session Creation ──────────────────────────────────────

/**
 * Create a Pacta agent from bridge session parameters.
 *
 * Uses claudeCliProvider by default — the same CLI the bridge already
 * invokes via PTY, but through Pacta's typed contract layer.
 *
 * @param params - Bridge session configuration
 * @param providerOverride - Optional provider for testing (defaults to claudeCliProvider)
 * @returns A configured Pacta Agent ready for invocation
 */
export function createPactaSession(
  params: PactaSessionParams,
  providerOverride?: AgentProvider,
): Agent {
  const pact = buildPactFromSessionParams(params);
  const provider = providerOverride ?? claudeCliProvider({
    model: params.model,
    timeoutMs: params.maxDurationMs,
  });

  const options: CreateAgentOptions = {
    pact,
    provider,
    onEvent: params.onEvent,
  };

  return createAgent(options);
}

/**
 * Create and invoke a Pacta agent in one step.
 *
 * Convenience function that creates the agent and immediately invokes it.
 * Returns the AgentResult with output, usage, and cost data.
 */
export async function invokePactaSession(
  params: PactaSessionParams,
  providerOverride?: AgentProvider,
): Promise<AgentResult> {
  const agent = createPactaSession(params, providerOverride);
  const request = buildRequestFromSessionParams(params);
  return agent.invoke(request);
}
