---
guide: 26
title: "Pacta: Getting Started"
domain: pacta
audience: [everyone]
summary: >-
  5-minute introduction to the Pacta Agent SDK — pacts, providers, and your first agent.
prereqs: []
touches:
  - packages/pacta/src/
---

# Guide 26 — Pacta: Getting Started

Pacta is a modular Agent SDK where agents are assembled from typed, composable parts. Instead of locking you into one framework's assumptions, Pacta provides a contract layer (the **pact**) and lets you plug in any provider, reasoning strategy, context manager, or output validator.

## The Three Tiers

Pacta is designed for three levels of engagement:

| Tier | What you do | Who it's for |
|------|-------------|--------------|
| **1 — Use** | Import a reference agent, pass a provider, invoke | Teams evaluating agent architectures |
| **2 — Assemble** | Compose your own agent from typed parts via `createAgent()` | Developers building custom agents |
| **3 — Build** | Implement new providers, reasoners, or context managers via port interfaces | Infrastructure developers |

This guide covers Tier 1 and introduces the concepts needed for Tier 2.

## Core Concepts

### The Pact

A **Pact** is a plain data object declaring what an agent may do and how it behaves. It is declared before invocation, and the runtime enforces it.

```typescript
import type { Pact } from '@method/pacta';

const pact: Pact = {
  mode: { type: 'oneshot' },
  budget: { maxCostUsd: 1.0, maxTurns: 10 },
  scope: { allowedTools: ['Read', 'Grep', 'Edit'] },
};
```

A pact can declare:

| Field | What it controls |
|-------|-----------------|
| `mode` | Execution mode — `oneshot`, `resumable`, or `persistent` |
| `streaming` | Whether to stream events during execution |
| `budget` | Resource limits — tokens, cost, duration, turns |
| `output` | Output shape validation with retry |
| `scope` | Tool/path/model constraints |
| `context` | Context window management strategy |
| `reasoning` | Reasoning strategy configuration |

### Providers

An **AgentProvider** is the port interface that connects Pacta to an LLM runtime. Providers are separate packages:

- `@method/pacta-provider-claude-cli` — wraps the Claude CLI (`claude --print`)
- `@method/pacta-provider-anthropic` — calls the Anthropic Messages API directly

### createAgent()

The composition function that binds a provider (and optional parts) to a pact. It validates provider capabilities against pact requirements at composition time.

## Your First Agent

### Tier 1: Use a reference agent

The fastest path. Reference agents come pre-assembled with sensible defaults:

```typescript
import { codeAgent } from '@method/pacta';
import { claudeCliProvider } from '@method/pacta-provider-claude-cli';

const agent = codeAgent({
  provider: claudeCliProvider({ model: 'claude-sonnet-4-6' }),
});

const result = await agent.invoke({
  prompt: 'Add error handling to the payment service',
  workdir: '/path/to/project',
});

console.log(result.output);       // The agent's response
console.log(result.completed);    // true if finished normally
console.log(result.stopReason);   // 'complete' | 'budget_exhausted' | 'timeout' | 'killed' | 'error'
console.log(result.turns);        // Number of agentic turns
console.log(result.cost.totalUsd);// Cost in USD
```

The `codeAgent` uses oneshot mode, allows Read/Grep/Glob/Edit/Write/Bash tools, sets a $2.00 budget with 20 max turns, and enables the ReAct reasoning strategy with think tool and plan-between-actions.

Three reference agents ship with `@method/pacta`:

| Agent | Default tools | Reasoning | Budget |
|-------|--------------|-----------|--------|
| `codeAgent` | Read, Grep, Glob, Edit, Write, Bash | ReAct (think + plan) | $2.00, 20 turns |
| `researchAgent` | Read, Grep, Glob, WebSearch, WebFetch | ReAct (think + plan) | $3.00, 30 turns |
| `reviewAgent` | Read, Grep, Glob | ReAct (think) | $1.00, 10 turns |

### Tier 2: Assemble your own

