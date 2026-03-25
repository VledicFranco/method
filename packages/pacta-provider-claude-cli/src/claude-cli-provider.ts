/**
 * Claude CLI Provider — AgentProvider implementation for Claude Code CLI.
 *
 * Wraps `claude --print` for oneshot invocations and `claude --resume`
 * for resumable sessions. Does not support streaming (CLI is batch).
 */

import type {
  AgentProvider,
  ProviderCapabilities,
  Resumable,
  Pact,
  AgentRequest,
  AgentResult,
  TokenUsage,
  CostReport,
} from '@method/pacta';

import {
  executeCli,
  CliExecutionError,
  type ExecutorOptions,
  type CliArgs,
} from './cli-executor.js';

// ── Options ──────────────────────────────────────────────────────

export interface ClaudeCliProviderOptions {
  /** CLI binary name (default: 'claude') */
  binary?: string;

  /** Default model override */
  model?: string;

  /** Execution timeout in ms (default: 300_000) */
  timeoutMs?: number;

  /** Override spawn function for testing */
  executorOptions?: ExecutorOptions;
}

// ── Provider Type ────────────────────────────────────────────────

export type ClaudeCliProvider = AgentProvider & Resumable;

// ── Capabilities ─────────────────────────────────────────────────

const CAPABILITIES: ProviderCapabilities = {
  modes: ['oneshot', 'resumable'],
  streaming: false,
  resumable: true,
  budgetEnforcement: 'none',
  outputValidation: 'client',
  toolModel: 'builtin',
};

// ── Factory ──────────────────────────────────────────────────────

/**
 * Create a Claude CLI AgentProvider.
 *
 * @param options - Configuration for the CLI provider
 * @returns AgentProvider & Resumable implementation
 */
export function claudeCliProvider(
  options: ClaudeCliProviderOptions = {},
): ClaudeCliProvider {
  const {
    binary = 'claude',
    model,
    timeoutMs = 300_000,
    executorOptions = {},
  } = options;

  const execOpts: ExecutorOptions = {
    ...executorOptions,
    binary: executorOptions.binary ?? binary,
    timeoutMs: executorOptions.timeoutMs ?? timeoutMs,
  };

  async function invokeImpl<T>(
    pact: Pact<T>,
    request: AgentRequest,
    resumeSessionId?: string,
  ): Promise<AgentResult<T>> {
    const startTime = Date.now();

    const cliArgs: CliArgs = {
      prompt: request.prompt,
      print: true,
      cwd: request.workdir,
      resumeSessionId: resumeSessionId ?? request.resumeSessionId,
      model: pact.scope?.model ?? model,
      systemPrompt: request.systemPrompt,
      allowedTools: pact.scope?.allowedTools,
    };

    const result = await executeCli(cliArgs, execOpts);

    if (result.exitCode !== 0) {
      throw new CliExecutionError(result.exitCode, result.stderr);
    }

    const durationMs = Date.now() - startTime;
    const output = result.stdout.trim() as unknown as T;

    // Parse session ID from stderr if available (claude CLI outputs session info to stderr)
    const sessionId = parseSessionId(result.stderr) ?? crypto.randomUUID();

    return {
      output,
      sessionId,
      completed: true,
      stopReason: 'complete',
      usage: emptyUsage(),
      cost: emptyCost(),
      durationMs,
      turns: 1,
    };
  }

  return {
    name: 'claude-cli',

    capabilities(): ProviderCapabilities {
      return CAPABILITIES;
    },

    invoke<T>(pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>> {
      return invokeImpl(pact, request);
    },

    resume<T>(
      sessionId: string,
      pact: Pact<T>,
      request: AgentRequest,
    ): Promise<AgentResult<T>> {
      return invokeImpl(pact, request, sessionId);
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────

function parseSessionId(stderr: string): string | undefined {
  // Claude CLI may output session ID in various formats
  const match = stderr.match(/session[_\s]*(?:id)?[:\s]+([a-f0-9-]+)/i);
  return match?.[1];
}

function emptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
  };
}

function emptyCost(): CostReport {
  return {
    totalUsd: 0,
    perModel: {},
  };
}
