---
guide: 27
title: "Pacta: Assembling Agents"
domain: pacta
audience: [contributors, agent-operators]
summary: >-
  Compose agents from typed parts — providers, reasoning strategies, context managers, validators.
prereqs: [26]
touches:
  - packages/pacta/src/engine/
  - packages/pacta/src/reasoning/
  - packages/pacta/src/context/
  - packages/pacta/src/middleware/
---

# Guide 27 — Pacta: Assembling Agents

This guide covers Tier 2 of the Pacta SDK: composing agents from typed, independent parts using `createAgent()`. Every part is optional except the provider and the pact.

## createAgent() Deep Dive

`createAgent()` is the composition function. It takes a `CreateAgentOptions` object and returns an `Agent`:

```typescript
import { createAgent } from '@method/pacta';
import type { CreateAgentOptions, Agent } from '@method/pacta';

const options: CreateAgentOptions = {
  pact: { mode: { type: 'oneshot' } },  // required: the contract
  provider: myProvider,                   // required: the LLM runtime
  reasoning: { thinkTool: true },         // optional: reasoning config
  context: { strategy: 'compact' },       // optional: context management
  tools: myToolProvider,                  // optional: tool execution
  memory: myMemoryPort,                   // optional: memory backend
  onEvent: (e) => console.log(e.type),    // optional: event observer
};

const agent: Agent = createAgent(options);
```

At composition time, `createAgent()` validates that the provider's capabilities match the pact's requirements. If the pact requests `mode: { type: 'resumable' }` but the provider only supports `oneshot`, it throws a `CapabilityError`:

```typescript
import { CapabilityError } from '@method/pacta';

try {
  const agent = createAgent({
    pact: { mode: { type: 'resumable' } },
    provider: oneshotOnlyProvider,
  });
} catch (e) {
  if (e instanceof CapabilityError) {
    console.error(e.message);
    // "Provider "my-provider" does not support mode "resumable". Supported modes: oneshot"
  }
}
```

## The Middleware Pipeline

`createAgent()` wires middleware in a specific order:

```
Request → Budget Enforcer → Output Validator → Provider → Response
```

**Budget Enforcer** (outer): tracks turns, tokens, cost, and duration. Emits `budget_warning` at 80% and `budget_exhausted` when limits are exceeded. Stops or throws based on `budget.onExhaustion` policy (`'stop'`, `'warn'`, or `'error'`).

**Output Validator** (inner): if `pact.output.schema` is defined, validates the response through `schema.parse()`. On failure, retries with verbal feedback up to `maxRetries` times. If budget exhausts during a retry, budget wins.

The middleware only activates when the corresponding pact fields are set. No `pact.budget` means no budget enforcer. No `pact.output.schema` means no output validator.

## Budget Enforcement

Declare resource limits in the pact's `budget` field:

```typescript
const agent = createAgent({
  pact: {
    mode: { type: 'oneshot' },
    budget: {
      maxTokens: 50_000,       // total token limit
      maxOutputTokens: 8192,   // per-request output limit
      maxCostUsd: 1.00,        // dollar limit
      maxDurationMs: 60_000,   // wall-clock timeout
      maxTurns: 10,            // agentic turn limit
      onExhaustion: 'stop',    // 'stop' | 'warn' | 'error'
    },
  },
  provider: myProvider,
});
```

The enforcer pre-checks turns and duration before each invocation, and post-checks all resources after. When `onExhaustion` is `'error'`, it throws `BudgetExhaustedError` instead of returning a synthetic result.

## Output Validation

Declare output shape constraints with a `SchemaDefinition`:

