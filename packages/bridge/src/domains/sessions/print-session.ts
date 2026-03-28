import PQueue from 'p-queue';
import type { Pact, AgentRequest, AgentResult, AgentProvider, AgentEvent, Agent, BudgetContract, ScopeContract, ReasoningPolicy } from '@method/pacta';
import { createAgent } from '@method/pacta';
import { claudeCliProvider, executeCliStream, type CliArgs } from '@method/pacta-provider-claude-cli';

// ── Session contract types (moved here from pty-session.ts — PRD 028 C-4) ──

export type SessionStatus = 'initializing' | 'ready' | 'working' | 'dead';

/** Minimal adaptive-settle interface — retained as structural type after PTY removal. */
export interface AdaptiveSettleDelay {
  readonly delayMs: number;
  readonly falsePositiveCount: number;
}

/** Callback for streaming text chunks during prompt execution. */
export type StreamChunkCallback = (chunk: string) => void;

export interface PtySession {
  readonly id: string;
  /** OS process ID of the outer PTY shell (null for print-mode sessions). */
  readonly pid: number | null;
  status: SessionStatus;
  /** Number of prompts queued (including the one currently in-flight). */
  queueDepth: number;
  /** Total number of prompts sent through this session. */
  promptCount: number;
  /** Timestamp of the last prompt send or response receipt. */
  lastActivityAt: Date;
  /** Full session transcript. */
  readonly transcript: string;
  /** Subscribe to live session output. Returns unsubscribe function. */
  onOutput(cb: (data: string) => void): () => void;
  /** Subscribe to session process exit. */
  onExit(cb: (exitCode: number) => void): void;
  sendPrompt(prompt: string, timeoutMs?: number, settleDelayMs?: number): Promise<{ output: string; timedOut: boolean }>;
  /**
   * Send a prompt with streaming text output via callback.
   * Emits incremental text chunks as the model generates them.
   * Falls back to sendPrompt if streaming is not supported.
   */
  sendPromptStream?(prompt: string, onChunk: StreamChunkCallback, timeoutMs?: number): Promise<{ output: string; timedOut: boolean }>;
  resize(cols: number, rows: number): void;
  kill(): void;
  /** Send CTRL-C interrupt signal. Returns true if interrupt was written. */
  interrupt(): boolean;
  /** Adaptive settle delay instance (null if disabled or print-mode). */
  readonly adaptiveSettle: AdaptiveSettleDelay | null;
}

// ── PactaSessionParams (absorbed from pacta-session.ts spike) ────

/** Bridge-level session configuration that maps to Pacta concepts. */
export interface PactaSessionParams {
  /** Session nickname (used as metadata) */
  nickname: string;

  /** Working directory for the agent */
  workdir: string;

  /** The prompt / commission text */
  prompt: string;

  /** System prompt to prepend */
  systemPrompt?: string;

  /** Maximum cost in USD (maps to budget.maxCostUsd) */
  maxCostUsd?: number;

  /** Maximum duration in ms (maps to budget.maxDurationMs) */
  maxDurationMs?: number;

  /** Maximum turns / tool cycles (maps to budget.maxTurns) */
  maxTurns?: number;

  /** Allowed tools whitelist (maps to scope.allowedTools) */
  allowedTools?: string[];

  /** Allowed filesystem paths (maps to scope.allowedPaths) */
  allowedPaths?: string[];

  /** Model to use (maps to scope.model) */
  model?: string;

  /** Reasoning effort level */
  reasoningEffort?: 'low' | 'medium' | 'high';

  /** Session mode — oneshot or resumable */
  mode?: 'oneshot' | 'resumable';

  /** Session ID for resumable sessions */
  resumeSessionId?: string;
}

/** Build a Pacta Pact from bridge session parameters. */
export function buildPactFromSessionParams(params: PactaSessionParams): Pact {
  const budget: BudgetContract | undefined =
    (params.maxCostUsd !== undefined ||
     params.maxDurationMs !== undefined ||
     params.maxTurns !== undefined)
      ? {
          maxCostUsd: params.maxCostUsd,
          maxDurationMs: params.maxDurationMs,
          maxTurns: params.maxTurns,
        }
      : undefined;

  const scope: ScopeContract | undefined =
    (params.allowedTools !== undefined ||
     params.allowedPaths !== undefined ||
     params.model !== undefined)
      ? {
          allowedTools: params.allowedTools,
          allowedPaths: params.allowedPaths,
          model: params.model,
        }
      : undefined;

  const reasoning: ReasoningPolicy | undefined =
    params.reasoningEffort !== undefined
      ? { effort: params.reasoningEffort }
      : undefined;

  return {
    mode: { type: params.mode ?? 'oneshot' },
    budget,
    scope,
    reasoning,
  };
}

