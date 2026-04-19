// SPDX-License-Identifier: Apache-2.0
/**
 * Fluent builders for Pact and AgentRequest test objects.
 *
 * Every builder has sensible defaults so tests only specify
 * the fields they care about.
 */

import type {
  Pact,
  AgentRequest,
  BudgetContract,
  OutputContract,
  ScopeContract,
  ExecutionMode,
  ContextPolicy,
  ReasoningPolicy,
} from '@methodts/pacta';

// ── PactBuilder ─────────────────────────────────────────────────

export class PactBuilder<T = unknown> {
  private _mode: ExecutionMode = { type: 'oneshot' };
  private _streaming?: boolean;
  private _budget?: BudgetContract;
  private _output?: OutputContract<T>;
  private _scope?: ScopeContract;
  private _context?: ContextPolicy;
  private _reasoning?: ReasoningPolicy;

  withMode(mode: ExecutionMode): this {
    this._mode = mode;
    return this;
  }

  withStreaming(streaming: boolean): this {
    this._streaming = streaming;
    return this;
  }

  withBudget(budget: BudgetContract): this {
    this._budget = budget;
    return this;
  }

  withOutput(output: OutputContract<T>): this {
    this._output = output;
    return this;
  }

  withScope(scope: ScopeContract): this {
    this._scope = scope;
    return this;
  }

  withContext(context: ContextPolicy): this {
    this._context = context;
    return this;
  }

  withReasoning(reasoning: ReasoningPolicy): this {
    this._reasoning = reasoning;
    return this;
  }

  build(): Pact<T> {
    const pact: Pact<T> = { mode: this._mode };
    if (this._streaming !== undefined) pact.streaming = this._streaming;
    if (this._budget) pact.budget = this._budget;
    if (this._output) pact.output = this._output;
    if (this._scope) pact.scope = this._scope;
    if (this._context) pact.context = this._context;
    if (this._reasoning) pact.reasoning = this._reasoning;
    return pact;
  }
}

/** Create a PactBuilder with sensible defaults */
export function pactBuilder<T = unknown>(): PactBuilder<T> {
  return new PactBuilder<T>();
}

// ── AgentRequestBuilder ─────────────────────────────────────────

export class AgentRequestBuilder {
  private _prompt = 'test prompt';
  private _workdir?: string;
  private _systemPrompt?: string;
  private _resumeSessionId?: string;
  private _metadata?: Record<string, unknown>;

  withPrompt(prompt: string): this {
    this._prompt = prompt;
    return this;
  }

  withWorkdir(workdir: string): this {
    this._workdir = workdir;
    return this;
  }

  withSystemPrompt(systemPrompt: string): this {
    this._systemPrompt = systemPrompt;
    return this;
  }

  withResumeSessionId(sessionId: string): this {
    this._resumeSessionId = sessionId;
    return this;
  }

  withMetadata(metadata: Record<string, unknown>): this {
    this._metadata = metadata;
    return this;
  }

  build(): AgentRequest {
    const request: AgentRequest = { prompt: this._prompt };
    if (this._workdir) request.workdir = this._workdir;
    if (this._systemPrompt) request.systemPrompt = this._systemPrompt;
    if (this._resumeSessionId) request.resumeSessionId = this._resumeSessionId;
    if (this._metadata) request.metadata = this._metadata;
    return request;
  }
}

/** Create an AgentRequestBuilder with sensible defaults */
export function agentRequestBuilder(): AgentRequestBuilder {
  return new AgentRequestBuilder();
}