```typescript
import type { SchemaDefinition, SchemaResult } from '@method/pacta';

// A schema that validates JSON output as a review object
const reviewSchema: SchemaDefinition<{ verdict: string; issues: string[] }> = {
  description: 'Code review result',
  parse(raw: unknown): SchemaResult<{ verdict: string; issues: string[] }> {
    try {
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (typeof obj.verdict !== 'string' || !Array.isArray(obj.issues)) {
        return { success: false, errors: ['Expected { verdict: string, issues: string[] }'] };
      }
      return { success: true, data: obj };
    } catch (e) {
      return { success: false, errors: [`JSON parse failed: ${e}`] };
    }
  },
};

const agent = createAgent({
  pact: {
    mode: { type: 'oneshot' },
    output: {
      schema: reviewSchema,
      retryOnValidationFailure: true,  // default: true
      maxRetries: 2,                   // default: 2
      retryPrompt: 'Your output did not match the required schema. Errors:\n',
    },
  },
  provider: myProvider,
});
```

The validator wraps the provider directly. When validation fails, it retries by sending the error details as verbal feedback. If `retryOnValidationFailure` is `false`, it returns immediately with `stopReason: 'error'`.

## Scope Contract

The `scope` field on a pact declares capability constraints — what the agent is allowed to do at runtime:

```typescript
import { createAgent } from '@method/pacta';

const agent = createAgent({
  pact: {
    mode: { type: 'oneshot' },
    scope: {
      allowedTools: ['Read', 'Grep', 'Glob', 'Bash'],  // whitelist — only these tools are available
      deniedTools: ['Bash'],                             // blacklist — removed even if in allowedTools
      allowedPaths: ['src/**', 'tests/**'],              // glob patterns restricting filesystem access
      model: 'claude-sonnet-4-6',                       // model constraint
      permissionMode: 'auto',                            // 'ask' | 'auto' | 'deny'
    },
  },
  provider: myProvider,
});
```

The full `ScopeContract` interface:

| Field | Type | Description |
|-------|------|-------------|
| `allowedTools` | `string[]` | Whitelist — if set, only these tools are available to the agent. |
| `deniedTools` | `string[]` | Blacklist — applied after the whitelist. Tools matching `deniedTools` are removed even if they match `allowedTools`. |
| `allowedPaths` | `string[]` | Glob patterns restricting filesystem access. Only paths matching these patterns are accessible to the agent. |
| `model` | `string` | Model constraint (e.g., `'claude-sonnet-4-6'`, `'claude-haiku-4-5'`). |
| `permissionMode` | `'ask' \| 'auto' \| 'deny'` | How tool permission prompts are handled. |

**Tool filtering order:** `allowedTools` is evaluated first (whitelist). Then `deniedTools` is applied on top (blacklist). This means you can whitelist a broad set and then surgically remove specific tools:

```typescript
scope: {
  allowedTools: ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write'],
  deniedTools: ['Write'],  // allow reading and editing, but not overwriting entire files
}
```

**Path restriction** with `allowedPaths` uses glob patterns. The agent can only access filesystem paths that match at least one of the patterns:

```typescript
scope: {
  allowedPaths: ['src/**', 'tests/**', 'package.json'],  // no access to node_modules, .env, etc.
}
```

## Reasoning Strategies

Reasoning strategies are middleware factories that read a `ReasoningPolicy` and augment the agent's requests. Import them from `@method/pacta`:

### reactReasoner

The ReAct strategy (Reasoning + Acting) adds structured reasoning to the agent's loop:

```typescript
import { createAgent, reactReasoner } from '@method/pacta';

const agent = createAgent({
  pact: {
    mode: { type: 'oneshot' },
    reasoning: {
      thinkTool: true,          // adds a zero-side-effect "think" tool
      planBetweenActions: true,  // injects planning instructions into system prompt
      instructions: 'Focus on edge cases and error paths.',  // custom instructions
    },
  },
  provider: myProvider,
});
```

When `thinkTool` is enabled, a `think` tool definition is added to request metadata. The tool accepts a `thought` string and has no side effects — it serves as a structured scratchpad. When `planBetweenActions` is enabled, the system prompt is augmented with instructions to state observations, plans, and expectations before each tool use.

