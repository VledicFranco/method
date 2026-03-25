/**
 * Agent Events — typed lifecycle signals emitted during execution.
 *
 * Every agent invocation emits events through a single vocabulary.
 * The event stream is the observability surface of the pact.
 */

import type { TokenUsage, CostReport } from './pact.js';

export type AgentEvent =
  | AgentStarted
  | AgentText
  | AgentThinking
  | AgentToolUse
  | AgentToolResult
  | AgentTurnComplete
  | AgentContextCompacted
  | AgentReflection
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

export interface AgentThinking {
  type: 'thinking';
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

export interface AgentContextCompacted {
  type: 'context_compacted';
  fromTokens: number;
  toTokens: number;
}

export interface AgentReflection {
  type: 'reflection';
  trial: number;
  critique: string;
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
  result: unknown;
  usage: TokenUsage;
  cost: CostReport;
  durationMs: number;
  turns: number;
}
