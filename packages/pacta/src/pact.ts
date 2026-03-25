/**
 * The Pact — a typed contract for agent deployment.
 *
 * A pact declares what the caller expects from the agent runtime:
 * how it executes, what it may consume, what shape its output takes,
 * and what capabilities it has access to.
 *
 * The pact is declared before invocation. The runtime enforces it.
 */

import type { ExecutionMode } from './modes/execution-mode.js';
import type { BudgetContract } from './budget/budget-contract.js';
import type { OutputContract } from './output/output-contract.js';
import type { ScopeContract } from './scope.js';

// ── The Pact ──────────────────────────────────────────────────────

export interface Pact<TOutput = string> {
  /** How the agent executes — behavioral contract */
  mode: ExecutionMode;

  /** What the agent may consume — resource limits */
  budget?: BudgetContract;

  /** The shape of the result — structural validation */
  output?: OutputContract<TOutput>;

  /** What capabilities the agent has — tool/path/model constraints */
  scope?: ScopeContract;
}

// ── Agent Request ─────────────────────────────────────────────────

export interface AgentRequest {
  /** The prompt / commission text */
  prompt: string;

  /** Working directory for the agent */
  workdir?: string;

  /** System prompt appended to agent context */
  systemPrompt?: string;

  /** Resume a prior session (for resumable/persistent modes) */
  resumeSessionId?: string;

  /** Arbitrary metadata passed through to the provider */
  metadata?: Record<string, unknown>;
}

// ── Agent Result ──────────────────────────────────────────────────

export interface AgentResult<TOutput = string> {
  /** The agent's final output */
  output: TOutput;

  /** Session ID (for resumable/persistent modes) */
  sessionId: string;

  /** Whether the agent completed normally */
  completed: boolean;

  /** Why the agent stopped */
  stopReason: 'complete' | 'budget_exhausted' | 'timeout' | 'killed' | 'error';

  /** Token usage for this invocation */
  usage: TokenUsage;

  /** Cost report */
  cost: CostReport;

  /** Wall-clock duration in milliseconds */
  durationMs: number;

  /** Number of agentic turns (tool use cycles) */
  turns: number;
}

// ── Token Usage ───────────────────────────────────────────────────

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

// ── Cost Report ───────────────────────────────────────────────────

export interface CostReport {
  /** Total cost in USD */
  totalUsd: number;

  /** Per-model breakdown */
  perModel: Record<string, { tokens: TokenUsage; costUsd: number }>;

  /** How much of the declared budget was consumed (0-100) */
  budgetConsumedPercent?: number;
}
