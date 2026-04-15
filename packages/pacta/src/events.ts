/**
 * Agent Events — typed lifecycle signals emitted during execution.
 *
 * Every agent invocation emits events through a single vocabulary.
 * The event stream is the observability surface of the pact.
 */

import type { TokenUsage, CostReport } from './pact.js';
import type { CognitiveEvent } from './cognitive/algebra/events.js';

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
  | AgentCompleted
  | PactDeadLetterEvent
  | CognitiveEvent;

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

/**
 * Terminal event emitted when a pact execution hits the dead-letter path.
 *
 * PRD-062 / S5 §2.4. Added as a backward-compatible extension of the
 * `AgentEvent` union (additive — existing exhaustive switches that lack
 * a default case become non-exhaustive at compile time; add a default
 * returning the unhandled event to restore exhaustiveness).
 *
 * Two emission paths produce this event (G-DLQ-SINGLE-EMIT):
 *   1. Inline from the continuation handler when pacta classifies
 *      "ack + signal DLQ" (budget exhaustion, checkpoint corruption,
 *      `budget_expired`).
 *   2. External from Cortex's DLQ observer after retries exhaust.
 *
 * The runtime coordinates so that each sessionId sees at most one such
 * event, regardless of which path(s) trigger.
 */
export interface PactDeadLetterEvent {
  type: 'pact.dead_letter';
  sessionId: string;
  pactKey: string;
  turnIndex: number;
  lastError: string;
  attempts: number;
  traceId: string;
}
