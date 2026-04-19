// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for Anthropic Messages API Provider.
 *
 * All HTTP calls are mocked — no actual Anthropic API calls are made.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  Pact,
  AgentRequest,
  AgentEvent,
  ProviderCapabilities,
  ToolProvider,
  ToolDefinition,
  ToolResult,
} from '@methodts/pacta';
import Anthropic from '@anthropic-ai/sdk';
import { anthropicProvider } from './anthropic-provider.js';
import { RateLimitError } from '@methodts/pacta';
import type {
  AnthropicMessagesResponse,
  AnthropicMessagesRequest,
} from './types.js';
import { parseSseChunk } from './sse-parser.js';
import { mapUsage, calculateCost } from './pricing.js';

/**
 * Create an Anthropic client wired to a mock fetch function.
 *
 * `maxRetries: 0` disables the SDK's built-in 429/5xx retry backoff so
 * non-200 mocks fail fast instead of triggering minute-long exponential
 * waits inside unit tests.
 */
function makeClient(apiKey: string, fetchFn: typeof globalThis.fetch): Anthropic {
  return new Anthropic({ apiKey, fetch: fetchFn, maxRetries: 0 });
}

// ── Mock Helpers ─────────────────────────────────────────────────

/**
 * Normalize the SDK's HeadersInit (which may be a Headers instance, a
 * plain record, or undefined) to a flat record so test assertions can
 * read `headers['x-api-key']` regardless of SDK internals.
 */
function normalizeHeaders(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  if (h instanceof Headers) return Object.fromEntries(h.entries());
  if (Array.isArray(h)) return Object.fromEntries(h);
  return h as Record<string, string>;
}

function mockFetch(
  responseBody: unknown,
  status = 200,
): { fetchFn: typeof globalThis.fetch; capturedRequests: { url: string; init: RequestInit }[] } {
  const capturedRequests: { url: string; init: RequestInit }[] = [];

  const fetchFn = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const normalizedInit: RequestInit = init
      ? { ...init, headers: normalizeHeaders(init.headers) }
      : {};
    capturedRequests.push({ url, init: normalizedInit });

    if (status !== 200) {
      return new Response(
        typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody),
        { status, statusText: 'Error' },
      );
    }

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return { fetchFn: fetchFn as typeof globalThis.fetch, capturedRequests };
}

function mockStreamingFetch(
  sseText: string,
  status = 200,
): { fetchFn: typeof globalThis.fetch } {
  const fetchFn = async (): Promise<Response> => {
    if (status !== 200) {
      return new Response(sseText, { status, statusText: 'Error' });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sseText));
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };

  return { fetchFn: fetchFn as typeof globalThis.fetch };
}

function makeResponse(overrides: Partial<AnthropicMessagesResponse> = {}): AnthropicMessagesResponse {
  return {
    id: 'msg_test123',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello from Claude!' }],
    model: 'claude-sonnet-4-6',
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 100,
      output_tokens: 50,
    },
    ...overrides,
  };
}

function makeToolProvider(
  tools: ToolDefinition[],
  executeImpl: (name: string, input: unknown) => Promise<ToolResult>,
): ToolProvider {
  return {
    list: () => tools,
    execute: executeImpl,
  };
}

// ── Test Fixtures ────────────────────────────────────────────────

const basePact: Pact<string> = {
  mode: { type: 'oneshot' },
};

const baseRequest: AgentRequest = {
  prompt: 'Hello, world!',
};

// ── Tests: Provider Capabilities ─────────────────────────────────

