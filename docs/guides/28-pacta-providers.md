---
guide: 28
title: "Pacta: Implementing Providers"
domain: pacta
audience: [contributors]
summary: >-
  How to implement the AgentProvider port — capabilities, streaming, tool use.
prereqs: [26]
touches:
  - packages/pacta/src/ports/agent-provider.ts
  - packages/pacta-provider-claude-cli/src/
  - packages/pacta-provider-anthropic/src/
---

# Guide 28 — Pacta: Implementing Providers

Providers are the runtime bridge between Pacta and LLM services. The `AgentProvider` interface is deliberately minimal — implement `invoke()` and `capabilities()`, and Pacta handles the rest. This guide covers the port interface, the two shipped providers, and how to build your own.

## The AgentProvider Interface

Every provider must implement the base interface:

```typescript
interface AgentProvider {
  readonly name: string;
  capabilities(): ProviderCapabilities;
  invoke<T>(pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>>;
}
```

- **`name`** — unique identifier for the provider (e.g., `'claude-cli'`, `'anthropic'`, `'ollama'`)
- **`capabilities()`** — declares what this provider supports, validated at composition time
- **`invoke()`** — executes an agent request against the pact's constraints and returns a result

## Provider Capabilities

The `ProviderCapabilities` object tells `createAgent()` what the provider can do:

```typescript
interface ProviderCapabilities {
  modes: ExecutionMode['type'][];  // ['oneshot'] or ['oneshot', 'resumable'] etc.
  streaming: boolean;               // can stream AgentEvents
  resumable: boolean;               // can resume prior sessions
  budgetEnforcement: 'native' | 'client' | 'none';  // who tracks budget
  outputValidation: 'native' | 'client' | 'none';   // who validates output
  toolModel: 'builtin' | 'mcp' | 'function' | 'none';  // how tools work
  models?: string[];                // optional: list of supported model IDs
}
```

`createAgent()` validates capabilities at composition time. If the pact requests `mode: { type: 'resumable' }` but the provider's `modes` array does not include `'resumable'`, a `CapabilityError` is thrown. Similarly, if the pact sets `streaming: true` but the provider's `streaming` is `false`, composition fails.

The `budgetEnforcement` and `outputValidation` fields are informational. When set to `'client'`, Pacta's middleware handles enforcement. When `'native'`, the provider handles it internally. When `'none'`, that feature is not available.

## Optional Capability Interfaces

Beyond the base `AgentProvider`, three optional interfaces extend what a provider can do:

### Streamable

```typescript
interface Streamable {
  stream(pact: Pact, request: AgentRequest): AsyncIterable<AgentEvent>;
}
```

Emits typed `AgentEvent` objects as an async iterable. The event types include `text`, `thinking`, `tool_use`, `tool_result`, `turn_complete`, and `completed`.

### Resumable

```typescript
interface Resumable {
  resume<T>(sessionId: string, pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>>;
}
```

Resumes a prior session by its ID. The `sessionId` comes from a previous `AgentResult`.

### Killable

```typescript
interface Killable {
  kill(sessionId: string): Promise<void>;
}
```

Terminates a persistent session.

### Lifecycle

Any port (not just providers) can implement `Lifecycle` for setup/teardown:

```typescript
interface Lifecycle {
  init(): Promise<void>;
  dispose(): Promise<void>;
}
```

## Shipped Provider: Claude CLI

The `@method/pacta-provider-claude-cli` package wraps the Claude Code CLI:

```typescript
import { claudeCliProvider } from '@method/pacta-provider-claude-cli';
import type { ClaudeCliProviderOptions } from '@method/pacta-provider-claude-cli';

const provider = claudeCliProvider({
  binary: 'claude',       // CLI binary name (default: 'claude')
  model: 'claude-sonnet-4-6',  // default model
  timeoutMs: 300_000,     // execution timeout (default: 5 min)
});
```

