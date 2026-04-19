---
title: "@methodts/pacta-provider-anthropic"
scope: package
layer: L3
contents:
  - src/anthropic-provider.ts
  - src/pricing.ts
  - src/sse-parser.ts
  - src/types.ts
---

# @methodts/pacta-provider-anthropic

AgentProvider implementation for the Anthropic Messages API -- direct HTTP, no SDK dependency.

## Overview

This package provides a Pacta `AgentProvider` that calls the Anthropic Messages API using raw `fetch()`. It supports:

- **Oneshot invocations** with automatic tool use loops
- **SSE streaming** with real-time event emission
- **Prompt caching** cost tracking (cache write + cache read tokens)
- **Built-in pricing** for Claude Sonnet, Opus, and Haiku models

The provider implements both `AgentProvider` and `Streamable` interfaces. No external SDK dependency -- only the platform `fetch()` API.

## Install

```bash
npm install @methodts/pacta-provider-anthropic
```

## Layer Position

```
L4  @methodts/bridge                       Uses providers to deploy agents
L3  @methodts/pacta-provider-anthropic     This package
    @methodts/pacta                        Core SDK (peer dependency)
```

## Usage

### Basic Provider

```typescript
import { anthropicProvider } from '@methodts/pacta-provider-anthropic';
import { createAgent } from '@methodts/pacta';

const provider = anthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const agent = createAgent({
  pact: {
    mode: { type: 'oneshot' },
    scope: { model: 'claude-sonnet-4-6' },
    budget: { maxTurns: 10, maxCostUsd: 0.50 },
  },
  provider,
});

const result = await agent.invoke({
  prompt: 'Explain the difference between type and interface in TypeScript',
});

console.log(result.output);
console.log(`Cost: $${result.cost.totalUsd.toFixed(4)}`);
console.log(`Tokens: ${result.usage.totalTokens}`);
```

### Provider Options

```typescript
const provider = anthropicProvider({
  apiKey: 'sk-...',                 // Defaults to ANTHROPIC_API_KEY env var
  model: 'claude-sonnet-4-6',           // Default model (default: 'claude-sonnet-4-6')
  baseUrl: 'https://api.anthropic.com', // API base URL
  maxOutputTokens: 8192,            // Max output tokens per request (default: 8192)
  maxTurns: 25,                     // Max agentic turns for tool loops (default: 25)
  toolProvider: myToolProvider,     // ToolProvider for agentic tool use
  fetchFn: customFetch,            // Override fetch for testing
});
```

### Tool Use

Pass a `ToolProvider` to enable agentic tool use loops. The provider automatically:

1. Sends tool definitions to the API (filtered by pact scope)
2. Detects `tool_use` blocks in the response
3. Executes tools via the ToolProvider
4. Sends tool results back and continues the conversation
5. Repeats until the model stops requesting tools or the turn limit is reached

```typescript
import { anthropicProvider } from '@methodts/pacta-provider-anthropic';
import { MockToolProvider } from '@methodts/pacta-testkit';

const tools = new MockToolProvider();
tools.addTool(
  { name: 'Read', description: 'Read a file', inputSchema: { type: 'object', properties: { file_path: { type: 'string' } } } },
  { output: 'file contents...' },
);

const provider = anthropicProvider({
  toolProvider: tools,
});
```

### Streaming

```typescript
const provider = anthropicProvider({ apiKey: 'sk-...' });

const agent = createAgent({
  pact: { mode: { type: 'oneshot' }, streaming: true },
  provider,
});

for await (const event of provider.stream(agent.pact, { prompt: 'Hello' })) {
  switch (event.type) {
    case 'started':
      console.log(`Session: ${event.sessionId}`);
      break;
    case 'text':
      process.stdout.write(event.content);
      break;
    case 'tool_use':
      console.log(`Tool: ${event.tool}`);
      break;
    case 'turn_complete':
      console.log(`Turn ${event.turnNumber}, tokens: ${event.usage.totalTokens}`);
      break;
    case 'completed':
      console.log(`\nDone. Cost: $${event.cost.totalUsd.toFixed(4)}`);
      break;
  }
}
```

The streaming path parses SSE events from the Anthropic response body, maps them to `AgentEvent` types, and handles tool use loops identically to the non-streaming path.

### Pricing Utilities

For custom cost tracking or offline calculations:

```typescript
import { mapUsage, calculateCost } from '@methodts/pacta-provider-anthropic';

// Convert Anthropic API usage to Pacta TokenUsage
const usage = mapUsage({
  input_tokens: 1000,
  output_tokens: 500,
  cache_creation_input_tokens: 200,
  cache_read_input_tokens: 800,
});

// Calculate cost for a model
const cost = calculateCost('claude-sonnet-4-6', usage);
console.log(`$${cost.totalUsd.toFixed(4)}`);
```

Built-in pricing (per million tokens):

| Model | Input | Output | Cache Write | Cache Read |
|-------|-------|--------|-------------|------------|
| claude-sonnet-4-6 | $3.00 | $15.00 | $3.75 | $0.30 |
| claude-opus-4-20250514 | $15.00 | $75.00 | $18.75 | $1.50 |
| claude-haiku-4-5-20250514 | $0.80 | $4.00 | $1.00 | $0.08 |

Unknown models fall back to Sonnet pricing.

## Capabilities

```typescript
provider.capabilities();
// {
//   modes: ['oneshot'],
//   streaming: true,
//   resumable: false,
//   budgetEnforcement: 'client',
//   outputValidation: 'client',
//   toolModel: 'function',
// }
```

- **Modes**: oneshot only (no server-side session persistence)
- **Streaming**: supported via SSE
- **Budget enforcement**: client-side (via `budgetEnforcer` middleware)
- **Output validation**: client-side (via `outputValidator` middleware)
- **Tool model**: function calling (tools passed as API tool definitions)

## API Surface

### Provider Factory

`anthropicProvider(options?)` -- creates `AnthropicProvider` (AgentProvider & Streamable)

`AnthropicProviderOptions`: apiKey, model, baseUrl, maxOutputTokens, fetchFn, toolProvider, maxTurns

### Pricing

`mapUsage(anthropicUsage)` -- converts `AnthropicUsage` to `TokenUsage`

`calculateCost(model, usage)` -- returns `CostReport` with per-model breakdown

### SSE Parser

`parseSseChunk(buffer)` -- parse SSE text into events + remainder (for partial buffers)

`streamSseEvents(body)` -- async generator: ReadableStream to typed `AnthropicStreamEvent`

### Anthropic API Types

Request: `AnthropicMessagesRequest`, `AnthropicMessage`, `AnthropicContentBlock`, `AnthropicToolDefinition`

Response: `AnthropicMessagesResponse`, `AnthropicUsage`

Content blocks: `AnthropicTextBlock`, `AnthropicToolUseBlock`, `AnthropicToolResultBlock`

Stream events: `AnthropicStreamEvent`, `MessageStartEvent`, `ContentBlockStartEvent`, `ContentBlockDeltaEvent`, `ContentBlockStopEvent`, `MessageDeltaEvent`, `MessageStopEvent`

### Error Types

`AnthropicApiError` -- HTTP error from the Anthropic API (includes statusCode and responseBody)

## Architecture

```
src/
  anthropic-provider.ts    anthropicProvider() factory — invoke + stream + tool use loop
  pricing.ts               Model pricing table, mapUsage(), calculateCost()
  sse-parser.ts            parseSseChunk(), streamSseEvents() — SSE wire format parsing
  types.ts                 Anthropic Messages API type definitions (request, response, stream)
```

## Development

```bash
npm run build            # TypeScript build
npm test                 # Run all tests
```
