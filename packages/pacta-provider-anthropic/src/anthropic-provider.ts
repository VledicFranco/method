/**
 * Anthropic Messages API Provider — AgentProvider + Streamable implementation.
 *
 * Uses raw fetch() to call the Anthropic Messages API. No SDK dependency.
 * Supports oneshot invocations with tool use loops and SSE streaming.
 */

import type {
  AgentProvider,
  Streamable,
  ProviderCapabilities,
  Pact,
  AgentRequest,
  AgentResult,
  AgentEvent,
  TokenUsage,
  CostReport,
  ToolProvider,
  ToolDefinition,
} from '@method/pacta';

import type {
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  AnthropicMessage,
  AnthropicContentBlock,
  AnthropicToolUseBlock,
  AnthropicToolDefinition,
  AnthropicToolResultBlock,
  AnthropicStreamEvent,
} from './types.js';

import { mapUsage, calculateCost } from './pricing.js';
import { streamSseEvents } from './sse-parser.js';

// ── Options ──────────────────────────────────────────────────────

export interface AnthropicProviderOptions {
  /** API key (defaults to ANTHROPIC_API_KEY env var) */
  apiKey?: string;

  /** Model to use (defaults to 'claude-sonnet-4-6') */
  model?: string;

  /** Base URL for the API (defaults to 'https://api.anthropic.com') */
  baseUrl?: string;

  /** Max output tokens per request (defaults to 8192) */
  maxOutputTokens?: number;

  /** Override fetch for testing */
  fetchFn?: typeof globalThis.fetch;

  /** Tool provider for agentic tool use */
  toolProvider?: ToolProvider;

  /** Max agentic turns for tool use loops (defaults to 25) */
  maxTurns?: number;
}

// ── Provider Type ────────────────────────────────────────────────

export type AnthropicProvider = AgentProvider & Streamable;

// ── Capabilities ─────────────────────────────────────────────────

const CAPABILITIES: ProviderCapabilities = {
  modes: ['oneshot'],
  streaming: true,
  resumable: false,
  budgetEnforcement: 'client',
  outputValidation: 'client',
  toolModel: 'function',
};

// ── Factory ──────────────────────────────────────────────────────

/**
 * Create an Anthropic Messages API AgentProvider.
 *
 * @param options - Configuration for the Anthropic provider
 * @returns AgentProvider & Streamable implementation
 */
