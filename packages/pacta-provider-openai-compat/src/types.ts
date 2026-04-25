// SPDX-License-Identifier: Apache-2.0
/**
 * Public options + internal OpenAI-shape wire types for the
 * `OpenAICompatibleProvider`.
 *
 * Any endpoint that speaks OpenAI's `/v1/chat/completions` shape can be
 * targeted by setting `baseUrl` accordingly:
 *  - OpenRouter:  https://openrouter.ai/api/v1
 *  - Together:    https://api.together.xyz/v1
 *  - Fireworks:   https://api.fireworks.ai/inference/v1
 *  - Groq:        https://api.groq.com/openai/v1
 *  - Cerebras:    https://api.cerebras.ai/v1
 */

// ── Public Options ──────────────────────────────────────────────────

export interface OpenAICompatibleProviderOptions {
  /** Base URL of the OpenAI-compatible endpoint, e.g. 'https://openrouter.ai/api/v1'. */
  readonly baseUrl: string;
  /** API key used as Bearer auth. */
  readonly apiKey: string;
  /** Model identifier, e.g. 'deepseek/deepseek-r1-distill-llama-70b'. */
  readonly model: string;
  /** Display name for telemetry. Default: derived from model. */
  readonly name?: string;
  /** Per-call timeout. Default 60000. */
  readonly timeoutMs?: number;
  /** Extra headers added to every request. Useful for OpenRouter's HTTP-Referer/X-Title. */
  readonly defaultHeaders?: Record<string, string>;
  /** Cost in USD per 1K input tokens. Default 0 (no cost reporting). */
  readonly costPerInputTokenUsd?: number;
  /** Cost in USD per 1K output tokens. Default 0 (no cost reporting). */
  readonly costPerOutputTokenUsd?: number;
}

// ── OpenAI Wire Types (internal) ────────────────────────────────────

/**
 * Minimal subset of the OpenAI chat-completions request shape that we
 * actually emit. Tool use, streaming, and JSON mode are intentionally
 * omitted — see provider.ts §"Scope" for rationale.
 */
export interface OpenAIChatCompletionRequest {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens?: number;
  temperature?: number;
}

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Minimal subset of the OpenAI chat-completions response shape we read.
 * `usage` is technically optional in the spec — providers occasionally
 * omit it (looking at you, certain self-hosted gateways) — so we treat
 * it defensively.
 */
export interface OpenAIChatCompletionResponse {
  id?: string;
  model?: string;
  choices: OpenAIChatChoice[];
  usage?: OpenAIUsage;
}

export interface OpenAIChatChoice {
  index?: number;
  message: { role: string; content: string | null };
  finish_reason?: string | null;
}

export interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}
