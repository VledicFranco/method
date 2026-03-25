/**
 * CLI Executor — spawns the `claude` process and captures output.
 *
 * Designed for dependency injection: the spawn function can be replaced
 * in tests to avoid actually invoking the CLI.
 */

import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

// ── Types ────────────────────────────────────────────────────────

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

  if (args.resumeSessionId) {
    result.push('--resume', args.resumeSessionId);
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

  return new Promise<CliResult>((resolve, reject) => {
    const child = spawnFn(binary, cliArgs, {
      cwd: args.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new CliTimeoutError(timeoutMs));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new CliSpawnError(binary, err));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf-8'),
        stderr: Buffer.concat(stderr).toString('utf-8'),
      });
    });
  });
}

// ── Errors ───────────────────────────────────────────────────────

export class CliTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Claude CLI timed out after ${timeoutMs}ms`);
    this.name = 'CliTimeoutError';
  }
}

export class CliSpawnError extends Error {
  constructor(
    public readonly binary: string,
    public readonly cause: Error,
  ) {
    super(`Failed to spawn "${binary}": ${cause.message}`);
    this.name = 'CliSpawnError';
  }
}

export class CliExecutionError extends Error {
  constructor(
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(`Claude CLI exited with code ${exitCode}: ${stderr.slice(0, 200)}`);
    this.name = 'CliExecutionError';
  }
}
