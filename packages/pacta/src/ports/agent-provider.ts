/**
 * Agent Provider — the port interface for agent runtimes.
 *
 * Split into base (required) + optional capability interfaces.
 * createAgent validates at composition time that the provider
 * supports the requested execution mode and streaming.
 *
 * Concrete implementations live in separate packages:
 * @method/pacta-provider-claude-cli, @method/pacta-provider-anthropic, etc.
 */

import type { Pact, AgentRequest, AgentResult } from '../pact.js';
import type { AgentEvent } from '../events.js';
import type { ExecutionMode } from '../modes/execution-mode.js';

// ── Base Provider (required) ──────────────────────────────────────

export interface AgentProvider {
  readonly name: string;
  capabilities(): ProviderCapabilities;
  invoke<T>(pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>>;
}

// ── Optional Capabilities ─────────────────────────────────────────

/** Provider can stream events during execution */
export interface Streamable {
  stream(pact: Pact, request: AgentRequest): AsyncIterable<AgentEvent>;
}

/** Provider can resume prior sessions */
export interface Resumable {
  resume<T>(sessionId: string, pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>>;
}

/** Provider can kill persistent sessions */
export interface Killable {
  kill(sessionId: string): Promise<void>;
}

// ── Lifecycle (optional for any port) ─────────────────────────────

export interface Lifecycle {
  init(): Promise<void>;
  dispose(): Promise<void>;
}

// ── Provider Capabilities ─────────────────────────────────────────

export interface ProviderCapabilities {
  modes: ExecutionMode['type'][];
  streaming: boolean;
  resumable: boolean;
  budgetEnforcement: 'native' | 'client' | 'none';
  outputValidation: 'native' | 'client' | 'none';
  toolModel: 'builtin' | 'mcp' | 'function' | 'none';
  models?: string[];
}
