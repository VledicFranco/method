---
title: "@methodts/pacta-provider-openai-compat"
scope: package
layer: L3
contents:
  - src/provider.ts
  - src/types.ts
---

# @methodts/pacta-provider-openai-compat

AgentProvider implementation that targets any OpenAI-compatible
`/v1/chat/completions` endpoint -- direct HTTP, native fetch, no SDK
dependency.

## Overview

This is the **mid-tier** in PRD 057's SLM cascade: it sits between a
local SLM (`@methodts/pacta` `SLMAsAgentProvider`) and a frontier
provider (`@methodts/pacta-provider-anthropic`). Cheap reasoning models
like DeepSeek-R1-Distill, Kimi, or Llama-70B served via OpenRouter,
Together, Fireworks, Groq, or Cerebras all speak the OpenAI shape, so
one provider class covers them all.

```
SLMAsAgentProvider                                                   tier 0  cheapest, lowest capability
  |
  v
OpenAICompatibleProvider  (DeepSeek / Kimi / Llama via OpenRouter ..) tier 1  cheap reasoning
  |
  v
AnthropicProvider          (Claude Sonnet / Opus)                    tier 2  frontier
```

## Install

```bash
npm install @methodts/pacta-provider-openai-compat
```

## Layer Position

```
L4  @methodts/bridge                              Uses providers to deploy agents
L3  @methodts/pacta-provider-openai-compat        This package
    @methodts/pacta                               Core SDK (peer dependency)
```

## Usage

```typescript
import { OpenAICompatibleProvider } from '@methodts/pacta-provider-openai-compat';
import { createAgent } from '@methodts/pacta';

const provider = new OpenAICompatibleProvider({
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY!,
  model: 'deepseek/deepseek-r1-distill-llama-70b',
  defaultHeaders: {
    'HTTP-Referer': 'https://method.dev',
    'X-Title': 'method',
  },
  // Optional cost tracking (USD per 1K tokens)
  costPerInputTokenUsd: 0.10,
  costPerOutputTokenUsd: 0.40,
});

const agent = createAgent({
  pact: { mode: { type: 'oneshot' } },
  provider,
});

const result = await agent.invoke({ prompt: 'Reason about X.' });
```

### Tested endpoints

Any endpoint that implements OpenAI's chat-completions shape:

| Provider   | baseUrl                                       |
|------------|-----------------------------------------------|
| OpenRouter | `https://openrouter.ai/api/v1`                |
| Together   | `https://api.together.xyz/v1`                 |
| Fireworks  | `https://api.fireworks.ai/inference/v1`       |
| Groq       | `https://api.groq.com/openai/v1`              |
| Cerebras   | `https://api.cerebras.ai/v1`                  |

## Capabilities

```typescript
{
  modes: ['oneshot'],
  streaming: false,
  resumable: false,
  budgetEnforcement: 'none',
  outputValidation: 'none',
  toolModel: 'none',
}
```

The provider is intentionally minimal:

- **No tool use.** Each backend has slightly different tool-calling
  semantics. The cascade falls back to a higher tier when tools are
  needed.
- **No streaming.** This tier is meant for cheap, fast oneshot answers.
- **No native budget or output validation.** Use the `budgetEnforcer`
  and `outputValidator` middleware from `@methodts/pacta`.
- **No native confidence.** OpenAI-shape responses do not include a
  calibrated confidence score -- the cascade should rely on output
  shape or downstream validation, not provider confidence.

## API surface

### `OpenAICompatibleProvider`

```typescript
new OpenAICompatibleProvider(options: OpenAICompatibleProviderOptions)
```

| option                    | required | default                                |
|---------------------------|----------|----------------------------------------|
| `baseUrl`                 | yes      | -                                      |
| `apiKey`                  | yes      | -                                      |
| `model`                   | yes      | -                                      |
| `name`                    | no       | derived from model                     |
| `timeoutMs`               | no       | `60000`                                |
| `defaultHeaders`          | no       | `{}`                                   |
| `costPerInputTokenUsd`    | no       | `0`                                    |
| `costPerOutputTokenUsd`   | no       | `0`                                    |

### Errors

- `OpenAICompatibleApiError` — non-2xx HTTP response. Carries
  `statusCode` and `responseBody`.
- `OpenAICompatibleNetworkError` — `fetch()` rejected (timeout,
  connection refused, DNS failure, ...).

## Development

```bash
npm run build
npm test
```
