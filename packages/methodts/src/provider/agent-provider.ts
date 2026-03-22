/**
 * AgentProvider — Effect service interface for executing agent commissions.
 *
 * Abstracts the bridge/PTY layer so methodology runtime can dispatch
 * commissions to any agent backend (real bridge, mock, future providers).
 *
 * @see PRD 021 Component 13 — AgentProvider service interface
 */

import { Context, Effect } from "effect";

/** Detailed token usage breakdown. */
export type TokenUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
};

/** Per-model cost breakdown. */
export type ModelUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
};

/** Result from an agent execution. */
export type AgentResult = {
  /** Raw agent output text. */
  readonly raw: string;
  /** Execution cost metrics. */
  readonly cost: {
    readonly tokens: number;
    readonly usd: number;
    readonly duration_ms: number;
  };
  /** Bridge session identifier, if applicable. */
  readonly sessionId?: string;
  /** Detailed token usage breakdown. */
  readonly usage?: TokenUsage;
  /** Per-model cost breakdown (keyed by model name). */
  readonly modelUsage?: Readonly<Record<string, ModelUsage>>;
  /** Number of conversation turns. */
  readonly numTurns?: number;
  /** Reason the agent stopped (e.g. "end_turn", "max_tokens"). */
  readonly stopReason?: string;
  /** Tool calls that were denied due to permissions. */
  readonly permissionDenials?: readonly string[];
};

/**
 * Agent execution error — 5 variants for Effect.catchTag.
 *
 * Each variant carries a `_tag` discriminant so callers can
 * pattern-match with `Effect.catchTag("AgentTimeout", ...)`.
 */
export type AgentError =
  | { readonly _tag: "AgentTimeout"; readonly message: string; readonly duration_ms: number }
  | { readonly _tag: "AgentCrash"; readonly message: string; readonly cause?: unknown }
  | { readonly _tag: "AgentBudgetExceeded"; readonly limit: number; readonly actual: number }
  | { readonly _tag: "AgentPermissionDenied"; readonly resource: string; readonly message: string }
  | { readonly _tag: "AgentSpawnFailed"; readonly message: string; readonly cause?: unknown };

/** Streaming event from agent execution. */
export type AgentStreamEvent = {
  readonly type: string;
  readonly subtype?: string;
  readonly data?: unknown;
  readonly timestamp: Date;
};

/**
 * Agent provider service — executes commissions via an agent backend.
 *
 * Implementations receive a commission prompt (and optional bridge config)
 * and return an AgentResult or an AgentError.
 */
export interface AgentProvider {
  readonly execute: (commission: {
    prompt: string;
    bridge?: Record<string, unknown>;
    sessionId?: string;
    resumeSessionId?: string;
  }) => Effect.Effect<AgentResult, AgentError, never>;

  /** Optional streaming execution — emits events as the agent works. */
  readonly executeStreaming?: (
    commission: {
      prompt: string;
      bridge?: Record<string, unknown>;
      sessionId?: string;
      resumeSessionId?: string;
    },
    onEvent: (event: AgentStreamEvent) => void,
  ) => Effect.Effect<AgentResult, AgentError, never>;
}

/** Effect Context.Tag for the AgentProvider service. */
export const AgentProvider = Context.GenericTag<AgentProvider>("AgentProvider");
