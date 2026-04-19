// SPDX-License-Identifier: Apache-2.0
/**
 * Ollama OpenAI-compatible API types — minimal subset for the provider.
 *
 * Uses Ollama's /v1/chat/completions endpoint which mirrors the OpenAI
 * chat completion API shape.
 */

// ── Request Types ─────────────────────────────────────────────────

export interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  /** Ollama-specific: keep model loaded in VRAM (seconds, -1 = forever) */
  keep_alive?: number;
}

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ── Response Types ────────────────────────────────────────────────

export interface OllamaChatResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: OllamaChoice[];
  usage: OllamaUsage;
}

export interface OllamaChoice {
  index: number;
  message: OllamaMessage;
  finish_reason: 'stop' | 'length';
}

export interface OllamaUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ── Model List Types ──────────────────────────────────────────────

export interface OllamaTagsResponse {
  models: OllamaModelInfo[];
}

export interface OllamaModelInfo {
  name: string;
  model: string;
  size: number;
  details: {
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

// ── Version/Health Types ──────────────────────────────────────────

export interface OllamaVersionResponse {
  version: string;
}
