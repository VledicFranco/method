/**
 * createAgent() — composition function that binds ports to a pact.
 *
 * Validates provider capabilities against pact requirements at composition
 * time. Wires middleware in order: Budget Enforcer → Output Validator → Provider.
 *
 * Returns an agent object with an invoke() method.
 */

import type { Pact, AgentRequest, AgentResult } from '../pact.js';
import type { AgentProvider } from '../ports/agent-provider.js';
import type { AgentEvent } from '../events.js';
import type { ToolProvider } from '../ports/tool-provider.js';
import type { MemoryPort } from '../ports/memory-port.js';
import type { ContextPolicy } from '../context/context-policy.js';
import type { ReasoningPolicy } from '../reasoning/reasoning-policy.js';
import { budgetEnforcer } from '../middleware/budget-enforcer.js';
import { outputValidator } from '../middleware/output-validator.js';
import { throttler, type ThrottlerOptions } from '../middleware/throttler.js';

// ── Agent State ──────────────────────────────────────────────────

/** Cumulative state accumulated across invocations. Read-only, updated after each completed invoke(). */
export interface AgentState {
  turnsExecuted: number;
  totalUsd: number;
  totalTokens: number;
  invocationCount: number;
}

// ── Agent Interface ──────────────────────────────────────────────

export interface Agent<TOutput = unknown> {
  invoke(request: AgentRequest): Promise<AgentResult<TOutput>>;
  readonly pact: Pact<TOutput>;
  readonly provider: AgentProvider;
  /** Cumulative state across invocations. Reflects the last completed invocation. */
  readonly state: AgentState;
  /** Optional cleanup — release resources, abort in-flight work. */
  dispose?(): void;
}

// ── Configuration ────────────────────────────────────────────────

export interface CreateAgentOptions<TOutput = unknown> {
  pact: Pact<TOutput>;
  provider: AgentProvider;
  reasoning?: ReasoningPolicy;
  context?: ContextPolicy;
  tools?: ToolProvider;
  memory?: MemoryPort;
  onEvent?: (event: AgentEvent) => void;
  /** Optional throttler for rate governing (PRD 051). */
  throttle?: ThrottlerOptions;
}

// ── Capability Validation ────────────────────────────────────────

export class CapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapabilityError';
  }
}

function validateCapabilities<T>(options: CreateAgentOptions<T>): void {
  const { pact, provider } = options;
  const caps = provider.capabilities();

  // Validate execution mode
  if (!caps.modes.includes(pact.mode.type)) {
    throw new CapabilityError(
      `Provider "${provider.name}" does not support mode "${pact.mode.type}". ` +
      `Supported modes: ${caps.modes.join(', ')}`
    );
  }

  // Validate streaming
  if (pact.streaming && !caps.streaming) {
    throw new CapabilityError(
      `Provider "${provider.name}" does not support streaming.`
    );
  }
}

// ── Invocation Wrapper (middleware pipeline) ─────────────────────

type InvokeFn<T> = (pact: Pact<T>, request: AgentRequest) => Promise<AgentResult<T>>;

function buildPipeline<T>(options: CreateAgentOptions<T>): InvokeFn<T> {
  const { pact, provider, onEvent, throttle } = options;

  // Base: provider invoke
  let pipeline: InvokeFn<T> = (p, req) => provider.invoke(p, req);

  // Wrap with output validator (inner — runs closer to provider)
  if (pact.output?.schema) {
    pipeline = outputValidator(pipeline, pact, onEvent);
  }

  // Wrap with budget enforcer (middle)
  if (pact.budget) {
    pipeline = budgetEnforcer(pipeline, pact, onEvent);
  }

  // Wrap with throttler (outermost — slot held for full pipeline duration)
  if (throttle) {
    pipeline = throttler(pipeline, throttle);
  }

  return pipeline;
}

// ── createAgent ──────────────────────────────────────────────────

export function createAgent<TOutput = unknown>(
  options: CreateAgentOptions<TOutput>,
): Agent<TOutput> {
  validateCapabilities(options);

  const pipeline = buildPipeline(options);

  // State accumulation — always runs, regardless of middleware configuration.
  const agentState: AgentState = {
    turnsExecuted: 0,
    totalUsd: 0,
    totalTokens: 0,
    invocationCount: 0,
  };

  return {
    pact: options.pact,
    provider: options.provider,
    get state(): AgentState {
      return { ...agentState };
    },
    async invoke(request: AgentRequest): Promise<AgentResult<TOutput>> {
      const result = await pipeline(options.pact, request);

      // Accumulate state from result
      agentState.invocationCount++;
      agentState.turnsExecuted += result.turns ?? 0;
      if (result.cost) {
        agentState.totalUsd += result.cost.totalUsd ?? 0;
      }
      if (result.usage) {
        agentState.totalTokens +=
          (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0);
      }

      return result;
    },
  };
}