**Capabilities:**
- Modes: `oneshot`, `resumable`
- Streaming: no (CLI is batch)
- Resume: yes (via `claude --resume`)
- Budget enforcement: none (client-side)
- Output validation: client-side
- Tool model: builtin (Claude's built-in tools)

The provider type is `AgentProvider & Resumable`:

```typescript
import type { ClaudeCliProvider } from '@method/pacta-provider-claude-cli';
// ClaudeCliProvider = AgentProvider & Resumable
```

**How it works:** The provider calls `claude --print` with the prompt, model, system prompt, and allowed tools as CLI flags. For resumable sessions, it uses `--resume <sessionId>`. The CLI's stdout becomes the `output`, and the session ID is parsed from stderr.

The package also exports the lower-level `executeCli()` function and `buildCliArgs()` for advanced usage or custom providers that wrap the CLI differently:

```typescript
import { executeCli, buildCliArgs } from '@method/pacta-provider-claude-cli';
import type { CliArgs, CliResult } from '@method/pacta-provider-claude-cli';
```

### simpleCodeAgent

A convenience factory that creates an agent pre-wired with the Claude CLI provider:

```typescript
import { simpleCodeAgent } from '@method/pacta-provider-claude-cli';

const agent = simpleCodeAgent({ model: 'claude-sonnet-4-6' });
const result = await agent.invoke({
  prompt: 'Fix the import error',
  workdir: '/project',
});
```

This is the simplest possible path — one function call, one invoke. It uses oneshot mode with Read/Grep/Glob/Edit/Write tools.

## Shipped Provider: Anthropic API

The `@method/pacta-provider-anthropic` package calls the Anthropic Messages API directly using `fetch()`. No SDK dependency.

```typescript
import { anthropicProvider } from '@method/pacta-provider-anthropic';
import type { AnthropicProviderOptions } from '@method/pacta-provider-anthropic';

const provider = anthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,  // or pass explicitly
  model: 'claude-sonnet-4-6',             // default model
  baseUrl: 'https://api.anthropic.com',   // default
  maxOutputTokens: 8192,                  // default per-request limit
  toolProvider: myToolProvider,            // for agentic tool use loops
  maxTurns: 25,                           // max tool-use loop iterations
});
```

**Capabilities:**
- Modes: `oneshot`
- Streaming: yes
- Resume: no
- Budget enforcement: client-side
- Output validation: client-side
- Tool model: function (tool definitions as JSON Schema)

The provider type is `AgentProvider & Streamable`:

```typescript
import type { AnthropicProvider } from '@method/pacta-provider-anthropic';
// AnthropicProvider = AgentProvider & Streamable
```

**Tool use loop:** When the model responds with `tool_use` content blocks and `stop_reason: 'tool_use'`, the provider executes the tools through the `ToolProvider`, appends results as user messages, and continues the loop. This continues until the model responds without tool use or `maxTurns` is reached.

**Streaming:** The provider implements `Streamable` with SSE parsing. Use it with `provider.stream(pact, request)`:

```typescript
const provider = anthropicProvider({ toolProvider: myTools });

for await (const event of provider.stream(pact, request)) {
  switch (event.type) {
    case 'text':
      process.stdout.write(event.content);
      break;
    case 'tool_use':
      console.log(`Tool: ${event.tool}`);
      break;
    case 'completed':
      console.log(`Cost: $${event.cost.totalUsd}`);
      break;
  }
}
```

The package also exports utilities for advanced usage:

```typescript
import { mapUsage, calculateCost } from '@method/pacta-provider-anthropic';  // pricing
import { parseSseChunk, streamSseEvents } from '@method/pacta-provider-anthropic';  // SSE parser
```

## Implementing Your Own Provider

Here is a minimal provider implementation:

```typescript
import type {
  AgentProvider,
  ProviderCapabilities,
  Pact,
  AgentRequest,
  AgentResult,
  TokenUsage,
  CostReport,
} from '@method/pacta';

export function ollamaProvider(baseUrl = 'http://localhost:11434'): AgentProvider {
  return {
    name: 'ollama',

    capabilities(): ProviderCapabilities {
      return {
        modes: ['oneshot'],
        streaming: false,
        resumable: false,
        budgetEnforcement: 'none',
        outputValidation: 'client',
        toolModel: 'none',
        models: ['llama3', 'codellama', 'mistral'],
      };
    },

    async invoke<T>(pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>> {
      const startTime = Date.now();
      const model = pact.scope?.model ?? 'llama3';

      const response = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: request.prompt,
          system: request.systemPrompt,
          stream: false,
        }),
      });

      const data = await response.json();

      return {
        output: data.response as unknown as T,
        sessionId: crypto.randomUUID(),
        completed: true,
        stopReason: 'complete',
        usage: {
          inputTokens: data.prompt_eval_count ?? 0,
          outputTokens: data.eval_count ?? 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
        },
        cost: { totalUsd: 0, perModel: {} },  // Ollama is free
        durationMs: Date.now() - startTime,
        turns: 1,
      };
    },
  };
}
```

### Key implementation rules

1. **Return a valid `AgentResult`** — all fields are required. Use `crypto.randomUUID()` for session IDs if the provider doesn't have its own.

2. **Declare capabilities honestly** — if the provider cannot stream, set `streaming: false`. `createAgent()` validates these at composition time and will reject mismatches.

3. **Map token usage** — fill in `inputTokens`, `outputTokens`, and `totalTokens` as accurately as possible. Budget enforcement and cost tracking depend on these values.

4. **Handle errors gracefully** — if the provider encounters a transient error, return `{ completed: false, stopReason: 'error' }` so that Reflexion middleware can retry. Throw for fatal errors.

5. **Respect `pact.scope`** — check `pact.scope.model` for model overrides and `pact.scope.allowedTools` for tool filtering. See how `anthropicProvider` builds its tool list.

6. **Use factory functions** — return the provider object from a factory function (not a class) for consistency with the shipped providers.

### Adding streaming

To support streaming, implement the `Streamable` interface alongside `AgentProvider`:

```typescript
import type { AgentProvider, Streamable, AgentEvent } from '@method/pacta';

export function myProvider(): AgentProvider & Streamable {
  return {
    name: 'my-provider',
    capabilities() { return { /* ... */ streaming: true }; },
    async invoke(pact, request) { /* ... */ },
    async *stream(pact, request): AsyncIterable<AgentEvent> {
      yield { type: 'started', sessionId: '...', timestamp: new Date().toISOString() };
      // ... yield events as they arrive ...
      yield { type: 'completed', result: '...', usage: { /* ... */ }, cost: { /* ... */ }, durationMs: 0, turns: 1 };
    },
  };
}
```

### Testing with executorOptions

Both shipped providers accept injection points for testing:

- **Claude CLI:** `executorOptions.spawnFn` replaces the actual CLI spawn
- **Anthropic:** `fetchFn` replaces `globalThis.fetch`

For integration tests, use `RecordingProvider` from `@method/pacta-testkit` instead of a real provider. See [Guide 29](./29-pacta-testing-with-playground.md).

## Next Steps

- **[Guide 26 — Pacta: Getting Started](./26-pacta-getting-started.md)** — Introduction to the SDK if you haven't read it yet.
- **[Guide 27 — Pacta: Assembling Agents](./27-pacta-assembling-agents.md)** — Compose agents from providers and other parts.
- **[Guide 29 — Pacta: Testing with Playground](./29-pacta-testing-with-playground.md)** — Test agents with virtual filesystems and scripted tools.
