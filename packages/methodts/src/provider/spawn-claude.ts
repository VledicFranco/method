/**
 * spawnClaude — Isolated spawn logic for `claude --print`.
 *
 * Pure function + Effect wrapper. Spawns a child process, captures
 * stdout/stderr, handles timeout, and maps the result through
 * parseClaudeOutput / mapProcessError from claude-headless.
 *
 * @see PRD 021 Component 13 — ClaudeHeadlessProvider
 */

import { Effect } from "effect";
import type { AgentResult, AgentError } from "./agent-provider.js";
import { buildCliArgs, parseClaudeOutput, mapProcessError, type ClaudeHeadlessConfig } from "./claude-headless.js";

/** Raw result from the child process before interpretation. */
export type SpawnResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
};

/**
 * Spawn `claude --print` as a child process.
 *
 * Returns an Effect that:
 * 1. Builds CLI args via buildCliArgs
 * 2. Spawns the process via child_process.spawn
 * 3. Collects stdout/stderr
 * 4. Applies timeout (config.timeoutMs, default 300000ms)
 * 5. On exit code 0 → parseClaudeOutput(stdout)
 * 6. On non-zero exit → mapProcessError(exitCode, stderr, config)
 * 7. On spawn failure → AgentSpawnFailed
 * 8. On timeout → AgentTimeout
 */
export function spawnClaude(
  prompt: string,
  config: ClaudeHeadlessConfig,
  sessionId: string,
): Effect.Effect<AgentResult, AgentError, never> {
  const args = buildCliArgs(prompt, config, sessionId);
  const bin = config.claudeBin ?? "claude";
  const timeoutMs = config.timeoutMs ?? 300000;

  return Effect.tryPromise({
    try: async () => {
      const { spawn } = await import("child_process");

      return new Promise<SpawnResult>((resolve, reject) => {
        const proc = spawn(bin, args, {
          cwd: config.workdir ?? ".",
          env: { ...process.env },
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        proc.stdout?.on("data", (data: Buffer) => {
          stdout += data.toString();
        });
        proc.stderr?.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        const timer = setTimeout(() => {
          proc.kill("SIGTERM");
          reject({
            _tag: "AgentTimeout",
            message: `Process timed out after ${timeoutMs}ms`,
            duration_ms: timeoutMs,
          });
        }, timeoutMs);

        proc.on("close", (code) => {
          clearTimeout(timer);
          resolve({ stdout, stderr, exitCode: code ?? 1 });
        });

        proc.on("error", (err) => {
          clearTimeout(timer);
          reject({
            _tag: "AgentSpawnFailed",
            message: `Failed to spawn ${bin}: ${err.message}`,
            cause: err,
          });
        });
      });
    },
    catch: (error) => {
      // If the rejected value is already a tagged AgentError, pass through
      if (typeof error === "object" && error !== null && "_tag" in error) {
        return error as AgentError;
      }
      return {
        _tag: "AgentSpawnFailed" as const,
        message: `Spawn failed: ${String(error)}`,
        cause: error,
      };
    },
  }).pipe(
    Effect.flatMap((result) => {
      if (result.exitCode !== 0) {
        return Effect.fail(mapProcessError(result.exitCode, result.stderr, config));
      }
      return Effect.succeed(parseClaudeOutput(result.stdout));
    }),
  );
}
