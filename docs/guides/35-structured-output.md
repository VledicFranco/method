---
guide: 35
title: "Structured Output"
domain: provider
audience: [developers]
summary: >-
  Get typed JSON directly from LLM agents using StructuredAgentProvider, bypassing text parsing.
prereqs: [10]
touches:
  - packages/methodts/src/provider/structured-provider.ts
  - packages/methodts/src/provider/claude-headless.ts
  - packages/methodts/src/semantic/run.ts
---

# Guide 35 — Structured Output: Typed JSON from LLM Agents

How to use `StructuredAgentProvider` to get typed JSON responses from LLM agents without writing text parsers.

## The Problem This Solves

Standard `AgentProvider.execute()` returns raw text. The caller must parse it — regex extraction, markdown fencing stripping, JSON.parse, null checks. Every SemanticFn needs a custom `parse` function. Parse failures trigger retries, wasting tokens.

`StructuredAgentProvider.executeStructured<T>()` returns typed JSON directly. You provide a JSON schema, the provider injects it as a constraint, and the response comes back parsed and typed.

## Quickstart

```typescript
import { createStructuredProvider, type JsonSchema } from "@methodts/methodts";

// Wrap any existing AgentProvider
const structured = createStructuredProvider(baseProvider);

const schema: JsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    score: { type: "number" },
    issues: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "score", "issues"],
};

const result = await Effect.runPromise(
  structured.executeStructured<{ summary: string; score: number; issues: string[] }>({
    prompt: "Review this code and produce a structured assessment.",
    schema,
    schemaName: "CodeReview",
  }),
);

// result.data is typed — no parsing needed
console.log(result.data.summary);  // string
console.log(result.data.score);    // number
console.log(result.data.issues);   // string[]
console.log(result.cost);          // { tokens, usd, duration_ms }
```

## How It Works

`createStructuredProvider(provider)` wraps any `AgentProvider`:

1. The JSON schema is appended to the prompt as a constraint
2. The LLM is instructed to respond with only the JSON object
3. The response is parsed (with markdown fence stripping)
4. The typed result is returned as `StructuredResult<T>`

If the response isn't valid JSON, the effect fails with `AgentCrash`.

## With ClaudeHeadlessProvider

```typescript
import { StructuredClaudeHeadlessProvider } from "@methodts/methodts";

const layer = StructuredClaudeHeadlessProvider({ model: "sonnet" });
```

This creates a `Layer<StructuredAgentProvider>` that spawns `claude --print` under the hood.

## With SPL (runSemantic)

Pass `structuredProvider` and `schema` in `RunSemanticConfig` to bypass text parsing in `runAtomic()`:

```typescript
import { runSemantic, type RunSemanticConfig } from "@methodts/methodts";

const config: RunSemanticConfig = {
  structuredProvider: createStructuredProvider(baseProvider),
  schema: myOutputSchema,
  schemaName: "MyOutput",
};

const result = await Effect.runPromise(
  runSemantic(myFn, input, config).pipe(Effect.provide(providerLayer)),
);
```

When both `structuredProvider` and `schema` are set, `runAtomic` uses `executeStructured` instead of the regular execute + parse path. The `fn.parse` function is bypassed — the schema replaces it. Postcondition checks still run on the typed output.

## API Reference

### Types

| Type | Description |
|------|-------------|
| `JsonSchema` | JSON Schema draft-07 subset (type, properties, required, items, enum, etc.) |
| `StructuredCommission` | `{ prompt, schema, schemaName, bridge?, sessionId?, resumeSessionId? }` |
| `StructuredResult<T>` | `{ data: T, raw: string, cost: { tokens, usd, duration_ms } }` |

### Functions

| Function | Description |
|----------|-------------|
| `createStructuredProvider(provider)` | Wrap any AgentProvider with structured output support |
| `buildStructuredPrompt(prompt, schema, name)` | Build the schema-injected prompt (exposed for testing) |
| `parseJsonResponse<T>(raw)` | Parse a potentially fenced JSON response (exposed for testing) |
| `StructuredClaudeHeadlessProvider(config?)` | Create a Layer providing StructuredAgentProvider via Claude CLI |

### Error Handling

- Valid JSON response → `StructuredResult<T>` (success)
- Invalid JSON response → `AgentCrash` error (structured output parse failed)
- Provider failure (timeout, crash, budget) → original `AgentError` propagated unchanged
