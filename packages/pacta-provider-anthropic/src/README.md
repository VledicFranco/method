# @method/pacta-provider-anthropic

Anthropic Messages API provider for `@method/pacta`. Implements `AgentProvider` using the Anthropic API directly (not via the Claude CLI). Supports streaming, native tool use, and prompt caching.

## Usage

```typescript
import { anthropicProvider } from '@method/pacta-provider-anthropic';

const provider = anthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-6',
});
```

## Features

- **Streaming**: token-by-token output via SSE — lowest latency
- **Tool use**: native Anthropic tool calling with typed schemas
- **Prompt caching**: automatic cache headers for long system prompts (reduces cost)
- **Cost tracking**: `mapUsage()` + `calculateCost()` for per-call spend calculation

## Components

| Component | Description |
|-----------|-------------|
| `anthropicProvider()` | Factory — returns a configured `AnthropicProvider` |
| `pricing.ts` | `mapUsage()`, `calculateCost()` — input/output token cost calculation |
| `sse-parser.ts` | Low-level SSE event parser for streaming responses |

## When to Use

Use this provider when you need direct API access (no Claude CLI installed), fine-grained control over streaming, or cost tracking. For local development with a running Claude CLI session, prefer `@method/pacta-provider-claude-cli`.
