---
title: "@method/pacta"
scope: package
layer: L3
contents:
  - src/pact.ts
  - src/modes/execution-mode.ts
  - src/budget/budget-contract.ts
  - src/output/output-contract.ts
  - src/scope.ts
  - src/events.ts
  - src/ports/agent-provider.ts
---

# @method/pacta

Agent deployment contracts. Typed pacts for execution mode, budget, output shape, and scope.

## What

Pacta formalizes agent deployment as **pacts** — typed contracts between caller and agent runtime. A pact declares:

- **Execution Mode** — oneshot, resumable, persistent, or streaming
- **Budget** — token limits, cost caps, duration timeouts, turn limits
- **Output** — schema validation with retry-on-failure
- **Scope** — allowed tools, filesystem paths, model constraints

## Why

Every agent framework treats execution mode as an implementation detail. Pacta makes it a first-class contract. The same orchestration code works across providers because it depends on behavioral guarantees, not provider internals.

## Layer Position

```
L4  @method/bridge     Uses pacta to deploy agents
L3  @method/pacta      ← Agent deployment contracts
L2  @method/methodts   Domain extensions
L0  @method/types      Pure type definitions
```

## Usage

```typescript
import type { Pact, AgentProvider } from '@method/pacta';

const pact: Pact = {
  mode: { type: 'resumable' },
  budget: { maxCostUsd: 0.50, maxTurns: 10, onExhaustion: 'stop' },
  scope: { model: 'claude-sonnet-4-6', allowedTools: ['Read', 'Grep', 'Glob'] },
};

const result = await provider.invoke(pact, {
  prompt: 'Analyze the test coverage in this project',
  workdir: '/path/to/project',
});
```

## Architecture

```
src/
  pact.ts                    Core types: Pact, AgentRequest, AgentResult, TokenUsage
  scope.ts                   ScopeContract — tool/path/model constraints
  events.ts                  AgentEvent discriminated union — lifecycle signals
  modes/
    execution-mode.ts        ExecutionMode — oneshot, resumable, persistent, streaming
  budget/
    budget-contract.ts       BudgetContract — resource limits
  output/
    output-contract.ts       OutputContract — schema validation
  ports/
    agent-provider.ts        AgentProvider — the provider port interface
```
