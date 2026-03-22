import { spawn } from 'node:child_process';
import { buildCliArgs, parseClaudeOutput, type ClaudeHeadlessConfig } from '@method/methodts';
import type { AgentResult } from '@method/methodts';
import type { LlmProvider, LlmRequest, LlmResponse, LlmStreamEvent } from './llm-provider.js';

/**
 * Claude Code CLI Provider — delegates to @method/methodts for arg building
 * and output parsing, wraps result as LlmResponse for bridge consumption.
 *
 * invoke() uses methodts's buildCliArgs + parseClaudeOutput as the canonical
 * implementation. invokeStreaming() retains bridge-native streaming logic
 * (stream-json format) which methodts doesn't yet support.
 */
export class ClaudeCodeProvider implements LlmProvider {
  private readonly claudeBin: string;

  constructor(claudeBin: string = process.env.CLAUDE_BIN ?? 'claude') {
    this.claudeBin = claudeBin;
  }

  /** Convert an LlmRequest to ClaudeHeadlessConfig + args for methodts */
  private toMethodTSConfig(request: LlmRequest): ClaudeHeadlessConfig {
    return {
      claudeBin: this.claudeBin,
      model: request.model,
      maxBudgetUsd: request.maxBudgetUsd,
      workdir: request.workdir,
      allowedTools: request.allowedTools,
    };
  }

  /** Convert methodts AgentResult to bridge LlmResponse */
  private toLlmResponse(agent: AgentResult, request: LlmRequest): LlmResponse {
    return {
      result: agent.raw,
      is_error: false,
      duration_ms: agent.cost.duration_ms,
      duration_api_ms: agent.cost.duration_ms, // methodts doesn't separate API vs total
      num_turns: agent.numTurns ?? 0,
      session_id: agent.sessionId ?? request.sessionId,
      total_cost_usd: agent.cost.usd,
      usage: agent.usage ? {
        input_tokens: agent.usage.inputTokens,
        cache_creation_input_tokens: agent.usage.cacheCreationTokens,
        cache_read_input_tokens: agent.usage.cacheReadTokens,
        output_tokens: agent.usage.outputTokens,
      } : { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 },
      model_usage: agent.modelUsage ? Object.fromEntries(
        Object.entries(agent.modelUsage).map(([model, data]) => [
          model, { inputTokens: data.inputTokens, outputTokens: data.outputTokens, costUSD: data.costUsd }
        ])
      ) : {},
      permission_denials: agent.permissionDenials ? [...agent.permissionDenials] : [],
      stop_reason: agent.stopReason ?? 'end_turn',
      subtype: 'success',
    };
  }

  /** Build CLI args — delegates to methodts buildCliArgs + adds bridge-specific flags */
  buildArgs(request: LlmRequest): string[] {
    // Validate session management
    if (request.refreshSessionId && request.resumeSessionId) {
      throw new Error(
        'Cannot set both refreshSessionId and resumeSessionId. ' +
        'Use one or the other, not both.'
      );
    }

    const config = this.toMethodTSConfig(request);
    const sessionId = request.refreshSessionId ?? request.sessionId;
    const resumeSessionId = request.resumeSessionId;

    // Use methodts canonical arg builder with explicit overrides (no methodts defaults leaking)
    const configExplicit: ClaudeHeadlessConfig = {
      claudeBin: this.claudeBin,
      model: request.model,           // undefined if not set — methodts won't add --model
      maxBudgetUsd: request.maxBudgetUsd, // undefined if not set
      workdir: request.workdir,
      allowedTools: request.allowedTools,
    };
    const args = buildCliArgs(request.prompt, configExplicit, sessionId, resumeSessionId);

    // Strip any methodts defaults that leaked (model, budget) when bridge didn't request them
    for (const flag of ['--model', '--max-budget-usd']) {
      if (flag === '--model' && request.model === undefined) {
        const idx = args.indexOf(flag);
        if (idx >= 0) args.splice(idx, 2);
      }
      if (flag === '--max-budget-usd' && request.maxBudgetUsd === undefined) {
        const idx = args.indexOf(flag);
        if (idx >= 0) args.splice(idx, 2);
      }
    }

    // Override output format (methodts defaults to json, but bridge may want stream-json)
    const formatIdx = args.indexOf('--output-format');
    if (formatIdx >= 0 && request.outputFormat) {
      args[formatIdx + 1] = request.outputFormat;
    }

    // Bridge-specific flags not in methodts
    const permMode = request.permissionMode ?? 'bypassPermissions';
    const pmIdx = args.indexOf('--permission-mode');
    if (pmIdx >= 0) {
      args[pmIdx + 1] = permMode;
    } else {
      args.push('--permission-mode', permMode);
    }
    if (request.appendSystemPrompt) {
      args.push('--append-system-prompt', request.appendSystemPrompt);
    }
    if (request.verbose) {
      args.push('--verbose');
    }
    if (request.includePartialMessages) {
      args.push('--include-partial-messages');
    }
    if (request.additionalFlags) {
      args.push(...request.additionalFlags);
    }

    return args;
  }

