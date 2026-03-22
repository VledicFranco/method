/**
 * AgentProvider — Effect service interface for executing agent commissions.
 *
 * Abstracts the bridge/PTY layer so methodology runtime can dispatch
 * commissions to any agent backend (real bridge, mock, future providers).
 *
 * @see PRD 021 Component 13 — AgentProvider service interface
 */

import { Context, Effect } from "effect";

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
  }) => Effect.Effect<AgentResult, AgentError, never>;
}

/** Effect Context.Tag for the AgentProvider service. */
export const AgentProvider = Context.GenericTag<AgentProvider>("AgentProvider");