The `THINK_TOOL` constant is exported if you need to reference the tool definition:

```typescript
import { THINK_TOOL } from '@method/pacta';
// { name: 'think', description: '...', inputSchema: { ... } }
```

### reflexionReasoner

The Reflexion strategy implements multi-trial verbal self-critique:

```typescript
import { createAgent, reflexionReasoner } from '@method/pacta';

const agent = createAgent({
  pact: {
    mode: { type: 'oneshot' },
    reasoning: {
      reflectOnFailure: true,      // enable reflection loop
      maxReflectionTrials: 3,      // max retries (default: 3)
    },
  },
  provider: myProvider,
});
```

When a result indicates failure (`stopReason: 'error'`), the reasoner constructs a verbal critique and retries. Budget exhaustion, timeout, and kill are non-retriable — only errors trigger reflection. Each retry emits an `AgentReflection` event with the trial number and critique text.

### fewShotInjector

Injects example prompt-response pairs into the agent's context:

```typescript
import { createAgent, fewShotInjector } from '@method/pacta';

const agent = createAgent({
  pact: {
    mode: { type: 'oneshot' },
    reasoning: {
      examples: [
        { prompt: 'Find the bug in auth.ts', response: 'Read the file first, then grep for error handling patterns...' },
        { prompt: 'Add tests for parser', response: 'Check existing test patterns, then create matching tests...' },
      ],
    },
  },
  provider: myProvider,
});
```

### effortMapper

Maps the `effort` field to provider-specific reasoning controls:

```typescript
import { createAgent, getEffortParams } from '@method/pacta';
import type { EffortParams } from '@method/pacta';

// Query the mapping directly
const params: EffortParams = getEffortParams('high');
// { thinkTool: true, planBetweenActions: true, reflectOnFailure: true, maxReflectionTrials: 3 }
```

| Effort | Think tool | Plan between actions | Reflect on failure | Max trials |
|--------|-----------|---------------------|-------------------|------------|
| `low` | No | No | No | 0 |
| `medium` | Yes | No | No | 0 |
| `high` | Yes | Yes | Yes | 3 |

## Context Managers

Context managers are middleware that handle the agent's context window across long-running tasks. Three strategies ship with `@method/pacta`:

### compactionManager

Monitors token usage and triggers context summarization when pressure exceeds a threshold:

```typescript
import { createAgent, compactionManager } from '@method/pacta';

const agent = createAgent({
  pact: {
    mode: { type: 'oneshot' },
    context: {
      strategy: 'compact',
      compactionThreshold: 0.8,  // trigger at 80% context usage (default)
      compactionInstructions: 'Summarize key decisions and pending tasks. Drop failed approaches.',
    },
  },
  provider: myProvider,
});
```

When cumulative token usage exceeds the threshold, the manager sends a compaction request to the provider. After compaction, token tracking resets to the compacted size. Emits `context_compacted` events with before/after token counts.

### noteTakingManager

Uses a `MemoryPort` to store and retrieve notes between turns:

```typescript
import { createAgent, noteTakingManager } from '@method/pacta';
import type { MemoryPort } from '@method/pacta';

const memory: MemoryPort = {
  async store(key, value) { /* ... */ },
  async retrieve(key) { /* ... */ },
  async writeNote(note) { /* ... */ },
  async readNotes(filter) { /* ... */ },
};

const agent = createAgent({
  pact: {
    mode: { type: 'oneshot' },
    context: { strategy: 'notes', memory },
  },
  provider: myProvider,
  memory,
});
```

Before each turn, the manager retrieves recent notes and prepends them to the prompt. After each completed turn, it stores a summary of the output as a note. This preserves important observations without relying on the context window.

### subagentDelegator

Delegates to fresh context windows when context pressure is detected:

