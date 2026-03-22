/**
 * ClaudeHeadlessProvider — Production agent provider wrapping `claude --print`.
 *
 * Builds CLI arguments, parses JSON output, and maps process errors
 * to AgentError variants. The actual process spawn is stubbed in Phase 1b;
 * integration tests with real Claude are deferred to Wave 7 (WU-7.3).
 *
 * @see PRD 021 Component 13 — ClaudeHeadlessProvider
 */

import { Effect, Layer } from "effect";
import { AgentProvider, type AgentResult, type AgentError } from "./agent-provider.js";

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
 */
export function buildCliArgs(prompt: string, config: ClaudeHeadlessConfig, sessionId?: string): string[] {
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
  if (sessionId) {
    args.push("--session-id", sessionId);
  }
  if (cfg.allowedTools.length > 0) {
    args.push("--allowedTools", cfg.allowedTools.join(","));
  }
  return args;
}

/**
 * Parse JSON output from claude --print into AgentResult.
 * The JSON format has: { result: string, cost_usd: number, duration_ms: number, ... }
 */
export function parseClaudeOutput(stdout: string): AgentResult {
  try {
    const parsed = JSON.parse(stdout);
    return {
      raw: typeof parsed.result === "string" ? parsed.result : stdout,
      cost: {
        tokens: parsed.num_turns ?? 0,
        usd: parsed.cost_usd ?? 0,
        duration_ms: parsed.duration_ms ?? 0,
      },
      sessionId: parsed.session_id,
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
 */
export function generateSessionId(prefix: string, methodId?: string, stepId?: string): string {
  const parts = [prefix];
  if (methodId) parts.push(methodId);
  if (stepId) parts.push(stepId);
  parts.push(Date.now().toString(36));
  return parts.join("_");
}

/**
 * Create a ClaudeHeadless AgentProvider.
 *
 * In production, this spawns `claude --print` processes.
 * For Phase 1b, the actual spawn is stubbed — the unit tests verify
 * argument building, output parsing, and error mapping.
 * Integration tests with real Claude are in Wave 7 (WU-7.3).
 */
export function ClaudeHeadlessProvider(config: ClaudeHeadlessConfig = {}): Layer.Layer<AgentProvider> {
  return Layer.succeed(AgentProvider, {
    execute: (commission) =>
      Effect.gen(function* () {
        // Build args (verifiable)
        const sessionId = generateSessionId(config.sessionPrefix ?? defaults.sessionPrefix);
        const _args = buildCliArgs(commission.prompt, config, sessionId);

        // In Phase 1b, we don't actually spawn — this is a stub
        // Real implementation would use Effect.tryPromise to spawn child_process
        return yield* Effect.fail<AgentError>({
          _tag: "AgentSpawnFailed",
          message: "ClaudeHeadlessProvider: live execution not yet implemented (Phase 1b stub)",
          cause: undefined,
        });
      }),
  });
}