  /** Build environment variables for the child process */
  private buildEnv(request: LlmRequest): Record<string, string> {
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (request.workdir) {
      env.BRIDGE_URL = process.env.BRIDGE_URL ?? `http://localhost:${process.env.PORT ?? '3456'}`;
      env.BRIDGE_SESSION_ID = request.sessionId;
    }
    return env;
  }

  async invoke(request: LlmRequest): Promise<LlmResponse> {
    const args = this.buildArgs({ ...request, outputFormat: 'json' });
    const env = this.buildEnv(request);

    return new Promise<LlmResponse>((resolve, reject) => {
      const child = spawn(this.claudeBin, args, {
        cwd: request.workdir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      if (request.signal) {
        request.signal.addEventListener('abort', () => {
          child.kill();
        }, { once: true });
      }

      let stdout = '';
      let stderr = '';

      child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      child.on('error', (err) => {
        reject(new Error(`Failed to spawn claude: ${err.message}`));
      });

      child.on('close', (code) => {
        if (code !== 0 && !stdout.trim()) {
          reject(new Error(`claude exited with code ${code}: ${stderr}`));
          return;
        }

        try {
          // Use methodts canonical output parser
          const agentResult = parseClaudeOutput(stdout.trim());
          resolve(this.toLlmResponse(agentResult, request));
        } catch (e) {
          reject(new Error(`Failed to parse claude JSON output: ${(e as Error).message}\nstdout: ${stdout.substring(0, 500)}`));
        }
      });
    });
  }

  async invokeStreaming(request: LlmRequest, onEvent: (event: LlmStreamEvent) => void): Promise<LlmResponse> {
    const args = this.buildArgs({
      ...request,
      outputFormat: 'stream-json',
      verbose: true,
      includePartialMessages: true,
    });
    const env = this.buildEnv(request);

    return new Promise<LlmResponse>((resolve, reject) => {
      const child = spawn(this.claudeBin, args, {
        cwd: request.workdir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let buffer = '';
      let lastResult: LlmResponse | null = null;
      let stderr = '';

      child.stdout!.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const event = JSON.parse(trimmed) as Record<string, unknown>;
            onEvent(event as LlmStreamEvent);

            if (event.type === 'result') {
              const agentResult = parseClaudeOutput(trimmed);
              lastResult = this.toLlmResponse(agentResult, request);
            }
          } catch {
            // Skip malformed lines
          }
        }
      });

      child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      child.on('error', (err) => {
        reject(new Error(`Failed to spawn claude: ${err.message}`));
      });

      child.on('close', (code) => {
        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer.trim()) as Record<string, unknown>;
            onEvent(event as LlmStreamEvent);
            if (event.type === 'result') {
              const agentResult = parseClaudeOutput(buffer.trim());
              lastResult = this.toLlmResponse(agentResult, request);
            }
          } catch { /* Skip malformed trailing data */ }
        }

        if (lastResult) {
          resolve(lastResult);
        } else if (code !== 0) {
          reject(new Error(`claude exited with code ${code}: ${stderr}`));
        } else {
          reject(new Error('claude stream ended without a result event'));
        }
      });
    });
  }
}