/** Build an AgentRequest from bridge session parameters. */
export function buildRequestFromSessionParams(
  params: PactaSessionParams,
): AgentRequest {
  return {
    prompt: params.prompt,
    workdir: params.workdir,
    systemPrompt: params.systemPrompt,
    resumeSessionId: params.resumeSessionId,
    metadata: { nickname: params.nickname },
  };
}

// ── PrintSession ─────────────────────────────────────────────────

export interface PrintSessionOptions {
  id: string;
  workdir: string;
  initialPrompt?: string;
  /** Per-session cost cap in USD */
  maxBudgetUsd?: number;
  /** System prompt to append (bridge context injection) */
  appendSystemPrompt?: string;
  /** Permission mode (unused in Pacta layer — kept for pool.ts compatibility) */
  permissionMode?: string;
  /** Model override */
  model?: string;
  /** Additional CLI flags */
  spawnArgs?: string[];
  /**
   * @deprecated Ignored — claudeCliProvider is used internally.
   * Will be removed in a future cleanup pass (C-4/pool.ts).
   */
  llmProvider?: unknown;
  /** Override provider for testing */
  providerOverride?: AgentProvider;
  /** PRD 029: Recovered session — first prompt uses --resume instead of --session-id. */
  recovered?: boolean;
  /** PRD 029: Event callback forwarded to createAgent for lifecycle observation. */
  onEvent?: (event: AgentEvent) => void;
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

function reverseMapStopReason(stopReason: AgentResult['stopReason']): string {
  switch (stopReason) {
    case 'complete': return 'end_turn';
    case 'budget_exhausted': return 'max_turns';
    case 'timeout': return 'timeout';
    case 'killed': return 'killed';
    case 'error': return 'error';
    default: return String(stopReason);
  }
}

function agentResultToMetadata(result: AgentResult, cumulativeCostUsd: number): PrintMetadata {
  const modelUsage: PrintMetadata['model_usage'] = {};
  for (const [model, data] of Object.entries(result.cost.perModel)) {
    modelUsage[model] = {
      inputTokens: data.tokens.inputTokens,
      outputTokens: data.tokens.outputTokens,
      costUSD: data.costUsd,
    };
  }
  return {
    total_cost_usd: result.cost.totalUsd,
    num_turns: result.turns,
    duration_ms: result.durationMs,
    duration_api_ms: result.durationMs, // AgentResult has no duration_api_ms; use total as approximation
    usage: {
      input_tokens: result.usage.inputTokens,
      cache_creation_input_tokens: result.usage.cacheWriteTokens,
      cache_read_input_tokens: result.usage.cacheReadTokens,
      output_tokens: result.usage.outputTokens,
    },
    permission_denials: [],
    stop_reason: reverseMapStopReason(result.stopReason),
    subtype: result.completed ? 'success' : 'error',
    model_usage: modelUsage,
    cumulative_cost_usd: cumulativeCostUsd,
  };
}

/**
 * PRD 012 Phase 4 / PRD 028: Print-Mode Session
 *
 * Implements the PtySession interface using the Pacta composition engine + claudeCliProvider.
 * Each sendPrompt() call invokes the agent — no persistent PTY.
 * Responses are structured JSON — no regex parsing, no settle delay.
 *
 * Session continuity: claudeCliProvider tracks --session-id vs --resume
 * automatically via its invokedSessions map, keyed by session ID.
 */
export function createPrintSession(options: PrintSessionOptions): PtySession & { readonly printMetadata: PrintMetadata | null } {
  const {
    id,
    workdir,
    initialPrompt,
    maxBudgetUsd,
    appendSystemPrompt,
    model,
    providerOverride,
    recovered,
    onEvent,
  } = options;

  // Provider is created once; its invokedSessions map handles --session-id vs --resume
  const provider: AgentProvider = providerOverride ?? claudeCliProvider({ model });

  // sessionId in pact.mode is used by claudeCliProvider to track --session-id vs --resume
  const pact: Pact = {
    mode: { type: 'resumable', sessionId: id },
    budget: maxBudgetUsd !== undefined ? { maxCostUsd: maxBudgetUsd } : undefined,
    scope: model !== undefined ? { model } : undefined,
  };

  // PRD 029 BUG-1 fix: Agent is created once at session scope — not per-prompt.
  // This preserves accumulated state (cost, turns, tokens) across invocations.
  const agent: Agent = createAgent({ pact, provider, onEvent });

  const queue = new PQueue({ concurrency: 1 });

  let status: SessionStatus = 'ready'; // Print sessions start ready immediately
  let promptCount = 0;
  let lastActivityAt = new Date();
  let lastMetadata: PrintMetadata | null = null;
  let isFirstPrompt = true;

  // Transcript accumulator (stores text results)
  let transcript = '';
  const outputSubscribers = new Set<(data: string) => void>();
  const exitCallbacks: Array<(exitCode: number) => void> = [];

  /** Defeats TypeScript's control-flow narrowing for async mutations (kill() during await). */
  const getStatus = (): SessionStatus => status;

  function notifyOutput(data: string): void {
    for (const sub of outputSubscribers) {
      try { sub(data); } catch { /* subscriber errors are non-fatal */ }
    }
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

        notifyOutput(`\n[print-mode] Sending prompt #${promptCount}...\n`);

        try {
          const request: AgentRequest = {
            prompt,
            workdir,
            systemPrompt: appendSystemPrompt,
          };

          // PRD 029 BUG-2 fix: For recovered sessions, set resumeSessionId on the
          // first prompt so claudeCliProvider uses --resume instead of --session-id.
          if (recovered && isFirstPrompt) {
            request.resumeSessionId = id;
          }
          isFirstPrompt = false;

          const result: AgentResult = await agent.invoke(request);

          // Update metadata — use agent.state.totalUsd for cumulative cost (BUG-1 fix)
          lastMetadata = agentResultToMetadata(result, agent.state.totalUsd);

          // Accumulate transcript
          const output = String(result.output);
          transcript += `\n--- Prompt #${promptCount} ---\n${prompt}\n--- Response ---\n${output}\n`;

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

    sendPromptStream(prompt: string, onChunk: StreamChunkCallback, timeoutMs?: number): Promise<{ output: string; timedOut: boolean }> {
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

        try {
          // Build CLI args matching what claudeCliProvider would build
          const cliArgs: CliArgs = {
            prompt,
            print: true,
            cwd: workdir,
            model: model,
            systemPrompt: appendSystemPrompt,
          };

          // Session tracking: first prompt uses --session-id, subsequent use --resume
          if (recovered && isFirstPrompt) {
            cliArgs.resumeSessionId = id;
          } else if (isFirstPrompt) {
            cliArgs.sessionId = id;
          } else {
            cliArgs.resumeSessionId = id;
          }
          isFirstPrompt = false;

          // Execute with streaming — emits text chunks via onChunk
          let fullText = '';
          // Use a container object to avoid TS control-flow narrowing issues
          const streamState: { resultData: Record<string, unknown> | null } = { resultData: null };

          const cliResult = await executeCliStream(
            cliArgs,
            (event) => {
              if (event.type === 'text' && event.text) {
                fullText += event.text;
                onChunk(event.text);
              } else if (event.type === 'result' && event.data) {
                streamState.resultData = event.data;
              }
            },
            { timeoutMs: timeoutMs ?? 300_000 },
          );

          const resultData = streamState.resultData;

          // Build output from stream result or fallback to collected text
          const output = resultData?.result
            ? String(resultData.result)
            : fullText || cliResult.stdout.trim();

          // Build metadata from the result event if available
          if (resultData) {
            const rd = resultData as Record<string, any>;
            const modelUsage: PrintMetadata['model_usage'] = {};
            if (rd.model_usage) {
              for (const [mdl, mu] of Object.entries(rd.model_usage as Record<string, any>)) {
                modelUsage[mdl] = {
                  inputTokens: mu.input_tokens ?? 0,
                  outputTokens: mu.output_tokens ?? 0,
                  costUSD: 0,
                };
              }
            }
            const cumulativeCost = (lastMetadata?.cumulative_cost_usd ?? 0) + (rd.total_cost_usd ?? 0);
            lastMetadata = {
              total_cost_usd: rd.total_cost_usd ?? 0,
              num_turns: rd.num_turns ?? 1,
              duration_ms: rd.duration_ms ?? 0,
              duration_api_ms: rd.duration_api_ms ?? 0,
              usage: {
                input_tokens: rd.usage?.input_tokens ?? 0,
                cache_creation_input_tokens: rd.usage?.cache_creation_input_tokens ?? 0,
                cache_read_input_tokens: rd.usage?.cache_read_input_tokens ?? 0,
                output_tokens: rd.usage?.output_tokens ?? 0,
              },
              permission_denials: [],
              stop_reason: rd.stop_reason ?? 'end_turn',
              subtype: 'success',
              model_usage: modelUsage,
              cumulative_cost_usd: cumulativeCost,
            };
          }

          // Accumulate transcript
          transcript += `\n--- Prompt #${promptCount} ---\n${prompt}\n--- Response ---\n${output}\n`;
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
