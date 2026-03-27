/**
 * Anthropic Messages API Provider — AgentProvider + Streamable implementation.
 *
 * Uses the official @anthropic-ai/sdk for API calls. Supports oneshot invocations
 * with tool use loops and SSE streaming.
 */

import Anthropic from '@anthropic-ai/sdk';

import type {
  AgentProvider,
  Streamable,
  ProviderCapabilities,
  Pact,
  AgentRequest,
  AgentResult,
  AgentEvent,
  TokenUsage,
  ToolProvider,
  ToolDefinition,
} from '@method/pacta';

import { calculateCost } from './pricing.js';

// Re-export SDK types that consumers may need
export type { Anthropic };

// ── Options ──────────────────────────────────────────────────────

export interface AnthropicProviderOptions {
  /** API key (defaults to ANTHROPIC_API_KEY env var) */
  apiKey?: string;

  /** Model to use (defaults to 'claude-sonnet-4-20250514') */
  model?: string;

  /** Base URL for the API (defaults to 'https://api.anthropic.com') */
  baseUrl?: string;

  /** Max output tokens per request (defaults to 8192) */
  maxOutputTokens?: number;

  /** Tool provider for agentic tool use */
  toolProvider?: ToolProvider;

  /** Max agentic turns for tool use loops (defaults to 25) */
  maxTurns?: number;

  /** Provide a pre-configured Anthropic client (overrides apiKey/baseUrl) */
  client?: Anthropic;
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

// ── Model Aliases ────────────────────────────────────────────────

/** Map short aliases to real API model IDs */
const MODEL_ALIASES: Record<string, string> = {
  'claude-opus-4-6': 'claude-opus-4-20250514',
  'claude-sonnet-4-6': 'claude-sonnet-4-20250514',
  'claude-sonnet-4-5': 'claude-sonnet-4-5-20241022',
  'claude-haiku-4-5': 'claude-haiku-4-5-20241022',
};

function resolveModelId(alias: string): string {
  return MODEL_ALIASES[alias] ?? alias;
}

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
    apiKey,
    model: defaultModel = 'claude-sonnet-4-20250514',
    baseUrl,
    maxOutputTokens = 8192,
    toolProvider,
    maxTurns = 25,
  } = options;

  // Create or use provided Anthropic client
  const client = options.client ?? new Anthropic({
    apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
    baseURL: baseUrl,
  });

  function resolveModel(pact: Pact): string {
    const model = pact.scope?.model ?? defaultModel;
    return resolveModelId(model);
  }

  function buildTools(pact: Pact): Anthropic.Messages.Tool[] | undefined {
    const tools = toolProvider?.list() ?? [];

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

  // ── Tool Use Loop ──────────────────────────────────────────────

  async function invokeWithToolLoop<T>(
    pact: Pact<T>,
    request: AgentRequest,
  ): Promise<AgentResult<T>> {
    const startTime = Date.now();
    const model = resolveModel(pact);
    const sessionId = crypto.randomUUID();

    const messages: Anthropic.Messages.MessageParam[] = [
      { role: 'user', content: request.prompt },
    ];

    let totalUsage: TokenUsage = emptyUsage();
    let turns = 0;
    const maxLoopTurns = pact.budget?.maxTurns ?? maxTurns;

    while (turns < maxLoopTurns) {
      turns++;

      const resolvedMaxTokens = pact.budget?.maxOutputTokens ?? maxOutputTokens;
      const tools = buildTools(pact);

      const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
        model,
        max_tokens: resolvedMaxTokens,
        messages,
      };

      if (request.systemPrompt) {
        params.system = request.systemPrompt;
      }
      if (tools) {
        params.tools = tools;
      }

      const response = await client.messages.create(params);

      // Accumulate usage
      const turnUsage = mapUsage(response.usage);
      totalUsage = accumulateUsage(totalUsage, turnUsage);

      // Check for tool_use blocks
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
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
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
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

    const messages: Anthropic.Messages.MessageParam[] = [
      { role: 'user', content: request.prompt },
    ];

    let totalUsage: TokenUsage = emptyUsage();
    let turns = 0;
    const maxLoopTurns = pact.budget?.maxTurns ?? maxTurns;

    while (turns < maxLoopTurns) {
      turns++;

      const resolvedMaxTokens = pact.budget?.maxOutputTokens ?? maxOutputTokens;
      const tools = buildTools(pact);

      const params: Anthropic.Messages.MessageCreateParamsStreaming = {
        model,
        max_tokens: resolvedMaxTokens,
        messages,
        stream: true,
      };

      if (request.systemPrompt) {
        params.system = request.systemPrompt;
      }
      if (tools) {
        params.tools = tools;
      }

      const stream = client.messages.stream(params);

      // Collect content from streaming
      const contentBlocks: Anthropic.Messages.ContentBlock[] = [];
      let currentToolUse: Anthropic.Messages.ToolUseBlock | null = null;
      let currentToolJson = '';
      let currentText = '';

      for await (const event of stream) {
        // Emit text deltas
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text', content: event.delta.text };
          currentText += event.delta.text;
        }
        if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
          currentToolJson += event.delta.partial_json;
        }

        // Track tool use blocks
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            currentToolUse = { ...event.content_block, input: {} };
            currentToolJson = '';
            yield {
              type: 'tool_use',
              tool: event.content_block.name,
              input: {},
              toolUseId: event.content_block.id,
            };
          } else if (event.content_block.type === 'text') {
            currentText = event.content_block.text;
          }
        }

        if (event.type === 'content_block_stop') {
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
            contentBlocks.push({ type: 'text', text: currentText, citations: null } as Anthropic.Messages.TextBlock);
            currentText = '';
          }
        }
      }

      // Get final message for usage
      const finalMessage = await stream.finalMessage();
      const turnUsage = mapUsage(finalMessage.usage);
      totalUsage = accumulateUsage(totalUsage, turnUsage);

      yield {
        type: 'turn_complete',
        turnNumber: turns,
        usage: turnUsage,
      };

      // Check for tool use
      const toolUseBlocks = contentBlocks.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
      );

      if (toolUseBlocks.length === 0 || finalMessage.stop_reason !== 'tool_use') {
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

      messages.push({ role: 'assistant', content: contentBlocks as Anthropic.Messages.ContentBlockParam[] });

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
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

// ── Helpers ──────────────────────────────────────────────────────

function mapToolDefinition(tool: ToolDefinition): Anthropic.Messages.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: (tool.inputSchema ?? { type: 'object', properties: {} }) as Anthropic.Messages.Tool.InputSchema,
  };
}

function extractTextOutput(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

function mapUsage(usage: Anthropic.Messages.Usage): TokenUsage {
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = (usage as unknown as Record<string, number>).cache_read_input_tokens ?? 0;
  const cacheWrite = (usage as unknown as Record<string, number>).cache_creation_input_tokens ?? 0;
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
  };
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
