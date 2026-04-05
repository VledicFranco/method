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

// ── JSON Response Shape ───────────────────────────────────────────

interface ClaudeJsonResponse {
  result?: string;
  session_id?: string;
  num_turns?: number;
  stop_reason?: string;
  total_cost_usd?: number;
  model_usage?: Record<string, {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

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

  /**
   * Tracks which session IDs have been invoked at least once.
   * First invocation uses --session-id; subsequent uses --resume.
   */
  const invokedSessions = new Map<string, boolean>();

  async function invokeImpl<T>(
    pact: Pact<T>,
    request: AgentRequest,
    resumeSessionId?: string,
  ): Promise<AgentResult<T>> {
    const startTime = Date.now();

    // Determine session tracking args
    const modeSessionId =
      pact.mode.type === 'resumable' ? pact.mode.sessionId : undefined;

    const cliArgs: CliArgs = {
      prompt: request.prompt,
      print: true,
      cwd: request.workdir,
      model: pact.scope?.model ?? model,
      systemPrompt: request.systemPrompt,
      allowedTools: pact.scope?.allowedTools,
      abortSignal: request.abortSignal,
      clearHistory: request.clearHistory,
    };

    if (resumeSessionId) {
      // Called via provider.resume() — always use --resume
      cliArgs.resumeSessionId = resumeSessionId;
    } else if (modeSessionId) {
      if (request.clearHistory) {
        // Fresh start: reset tracked state, use --session-id.
        // We re-add after invoking so the next call resumes.
        invokedSessions.delete(modeSessionId);
        cliArgs.sessionId = modeSessionId;
        // Mark as invoked immediately so next call uses --resume
        invokedSessions.set(modeSessionId, true);
      } else if (!invokedSessions.has(modeSessionId)) {
        // First invocation — use --session-id
        cliArgs.sessionId = modeSessionId;
        invokedSessions.set(modeSessionId, true);
      } else {
        // Subsequent invocation — use --resume
        cliArgs.resumeSessionId = modeSessionId;
      }
    } else if (request.resumeSessionId) {
      // Fallback: use resumeSessionId from request
      cliArgs.resumeSessionId = request.resumeSessionId;
    }

    const result = await executeCli(cliArgs, execOpts);

    if (result.exitCode !== 0) {
      throw new CliExecutionError({
        providerClass: 'claude-cli',
        exitCode: result.exitCode,
        stderr: result.stderr,
      });
    }

    const durationMs = Date.now() - startTime;

    // Attempt to parse stdout as JSON (--output-format json)
    let output: T;
    let sessionId: string;
    let turns = 1;
    let stopReason: AgentResult['stopReason'] = 'complete';
    let usage: TokenUsage = emptyUsage();
    let cost: CostReport = emptyCost();

    const trimmed = result.stdout.trim();
    let parsed: ClaudeJsonResponse | null = null;
    try {
      parsed = JSON.parse(trimmed) as ClaudeJsonResponse;
    } catch {
      // Not JSON — fall through to plain-text handling
    }

    if (parsed !== null) {
      // Map JSON fields to AgentResult
      output = (parsed.result ?? trimmed) as unknown as T;

      // Session ID: prefer JSON response, fall back to stderr parsing
      sessionId =
        parsed.session_id ??
        parseSessionId(result.stderr) ??
        crypto.randomUUID();

      turns = parsed.num_turns ?? 1;
      stopReason = mapStopReason(parsed.stop_reason);

      // Cost
      cost = {
        totalUsd: parsed.total_cost_usd ?? 0,
        perModel: {},
      };

      if (parsed.model_usage) {
        for (const [mdl, mu] of Object.entries(parsed.model_usage)) {
          const modelTokens: TokenUsage = {
            inputTokens: mu.input_tokens ?? 0,
            outputTokens: mu.output_tokens ?? 0,
            cacheWriteTokens: mu.cache_creation_input_tokens ?? 0,
            cacheReadTokens: mu.cache_read_input_tokens ?? 0,
            totalTokens:
              (mu.input_tokens ?? 0) +
              (mu.output_tokens ?? 0),
          };
          cost.perModel[mdl] = { tokens: modelTokens, costUsd: 0 };
        }
      }

      // Usage (top-level aggregated)
      if (parsed.usage) {
        const u = parsed.usage;
        usage = {
          inputTokens: u.input_tokens ?? 0,
          outputTokens: u.output_tokens ?? 0,
          cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
          cacheReadTokens: u.cache_read_input_tokens ?? 0,
          totalTokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
        };
      }
    } else {
      // Plain text fallback
      output = trimmed as unknown as T;
      sessionId =
        parseSessionId(result.stderr) ?? crypto.randomUUID();
    }

    return {
      output,
      sessionId,
      completed: true,
      stopReason,
      usage,
      cost,
      durationMs,
      turns,
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

function mapStopReason(raw?: string): AgentResult['stopReason'] {
  switch (raw) {
    case 'end_turn':
      return 'complete';
    case 'max_turns':
      return 'budget_exhausted';
    case 'timeout':
      return 'timeout';
    case 'killed':
    case 'interrupted':
      return 'killed';
    case 'error':
      return 'error';
    default:
      return 'complete';
  }
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