```typescript
import { createAgent, subagentDelegator } from '@method/pacta';

const agent = createAgent({
  pact: {
    mode: { type: 'oneshot' },
    context: {
      strategy: 'subagent',
      compactionThreshold: 0.8,
      subagentSummaryTokens: 500,  // max tokens for summary prefix (default: 500)
    },
  },
  provider: myProvider,
});
```

When context pressure exceeds the threshold, the delegator builds a summary-prefixed request and runs it in a fresh context. The conversation summary accumulates across delegations, so each sub-agent receives context from all prior windows.

## Reference Agents and .with()

Reference agents are pre-assembled compositions that bridge Tier 1 to Tier 2. They expose a `.with()` method for selective overrides:

```typescript
import { codeAgent } from '@method/pacta';
import { claudeCliProvider } from '@method/pacta-provider-claude-cli';

const base = codeAgent({ provider: claudeCliProvider() });

// Override just the budget — everything else stays at defaults
const expensive = base.with({
  pact: { budget: { maxCostUsd: 10.0 } },
});

// Swap the provider entirely
const anthropicVersion = base.with({
  provider: anthropicProvider({ apiKey: '...' }),
});

// Add an event observer
const observed = base.with({
  onEvent: (e) => logToTelemetry(e),
});
```

`.with()` deep-merges pact overrides (budget, scope, streaming) and shallow-replaces everything else (provider, reasoning, context, tools, memory, onEvent). It returns a new `ReferenceAgent` — never mutates the original.

## Full Composition Example

Here is a fully assembled agent combining all the parts:

```typescript
import { createAgent, reactReasoner, compactionManager } from '@method/pacta';
import { anthropicProvider } from '@method/pacta-provider-anthropic';
import type { SchemaDefinition, SchemaResult } from '@method/pacta';

interface ReviewResult {
  verdict: 'approve' | 'request-changes';
  issues: string[];
  summary: string;
}

const reviewSchema: SchemaDefinition<ReviewResult> = {
  description: 'Structured code review result',
  parse(raw: unknown): SchemaResult<ReviewResult> {
    try {
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!['approve', 'request-changes'].includes(obj.verdict)) {
        return { success: false, errors: ['verdict must be "approve" or "request-changes"'] };
      }
      return { success: true, data: obj as ReviewResult };
    } catch {
      return { success: false, errors: ['Failed to parse as JSON'] };
    }
  },
};

const reviewer = createAgent<ReviewResult>({
  provider: anthropicProvider({
    model: 'claude-sonnet-4-6',
    toolProvider: myToolProvider,
  }),
  pact: {
    mode: { type: 'oneshot' },
    budget: { maxCostUsd: 1.50, maxTurns: 15, onExhaustion: 'stop' },
    scope: { allowedTools: ['Read', 'Grep', 'Glob'] },
    output: { schema: reviewSchema, retryOnValidationFailure: true, maxRetries: 2 },
    reasoning: { thinkTool: true, planBetweenActions: true, effort: 'high' },
    context: { strategy: 'compact', compactionThreshold: 0.8 },
  },
  onEvent(event) {
    if (event.type === 'budget_warning') {
      console.warn(`Budget: ${event.resource} at ${event.percentUsed}%`);
    }
    if (event.type === 'reflection') {
      console.log(`Reflection trial ${event.trial}: ${event.critique}`);
    }
  },
});

const result = await reviewer.invoke({
  prompt: 'Review the changes in src/auth/ for security issues',
  workdir: '/project',
});

if (result.completed) {
  console.log(`Verdict: ${result.output.verdict}`);
  console.log(`Issues: ${result.output.issues.join(', ')}`);
}
```

## Next Steps

- **[Guide 28 — Pacta: Implementing Providers](./28-pacta-providers.md)** — How to implement the AgentProvider port interface.
- **[Guide 29 — Pacta: Testing with Playground](./29-pacta-testing-with-playground.md)** — Test agents against virtual filesystems without calling real LLMs.
