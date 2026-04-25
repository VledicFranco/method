// SPDX-License-Identifier: Apache-2.0
/**
 * OpenAICompatibleProvider — AgentProvider for any OpenAI-compatible
 * `/v1/chat/completions` endpoint (OpenRouter, Together, Fireworks, Groq,
 * Cerebras, vLLM, llama.cpp's HTTP shim, ...).
 *
 * Designed as the mid-tier in PRD 057's SLM → mid → frontier cascade:
 * cheap reasoning models like DeepSeek-R1-Distill or Kimi via OpenRouter
 * sit between a local SLM and a frontier (Anthropic) provider.
 *
 * Scope: oneshot only. No tool use, no streaming, no JSON-mode, no
 * sessions. The cascade falls back to higher tiers when those features
 * are needed; this tier exists to answer simple prompts cheaply. Adding
 * tool use later means matching every backend's quirks (OpenRouter
 * supports it, Groq partially, Cerebras barely) — out of scope for the
 * Wave 2 deliverable.
 *
 * @see docs/prds/057-slm-cascade-infrastructure.md
 */

import type {
  AgentProvider,
  ProviderCapabilities,
  Pact,
  AgentRequest,
  AgentResult,
  TokenUsage,
} from '@methodts/pacta';

import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIChatMessage,
  OpenAICompatibleProviderOptions,
} from './types.js';

// ── Errors ──────────────────────────────────────────────────────────

export class OpenAICompatibleApiError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;

  constructor(statusCode: number, responseBody: string) {
    super(`OpenAI-compatible API error (${statusCode}): ${responseBody}`);
    this.name = 'OpenAICompatibleApiError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

export class OpenAICompatibleNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'OpenAICompatibleNetworkError';
  }
}

// ── Capabilities ────────────────────────────────────────────────────

const CAPABILITIES: ProviderCapabilities = {
  modes: ['oneshot'],
  streaming: false,
  resumable: false,
  budgetEnforcement: 'none',
  outputValidation: 'none',
  toolModel: 'none',
};

// ── Provider ────────────────────────────────────────────────────────

export class OpenAICompatibleProvider implements AgentProvider {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly defaultHeaders: Record<string, string>;
  private readonly costPerInputTokenUsd: number;
  private readonly costPerOutputTokenUsd: number;

  constructor(options: OpenAICompatibleProviderOptions) {
    if (!options.baseUrl) throw new Error('OpenAICompatibleProvider: baseUrl is required.');
    if (!options.apiKey) throw new Error('OpenAICompatibleProvider: apiKey is required.');
    if (!options.model) throw new Error('OpenAICompatibleProvider: model is required.');

    // Strip trailing slash so we can reliably append `/chat/completions`.
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.name = options.name ?? deriveName(options.model);
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.defaultHeaders = { ...(options.defaultHeaders ?? {}) };
    this.costPerInputTokenUsd = options.costPerInputTokenUsd ?? 0;
    this.costPerOutputTokenUsd = options.costPerOutputTokenUsd ?? 0;
  }

  capabilities(): ProviderCapabilities {
    return CAPABILITIES;
  }

  async invoke<T>(_pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>> {
    const start = Date.now();
    const sessionId =
      typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `oai-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const messages = buildMessages(request);
    const body: OpenAIChatCompletionRequest = {
      model: this.model,
      messages,
    };

    const url = `${this.baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey}`,
      ...this.defaultHeaders,
    };

    // Honor inbound abort signal AND wall-clock timeout.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    const onUpstreamAbort = () => controller.abort();
    if (request.abortSignal) {
      if (request.abortSignal.aborted) {
        controller.abort();
      } else {
        request.abortSignal.addEventListener('abort', onUpstreamAbort, { once: true });
      }
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new OpenAICompatibleNetworkError(
        `Network error calling ${url}: ${(err as Error).message ?? String(err)}`,
        { cause: err },
      );
    } finally {
      clearTimeout(timeoutId);
      if (request.abortSignal) {
        request.abortSignal.removeEventListener('abort', onUpstreamAbort);
      }
    }

    if (!response.ok) {
      const text = await safeReadText(response);
      throw new OpenAICompatibleApiError(response.status, text);
    }

    const json = (await response.json()) as OpenAIChatCompletionResponse;
    const output = extractOutput(json);
    const usage = mapUsage(json);
    const cost = this.computeCost(usage);

    return {
      output: output as unknown as T,
      sessionId,
      completed: true,
      stopReason: 'complete',
      usage,
      cost: {
        totalUsd: cost,
        perModel: {
          [this.model]: { tokens: usage, costUsd: cost },
        },
      },
      durationMs: Date.now() - start,
      turns: 1,
      // OpenAI-shape responses do not carry a calibrated confidence signal.
      confidence: undefined,
    };
  }

  private computeCost(usage: TokenUsage): number {
    const inputCost = (usage.inputTokens / 1000) * this.costPerInputTokenUsd;
    const outputCost = (usage.outputTokens / 1000) * this.costPerOutputTokenUsd;
    return inputCost + outputCost;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function buildMessages(request: AgentRequest): OpenAIChatMessage[] {
  const messages: OpenAIChatMessage[] = [];
  if (request.systemPrompt) {
    messages.push({ role: 'system', content: request.systemPrompt });
  }
  messages.push({ role: 'user', content: request.prompt });
  return messages;
}

function extractOutput(json: OpenAIChatCompletionResponse): string {
  const first = json.choices?.[0];
  if (!first) return '';
  const content = first.message?.content;
  return content ?? '';
}

function mapUsage(json: OpenAIChatCompletionResponse): TokenUsage {
  const u = json.usage;
  const inputTokens = u?.prompt_tokens ?? 0;
  const outputTokens = u?.completion_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: u?.total_tokens ?? inputTokens + outputTokens,
  };
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function deriveName(model: string): string {
  // Take the trailing path segment for slash-namespaced model IDs
  // (e.g. 'deepseek/deepseek-r1-distill-llama-70b' → 'deepseek-r1-distill-llama-70b').
  const slashIdx = model.lastIndexOf('/');
  return slashIdx >= 0 ? model.slice(slashIdx + 1) : model;
}
