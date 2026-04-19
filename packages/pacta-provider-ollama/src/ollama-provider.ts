// SPDX-License-Identifier: Apache-2.0
/**
 * Ollama AgentProvider — connects to local or remote Ollama instances via
 * the OpenAI-compatible /v1/chat/completions endpoint.
 *
 * Designed for the RFC 002 heterogeneous architecture: small models (135M-30B)
 * running on commodity GPUs, callable from cognitive modules at $0/call.
 */

import { randomUUID } from 'node:crypto';
import type {
  AgentProvider,
  ProviderCapabilities,
  Lifecycle,
  Pact,
  AgentRequest,
  AgentResult,
  TokenUsage,
  CostReport,
} from '@methodts/pacta';
import type { OllamaChatRequest, OllamaChatResponse, OllamaTagsResponse } from './types.js';

// ── Options ──────────────────────────────────────────────────────

export interface OllamaProviderOptions {
  /** Base URL for the Ollama API (default: 'http://localhost:11434') */
  baseUrl?: string;

  /** Default model to use when pact.scope.model is not set */
  model?: string;

  /** Default max output tokens (default: 2048) */
  maxOutputTokens?: number;

  /** Default temperature (default: 0.1) */
  temperature?: number;

  /** Request timeout in milliseconds (default: 60000) */
  timeoutMs?: number;

  /** Keep model loaded in VRAM — seconds, -1 = forever (default: 300) */
  keepAlive?: number;

  /** Custom fetch function for testing */
  fetchFn?: typeof globalThis.fetch;
}

// ── Provider Type ────────────────────────────────────────────────

export type OllamaProvider = AgentProvider & Lifecycle;

// ── Capabilities ─────────────────────────────────────────────────

const CAPABILITIES: ProviderCapabilities = {
  modes: ['oneshot'],
  streaming: false,
  resumable: false,
  budgetEnforcement: 'none',
  outputValidation: 'client',
  toolModel: 'none',
};

// ── Error ────────────────────────────────────────────────────────

export class OllamaApiError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;
  constructor(statusCode: number, responseBody: string) {
    super(`Ollama API error ${statusCode}: ${responseBody}`);
    this.name = 'OllamaApiError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

// ── Factory ──────────────────────────────────────────────────────

export function ollamaProvider(options: OllamaProviderOptions = {}): OllamaProvider {
  const baseUrl = (options.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
  const defaultModel = options.model ?? 'qwen3-coder:30b';
  const defaultMaxTokens = options.maxOutputTokens ?? 2048;
  const defaultTemperature = options.temperature ?? 0.1;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const keepAlive = options.keepAlive ?? 300;
  const fetchFn = options.fetchFn ?? globalThis.fetch;

  let availableModels: string[] | undefined;

  return {
    name: 'ollama',

    capabilities(): ProviderCapabilities {
      return availableModels
        ? { ...CAPABILITIES, models: availableModels }
        : CAPABILITIES;
    },

    async init(): Promise<void> {
      // Discover available models on the Ollama instance
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchFn(`${baseUrl}/api/tags`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const data = (await res.json()) as OllamaTagsResponse;
          availableModels = data.models.map((m) => m.name);
        }
      } catch {
        // Non-fatal — models list is optional
      } finally {
        clearTimeout(timer);
      }
    },

    async dispose(): Promise<void> {
      // No persistent resources to clean up
    },

    async invoke<T>(pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>> {
      const startTime = Date.now();
      const model = pact.scope?.model ?? defaultModel;
      const maxTokens = pact.budget?.maxOutputTokens ?? defaultMaxTokens;

      // Build messages
      const messages: OllamaChatRequest['messages'] = [];
      if (request.systemPrompt) {
        messages.push({ role: 'system', content: request.systemPrompt });
      }
      messages.push({ role: 'user', content: request.prompt });

      const body: OllamaChatRequest = {
        model,
        messages,
        max_tokens: maxTokens,
        temperature: defaultTemperature,
        stream: false,
        keep_alive: keepAlive,
      };

      // Make request with timeout + abort signal
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      // Propagate caller's abort signal
      if (request.abortSignal) {
        request.abortSignal.addEventListener('abort', () => controller.abort(), { once: true });
      }

      try {
        const res = await fetchFn(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errorBody = await res.text();
          throw new OllamaApiError(res.status, errorBody);
        }

        const data = (await res.json()) as OllamaChatResponse;
        const choice = data.choices[0];
        const output = choice?.message?.content ?? '';
        const finishReason = choice?.finish_reason ?? 'stop';

        const usage: TokenUsage = {
          inputTokens: data.usage?.prompt_tokens ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: data.usage?.total_tokens ?? 0,
        };

        const cost: CostReport = { totalUsd: 0, perModel: {} };

        return {
          output: output as unknown as T,
          sessionId: randomUUID(),
          completed: finishReason === 'stop',
          stopReason: finishReason === 'stop' ? 'complete' : 'budget_exhausted',
          usage,
          cost,
          durationMs: Date.now() - startTime,
          turns: 1,
        };
      } catch (error) {
        if (error instanceof OllamaApiError) throw error;

        const isAbort =
          error instanceof DOMException && error.name === 'AbortError';
        const isTimeout = isAbort && !request.abortSignal?.aborted;

        if (isTimeout) {
          return {
            output: '' as unknown as T,
            sessionId: randomUUID(),
            completed: false,
            stopReason: 'timeout',
            usage: emptyUsage(),
            cost: { totalUsd: 0, perModel: {} },
            durationMs: Date.now() - startTime,
            turns: 0,
          };
        }

        // Caller abort
        if (isAbort) {
          return {
            output: '' as unknown as T,
            sessionId: randomUUID(),
            completed: false,
            stopReason: 'killed',
            usage: emptyUsage(),
            cost: { totalUsd: 0, perModel: {} },
            durationMs: Date.now() - startTime,
            turns: 0,
          };
        }

        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────

function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 };
}
