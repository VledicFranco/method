/**
 * The Pact — a typed contract for agent deployment.
 *
 * A pact is a plain data object describing constraints (declarative what).
 * createAgent() binds port instances (runtime how) to a pact.
 *
 * The pact is declared before invocation. The runtime enforces it.
 */

import type { ExecutionMode, StreamOptions } from './modes/execution-mode.js';
import type { BudgetContract } from './budget/budget-contract.js';
import type { OutputContract } from './output/output-contract.js';
import type { ScopeContract } from './scope.js';
import type { ContextPolicy } from './context/context-policy.js';
import type { ReasoningPolicy } from './reasoning/reasoning-policy.js';

// ── Recovery Intent ───────────────────────────────────────────────

/** Declarative recovery preference — what the orchestrator should do on crash/restart. */
export type RecoveryIntent = 'resume' | 'restart' | 'abandon';

// ── The Pact ──────────────────────────────────────────────────────

export interface Pact<TOutput = unknown> {
  /** How the agent executes — behavioral contract */
  mode: ExecutionMode;

  /** Whether to stream events during execution (orthogonal to mode) */
  streaming?: boolean | StreamOptions;

  /** What the agent may consume — resource limits */
  budget?: BudgetContract;

  /** The shape of the result — structural validation */
  output?: OutputContract<TOutput>;

  /** What capabilities the agent has — tool/path/model constraints */
  scope?: ScopeContract;

  /** How the agent manages its context window */
  context?: ContextPolicy;

  /** How the agent reasons between actions */
  reasoning?: ReasoningPolicy;

  /** What the orchestrator should do if the host process crashes/restarts.
   *  This is a deployment hint — not enforced by the SDK. */
  recovery?: RecoveryIntent;
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

  /** Cancel an in-flight invocation. Provider must propagate to the child process. */
  abortSignal?: AbortSignal;

  /** Reset conversation context while keeping the session ID slot.
   *  CLI provider: spawns --session-id (fresh), no --resume.
   *  Anthropic provider: omits prior messages from context. */
  clearHistory?: boolean;
}

// ── Agent Result ──────────────────────────────────────────────────

export interface AgentResult<TOutput = unknown> {
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
