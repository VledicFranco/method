// SPDX-License-Identifier: Apache-2.0
/**
 * ClaudeHeadlessProvider — Production agent provider wrapping `claude --print`.
 *
 * Builds CLI arguments, parses JSON output, and maps process errors
 * to AgentError variants. Spawns `claude --print` via child_process.spawn
 * with configurable timeout, budget, and model selection.
 *
 * @see PRD 021 Component 13 — ClaudeHeadlessProvider
 */

import { Layer } from "effect";
import { AgentProvider, type AgentResult, type AgentError } from "./agent-provider.js";
import { StructuredAgentProvider, createStructuredProvider } from "./structured-provider.js";
import { spawnClaude } from "./spawn-claude.js";

/** Configuration for the Claude headless provider. */
export type ClaudeHeadlessConfig = {
  readonly model?: string;
  readonly maxBudgetUsd?: number;
  readonly workdir?: string;
  readonly allowedTools?: readonly string[];
  readonly claudeBin?: string;
  readonly timeoutMs?: number;
  readonly sessionPrefix?: string;
};

/** Default configuration values. */
const defaults: Required<ClaudeHeadlessConfig> = {
  model: "sonnet",
  maxBudgetUsd: 5,
  workdir: ".",
  allowedTools: [],
  claudeBin: "claude",
  timeoutMs: 300000,
  sessionPrefix: "methodts",
};

/**
 * Build CLI arguments for claude --print invocation.
 * Exposed for testing — the main export is ClaudeHeadlessProvider.
 *
 * When `resumeSessionId` is provided, `--resume` takes precedence over `--session-id`.
 */
export function buildCliArgs(
  prompt: string,
  config: ClaudeHeadlessConfig,
  sessionId?: string,
  resumeSessionId?: string,
): string[] {
  const cfg = { ...defaults, ...config };
  const args: string[] = [
    "--print",
    "-p", prompt,
    "--output-format", "json",
    "--model", cfg.model,
  ];
  if (cfg.maxBudgetUsd != null) {
    args.push("--max-budget-usd", String(cfg.maxBudgetUsd));
  }
  // Session management: --resume takes precedence over --session-id
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  } else if (sessionId) {
    args.push("--session-id", sessionId);
  }
  if (cfg.allowedTools && cfg.allowedTools.length > 0) {
    args.push("--allowedTools", cfg.allowedTools.join(","));
  }
  return args;
}

/**
 * Parse JSON output from claude --print into AgentResult.
 * The JSON format has: { result: string, cost_usd: number, duration_ms: number, ... }
 *
 * Extracts rich fields when present: usage breakdown, per-model costs,
 * stop reason, and permission denials.
 */
export function parseClaudeOutput(stdout: string): AgentResult {
  try {
    const parsed = JSON.parse(stdout);
    return {
      raw: typeof parsed.result === "string" ? parsed.result : stdout,
      cost: {
        tokens: (parsed.usage?.input_tokens ?? 0) + (parsed.usage?.output_tokens ?? 0),
        usd: parsed.total_cost_usd ?? parsed.cost_usd ?? 0,
        duration_ms: parsed.duration_ms ?? 0,
      },
      sessionId: parsed.session_id,
      // Rich fields — optional, present when claude returns them
      usage: parsed.usage ? {
        inputTokens: parsed.usage.input_tokens ?? 0,
        outputTokens: parsed.usage.output_tokens ?? 0,
        cacheCreationTokens: parsed.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: parsed.usage.cache_read_input_tokens ?? 0,
      } : undefined,
      modelUsage: parsed.model_usage ? Object.fromEntries(
        Object.entries(parsed.model_usage).map(([model, data]) => [
          model, {
            inputTokens: (data as Record<string, number>).inputTokens ?? (data as Record<string, number>).input_tokens ?? 0,
            outputTokens: (data as Record<string, number>).outputTokens ?? (data as Record<string, number>).output_tokens ?? 0,
            costUsd: (data as Record<string, number>).costUSD ?? (data as Record<string, number>).cost_usd ?? 0,
          },
        ]),
      ) : undefined,
      numTurns: parsed.num_turns,
      stopReason: parsed.stop_reason,
      permissionDenials: parsed.permission_denials?.length ? parsed.permission_denials : undefined,
    };
  } catch {
    // If JSON parse fails, treat entire stdout as raw output
    return {
      raw: stdout,
      cost: { tokens: 0, usd: 0, duration_ms: 0 },
    };
  }
}

/**
 * Map process errors to AgentError variants.
 */
export function mapProcessError(exitCode: number, stderr: string, config: ClaudeHeadlessConfig): AgentError {
  if (stderr.includes("budget")) {
    return { _tag: "AgentBudgetExceeded", limit: config.maxBudgetUsd ?? defaults.maxBudgetUsd, actual: 0 };
  }
  if (stderr.includes("permission")) {
    return { _tag: "AgentPermissionDenied", resource: "unknown", message: stderr };
  }
  return { _tag: "AgentCrash", message: `Process exited with code ${exitCode}: ${stderr}` };
}

/**
 * Generate a session ID for a methodology step execution.
 *
 * claude --session-id requires a valid UUID. We use randomUUID() from the
 * Node crypto module to satisfy that constraint.
 */
export function generateSessionId(_prefix?: string, _methodId?: string, _stepId?: string): string {
  return crypto.randomUUID();
}

// node:crypto is available in Node 14.17+ without an import.
declare const crypto: { randomUUID(): string };

/**
 * Create a ClaudeHeadless AgentProvider.
 *
 * Spawns `claude --print` as a child process for each commission.
 * Configurable via ClaudeHeadlessConfig (model, budget, timeout, etc.).
 */
export function ClaudeHeadlessProvider(config: ClaudeHeadlessConfig = {}): Layer.Layer<AgentProvider> {
  return Layer.succeed(AgentProvider, {
    execute: (commission) => {
      const sessionId = commission.sessionId ?? generateSessionId(config.sessionPrefix ?? defaults.sessionPrefix);
      return spawnClaude(commission.prompt, config, sessionId, commission.resumeSessionId);
    },
  });
}

/**
 * Create a ClaudeHeadless StructuredAgentProvider.
 *
 * Wraps the regular ClaudeHeadless provider with structured output support.
 * Schema constraints are injected into the prompt; responses are parsed as JSON.
 *
 * @see PRD 046 §Wave 3 — Structured Output
 */
export function StructuredClaudeHeadlessProvider(config: ClaudeHeadlessConfig = {}): Layer.Layer<StructuredAgentProvider> {
  const baseProvider = {
    execute: (commission: { prompt: string; bridge?: Record<string, unknown>; sessionId?: string; resumeSessionId?: string }) => {
      const sessionId = commission.sessionId ?? generateSessionId(config.sessionPrefix ?? defaults.sessionPrefix);
      return spawnClaude(commission.prompt, config, sessionId, commission.resumeSessionId);
    },
  };
  return Layer.succeed(StructuredAgentProvider, createStructuredProvider(baseProvider));
}
