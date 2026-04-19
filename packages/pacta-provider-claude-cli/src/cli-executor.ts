// SPDX-License-Identifier: Apache-2.0
/**
 * CLI Executor — spawns the `claude` process and captures output.
 *
 * Designed for dependency injection: the spawn function can be replaced
 * in tests to avoid actually invoking the CLI.
 */

import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import {
  TimeoutError,
  CliSpawnError as PactaCliSpawnError,
  CliExecutionError as PactaCliExecutionError,
  CliAbortError as PactaCliAbortError,
} from '@methodts/pacta';

// ── Types ────────────────────────────────────────────────────

export interface CliArgs {
  /** The prompt to send */
  prompt: string;

  /** Use --print mode (non-interactive, single response) */
  print: boolean;

  /** Resume a prior session by ID */
  resumeSessionId?: string;

  /** Working directory for the CLI process */
  cwd?: string;

  /** Allowed tools (passed via --allowedTools) */
  allowedTools?: string[];

  /** Model override */
  model?: string;

  /** System prompt (passed via --system-prompt) */
  systemPrompt?: string;

  /** Max turns limit */
  maxTurns?: number;

  /** Output format — default 'json' for structured parsing */
  outputFormat?: 'json' | 'text';

  /** Session ID for first invocation (--session-id). Mutually exclusive with resumeSessionId. */
  sessionId?: string;

  /** If true, treat as fresh --session-id call (no --resume even if resumeSessionId set) */
  clearHistory?: boolean;

  /** Abort signal — kills child process on abort */
  abortSignal?: AbortSignal;
}

export interface CliResult {
  /** Process exit code (0 = success) */
  exitCode: number;

  /** Captured stdout */
  stdout: string;

  /** Captured stderr */
  stderr: string;
}

/**
 * Function signature for spawning a child process.
 * Default: node:child_process.spawn. Override in tests.
 */
export type SpawnFn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

// ── Argument Builder ─────────────────────────────────────────────

export function buildCliArgs(args: CliArgs): string[] {
  const result: string[] = [];

  if (args.print) {
    result.push('--print');
  }

  // Session tracking: --session-id for fresh start, --resume for continuation
  if (args.clearHistory && args.sessionId) {
    // Fresh start with a specific session ID (ignore resumeSessionId)
    result.push('--session-id', args.sessionId);
  } else if (args.sessionId && !args.resumeSessionId) {
    // First invocation — use --session-id
    result.push('--session-id', args.sessionId);
  } else if (args.resumeSessionId && !args.clearHistory) {
    // Resume an existing session
    result.push('--resume', args.resumeSessionId);
  }

  // Output format (default to json)
  const fmt = args.outputFormat ?? 'json';
  if (fmt === 'json') {
    result.push('--output-format', 'json');
  }

  if (args.model) {
    result.push('--model', args.model);
  }

  if (args.systemPrompt) {
    result.push('--system-prompt', args.systemPrompt);
  }

  if (args.maxTurns !== undefined) {
    result.push('--max-turns', String(args.maxTurns));
  }

  if (args.allowedTools && args.allowedTools.length > 0) {
    result.push('--allowedTools', args.allowedTools.join(','));
  }

  // Separator: claude CLI treats args after `--` as positional, preventing
  // confusion when --allowedTools value is mistakenly captured as the prompt.
  result.push('--');

  // Prompt is the positional argument (last)
  result.push(args.prompt);

  return result;
}

// ── Executor ─────────────────────────────────────────────────────

export interface ExecutorOptions {
  /** Override the spawn function (for testing) */
  spawnFn?: SpawnFn;

  /** CLI binary name (default: 'claude') */
  binary?: string;

  /** Timeout in milliseconds (default: 300_000 = 5 min) */
  timeoutMs?: number;
}

/**
 * Execute the Claude CLI and capture the result.
 * Returns a CliResult with exit code, stdout, and stderr.
 */
export async function executeCli(
  args: CliArgs,
  options: ExecutorOptions = {},
): Promise<CliResult> {
  const {
    spawnFn = nodeSpawn,
    binary = 'claude',
    timeoutMs = 300_000,
  } = options;

  const cliArgs = buildCliArgs(args);

  // Scrub ANTHROPIC_API_KEY from child env so the Claude CLI uses OAuth
  // (Max subscription) instead of a potentially credit-depleted API key.
  const childEnv = { ...process.env };
  delete childEnv.ANTHROPIC_API_KEY;

  return new Promise<CliResult>((resolve, reject) => {
    const child = spawnFn(binary, cliArgs, {
      cwd: args.cwd,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    // Close stdin immediately — the CLI doesn't receive stdin data from us,
    // and leaving the pipe open causes it to stall waiting for input in non-TTY envs.
    child.stdin?.end();

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new TimeoutError({ providerClass: CLI_PROVIDER_CLASS, timeoutMs }));
    }, timeoutMs);

    // Wire abort signal: kill the child process and reject with AbortError
    let aborted = false;
    if (args.abortSignal) {
      const signal = args.abortSignal;
      if (signal.aborted) {
        // Already aborted before we even started
        clearTimeout(timer);
        child.kill('SIGTERM');
        const err = new PactaCliAbortError({ providerClass: CLI_PROVIDER_CLASS });
        reject(err);
        aborted = true;
      } else {
        const onAbort = () => {
          aborted = true;
          clearTimeout(timer);
          child.kill('SIGTERM');
          reject(new PactaCliAbortError({ providerClass: CLI_PROVIDER_CLASS }));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        // Clean up the listener when the process closes
        child.on('close', () => {
          signal.removeEventListener('abort', onAbort);
        });
      }
    }

    child.on('error', (err) => {
      if (aborted) return;
      clearTimeout(timer);
      reject(new PactaCliSpawnError({ providerClass: CLI_PROVIDER_CLASS, binary, cause: err }));
    });

    child.on('close', (code) => {
      if (aborted) return;
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf-8'),
        stderr: Buffer.concat(stderr).toString('utf-8'),
      });
    });
  });
}