describe('anthropicProvider', () => {
  describe('capabilities', () => {
    it('returns correct capabilities', () => {
      const { fetchFn } = mockFetch({});
      const provider = anthropicProvider({ client: makeClient('test-key', fetchFn) });
      const caps: ProviderCapabilities = provider.capabilities();

      assert.deepStrictEqual(caps.modes, ['oneshot']);
      assert.strictEqual(caps.streaming, true);
      assert.strictEqual(caps.resumable, false);
      assert.strictEqual(caps.budgetEnforcement, 'client');
      assert.strictEqual(caps.outputValidation, 'client');
      assert.strictEqual(caps.toolModel, 'function');
    });

    it('has name "anthropic"', () => {
      const { fetchFn } = mockFetch({});
      const provider = anthropicProvider({ client: makeClient('test-key', fetchFn) });
      assert.strictEqual(provider.name, 'anthropic');
    });
  });

  // ── Tests: Request Construction ─────────────────────────────────

  describe('invoke — request construction', () => {
    it('constructs correct API request body', async () => {
      const response = makeResponse();
      const { fetchFn, capturedRequests } = mockFetch(response);

      const provider = anthropicProvider({ client: makeClient('sk-test-key', fetchFn) });
      await provider.invoke(basePact, baseRequest);

      assert.strictEqual(capturedRequests.length, 1);
      const req = capturedRequests[0];

      assert.strictEqual(req.url, 'https://api.anthropic.com/v1/messages');
      assert.strictEqual(req.init.method, 'POST');

      // normalizeHeaders lowercases all keys (Headers API normalizes), so
      // assertions read the canonical lowercase names.
      const headers = req.init.headers as Record<string, string>;
      assert.strictEqual(headers['x-api-key'], 'sk-test-key');
      assert.strictEqual(headers['anthropic-version'], '2023-06-01');
      assert.strictEqual(headers['content-type'], 'application/json');

      const body = JSON.parse(req.init.body as string) as AnthropicMessagesRequest;
      assert.strictEqual(body.model, 'claude-sonnet-4-6');
      // SDK 0.80.0 omits `stream` for non-streaming calls (absence implies false).
      assert.ok(body.stream === false || body.stream === undefined);
      assert.deepStrictEqual(body.messages, [
        { role: 'user', content: 'Hello, world!' },
      ]);
    });

    it('uses model from pact scope', async () => {
      const response = makeResponse();
      const { fetchFn, capturedRequests } = mockFetch(response);

      const pact: Pact<string> = {
        mode: { type: 'oneshot' },
        scope: { model: 'claude-opus-4-20250514' },
      };

      const provider = anthropicProvider({ client: makeClient('sk-test', fetchFn) });
      await provider.invoke(pact, baseRequest);

      const body = JSON.parse(capturedRequests[0].init.body as string) as AnthropicMessagesRequest;
      assert.strictEqual(body.model, 'claude-opus-4-20250514');
    });

    it('includes system prompt when provided', async () => {
      const response = makeResponse();
      const { fetchFn, capturedRequests } = mockFetch(response);

      const request: AgentRequest = {
        prompt: 'test',
        systemPrompt: 'You are a helpful assistant.',
      };

      const provider = anthropicProvider({ client: makeClient('sk-test', fetchFn) });
      await provider.invoke(basePact, request);

      const body = JSON.parse(capturedRequests[0].init.body as string) as AnthropicMessagesRequest;
      assert.strictEqual(body.system, 'You are a helpful assistant.');
    });

    it('uses custom baseUrl', async () => {
      const response = makeResponse();
      const { fetchFn, capturedRequests } = mockFetch(response);

      const provider = anthropicProvider({
        client: new Anthropic({
          apiKey: 'sk-test',
          fetch: fetchFn,
          baseURL: 'https://custom-proxy.example.com',
        }),
      });
      await provider.invoke(basePact, baseRequest);

      assert.strictEqual(
        capturedRequests[0].url,
        'https://custom-proxy.example.com/v1/messages',
      );
    });

    it('includes tools when toolProvider is configured', async () => {
      const response = makeResponse();
      const { fetchFn, capturedRequests } = mockFetch(response);

      const tp = makeToolProvider(
        [
          { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
          { name: 'write_file', description: 'Write a file', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } } },
        ],
        async () => ({ output: 'ok' }),
      );

      const provider = anthropicProvider({ client: makeClient('sk-test', fetchFn), toolProvider: tp });
      await provider.invoke(basePact, baseRequest);

      const body = JSON.parse(capturedRequests[0].init.body as string) as AnthropicMessagesRequest;
      assert.ok(body.tools);
      assert.strictEqual(body.tools!.length, 2);
      assert.strictEqual(body.tools![0].name, 'read_file');
      assert.strictEqual(body.tools![1].name, 'write_file');
    });

    it('filters tools by pact scope allowedTools', async () => {
      const response = makeResponse();
      const { fetchFn, capturedRequests } = mockFetch(response);

      const tp = makeToolProvider(
        [
          { name: 'read_file', description: 'Read' },
          { name: 'write_file', description: 'Write' },
          { name: 'delete_file', description: 'Delete' },
        ],
        async () => ({ output: 'ok' }),
      );

      const pact: Pact<string> = {
        mode: { type: 'oneshot' },
        scope: { allowedTools: ['read_file', 'write_file'] },
      };

      const provider = anthropicProvider({ client: makeClient('sk-test', fetchFn), toolProvider: tp });
      await provider.invoke(pact, baseRequest);

      const body = JSON.parse(capturedRequests[0].init.body as string) as AnthropicMessagesRequest;
      assert.strictEqual(body.tools!.length, 2);
      const names = body.tools!.map((t) => t.name);
      assert.ok(names.includes('read_file'));
      assert.ok(names.includes('write_file'));
      assert.ok(!names.includes('delete_file'));
    });

    it('uses maxOutputTokens from budget contract', async () => {
      const response = makeResponse();
      const { fetchFn, capturedRequests } = mockFetch(response);

      const pact: Pact<string> = {
        mode: { type: 'oneshot' },
        budget: { maxOutputTokens: 4096 },
      };

      const provider = anthropicProvider({ client: makeClient('sk-test', fetchFn) });
      await provider.invoke(pact, baseRequest);

      const body = JSON.parse(capturedRequests[0].init.body as string) as AnthropicMessagesRequest;
      assert.strictEqual(body.max_tokens, 4096);
    });

    it('throws when no API key is available', async () => {
      const { fetchFn } = mockFetch({});
      // Unset env var for this test
      const saved = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      try {
        // SDK 0.80.0 throws on construction with missing apiKey; fall back to
        // catching the constructor error if invoke is never reached.
        await assert.rejects(
          async () => {
            const provider = anthropicProvider({
              client: new Anthropic({ apiKey: '', fetch: fetchFn, maxRetries: 0 }),
            });
            await provider.invoke(basePact, baseRequest);
          },
          (err: Error) => {
            const m = err.message.toLowerCase();
            assert.ok(
              m.includes('api') || m.includes('apikey') || m.includes('authentication'),
              `Expected auth-related error, got: ${err.message}`,
            );
            return true;
          },
        );
      } finally {
        if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
      }
    });
  });

  // ── Tests: Response Mapping ────────────────────────────────────

  describe('invoke — response mapping', () => {
    it('maps response to AgentResult correctly', async () => {
      const response = makeResponse({
        content: [{ type: 'text', text: 'The answer is 42.' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      const { fetchFn } = mockFetch(response);

      const provider = anthropicProvider({ client: makeClient('sk-test', fetchFn) });
      const result = await provider.invoke(basePact, baseRequest);

      assert.strictEqual(result.output, 'The answer is 42.');
      assert.strictEqual(result.completed, true);
      assert.strictEqual(result.stopReason, 'complete');
      assert.strictEqual(result.turns, 1);
      assert.ok(result.sessionId, 'should have a session ID');
      assert.ok(result.durationMs >= 0, 'should have non-negative duration');
    });

    it('maps max_tokens stop reason to budget_exhausted', async () => {
      const response = makeResponse({ stop_reason: 'max_tokens' });
      const { fetchFn } = mockFetch(response);

      const provider = anthropicProvider({ client: makeClient('sk-test', fetchFn) });
      const result = await provider.invoke(basePact, baseRequest);

      assert.strictEqual(result.stopReason, 'budget_exhausted');
    });

    it('throws RateLimitError on 429 response', async () => {
      const { fetchFn } = mockFetch('Rate limit exceeded', 429);

      const provider = anthropicProvider({ client: makeClient('sk-test', fetchFn) });
      await assert.rejects(
        () => provider.invoke(basePact, baseRequest),
        (err: Error) => {
          assert.ok(err instanceof RateLimitError, `expected RateLimitError, got ${err.constructor.name}: ${err.message}`);
          return true;
        },
      );
    });

    it('concatenates multiple text blocks', async () => {
      const response = makeResponse({
        content: [
          { type: 'text', text: 'Part 1. ' },
          { type: 'text', text: 'Part 2.' },
        ],
      });
      const { fetchFn } = mockFetch(response);

      const provider = anthropicProvider({ client: makeClient('sk-test', fetchFn) });
      const result = await provider.invoke(basePact, baseRequest);

      assert.strictEqual(result.output, 'Part 1. Part 2.');
    });
  });

  // ── Tests: Tool Use Loop ──────────────────────────────────────

  describe('invoke — tool use loop', () => {
    it('handles tool_use → tool_result → final response', async () => {
      let callCount = 0;

      const fetchFn = async (
        _input: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        callCount++;

        if (callCount === 1) {
          // First call: model requests tool use
          const toolResponse = makeResponse({
            stop_reason: 'tool_use',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_123',
                name: 'read_file',
                input: { path: '/tmp/test.txt' },
              },
            ],
          });
          return new Response(JSON.stringify(toolResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Second call: model produces final response
        const finalResponse = makeResponse({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'File contents: hello world' }],
          usage: { input_tokens: 200, output_tokens: 30 },
        });
        return new Response(JSON.stringify(finalResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      let toolExecuted = false;
      const tp = makeToolProvider(
        [{ name: 'read_file', description: 'Read a file' }],
        async (name, input) => {
          toolExecuted = true;
          assert.strictEqual(name, 'read_file');
          assert.deepStrictEqual(input, { path: '/tmp/test.txt' });
          return { output: 'hello world' };
        },
      );

      const provider = anthropicProvider({
        client: makeClient('sk-test', fetchFn as typeof globalThis.fetch),
        toolProvider: tp,
      });

      const result = await provider.invoke(basePact, baseRequest);

      assert.ok(toolExecuted, 'tool should have been executed');
      assert.strictEqual(result.output, 'File contents: hello world');
      assert.strictEqual(result.completed, true);
      assert.strictEqual(result.turns, 2);
      assert.strictEqual(callCount, 2);
    });

    it('includes tool results in follow-up messages', async () => {
      let callCount = 0;
      const capturedBodies: AnthropicMessagesRequest[] = [];

      const fetchFn = async (
        _input: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        callCount++;
        if (init?.body) {
          capturedBodies.push(JSON.parse(init.body as string));
        }

        const jsonHeaders = { 'Content-Type': 'application/json' };

        if (callCount === 1) {
          return new Response(JSON.stringify(makeResponse({
            stop_reason: 'tool_use',
            content: [
              { type: 'tool_use', id: 'toolu_abc', name: 'calc', input: { x: 2 } },
            ],
          })), { status: 200, headers: jsonHeaders });
        }

        return new Response(JSON.stringify(makeResponse({
          content: [{ type: 'text', text: 'result: 4' }],
        })), { status: 200, headers: jsonHeaders });
      };

      const tp = makeToolProvider(
        [{ name: 'calc' }],
        async () => ({ output: '4' }),
      );

      const provider = anthropicProvider({
        client: makeClient('sk-test', fetchFn as typeof globalThis.fetch),
        toolProvider: tp,
      });

      await provider.invoke(basePact, baseRequest);

      // Second request should include the tool result
      assert.strictEqual(capturedBodies.length, 2);
      const secondBody = capturedBodies[1];
      assert.strictEqual(secondBody.messages.length, 3);

      // user, assistant (tool_use), user (tool_result)
      assert.strictEqual(secondBody.messages[0].role, 'user');
      assert.strictEqual(secondBody.messages[1].role, 'assistant');
      assert.strictEqual(secondBody.messages[2].role, 'user');

      const toolResultContent = secondBody.messages[2].content;
      assert.ok(Array.isArray(toolResultContent));
      const toolResult = (toolResultContent as Array<{ type: string; tool_use_id: string; content: string }>)[0];
      assert.strictEqual(toolResult.type, 'tool_result');
      assert.strictEqual(toolResult.tool_use_id, 'toolu_abc');
      assert.strictEqual(toolResult.content, '4');
    });

    it('throws when model requests tool use but no toolProvider', async () => {
      const response = makeResponse({
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'some_tool', input: {} },
        ],
      });
      const { fetchFn } = mockFetch(response);

      const provider = anthropicProvider({ client: makeClient('sk-test', fetchFn) });

      await assert.rejects(
        () => provider.invoke(basePact, baseRequest),
        (err: Error) => {
          assert.ok(err.message.includes('ToolProvider'));
          return true;
        },
      );
    });
  });

  // ── Tests: Streaming ──────────────────────────────────────────

  describe('stream — SSE event parsing', () => {
    it('emits typed AgentEvent objects from SSE stream', async () => {
      const sseText = [
        'event: message_start',
        `data: ${JSON.stringify({
          type: 'message_start',
          message: {
            id: 'msg_1', type: 'message', role: 'assistant',
            content: [], model: 'claude-sonnet-4-6',
            stop_reason: null,
            usage: { input_tokens: 50, output_tokens: 0 },
          },
        })}`,
        '',
        'event: content_block_start',
        `data: ${JSON.stringify({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        })}`,
        '',
        'event: content_block_delta',
        `data: ${JSON.stringify({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hello!' },
        })}`,
        '',
        'event: content_block_stop',
        `data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}`,
        '',
        'event: message_delta',
        `data: ${JSON.stringify({
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 10 },
        })}`,
        '',
        'event: message_stop',
        `data: ${JSON.stringify({ type: 'message_stop' })}`,
        '',
        '',
      ].join('\n');

      const { fetchFn } = mockStreamingFetch(sseText);
      const provider = anthropicProvider({ client: makeClient('sk-test', fetchFn) });

      const events: AgentEvent[] = [];
      for await (const event of provider.stream(basePact, baseRequest)) {
        events.push(event);
      }

      // Should have: started, text, turn_complete, completed
      const types = events.map((e) => e.type);
      assert.ok(types.includes('started'), 'should emit started event');
      assert.ok(types.includes('text'), 'should emit text event');
      assert.ok(types.includes('turn_complete'), 'should emit turn_complete');
      assert.ok(types.includes('completed'), 'should emit completed event');

      const textEvent = events.find((e) => e.type === 'text');
      assert.ok(textEvent && textEvent.type === 'text');
      assert.strictEqual(textEvent.content, 'Hello!');

      const completedEvent = events.find((e) => e.type === 'completed');
      assert.ok(completedEvent && completedEvent.type === 'completed');
      assert.strictEqual(completedEvent.result, 'Hello!');
    });

    it('emits tool_use events during streaming', async () => {
      const sseText = [
        'event: message_start',
        `data: ${JSON.stringify({
          type: 'message_start',
          message: {
            id: 'msg_2', type: 'message', role: 'assistant',
            content: [], model: 'claude-sonnet-4-6',
            stop_reason: null,
            usage: { input_tokens: 50, output_tokens: 0 },
          },
        })}`,
        '',
        'event: content_block_start',
        `data: ${JSON.stringify({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'toolu_stream_1', name: 'read_file', input: {} },
        })}`,
        '',
        'event: content_block_delta',
        `data: ${JSON.stringify({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"path":' },
        })}`,
        '',
        'event: content_block_delta',
        `data: ${JSON.stringify({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '"/tmp/f.txt"}' },
        })}`,
        '',
        'event: content_block_stop',
        `data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}`,
        '',
        'event: message_delta',
        `data: ${JSON.stringify({
          type: 'message_delta',
          delta: { stop_reason: 'tool_use' },
          usage: { output_tokens: 20 },
        })}`,
        '',
        'event: message_stop',
        `data: ${JSON.stringify({ type: 'message_stop' })}`,
        '',
        '',
      ].join('\n');

      // Second call returns final text (non-streaming for simplicity — we test the first streaming turn)
      let callCount = 0;
      const fetchFn = async (): Promise<Response> => {
        callCount++;
        if (callCount === 1) {
          const encoder = new TextEncoder();
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode(sseText));
              controller.close();
            },
          });
          return new Response(stream, { status: 200 });
        }
        // Second call: final response (also streaming)
        const finalSse = [
          'event: message_start',
          `data: ${JSON.stringify({
            type: 'message_start',
            message: {
              id: 'msg_3', type: 'message', role: 'assistant',
              content: [], model: 'claude-sonnet-4-6',
              stop_reason: null,
              usage: { input_tokens: 100, output_tokens: 0 },
            },
          })}`,
          '',
          'event: content_block_start',
          `data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}`,
          '',
          'event: content_block_delta',
          `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'File content here' } })}`,
          '',
          'event: content_block_stop',
          `data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}`,
          '',
          'event: message_delta',
          `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 15 } })}`,
          '',
          'event: message_stop',
          `data: ${JSON.stringify({ type: 'message_stop' })}`,
          '',
          '',
        ].join('\n');
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(finalSse));
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      };

      const tp = makeToolProvider(
        [{ name: 'read_file' }],
        async () => ({ output: 'file contents' }),
      );

      const provider = anthropicProvider({
        client: makeClient('sk-test', fetchFn as typeof globalThis.fetch),
        toolProvider: tp,
      });

      const events: AgentEvent[] = [];
      for await (const event of provider.stream(basePact, baseRequest)) {
        events.push(event);
      }

      const types = events.map((e) => e.type);
      assert.ok(types.includes('tool_use'), 'should emit tool_use event');
      assert.ok(types.includes('tool_result'), 'should emit tool_result event');

      const toolUseEvent = events.find((e) => e.type === 'tool_use');
      assert.ok(toolUseEvent && toolUseEvent.type === 'tool_use');
      assert.strictEqual(toolUseEvent.tool, 'read_file');
      assert.strictEqual(toolUseEvent.toolUseId, 'toolu_stream_1');
    });
  });
});

