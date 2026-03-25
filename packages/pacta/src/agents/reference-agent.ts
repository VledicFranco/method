/**
 * Reference Agent — pre-assembled agents with .with() customization.
 *
 * Reference agents are the Tier 1 on-ramp: import, pass a provider, invoke.
 * The .with() method bridges Tier 1 to Tier 2 by allowing selective overrides
 * without requiring full createAgent() composition knowledge.
 *
 * Design invariant: .with() returns a NEW agent — never mutates the original.
 */

import { createAgent } from '../engine/create-agent.js';
import type { Agent, CreateAgentOptions } from '../engine/create-agent.js';
import type { Pact } from '../pact.js';
import type { AgentProvider } from '../ports/agent-provider.js';
import type { ToolProvider } from '../ports/tool-provider.js';
import type { MemoryPort } from '../ports/memory-port.js';
import type { ReasoningPolicy } from '../reasoning/reasoning-policy.js';
import type { ContextPolicy } from '../context/context-policy.js';
import type { BudgetContract } from '../budget/budget-contract.js';
import type { ScopeContract } from '../scope.js';
import type { AgentEvent } from '../events.js';

// ── ReferenceAgent Interface ────────────────────────────────────

export interface ReferenceAgent<TOutput = unknown> extends Agent<TOutput> {
  /**
   * Returns a new ReferenceAgent with overrides deep-merged into the
   * current configuration. The original agent is not mutated.
   */
  with(overrides: Partial<ReferenceAgentConfig>): ReferenceAgent<TOutput>;
}

// ── Configuration ───────────────────────────────────────────────

export interface ReferenceAgentConfig {
  /** Agent provider — required, no default (avoids coupling to a specific impl) */
  provider: AgentProvider;

  /** Pact overrides — deep-merged with the reference agent's defaults */
  pact?: Partial<ReferenceAgentPactOverrides>;

  /** Reasoning policy overrides */
  reasoning?: ReasoningPolicy;

  /** Context policy overrides */
  context?: ContextPolicy;

  /** Tool provider */
  tools?: ToolProvider;

  /** Memory port */
  memory?: MemoryPort;

  /** Event handler */
  onEvent?: (event: AgentEvent) => void;
}

/** Pact fields that reference agents allow overriding */
export interface ReferenceAgentPactOverrides {
  budget?: Partial<BudgetContract>;
  scope?: Partial<ScopeContract>;
  streaming?: boolean;
}

// ── Deep Merge Utility ──────────────────────────────────────────

/**
 * Shallow-merge top-level keys, deep-merge nested plain objects.
 * Arrays and primitives are replaced, not concatenated.
 */
function deepMergePact(
  base: Partial<ReferenceAgentPactOverrides>,
  overrides: Partial<ReferenceAgentPactOverrides>,
): Partial<ReferenceAgentPactOverrides> {
  const result: Partial<ReferenceAgentPactOverrides> = { ...base };

  if (overrides.budget !== undefined) {
    result.budget = { ...base.budget, ...overrides.budget };
  }
  if (overrides.scope !== undefined) {
    result.scope = { ...base.scope, ...overrides.scope };
  }
  if (overrides.streaming !== undefined) {
    result.streaming = overrides.streaming;
  }

  return result;
}

// ── createReferenceAgent ────────────────────────────────────────

/**
 * Wraps createAgent() to produce a ReferenceAgent with .with() support.
 *
 * @param defaultPact - The full default pact for this reference agent
 * @param config - User-supplied configuration (provider is required)
 * @param defaultReasoning - Default reasoning policy (overridden by config.reasoning)
 * @param defaultContext - Default context policy (overridden by config.context)
 */
export function createReferenceAgent<TOutput = unknown>(
  defaultPact: Pact<TOutput>,
  config: ReferenceAgentConfig,
  defaultReasoning?: ReasoningPolicy,
  defaultContext?: ContextPolicy,
): ReferenceAgent<TOutput> {
  // Merge pact overrides from config into default pact
  const pactOverrides = config.pact ?? {};
  const mergedPact: Pact<TOutput> = {
    ...defaultPact,
    ...(pactOverrides.streaming !== undefined && { streaming: pactOverrides.streaming }),
    ...(pactOverrides.budget && {
      budget: { ...defaultPact.budget, ...pactOverrides.budget },
    }),
    ...(pactOverrides.scope && {
      scope: { ...defaultPact.scope, ...pactOverrides.scope },
    }),
  };

  const reasoning = config.reasoning ?? defaultReasoning;
  const context = config.context ?? defaultContext;

  const agentOptions: CreateAgentOptions<TOutput> = {
    pact: mergedPact,
    provider: config.provider,
    ...(reasoning && { reasoning }),
    ...(context && { context }),
    ...(config.tools && { tools: config.tools }),
    ...(config.memory && { memory: config.memory }),
    ...(config.onEvent && { onEvent: config.onEvent }),
  };

  const inner = createAgent(agentOptions);

  // Capture the resolved config for .with() re-composition
  const resolvedPactOverrides: Partial<ReferenceAgentPactOverrides> = {
    ...(mergedPact.budget && { budget: mergedPact.budget }),
    ...(mergedPact.scope && { scope: mergedPact.scope }),
    ...(mergedPact.streaming !== undefined && { streaming: mergedPact.streaming as boolean }),
  };

  const resolvedConfig: ReferenceAgentConfig = {
    provider: config.provider,
    pact: resolvedPactOverrides,
    ...(reasoning && { reasoning }),
    ...(context && { context }),
    ...(config.tools && { tools: config.tools }),
    ...(config.memory && { memory: config.memory }),
    ...(config.onEvent && { onEvent: config.onEvent }),
  };

  return {
    pact: inner.pact,
    provider: inner.provider,
    invoke: inner.invoke.bind(inner),

    with(overrides: Partial<ReferenceAgentConfig>): ReferenceAgent<TOutput> {
      const mergedConfig: ReferenceAgentConfig = {
        provider: overrides.provider ?? resolvedConfig.provider,
        pact: deepMergePact(
          resolvedConfig.pact ?? {},
          overrides.pact ?? {},
        ),
        ...(overrides.reasoning ?? resolvedConfig.reasoning
          ? { reasoning: overrides.reasoning ?? resolvedConfig.reasoning }
          : {}),
        ...(overrides.context ?? resolvedConfig.context
          ? { context: overrides.context ?? resolvedConfig.context }
          : {}),
        ...(overrides.tools ?? resolvedConfig.tools
          ? { tools: overrides.tools ?? resolvedConfig.tools }
          : {}),
        ...(overrides.memory ?? resolvedConfig.memory
          ? { memory: overrides.memory ?? resolvedConfig.memory }
          : {}),
        ...(overrides.onEvent ?? resolvedConfig.onEvent
          ? { onEvent: overrides.onEvent ?? resolvedConfig.onEvent }
          : {}),
      };

      return createReferenceAgent(defaultPact, mergedConfig, defaultReasoning, defaultContext);
    },
  };
}
