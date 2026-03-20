/**
 * PRD 012 Phase 4: LLM Provider Strategy
 *
 * Abstraction over the underlying LLM invocation mechanism.
 * The bridge uses this to decouple session management from
 * the specific CLI/API used to invoke Claude.
 */

export interface LlmRequest {
  prompt: string;
  sessionId: string;
  /** Resume an existing conversation */
  resumeSessionId?: string;
  /** Start a fresh session with this ID (for context refresh) */
  refreshSessionId?: string;
  /** Maximum budget in USD for this invocation */
  maxBudgetUsd?: number;
  /** Additional system prompt appended to project CLAUDE.md */
  appendSystemPrompt?: string;
  /** Permission mode (default: bypassPermissions for print sessions) */
  permissionMode?: string;
  /** Output format */
  outputFormat?: 'json' | 'stream-json' | 'text';
  /** Include verbose init events in stream-json */
  verbose?: boolean;
  /** Include partial message deltas in stream-json */
  includePartialMessages?: boolean;
  /** Model override */
  model?: string;
  /** Working directory */
  workdir?: string;
  /** Additional CLI flags */
  additionalFlags?: string[];
  /** Allowed tools filter (maps to --allowedTools CLI flag) */
  allowedTools?: string[];
  /** Abort signal for cancelling in-flight invocations (e.g., on timeout) */
  signal?: AbortSignal;
}

export interface LlmUsage {
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
}

export interface LlmResponse {
  /** The agent's final text response */
  result: string;
  /** Whether the invocation succeeded */
  is_error: boolean;
  /** Duration of the full invocation */
  duration_ms: number;
  /** Duration of API calls only */
  duration_api_ms: number;
  /** Number of agentic turns */
  num_turns: number;
  /** Session ID (for resume) */
  session_id: string;
  /** Total cost in USD */
  total_cost_usd: number;
  /** Token usage breakdown */
  usage: LlmUsage;
  /** Per-model usage */
  model_usage: Record<string, { inputTokens: number; outputTokens: number; costUSD: number }>;
  /** Permission denials encountered */
  permission_denials: string[];
  /** Stop reason */
  stop_reason: string;
  /** Subtype (success, error_max_turns, etc.) */
  subtype: string;
}

export interface LlmStreamEvent {
  type: string;
  subtype?: string;
  [key: string]: unknown;
}

export interface LlmProvider {
  /** Execute a prompt and return the full result */
  invoke(request: LlmRequest): Promise<LlmResponse>;

  /** Execute a prompt and stream events via callback. Returns final result. */
  invokeStreaming(request: LlmRequest, onEvent: (event: LlmStreamEvent) => void): Promise<LlmResponse>;
}
