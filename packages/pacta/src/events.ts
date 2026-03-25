/**
 * Agent Events — typed lifecycle signals emitted during execution.
 *
 * Every agent invocation emits events through a single vocabulary.
 * The event stream is the observability surface of the pact —
 * callers subscribe to know what the agent is doing without
 * understanding the provider's internal protocol.
 */

import type { TokenUsage, CostReport } from './pact.js';

export type AgentEvent =
  | AgentStarted
  | AgentText
  | AgentToolUse
  | AgentToolResult
  | AgentTurnComplete
  | AgentBudgetWarning
  | AgentBudgetExhausted
  | AgentError
  | AgentCompleted;

export interface AgentStarted {
  type: 'started';
  sessionId: string;
  timestamp: string;
}

export interface AgentText {
  type: 'text';
  content: string;
}

export interface AgentToolUse {
  type: 'tool_use';
  tool: string;
  input: unknown;
  toolUseId: string;
}

export interface AgentToolResult {
  type: 'tool_result';
  tool: string;
  output: unknown;
  toolUseId: string;
  durationMs: number;
}

export interface AgentTurnComplete {
  type: 'turn_complete';
  turnNumber: number;
  usage: TokenUsage;
}

export interface AgentBudgetWarning {
  type: 'budget_warning';
  resource: 'tokens' | 'cost' | 'duration' | 'turns';
  consumed: number;
  limit: number;
  percentUsed: number;
}

export interface AgentBudgetExhausted {
  type: 'budget_exhausted';
  resource: 'tokens' | 'cost' | 'duration' | 'turns';
  consumed: number;
  limit: number;
}

export interface AgentError {
  type: 'error';
  message: string;
  recoverable: boolean;
  code?: string;
}

export interface AgentCompleted {
  type: 'completed';
  result: string;
  usage: TokenUsage;
  cost: CostReport;
  durationMs: number;
  turns: number;
}