// ── Streaming Executor ──────────────────────────────────────────

/**
 * Events emitted during a streaming CLI execution.
 * The `claude --output-format stream-json` format emits NDJSON lines:
 *   {"type":"assistant","message":{"content":[{"type":"text","text":"..."}],...}}
 *   {"type":"result","result":"...","session_id":"...",...}
 */
export interface CliStreamEvent {
  type: 'text' | 'result' | 'error';
  /** Incremental text chunk (for type='text') */
  text?: string;
  /** Full result (for type='result') — raw parsed JSON from the CLI */
  data?: Record<string, unknown>;
}

export type CliStreamCallback = (event: CliStreamEvent) => void;

/**
 * Execute the Claude CLI in streaming mode (--output-format stream-json).
 * Calls `onEvent` with incremental text chunks and a final result event.
 * Returns the CliResult when the process exits.
 */
export async function executeCliStream(
  args: CliArgs,
  onEvent: CliStreamCallback,
  options: ExecutorOptions = {},
): Promise<CliResult> {
  const {
    spawnFn = nodeSpawn,
    binary = 'claude',
    timeoutMs = 300_000,
  } = options;

  // Force stream-json output format (requires --verbose)
  const cliArgs = buildCliArgs({ ...args, outputFormat: 'json' });
  // Replace --output-format json with --output-format stream-json
  const fmtIdx = cliArgs.indexOf('--output-format');
  if (fmtIdx !== -1 && cliArgs[fmtIdx + 1] === 'json') {
    cliArgs[fmtIdx + 1] = 'stream-json';
  }
  // stream-json requires --verbose
  if (!cliArgs.includes('--verbose')) {
    cliArgs.push('--verbose');
  }

  // Scrub ANTHROPIC_API_KEY — same rationale as executeCli
  const childEnv = { ...process.env };
  delete childEnv.ANTHROPIC_API_KEY;

  return new Promise<CliResult>((resolve, reject) => {
    const child = spawnFn(binary, cliArgs, {
      cwd: args.cwd,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    child.stdin?.end();

    const stderrChunks: Buffer[] = [];
    const stdoutChunks: Buffer[] = [];
    let lineBuffer = '';

    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      lineBuffer += chunk.toString('utf-8');

      // Process complete NDJSON lines
      const lines = lineBuffer.split('\n');
      // Keep the last (potentially incomplete) line in the buffer
      lineBuffer = lines.pop()!;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const obj = JSON.parse(trimmed);

          if (obj.type === 'assistant' && obj.message?.content) {
            // Extract text from content blocks
            for (const block of obj.message.content) {
              if (block.type === 'text' && typeof block.text === 'string') {
                onEvent({ type: 'text', text: block.text });
              }
            }
          } else if (obj.type === 'result') {
            onEvent({ type: 'result', data: obj });
          }
          // Ignore other event types (tool_use, tool_result, etc.)
        } catch {
          // Not valid JSON line — ignore
        }
      }
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new TimeoutError({ providerClass: CLI_PROVIDER_CLASS, timeoutMs }));
    }, timeoutMs);

    // Wire abort signal
    let aborted = false;
    if (args.abortSignal) {
      const signal = args.abortSignal;
      if (signal.aborted) {
        clearTimeout(timer);
        child.kill('SIGTERM');
        reject(new PactaCliAbortError({ providerClass: CLI_PROVIDER_CLASS }));
        aborted = true;
      } else {
        const onAbort = () => {
          aborted = true;
          clearTimeout(timer);
          child.kill('SIGTERM');
          reject(new PactaCliAbortError({ providerClass: CLI_PROVIDER_CLASS }));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        child.on('close', () => {
          signal.removeEventListener('abort', onAbort);
        });
      }
    }

    child.on('error', (err) => {
      if (aborted) return;
      clearTimeout(timer);
      reject(new PactaCliSpawnError({ providerClass: CLI_PROVIDER_CLASS, binary, cause: err }));
    });

    child.on('close', (code) => {
      if (aborted) return;
      clearTimeout(timer);

      // Process any remaining data in the line buffer
      if (lineBuffer.trim()) {
        try {
          const obj = JSON.parse(lineBuffer.trim());
          if (obj.type === 'result') {
            onEvent({ type: 'result', data: obj });
          } else if (obj.type === 'assistant' && obj.message?.content) {
            for (const block of obj.message.content) {
              if (block.type === 'text' && typeof block.text === 'string') {
                onEvent({ type: 'text', text: block.text });
              }
            }
          }
        } catch {
          // Ignore malformed trailing data
        }
      }

      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
      });
    });
  });
}

// ── Errors ───────────────────────────────────────────────────────
// Migrated to @methodts/pacta error taxonomy (PRD 051 S9).
// Re-exported here for backward compatibility.

const CLI_PROVIDER_CLASS = 'claude-cli' as const;

export { PactaCliSpawnError as CliSpawnError };
export { PactaCliExecutionError as CliExecutionError };
export { PactaCliAbortError as CliAbortError };

/**
 * @deprecated Use `TimeoutError` from `@methodts/pacta` instead.
 * Kept for backward compatibility — will be removed in a future version.
 */
export const CliTimeoutError = TimeoutError;