export function anthropicProvider(
  options: AnthropicProviderOptions = {},
): AnthropicProvider {
  const {
    apiKey = process.env.ANTHROPIC_API_KEY,
    model: defaultModel = 'claude-sonnet-4-6',
    baseUrl = 'https://api.anthropic.com',
    maxOutputTokens = 8192,
    fetchFn = globalThis.fetch,
    toolProvider,
    maxTurns = 25,
  } = options;

  function getApiKey(): string {
    if (!apiKey) {
      throw new Error(
        'Anthropic API key not provided. Set ANTHROPIC_API_KEY env var or pass apiKey option.',
      );
    }
    return apiKey;
  }

  function resolveModel(pact: Pact): string {
    return pact.scope?.model ?? defaultModel;
  }

  function buildTools(pact: Pact): AnthropicToolDefinition[] | undefined {
    const tools = toolProvider?.list() ?? [];

    // Filter by pact scope if set
    let filtered = tools;
    if (pact.scope?.allowedTools) {
      const allowed = new Set(pact.scope.allowedTools);
      filtered = tools.filter((t) => allowed.has(t.name));
    }
    if (pact.scope?.deniedTools) {
      const denied = new Set(pact.scope.deniedTools);
      filtered = filtered.filter((t) => !denied.has(t.name));
    }

    if (filtered.length === 0) return undefined;

    return filtered.map(mapToolDefinition);
  }

  function buildRequest(
    pact: Pact,
    request: AgentRequest,
    messages: AnthropicMessage[],
    stream: boolean,
  ): AnthropicMessagesRequest {
    const model = resolveModel(pact);
    const resolvedMaxTokens = pact.budget?.maxOutputTokens ?? maxOutputTokens;
    const tools = buildTools(pact);

    const body: AnthropicMessagesRequest = {
      model,
      max_tokens: resolvedMaxTokens,
      messages,
      stream,
    };

    if (request.systemPrompt) {
      body.system = request.systemPrompt;
    }

    if (tools) {
      body.tools = tools;
    }

    return body;
  }

  async function callApi(
    body: AnthropicMessagesRequest,
  ): Promise<AnthropicMessagesResponse> {
    const response = await fetchFn(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': getApiKey(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AnthropicApiError(response.status, errorText);
    }

    return (await response.json()) as AnthropicMessagesResponse;
  }

  async function callApiStreaming(
    body: AnthropicMessagesRequest,
  ): Promise<Response> {
    const response = await fetchFn(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': getApiKey(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AnthropicApiError(response.status, errorText);
    }

    return response;
  }

  // ── Tool Use Loop ──────────────────────────────────────────────

  async function invokeWithToolLoop<T>(
    pact: Pact<T>,
    request: AgentRequest,
  ): Promise<AgentResult<T>> {
    const startTime = Date.now();
    const model = resolveModel(pact);
    const sessionId = crypto.randomUUID();

    const messages: AnthropicMessage[] = [
      { role: 'user', content: request.prompt },
    ];

    let totalUsage: TokenUsage = emptyUsage();
    let turns = 0;
    const maxLoopTurns = pact.budget?.maxTurns ?? maxTurns;

    while (turns < maxLoopTurns) {
      turns++;

      const body = buildRequest(pact, request, messages, false);
      const response = await callApi(body);

      // Accumulate usage
      const turnUsage = mapUsage(response.usage);
      totalUsage = accumulateUsage(totalUsage, turnUsage);

      // Check for tool_use blocks
      const toolUseBlocks = response.content.filter(
        (b): b is AnthropicToolUseBlock => b.type === 'tool_use',
      );

      if (toolUseBlocks.length === 0 || response.stop_reason !== 'tool_use') {
        // No more tool calls — extract final text
        const output = extractTextOutput(response.content) as unknown as T;
        const cost = calculateCost(model, totalUsage);

        return {
          output,
          sessionId,
          completed: true,
          stopReason: response.stop_reason === 'max_tokens' ? 'budget_exhausted' : 'complete',
          usage: totalUsage,
          cost,
          durationMs: Date.now() - startTime,
          turns,
        };
      }

      // Execute tools and continue the loop
      if (!toolProvider) {
        throw new Error('Model requested tool use but no ToolProvider is configured.');
      }

      // Add assistant message with tool use blocks
      messages.push({ role: 'assistant', content: response.content });

      // Execute all tool calls and build result blocks
      const toolResults: AnthropicToolResultBlock[] = [];
      for (const toolUse of toolUseBlocks) {
        const result = await toolProvider.execute(toolUse.name, toolUse.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: typeof result.output === 'string'
            ? result.output
            : JSON.stringify(result.output),
          is_error: result.isError,
        });
      }

      // Add tool results as user message
      messages.push({ role: 'user', content: toolResults });
    }

    // Exceeded max turns
    const cost = calculateCost(model, totalUsage);
    return {
      output: '' as unknown as T,
      sessionId,
      completed: false,
      stopReason: 'budget_exhausted',
      usage: totalUsage,
      cost,
      durationMs: Date.now() - startTime,
      turns,
    };
  }

  // ── Streaming Implementation ───────────────────────────────────

  async function* streamImpl(
    pact: Pact,
    request: AgentRequest,
  ): AsyncIterable<AgentEvent> {
    const startTime = Date.now();
    const model = resolveModel(pact);
    const sessionId = crypto.randomUUID();

    yield {
      type: 'started',
      sessionId,
      timestamp: new Date().toISOString(),
    };

    const messages: AnthropicMessage[] = [
      { role: 'user', content: request.prompt },
    ];

    let totalUsage: TokenUsage = emptyUsage();
    let turns = 0;
    const maxLoopTurns = pact.budget?.maxTurns ?? maxTurns;

    while (turns < maxLoopTurns) {
      turns++;

      const body = buildRequest(pact, request, messages, true);
      const response = await callApiStreaming(body);

      if (!response.body) {
        throw new Error('Streaming response has no body');
      }

      // Collect content blocks from streaming
      const contentBlocks: AnthropicContentBlock[] = [];
      let currentBlockIndex = -1;
      let currentText = '';
      let currentToolUse: AnthropicToolUseBlock | null = null;
      let currentToolJson = '';
      let turnUsage: TokenUsage = emptyUsage();
      let stopReason: string = 'end_turn';

      for await (const event of streamSseEvents(response.body)) {
        yield* mapStreamEvent(event, sessionId);

        // Track state for content reconstruction
        switch (event.type) {
          case 'message_start':
            turnUsage = mapUsage(event.message.usage);
            break;

          case 'content_block_start':
            currentBlockIndex = event.index;
            if (event.content_block.type === 'text') {
              currentText = event.content_block.text;
            } else if (event.content_block.type === 'tool_use') {
              currentToolUse = { ...event.content_block, input: {} };
              currentToolJson = '';
            }
            break;

          case 'content_block_delta':
            if (event.delta.type === 'text_delta') {
              currentText += event.delta.text;
            } else if (event.delta.type === 'input_json_delta') {
              currentToolJson += event.delta.partial_json;
            }
            break;

          case 'content_block_stop':
            if (currentToolUse) {
              try {
                currentToolUse.input = currentToolJson ? JSON.parse(currentToolJson) : {};
              } catch {
                currentToolUse.input = {};
              }
              contentBlocks.push(currentToolUse);
              currentToolUse = null;
              currentToolJson = '';
            } else {
              contentBlocks.push({ type: 'text', text: currentText });
              currentText = '';
            }
            currentBlockIndex = -1;
            break;

          case 'message_delta':
            stopReason = event.delta.stop_reason;
            turnUsage = {
              ...turnUsage,
              outputTokens: event.usage.output_tokens,
              totalTokens: turnUsage.inputTokens + event.usage.output_tokens +
                turnUsage.cacheReadTokens + turnUsage.cacheWriteTokens,
            };
            break;
        }
      }

      totalUsage = accumulateUsage(totalUsage, turnUsage);

      yield {
        type: 'turn_complete',
        turnNumber: turns,
        usage: turnUsage,
      };

      // Check for tool use
      const toolUseBlocks = contentBlocks.filter(
        (b): b is AnthropicToolUseBlock => b.type === 'tool_use',
      );

      if (toolUseBlocks.length === 0 || stopReason !== 'tool_use') {
        // Done — emit completed
        const cost = calculateCost(model, totalUsage);
        const output = extractTextOutput(contentBlocks);

        yield {
          type: 'completed',
          result: output,
          usage: totalUsage,
          cost,
          durationMs: Date.now() - startTime,
          turns,
        };
        return;
      }

      // Execute tools
      if (!toolProvider) {
        throw new Error('Model requested tool use but no ToolProvider is configured.');
      }

      messages.push({ role: 'assistant', content: contentBlocks });

      const toolResults: AnthropicToolResultBlock[] = [];
      for (const toolUse of toolUseBlocks) {
        const toolStart = Date.now();
        const result = await toolProvider.execute(toolUse.name, toolUse.input);
        const toolDuration = Date.now() - toolStart;

        yield {
          type: 'tool_result',
          tool: toolUse.name,
          output: result.output,
          toolUseId: toolUse.id,
          durationMs: toolDuration,
        };

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: typeof result.output === 'string'
            ? result.output
            : JSON.stringify(result.output),
          is_error: result.isError,
        });
      }

      messages.push({ role: 'user', content: toolResults });
    }

    // Exceeded max turns
    const cost = calculateCost(model, totalUsage);
    yield {
      type: 'completed',
      result: '',
      usage: totalUsage,
      cost,
      durationMs: Date.now() - startTime,
      turns,
    };
  }

  return {
    name: 'anthropic',

    capabilities(): ProviderCapabilities {
      return CAPABILITIES;
    },

    invoke<T>(pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>> {
      return invokeWithToolLoop(pact, request);
    },

    stream(pact: Pact, request: AgentRequest): AsyncIterable<AgentEvent> {
      return streamImpl(pact, request);
    },
  };
}

// ── Stream Event Mapping ─────────────────────────────────────────

function* mapStreamEvent(
  event: AnthropicStreamEvent,
  _sessionId: string,
): Iterable<AgentEvent> {
  switch (event.type) {
    case 'content_block_start':
      if (event.content_block.type === 'tool_use') {
        yield {
          type: 'tool_use',
          tool: event.content_block.name,
          input: event.content_block.input ?? {},
          toolUseId: event.content_block.id,
        };
      }
      break;

    case 'content_block_delta':
      if (event.delta.type === 'text_delta') {
        yield {
          type: 'text',
          content: event.delta.text,
        };
      }
      break;

    // Other events don't map to AgentEvents directly
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function mapToolDefinition(tool: ToolDefinition): AnthropicToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema ?? { type: 'object', properties: {} },
  };
}

function extractTextOutput(content: AnthropicContentBlock[]): string {
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

function emptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
  };
}

function accumulateUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

// ── Errors ───────────────────────────────────────────────────────

export class AnthropicApiError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;

  constructor(statusCode: number, responseBody: string) {
    super(`Anthropic API error (${statusCode}): ${responseBody}`);
    this.name = 'AnthropicApiError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}
