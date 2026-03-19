import { spawn } from 'node:child_process';
import type { LlmProvider, LlmRequest, LlmResponse, LlmStreamEvent } from './llm-provider.js';

/**
 * PRD 012 Phase 4: Claude Code CLI Provider
 *
 * Invokes `claude --print` with structured JSON output.
 * Each invoke() call spawns a new process; multi-turn is handled
 * via --resume <session_id>.
 */
export class ClaudeCodeProvider implements LlmProvider {
  private readonly claudeBin: string;

  constructor(claudeBin: string = process.env.CLAUDE_BIN ?? 'claude') {
    this.claudeBin = claudeBin;
  }

  /** Build CLI args from an LlmRequest */
  buildArgs(request: LlmRequest): string[] {
    const args: string[] = ['--print', '-p', request.prompt];

    // Output format
    const format = request.outputFormat ?? 'json';
    args.push('--output-format', format);

    // Session management
    if (request.resumeSessionId) {
      args.push('--resume', request.resumeSessionId);
    } else {
      args.push('--session-id', request.sessionId);
    }

    // Permission mode (required for headless)
    args.push('--permission-mode', request.permissionMode ?? 'bypassPermissions');

    // Optional flags
    if (request.maxBudgetUsd !== undefined) {
      args.push('--max-budget-usd', String(request.maxBudgetUsd));
    }
    if (request.appendSystemPrompt) {
      args.push('--append-system-prompt', request.appendSystemPrompt);
    }
    if (request.model) {
      args.push('--model', request.model);
    }
    if (request.verbose) {
      args.push('--verbose');
    }
    if (request.includePartialMessages) {
      args.push('--include-partial-messages');
    }
    if (request.allowedTools && request.allowedTools.length > 0) {
      args.push('--allowedTools', request.allowedTools.join(','));
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
      // Ensure the child process knows the bridge URL
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

      // AbortSignal support: kill the child process if the signal fires
      if (request.signal) {
        request.signal.addEventListener('abort', () => {
          child.kill();
        }, { once: true });
      }

      let stdout = '';
      let stderr = '';

      child.stdout!.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr!.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to spawn claude: ${err.message}`));
      });

      child.on('close', (code) => {
        if (code !== 0 && !stdout.trim()) {
          reject(new Error(`claude exited with code ${code}: ${stderr}`));
          return;
        }

        try {
          const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
          resolve(this.parseJsonResult(parsed));
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

        // Process complete JSON lines
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const event = JSON.parse(trimmed) as Record<string, unknown>;
            onEvent(event as LlmStreamEvent);

            // Capture the final result event
            if (event.type === 'result') {
              lastResult = this.parseJsonResult(event);
            }
          } catch {
            // Skip malformed lines
          }
        }
      });

      child.stderr!.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to spawn claude: ${err.message}`));
      });

      child.on('close', (code) => {
        // Process any remaining buffer
        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer.trim()) as Record<string, unknown>;
            onEvent(event as LlmStreamEvent);
            if (event.type === 'result') {
              lastResult = this.parseJsonResult(event);
            }
          } catch {
            // Skip malformed trailing data
          }
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

  /** Parse Claude Code JSON output into LlmResponse */
  private parseJsonResult(raw: Record<string, unknown>): LlmResponse {
    const usage = (raw.usage ?? {}) as Record<string, number>;
    const modelUsage = (raw.modelUsage ?? {}) as Record<string, Record<string, number>>;

    return {
      result: String(raw.result ?? ''),
      is_error: Boolean(raw.is_error),
      duration_ms: Number(raw.duration_ms ?? 0),
      duration_api_ms: Number(raw.duration_api_ms ?? 0),
      num_turns: Number(raw.num_turns ?? 0),
      session_id: String(raw.session_id ?? ''),
      total_cost_usd: Number(raw.total_cost_usd ?? 0),
      usage: {
        input_tokens: Number(usage.input_tokens ?? 0),
        cache_creation_input_tokens: Number(usage.cache_creation_input_tokens ?? 0),
        cache_read_input_tokens: Number(usage.cache_read_input_tokens ?? 0),
        output_tokens: Number(usage.output_tokens ?? 0),
      },
      model_usage: Object.fromEntries(
        Object.entries(modelUsage).map(([model, data]) => [
          model,
          {
            inputTokens: Number(data.inputTokens ?? 0),
            outputTokens: Number(data.outputTokens ?? 0),
            costUSD: Number(data.costUSD ?? 0),
          },
        ])
      ),
      permission_denials: Array.isArray(raw.permission_denials)
        ? (raw.permission_denials as string[])
        : [],
      stop_reason: String(raw.stop_reason ?? 'end_turn'),
      subtype: String(raw.subtype ?? 'success'),
    };
  }
}
