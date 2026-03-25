/**
 * Agent Provider — the port interface for agent runtimes.
 *
 * Providers implement this interface to make their runtime
 * available under Pacta's pact system. The provider declares
 * its capabilities, and the pact system validates that the
 * requested pact is compatible before invocation.
 *
 * Concrete implementations (Claude CLI, Anthropic API, OpenAI, Ollama)
 * live outside this package — in consumer code or provider packages.
 */

import type { Pact, AgentRequest, AgentResult } from '../pact.js';
import type { AgentEvent } from '../events.js';
import type { ExecutionMode } from '../modes/execution-mode.js';

// ── Provider Port ─────────────────────────────────────────────────

export interface AgentProvider {
  /** Human-readable provider name (e.g., 'claude-cli', 'anthropic-api') */
  readonly name: string;

  /** What this provider supports — used to validate pacts before invocation */
  capabilities(): ProviderCapabilities;

  /** Execute an agent under a pact. Returns when the agent completes. */
  invoke<T>(pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>>;

  /** Execute with streaming events. The async iterable terminates on completion. */
  stream(pact: Pact, request: AgentRequest): AsyncIterable<AgentEvent>;

  /** Resume a prior session. Throws if the provider doesn't support resumable mode. */
  resume<T>(sessionId: string, pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>>;

  /** Kill a persistent session. Throws if the session doesn't exist. */
  kill(sessionId: string): Promise<void>;
}

// ── Provider Capabilities ─────────────────────────────────────────

export interface ProviderCapabilities {
  /** Which execution modes this provider supports */
  modes: ExecutionMode['type'][];

  /** Whether the provider can stream events */
  streaming: boolean;

  /** Whether the provider can resume sessions */
  resumable: boolean;

  /** Who enforces budget limits — the provider natively, or Pacta's client-side wrapper */
  budgetEnforcement: 'native' | 'client' | 'none';

  /** Who validates output schemas — the provider natively, or Pacta's client-side wrapper */
  outputValidation: 'native' | 'client' | 'none';

  /** How tools are integrated */
  toolModel: 'builtin' | 'mcp' | 'function' | 'none';

  /** Models available through this provider */
  models?: string[];
}
