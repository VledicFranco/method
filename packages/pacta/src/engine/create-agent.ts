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

// ── Agent Interface ──────────────────────────────────────────────

export interface Agent<TOutput = unknown> {
  invoke(request: AgentRequest): Promise<AgentResult<TOutput>>;
  readonly pact: Pact<TOutput>;
  readonly provider: AgentProvider;
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
  const { pact, provider, onEvent } = options;

  // Base: provider invoke
  let pipeline: InvokeFn<T> = (p, req) => provider.invoke(p, req);

  // Wrap with output validator (inner — runs closer to provider)
  if (pact.output?.schema) {
    pipeline = outputValidator(pipeline, pact, onEvent);
  }

  // Wrap with budget enforcer (outer — runs first)
  if (pact.budget) {
    pipeline = budgetEnforcer(pipeline, pact, onEvent);
  }

  return pipeline;
}

// ── createAgent ──────────────────────────────────────────────────

export function createAgent<TOutput = unknown>(
  options: CreateAgentOptions<TOutput>,
): Agent<TOutput> {
  validateCapabilities(options);

  const pipeline = buildPipeline(options);

  return {
    pact: options.pact,
    provider: options.provider,
    invoke(request: AgentRequest): Promise<AgentResult<TOutput>> {
      return pipeline(options.pact, request);
    },
  };
}
