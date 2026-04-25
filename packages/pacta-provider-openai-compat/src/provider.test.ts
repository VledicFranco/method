// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for OpenAICompatibleProvider — PRD 057 Wave 2.
 *
 * Uses the same global fetch override pattern as
 * pacta/src/cognitive/slm/http-bridge.test.ts to avoid an http-mock dep.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Pact, AgentRequest } from '@methodts/pacta';
import {
  OpenAICompatibleProvider,
  OpenAICompatibleApiError,
  OpenAICompatibleNetworkError,
} from './provider.js';

const realFetch = globalThis.fetch;

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function installFetchStub(handler: (req: FetchCall) => Response | Promise<Response>): {
  calls: FetchCall[];
  restore: () => void;
} {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    calls.push({ url, init });
    return handler({ url, init });
  }) as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

const MOCK_OK_BODY = {
  id: 'chatcmpl-1',
  model: 'deepseek/deepseek-r1-distill-llama-70b',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'hello world' },
      finish_reason: 'stop',
    },
  ],
  usage: {
    prompt_tokens: 11,
    completion_tokens: 7,
    total_tokens: 18,
  },
};

const PACT: Pact = { mode: { type: 'oneshot' } };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('OpenAICompatibleProvider', () => {
  let stub: { calls: FetchCall[]; restore: () => void };

  beforeEach(() => {
    stub = { calls: [], restore: () => {} };
  });
  afterEach(() => {
    stub.restore();
  });

  it('rejects construction without baseUrl/apiKey/model', () => {
    assert.throws(
      () =>
        new OpenAICompatibleProvider({
          baseUrl: '',
          apiKey: 'k',
          model: 'm',
        }),
      /baseUrl/,
    );
    assert.throws(
      () =>
        new OpenAICompatibleProvider({
          baseUrl: 'https://example.com/v1',
          apiKey: '',
          model: 'm',
        }),
      /apiKey/,
    );
    assert.throws(
      () =>
        new OpenAICompatibleProvider({
          baseUrl: 'https://example.com/v1',
          apiKey: 'k',
          model: '',
        }),
      /model/,
    );
  });

  it('reports correct capabilities', () => {
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'k',
      model: 'foo/bar',
    });
    const caps = p.capabilities();
    assert.deepEqual(caps.modes, ['oneshot']);
    assert.equal(caps.streaming, false);
    assert.equal(caps.resumable, false);
    assert.equal(caps.budgetEnforcement, 'none');
    assert.equal(caps.outputValidation, 'none');
    assert.equal(caps.toolModel, 'none');
  });

  it('derives name from model when not provided', () => {
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'k',
      model: 'deepseek/deepseek-r1-distill-llama-70b',
    });
    assert.equal(p.name, 'deepseek-r1-distill-llama-70b');

    const p2 = new OpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'k',
      model: 'mixtral-8x7b',
      name: 'custom-name',
    });
    assert.equal(p2.name, 'custom-name');
  });

  it('POSTs to {baseUrl}/chat/completions with messages[] containing the user prompt', async () => {
    stub = installFetchStub(() => jsonResponse(MOCK_OK_BODY));
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-test',
      model: 'deepseek/deepseek-r1-distill-llama-70b',
    });
    await p.invoke(PACT, { prompt: 'hi there' } satisfies AgentRequest);

    assert.equal(stub.calls.length, 1);
    const call = stub.calls[0]!;
    assert.equal(call.url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(call.init?.method, 'POST');
    const body = JSON.parse((call.init?.body as string) ?? '{}');
    assert.equal(body.model, 'deepseek/deepseek-r1-distill-llama-70b');
    assert.deepEqual(body.messages, [{ role: 'user', content: 'hi there' }]);
  });

  it('strips trailing slash from baseUrl', async () => {
    stub = installFetchStub(() => jsonResponse(MOCK_OK_BODY));
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://openrouter.ai/api/v1/',
      apiKey: 'sk-test',
      model: 'm',
    });
    await p.invoke(PACT, { prompt: 'x' });
    assert.equal(stub.calls[0]!.url, 'https://openrouter.ai/api/v1/chat/completions');
  });

  it('prepends a system message when systemPrompt is set', async () => {
    stub = installFetchStub(() => jsonResponse(MOCK_OK_BODY));
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'k',
      model: 'm',
    });
    await p.invoke(PACT, { prompt: 'user-text', systemPrompt: 'be terse' });

    const body = JSON.parse((stub.calls[0]!.init?.body as string) ?? '{}');
    assert.deepEqual(body.messages, [
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'user-text' },
    ]);
  });

  it('sends Authorization Bearer + content-type + defaultHeaders', async () => {
    stub = installFetchStub(() => jsonResponse(MOCK_OK_BODY));
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-secret',
      model: 'm',
      defaultHeaders: {
        'HTTP-Referer': 'https://method.dev',
        'X-Title': 'method',
      },
    });
    await p.invoke(PACT, { prompt: 'q' });

    const headers = (stub.calls[0]!.init?.headers ?? {}) as Record<string, string>;
    assert.equal(headers['authorization'], 'Bearer sk-secret');
    assert.equal(headers['content-type'], 'application/json');
    assert.equal(headers['HTTP-Referer'], 'https://method.dev');
    assert.equal(headers['X-Title'], 'method');
  });

  it('unpacks response into AgentResult with output and token usage', async () => {
    stub = installFetchStub(() => jsonResponse(MOCK_OK_BODY));
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'k',
      model: 'deepseek/deepseek-r1-distill-llama-70b',
    });
    const result = await p.invoke(PACT, { prompt: 'q' });

    assert.equal(result.output, 'hello world');
    assert.equal(result.completed, true);
    assert.equal(result.stopReason, 'complete');
    assert.equal(result.turns, 1);
    assert.ok(result.sessionId.length > 0);
    assert.equal(result.usage.inputTokens, 11);
    assert.equal(result.usage.outputTokens, 7);
    assert.equal(result.usage.cacheReadTokens, 0);
    assert.equal(result.usage.cacheWriteTokens, 0);
    assert.equal(result.usage.totalTokens, 18);
  });

  it('emits undefined confidence — OpenAI shape has no native confidence', async () => {
    stub = installFetchStub(() => jsonResponse(MOCK_OK_BODY));
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'k',
      model: 'm',
    });
    const result = await p.invoke(PACT, { prompt: 'q' });
    assert.equal(result.confidence, undefined);
  });

  it('reports zero cost when no rates configured, but populates perModel', async () => {
    stub = installFetchStub(() => jsonResponse(MOCK_OK_BODY));
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'k',
      model: 'm',
    });
    const result = await p.invoke(PACT, { prompt: 'q' });
    assert.equal(result.cost.totalUsd, 0);
    assert.ok(result.cost.perModel['m']);
    assert.equal(result.cost.perModel['m']!.tokens.totalTokens, 18);
  });

  it('computes cost from configured rates', async () => {
    stub = installFetchStub(() => jsonResponse(MOCK_OK_BODY));
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'k',
      model: 'm',
      // 11 input * (1/1000) + 7 output * (2/1000) = 0.011 + 0.014 = 0.025
      costPerInputTokenUsd: 1,
      costPerOutputTokenUsd: 2,
    });
    const result = await p.invoke(PACT, { prompt: 'q' });
    assert.ok(Math.abs(result.cost.totalUsd - 0.025) < 1e-9);
    assert.ok(Math.abs(result.cost.perModel['m']!.costUsd - 0.025) < 1e-9);
  });

  it('treats missing usage block defensively (zeros)', async () => {
    stub = installFetchStub(() =>
      jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'x' } }],
      }),
    );
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'k',
      model: 'm',
    });
    const result = await p.invoke(PACT, { prompt: 'q' });
    assert.equal(result.usage.inputTokens, 0);
    assert.equal(result.usage.outputTokens, 0);
    assert.equal(result.usage.totalTokens, 0);
    assert.equal(result.output, 'x');
  });

  it('throws OpenAICompatibleApiError on non-2xx', async () => {
    stub = installFetchStub(
      () =>
        new Response('rate limited', {
          status: 429,
          headers: { 'content-type': 'text/plain' },
        }),
    );
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'k',
      model: 'm',
    });
    await assert.rejects(
      () => p.invoke(PACT, { prompt: 'q' }),
      (err: unknown) => {
        assert.ok(err instanceof OpenAICompatibleApiError);
        assert.equal(err.statusCode, 429);
        assert.match(err.responseBody, /rate limited/);
        return true;
      },
    );
  });

  it('throws OpenAICompatibleNetworkError on fetch rejection', async () => {
    stub = installFetchStub(() => {
      throw new TypeError('connect ECONNREFUSED');
    });
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'k',
      model: 'm',
    });
    await assert.rejects(
      () => p.invoke(PACT, { prompt: 'q' }),
      OpenAICompatibleNetworkError,
    );
  });
});