// ── Tests: SSE Parser ───────────────────────────────────────────

describe('parseSseChunk', () => {
  it('parses complete SSE events', () => {
    const chunk = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_1"}}',
      '',
      'event: ping',
      'data: {"type":"ping"}',
      '',
      '',
    ].join('\n');

    const { events, remainder } = parseSseChunk(chunk);

    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].type, 'message_start');
    assert.strictEqual(events[1].type, 'ping');
    assert.strictEqual(remainder, '');
  });

  it('handles incomplete events by returning remainder', () => {
    const chunk = [
      'event: message_start',
      'data: {"type":"message_start"}',
      '',
      'event: content_block_start',
      'data: {"type":"content_',
    ].join('\n');

    const { events, remainder } = parseSseChunk(chunk);

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'message_start');
    assert.ok(remainder.includes('content_'));
  });

  it('skips events with malformed JSON', () => {
    const chunk = [
      'data: {not valid json}',
      '',
      'data: {"type":"ping"}',
      '',
      '',
    ].join('\n');

    const { events } = parseSseChunk(chunk);

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'ping');
  });
});

// ── Tests: Token Usage & Cost ────────────────────────────────────

describe('mapUsage', () => {
  it('maps Anthropic usage to Pacta TokenUsage', () => {
    const usage = mapUsage({
      input_tokens: 500,
      output_tokens: 200,
      cache_creation_input_tokens: 100,
      cache_read_input_tokens: 50,
    });

    assert.strictEqual(usage.inputTokens, 500);
    assert.strictEqual(usage.outputTokens, 200);
    assert.strictEqual(usage.cacheWriteTokens, 100);
    assert.strictEqual(usage.cacheReadTokens, 50);
    assert.strictEqual(usage.totalTokens, 850);
  });

  it('handles missing cache fields', () => {
    const usage = mapUsage({
      input_tokens: 100,
      output_tokens: 50,
    });

    assert.strictEqual(usage.cacheWriteTokens, 0);
    assert.strictEqual(usage.cacheReadTokens, 0);
    assert.strictEqual(usage.totalTokens, 150);
  });
});

