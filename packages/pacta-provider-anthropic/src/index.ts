// SPDX-License-Identifier: Apache-2.0
// @methodts/pacta-provider-anthropic — Anthropic Messages API AgentProvider
// anthropicProvider(), streaming, tool use, prompt caching

// Provider factory
export { anthropicProvider, AnthropicApiError } from './anthropic-provider.js';
export type { AnthropicProviderOptions, AnthropicProvider } from './anthropic-provider.js';

// Pricing utilities (for advanced usage / custom cost tracking)
export { mapUsage, calculateCost } from './pricing.js';

// SSE parser (for advanced usage / custom streaming)
export { parseSseChunk, streamSseEvents } from './sse-parser.js';
export type { SseParseResult } from './sse-parser.js';

// Anthropic API types (for consumers who need raw type access)
export type {
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  AnthropicMessage,
  AnthropicContentBlock,
  AnthropicTextBlock,
  AnthropicToolUseBlock,
  AnthropicToolResultBlock,
  AnthropicToolDefinition,
  AnthropicUsage,
  AnthropicStreamEvent,
  MessageStartEvent,
  ContentBlockStartEvent,
  ContentBlockDeltaEvent,
  ContentBlockStopEvent,
  MessageDeltaEvent,
  MessageStopEvent,
} from './types.js';
