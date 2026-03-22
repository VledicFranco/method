import PQueue from 'p-queue';
import { ClaudeCodeProvider } from './strategy/claude-code-provider.js';
import type { LlmResponse } from './strategy/llm-provider.js';
import type { PtySession, SessionStatus } from './pty-session.js';
import type { AdaptiveSettleDelay } from './adaptive-settle.js';

export interface PrintSessionOptions {
  id: string;
  workdir: string;
  claudeBin?: string;
  initialPrompt?: string;
  /** Per-session cost cap in USD */
  maxBudgetUsd?: number;
  /** System prompt to append (bridge context injection) */
  appendSystemPrompt?: string;
  /** Permission mode (default: bypassPermissions) */
  permissionMode?: string;
  /** Model override */
  model?: string;
  /** Additional CLI flags */
  spawnArgs?: string[];
}

/** Rich metadata from the last print-mode invocation */
export interface PrintMetadata {
  total_cost_usd: number;
  num_turns: number;
  duration_ms: number;
  duration_api_ms: number;
  usage: {
    input_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    output_tokens: number;
  };
  permission_denials: string[];
  stop_reason: string;
  subtype: string;
  model_usage: Record<string, { inputTokens: number; outputTokens: number; costUSD: number }>;
  /** Cumulative cost across all prompts in this session */
  cumulative_cost_usd: number;
}

/**
 * PRD 012 Phase 4: Print-Mode Session
 *
 * Implements the PtySession interface using `claude --print --resume`.
 * Each sendPrompt() call spawns a new process — no persistent PTY.
 * Responses are structured JSON — no regex parsing, no settle delay.
 */
export function createPrintSession(options: PrintSessionOptions): PtySession & { readonly printMetadata: PrintMetadata | null } {
  const {
    id,
    workdir,
    claudeBin,
    initialPrompt,
    maxBudgetUsd,
    appendSystemPrompt,
    permissionMode,
    model,
    spawnArgs,
  } = options;

  const provider = new ClaudeCodeProvider(claudeBin);
  const queue = new PQueue({ concurrency: 1 });

  let status: SessionStatus = 'ready'; // Print sessions start ready immediately
  let promptCount = 0;
  let lastActivityAt = new Date();
  let cumulativeCostUsd = 0;
  let lastMetadata: PrintMetadata | null = null;

  // Transcript accumulator (stores text results)
  let transcript = '';
  const outputSubscribers = new Set<(data: string) => void>();
  const exitCallbacks: Array<(exitCode: number) => void> = [];

  // Whether the first prompt has been sent (for --session-id vs --resume)
  let firstPromptSent = false;

  /** Defeats TypeScript's control-flow narrowing for async mutations (kill() during await). */
  const getStatus = (): SessionStatus => status;

  function notifyOutput(data: string): void {
    for (const sub of outputSubscribers) {
      try { sub(data); } catch { /* subscriber errors are non-fatal */ }
    }
  }

  function buildSessionFlags(): string[] {
    const flags: string[] = [];
    if (spawnArgs) flags.push(...spawnArgs);
    return flags;
  }

  const session: PtySession & { readonly printMetadata: PrintMetadata | null } = {
    id,

    get pid() { return null; },

    get status() { return status; },
    set status(s: SessionStatus) { status = s; },

    get queueDepth() { return queue.size + queue.pending; },

    get promptCount() { return promptCount; },
    set promptCount(n: number) { promptCount = n; },

    get lastActivityAt() { return lastActivityAt; },
    set lastActivityAt(d: Date) { lastActivityAt = d; },

    get transcript() { return transcript; },

    onOutput(cb: (data: string) => void): () => void {
      outputSubscribers.add(cb);
      return () => { outputSubscribers.delete(cb); };
    },

    onExit(cb: (exitCode: number) => void): void {
      exitCallbacks.push(cb);
    },

    sendPrompt(prompt: string, _timeoutMs?: number, _settleDelayMs?: number): Promise<{ output: string; timedOut: boolean }> {
      if (status === 'dead') {
        return Promise.reject(new Error(`Session ${id} is dead — cannot send prompt`));
      }

      return queue.add(async () => {
        if (status === 'dead') {
          throw new Error(`Session ${id} is dead — cannot send prompt`);
        }

        status = 'working';
        promptCount++;
        lastActivityAt = new Date();

        // Notify subscribers that we're starting
        notifyOutput(`\n[print-mode] Sending prompt #${promptCount}...\n`);

        try {
          const response: LlmResponse = await provider.invoke({
            prompt,
            sessionId: id,
            resumeSessionId: firstPromptSent ? id : undefined,
            maxBudgetUsd,
            appendSystemPrompt,
            permissionMode: permissionMode ?? 'bypassPermissions',
            outputFormat: 'json',
            model,
            workdir,
            additionalFlags: buildSessionFlags(),
          });

          firstPromptSent = true;

          // Update metadata
          cumulativeCostUsd += response.total_cost_usd;
          lastMetadata = {
            total_cost_usd: response.total_cost_usd,
            num_turns: response.num_turns,
            duration_ms: response.duration_ms,
            duration_api_ms: response.duration_api_ms,
            usage: response.usage,
            permission_denials: response.permission_denials,
            stop_reason: response.stop_reason,
            subtype: response.subtype,
            model_usage: response.model_usage,
            cumulative_cost_usd: cumulativeCostUsd,
          };

          // Accumulate transcript
          const output = response.result;
          transcript += `\n--- Prompt #${promptCount} ---\n${prompt}\n--- Response ---\n${output}\n`;

          // Notify output subscribers
          notifyOutput(output);

          lastActivityAt = new Date();
          if (getStatus() !== 'dead') {
            status = 'ready';
          }

          return { output, timedOut: false };
        } catch (err) {
          lastActivityAt = new Date();
          if (getStatus() !== 'dead') {
            status = 'ready';
          }

          const errorMsg = (err as Error).message;
          notifyOutput(`\n[print-mode] Error: ${errorMsg}\n`);

          // Return error as output rather than throwing — matches PtySession behavior
          return { output: `Error: ${errorMsg}`, timedOut: false };
        }
      }) as Promise<{ output: string; timedOut: boolean }>;
    },

    resize(_cols: number, _rows: number): void {
      // No-op for print sessions — no PTY to resize
    },

    kill(): void {
      status = 'dead';
      outputSubscribers.clear();
      for (const cb of exitCallbacks) {
        try { cb(0); } catch { /* exit callback errors are non-fatal */ }
      }
    },

    interrupt(): boolean {
      // No-op for print sessions — no PTY process to interrupt
      return false;
    },

    get adaptiveSettle(): AdaptiveSettleDelay | null {
      return null; // Print sessions don't use settle delay
    },

    get printMetadata(): PrintMetadata | null {
      return lastMetadata;
    },
  };

  // Handle initial prompt if provided
  if (initialPrompt) {
    session.sendPrompt(initialPrompt).catch(() => {
      // Initial prompt failure is non-fatal
    });
  }

  return session;
}
