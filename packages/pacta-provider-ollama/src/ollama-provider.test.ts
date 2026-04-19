// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ollamaProvider, OllamaApiError } from './ollama-provider.js';
import type { Pact } from '@methodts/pacta';

// ── Mock Fetch ───────────────────────────────────────────────────

function mockFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
): typeof globalThis.fetch {
  return handler as unknown as typeof globalThis.fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CHAT_RESPONSE = {
  id: 'chatcmpl-1',
  object: 'chat.completion' as const,
  created: 1700000000,
  model: 'qwen3-coder:30b',
  choices: [{
    index: 0,
    message: { role: 'assistant' as const, content: '{"status":"ok"}' },
    finish_reason: 'stop' as const,
  }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

const TAGS_RESPONSE = {
  models: [
    { name: 'qwen3-coder:30b', model: 'qwen3-coder:30b', size: 18e9, details: { family: 'qwen3moe', parameter_size: '30.5B', quantization_level: 'Q4_K_M' } },
    { name: 'smollm2:135m', model: 'smollm2:135m', size: 135e6, details: { family: 'smollm', parameter_size: '135M', quantization_level: 'F16' } },
  ],
};

// ── Tests ────────────────────────────────────────────────────────

describe('ollamaProvider', () => {
  it('returns correct name and capabilities', () => {
    const provider = ollamaProvider({ fetchFn: mockFetch(async () => jsonResponse({})) });
    assert.equal(provider.name, 'ollama');
    const caps = provider.capabilities();
    assert.deepEqual(caps.modes, ['oneshot']);
    assert.equal(caps.streaming, false);
    assert.equal(caps.resumable, false);
    assert.equal(caps.toolModel, 'none');
  });

  it('init() discovers available models', async () => {
    const provider = ollamaProvider({
      fetchFn: mockFetch(async (url) => {
        if (url.includes('/api/tags')) return jsonResponse(TAGS_RESPONSE);
        return jsonResponse({});
      }),
    });
    await provider.init();
    const caps = provider.capabilities();
    assert.deepEqual(caps.models, ['qwen3-coder:30b', 'smollm2:135m']);
  });

  it('init() does not throw when Ollama is unreachable', async () => {
    const provider = ollamaProvider({
      fetchFn: mockFetch(async () => { throw new Error('ECONNREFUSED'); }),
    });
    await provider.init(); // should not throw
    assert.equal(provider.capabilities().models, undefined);
  });

  it('invoke() sends correct request shape', async () => {
    let capturedBody: unknown;
    const provider = ollamaProvider({
      model: 'qwen3-coder:30b',
      fetchFn: mockFetch(async (_url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return jsonResponse(CHAT_RESPONSE);
      }),
    });

    const pact: Pact<string> = { mode: { type: 'oneshot' } };
    await provider.invoke(pact, { prompt: 'test prompt', systemPrompt: 'be helpful' });

    const body = capturedBody as Record<string, unknown>;
    assert.equal(body.model, 'qwen3-coder:30b');
    assert.equal(body.stream, false);
    const messages = body.messages as Array<{ role: string; content: string }>;
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'system');
    assert.equal(messages[0].content, 'be helpful');
    assert.equal(messages[1].role, 'user');
    assert.equal(messages[1].content, 'test prompt');
  });

  it('invoke() returns well-formed AgentResult', async () => {
    const provider = ollamaProvider({
      fetchFn: mockFetch(async () => jsonResponse(CHAT_RESPONSE)),
    });

    const pact: Pact<string> = { mode: { type: 'oneshot' } };
    const result = await provider.invoke(pact, { prompt: 'test' });

    assert.equal(result.output, '{"status":"ok"}');
    assert.equal(result.completed, true);
    assert.equal(result.stopReason, 'complete');
    assert.equal(result.usage.inputTokens, 10);
    assert.equal(result.usage.outputTokens, 5);
    assert.equal(result.usage.totalTokens, 15);
    assert.equal(result.usage.cacheReadTokens, 0);
    assert.equal(result.usage.cacheWriteTokens, 0);
    assert.equal(result.cost.totalUsd, 0);
    assert.equal(result.turns, 1);
    assert.ok(result.sessionId);
    assert.ok(result.durationMs >= 0);
  });

  it('invoke() uses pact.scope.model when provided', async () => {
    let capturedModel: string | undefined;
    const provider = ollamaProvider({
      model: 'default-model',
      fetchFn: mockFetch(async (_url, init) => {
        const body = JSON.parse(init?.body as string);
        capturedModel = body.model;
        return jsonResponse(CHAT_RESPONSE);
      }),
    });

    const pact: Pact<string> = {
      mode: { type: 'oneshot' },
      scope: { model: 'smollm2:135m' },
    };
    await provider.invoke(pact, { prompt: 'test' });

    assert.equal(capturedModel, 'smollm2:135m');
  });

  it('invoke() omits system message when systemPrompt is absent', async () => {
    let capturedMessages: unknown;
    const provider = ollamaProvider({
      fetchFn: mockFetch(async (_url, init) => {
        const body = JSON.parse(init?.body as string);
        capturedMessages = body.messages;
        return jsonResponse(CHAT_RESPONSE);
      }),
    });

    const pact: Pact<string> = { mode: { type: 'oneshot' } };
    await provider.invoke(pact, { prompt: 'test' });

    const messages = capturedMessages as Array<{ role: string }>;
    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, 'user');
  });

  it('invoke() returns budget_exhausted on length finish_reason', async () => {
    const lengthResponse = {
      ...CHAT_RESPONSE,
      choices: [{ ...CHAT_RESPONSE.choices[0], finish_reason: 'length' }],
    };

    const provider = ollamaProvider({
      fetchFn: mockFetch(async () => jsonResponse(lengthResponse)),
    });

    const pact: Pact<string> = { mode: { type: 'oneshot' } };
    const result = await provider.invoke(pact, { prompt: 'test' });

    assert.equal(result.completed, false);
    assert.equal(result.stopReason, 'budget_exhausted');
  });

  it('invoke() throws OllamaApiError on HTTP error', async () => {
    const provider = ollamaProvider({
      fetchFn: mockFetch(async () => new Response('model not found', { status: 404 })),
    });

    const pact: Pact<string> = { mode: { type: 'oneshot' } };
    await assert.rejects(
      () => provider.invoke(pact, { prompt: 'test' }),
      (err: unknown) => {
        assert.ok(err instanceof OllamaApiError);
        assert.equal(err.statusCode, 404);
        assert.ok(err.responseBody.includes('model not found'));
        return true;
      },
    );
  });

  it('invoke() returns timeout result when request exceeds timeoutMs', async () => {
    const provider = ollamaProvider({
      timeoutMs: 50,
      fetchFn: mockFetch(async (_url, init) => {
        // Wait until abort fires
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        });
      }),
    });

    const pact: Pact<string> = { mode: { type: 'oneshot' } };
    const result = await provider.invoke(pact, { prompt: 'test' });

    assert.equal(result.completed, false);
    assert.equal(result.stopReason, 'timeout');
  });

  it('invoke() propagates caller abort signal', async () => {
    const abortController = new AbortController();
    const provider = ollamaProvider({
      timeoutMs: 60_000,
      fetchFn: mockFetch(async (_url, init) => {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        });
      }),
    });

    const pact: Pact<string> = { mode: { type: 'oneshot' } };
    // Abort after a short delay
    setTimeout(() => abortController.abort(), 20);
    const result = await provider.invoke(pact, {
      prompt: 'test',
      abortSignal: abortController.signal,
    });

    assert.equal(result.completed, false);
    assert.equal(result.stopReason, 'killed');
  });

  it('dispose() is a no-op and does not throw', async () => {
    const provider = ollamaProvider({
      fetchFn: mockFetch(async () => jsonResponse({})),
    });
    await provider.dispose(); // should not throw
  });
});