When reference agents don't fit, compose your own with `createAgent()`:

```typescript
import { createAgent } from '@method/pacta';
import { claudeCliProvider } from '@method/pacta-provider-claude-cli';

const agent = createAgent({
  provider: claudeCliProvider(),
  pact: {
    mode: { type: 'oneshot' },
    budget: { maxCostUsd: 0.50, maxTurns: 5 },
    scope: { allowedTools: ['Read', 'Grep'] },
  },
});

const result = await agent.invoke({
  prompt: 'Find all TODO comments in the codebase',
  workdir: '/my/project',
});
```

See [Guide 27](./27-pacta-assembling-agents.md) for the full composition API.

## The AgentResult

Every invocation returns an `AgentResult`:

```typescript
interface AgentResult<TOutput = unknown> {
  output: TOutput;           // The agent's final output
  sessionId: string;         // Session ID (for resumable/persistent modes)
  completed: boolean;        // Whether the agent completed normally
  stopReason: 'complete' | 'budget_exhausted' | 'timeout' | 'killed' | 'error';
  usage: TokenUsage;         // Token counts (input, output, cache)
  cost: CostReport;          // Cost in USD with per-model breakdown
  durationMs: number;        // Wall-clock duration
  turns: number;             // Number of agentic turns
}
```

## Observing Events

Pass an `onEvent` callback to receive typed lifecycle events during execution:

```typescript
const agent = createAgent({
  provider: claudeCliProvider(),
  pact: { mode: { type: 'oneshot' } },
  onEvent(event) {
    switch (event.type) {
      case 'started':
        console.log(`Session: ${event.sessionId}`);
        break;
      case 'tool_use':
        console.log(`Tool: ${event.tool}(${JSON.stringify(event.input)})`);
        break;
      case 'budget_warning':
        console.log(`${event.resource}: ${event.percentUsed}% used`);
        break;
      case 'completed':
        console.log(`Done in ${event.turns} turns, $${event.cost.totalUsd}`);
        break;
    }
  },
});
```

The full event vocabulary includes: `started`, `text`, `thinking`, `tool_use`, `tool_result`, `turn_complete`, `context_compacted`, `reflection`, `budget_warning`, `budget_exhausted`, `error`, and `completed`.

## Customizing Reference Agents with .with()

Reference agents support `.with()` to selectively override defaults without full `createAgent()` composition:

```typescript
import { codeAgent } from '@method/pacta';
import { claudeCliProvider } from '@method/pacta-provider-claude-cli';

const agent = codeAgent({
  provider: claudeCliProvider(),
});

// Override the budget and scope — everything else stays at defaults
const customized = agent.with({
  pact: {
    budget: { maxCostUsd: 5.0, maxTurns: 50 },
    scope: { allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'] },
  },
});
```

`.with()` returns a new agent — the original is never mutated.

## Execution Modes

Pacta supports three execution modes. Streaming is orthogonal — any mode can stream events.

| Mode | Behavior | Provider support |
|------|----------|-----------------|
| `oneshot` | Single invocation, no session persistence | All providers |
| `resumable` | Can resume a prior session by ID | Claude CLI |
| `persistent` | Long-lived session with optional keep-alive | (future) |

```typescript
// Oneshot (default)
const pact = { mode: { type: 'oneshot' } };

// Resumable — resume a prior session
const pact = { mode: { type: 'resumable' } };
const result = await agent.invoke({
  prompt: 'Continue the refactoring',
  resumeSessionId: previousResult.sessionId,
});
```

## Next Steps

- **[Guide 27 — Pacta: Assembling Agents](./27-pacta-assembling-agents.md)** — Compose agents from typed parts: providers, reasoning strategies, context managers, validators.
- **[Guide 28 — Pacta: Implementing Providers](./28-pacta-providers.md)** — How to implement the AgentProvider port interface.
- **[Guide 29 — Pacta: Testing with Playground](./29-pacta-testing-with-playground.md)** — Test agents against virtual filesystems without calling real LLMs.