describe('calculateCost', () => {
  it('calculates correct cost for claude-sonnet-4-6', () => {
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2_000_000,
    };

    const cost = calculateCost('claude-sonnet-4-6', usage);

    // $3/M input + $15/M output = $18
    assert.strictEqual(cost.totalUsd, 18);
    assert.ok(cost.perModel['claude-sonnet-4-6']);
    assert.strictEqual(cost.perModel['claude-sonnet-4-6'].costUsd, 18);
  });

  it('includes cache pricing', () => {
    const usage = {
      inputTokens: 500_000,
      outputTokens: 100_000,
      cacheReadTokens: 200_000,
      cacheWriteTokens: 100_000,
      totalTokens: 900_000,
    };

    const cost = calculateCost('claude-sonnet-4-6', usage);

    // input: 0.5M * $3 = $1.5
    // output: 0.1M * $15 = $1.5
    // cache write: 0.1M * $3.75 = $0.375
    // cache read: 0.2M * $0.3 = $0.06
    const expected = 1.5 + 1.5 + 0.375 + 0.06;
    assert.ok(
      Math.abs(cost.totalUsd - expected) < 0.001,
      `Expected ${expected}, got ${cost.totalUsd}`,
    );
  });

  it('falls back to default pricing for unknown models', () => {
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 1_000_000,
    };

    const cost = calculateCost('claude-unknown-model', usage);

    // Falls back to Sonnet pricing: $3/M
    assert.strictEqual(cost.totalUsd, 3);
    assert.ok(cost.perModel['claude-unknown-model']);
  });
});
