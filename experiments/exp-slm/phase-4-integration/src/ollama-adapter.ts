/**
 * Ollama ProviderAdapter — calls Ollama's OpenAI-compatible endpoint.
 *
 * Uses the experiment's local ProviderAdapter interface (not @method/pacta)
 * so it can plug directly into createLlmMonitor() and createSLMProviderAdapter().
 *
 * Cost is always $0 (local inference on Tailscale GPU cluster).
 */

import type {
  ProviderAdapter,
  ProviderAdapterResult,
  ReadonlyWorkspaceSnapshot,
  AdapterConfig,
  TokenUsage,
} from '../../phase-1-llm-monitor/src/types.js';

// ── Config ────────────────────────────────────────────────────

export interface OllamaAdapterConfig {
  /** Ollama base URL, e.g. "http://chobits:11434". */
  baseUrl: string;
  /** Model name, e.g. "qwen3-coder:30b". */
  model: string;
  /** Max output tokens. Default: 512. */
  maxTokens?: number;
  /** Sampling temperature. Default: 0.1 (low for structured output). */
  temperature?: number;
  /** Request timeout in ms. Default: 120_000 (2 min for cold start). */
  timeoutMs?: number;
}

// ── Factory ───────────────────────────────────────────────────

export function createOllamaAdapter(config: OllamaAdapterConfig): ProviderAdapter {
  const {
    baseUrl,
    model,
    maxTokens = 512,
    temperature = 0.1,
    timeoutMs = 120_000,
  } = config;

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;

  return {
    async invoke(
      workspaceSnapshot: ReadonlyWorkspaceSnapshot,
      adapterConfig: AdapterConfig,
    ): Promise<ProviderAdapterResult> {
      const userContent = workspaceSnapshot
        .map((entry) => String(entry.content))
        .join('\n');

      const messages: Array<{ role: string; content: string }> = [];
      if (adapterConfig.systemPrompt) {
        messages.push({ role: 'system', content: adapterConfig.systemPrompt });
      }
      messages.push({ role: 'user', content: userContent });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: maxTokens,
            temperature,
            stream: false,
          }),
          signal: controller.signal,
        });

        if (!resp.ok) {
          const body = await resp.text().catch(() => '');
          throw new Error(`Ollama HTTP ${resp.status}: ${body}`);
        }

        const data = (await resp.json()) as {
          choices: Array<{ message: { content: string } }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          };
        };

        const output = data.choices?.[0]?.message?.content ?? '';
        const inputTokens = data.usage?.prompt_tokens ?? 0;
        const outputTokens = data.usage?.completion_tokens ?? 0;

        const usage: TokenUsage = {
          inputTokens,
          outputTokens,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: inputTokens + outputTokens,
        };

        return {
          output,
          usage,
          cost: {
            totalUsd: 0,
            perModel: {
              [`ollama:${model}`]: { tokens: usage, costUsd: 0 },
            },
          },
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
