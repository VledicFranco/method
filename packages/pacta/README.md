---
title: "@method/pacta"
scope: package
layer: L3
contents:
  - src/pact.ts
  - src/scope.ts
  - src/events.ts
  - src/modes/execution-mode.ts
  - src/budget/budget-contract.ts
  - src/output/output-contract.ts
  - src/ports/agent-provider.ts
  - src/ports/tool-provider.ts
  - src/ports/memory-port.ts
  - src/context/context-policy.ts
  - src/context/context-middleware.ts
  - src/context/compaction-manager.ts
  - src/context/note-taking-manager.ts
  - src/context/subagent-delegator.ts
  - src/context/system-prompt-budget-tracker.ts
  - src/reasoning/reasoning-policy.ts
  - src/reasoning/reasoner-middleware.ts
  - src/reasoning/react-reasoner.ts
  - src/reasoning/reflexion-reasoner.ts
  - src/reasoning/few-shot-injector.ts
  - src/reasoning/effort-mapper.ts
  - src/engine/create-agent.ts
  - src/middleware/budget-enforcer.ts
  - src/middleware/output-validator.ts
  - src/agents/reference-agent.ts
  - src/agents/code-agent.ts
  - src/agents/research-agent.ts
  - src/agents/review-agent.ts
---

# @method/pacta

Modular Agent SDK -- typed contracts, composable middleware, and reference agents.

## Overview

Pacta formalizes agent deployment as **pacts** -- typed contracts between caller and agent runtime. A pact declares execution mode, budget limits, output schema, scope constraints, context management strategy, and reasoning behavior. The SDK provides three composition tiers:

- **Tier 1** -- Import a reference agent, pass a provider, invoke. One line to a working agent.
- **Tier 2** -- Customize reference agents with `.with()` or compose `createAgent()` with middleware.
- **Tier 3** -- Build custom middleware, reasoning strategies, and context managers.

## Install

```bash
npm install @method/pacta
```

## Layer Position

```
L4  @method/bridge                  Uses pacta to deploy agents
L3  @method/pacta                   Agent SDK (this package)
    @method/pacta-provider-*        Provider implementations
    @method/pacta-testkit           Verification affordances
    @method/pacta-playground        Evaluation environment
L2  @method/methodts                Domain extensions
```

## Usage

### Tier 1 -- Reference Agents

```typescript
import { codeAgent } from '@method/pacta';
import { claudeCliProvider } from '@method/pacta-provider-claude-cli';

const agent = codeAgent({ provider: claudeCliProvider() });

const result = await agent.invoke({
  prompt: 'Fix the bug in parser.ts',
  workdir: '/project',
});

console.log(result.output);
console.log(`Cost: $${result.cost.totalUsd.toFixed(4)}`);
```

Three reference agents are included:

| Agent | Tools | Budget | Reasoning |
|-------|-------|--------|-----------|
| `codeAgent` | Read, Grep, Glob, Edit, Write, Bash | 20 turns, $2.00 | ReAct + think tool |
| `researchAgent` | Read, Grep, Glob, WebSearch, WebFetch | 30 turns, $1.00 | ReAct + reflection |
| `reviewAgent` | Read, Grep, Glob (read-only) | 15 turns, $1.00 | ReAct + think tool |

Every reference agent supports `.with()` to override configuration without full recomposition:

```typescript
const cheapAgent = codeAgent({ provider }).with({
  pact: { budget: { maxCostUsd: 0.25, maxTurns: 5 } },
});
```

### Tier 2 -- createAgent Composition

```typescript
import { createAgent } from '@method/pacta';
import type { Pact } from '@method/pacta';
import { anthropicProvider } from '@method/pacta-provider-anthropic';

const pact: Pact = {
  mode: { type: 'oneshot' },
  budget: { maxCostUsd: 0.50, maxTurns: 10, onExhaustion: 'stop' },
  scope: { model: 'claude-sonnet-4-6', allowedTools: ['Read', 'Grep', 'Glob'] },
  output: {
    schema: {
      parse: (raw) => {
        const text = typeof raw === 'string' ? raw : String(raw);
        return text.length > 0
          ? { success: true, data: text }
          : { success: false, errors: ['Empty output'] };
      },
    },
    retryOnValidationFailure: true,
    maxRetries: 2,
  },
  reasoning: {
    thinkTool: true,
    planBetweenActions: true,
    effort: 'medium',
  },
  context: {
    strategy: 'compact',
    compactionThreshold: 0.8,
  },
};

const agent = createAgent({
  pact,
  provider: anthropicProvider({ apiKey: 'sk-...' }),
  onEvent: (event) => console.log(event.type),
});

const result = await agent.invoke({
  prompt: 'Analyze the test coverage in this project',
  workdir: '/path/to/project',
});
```

`createAgent()` validates provider capabilities at composition time. If the provider does not support the requested execution mode or streaming, it throws `CapabilityError` immediately -- not at invocation time.

### Tier 3 -- Custom Middleware

```typescript
import { budgetEnforcer, outputValidator } from '@method/pacta';
import { reactReasoner, reflexionReasoner, fewShotInjector, effortMapper } from '@method/pacta';
import { compactionManager, noteTakingManager, subagentDelegator } from '@method/pacta';

// Reasoning middleware -- wraps invoke with reasoning strategies
const react = reactReasoner({ thinkTool: true, planBetweenActions: true });
const reflexion = reflexionReasoner({ maxReflectionTrials: 3 });
const fewShot = fewShotInjector([
  { prompt: 'Find all TODO comments', response: 'Use Grep with pattern "TODO"...' },
]);
const effort = effortMapper('high');

// Context middleware -- manages context window pressure
const compactor = compactionManager({ compactionThreshold: 0.8 });
const noteTaker = noteTakingManager({ memory: myMemoryPort });
const delegator = subagentDelegator({ subagentSummaryTokens: 500 });
const promptTracker = systemPromptBudgetTracker(4000);
```

All middleware follows the same wrapping pattern:

```typescript
type InvokeFn<T> = (pact: Pact<T>, request: AgentRequest) => Promise<AgentResult<T>>;
type Middleware<T> = (inner: InvokeFn<T>, pact: Pact<T>, onEvent?: (e: AgentEvent) => void) => InvokeFn<T>;
```

## API Surface

### Core Types

`Pact<T>`, `AgentRequest`, `AgentResult<T>`, `TokenUsage`, `CostReport`

### Execution Modes

`ExecutionMode`, `OneshotMode`, `ResumableMode`, `PersistentMode`, `StreamOptions`

### Budget Contract

`BudgetContract` -- maxTokens, maxOutputTokens, maxCostUsd, maxDurationMs, maxTurns, onExhaustion

### Output Contract

`OutputContract<T>`, `SchemaDefinition<T>`, `SchemaResult<T>` -- schema validation with retry-on-failure

### Scope Contract

`ScopeContract` -- allowedTools, deniedTools, allowedPaths, model, permissionMode

### Agent Events

`AgentEvent` discriminated union (12 variants): `started`, `text`, `thinking`, `tool_use`, `tool_result`, `turn_complete`, `context_compacted`, `reflection`, `budget_warning`, `budget_exhausted`, `error`, `completed`

### Port Interfaces

`AgentProvider`, `Streamable`, `Resumable`, `Killable`, `Lifecycle`, `ProviderCapabilities`

`ToolProvider`, `ToolDefinition`, `ToolResult`

`MemoryPort`, `MemoryEntry`, `AgentNote`, `NoteFilter`

### Context Policy and Managers

`ContextPolicy`, `ContextMiddleware`

`compactionManager(policy?)` -- summarize-in-place when context pressure is detected

`noteTakingManager(policy?)` -- external scratchpad via MemoryPort

`subagentDelegator(policy?)` -- delegate to fresh context windows under pressure

`systemPromptBudgetTracker(budget)` -- track and truncate oversized system prompts

### Reasoning Policy and Strategies

`ReasoningPolicy`, `AgentExample`, `ReasonerMiddleware`

`reactReasoner(policy?)` -- ReAct: think tool + planning instructions

`reflexionReasoner(policy?)` -- multi-trial with verbal self-critique

`fewShotInjector(examples)` -- inject example prompt-response pairs

`effortMapper(effort)`, `getEffortParams(effort)` -- map low/medium/high to provider params (`EffortParams`)

### Composition Engine

`createAgent(options)` -- bind ports to a pact, validate capabilities, wire middleware pipeline

`Agent<T>` -- invoke(request), pact, provider

`CreateAgentOptions<T>` -- pact, provider, reasoning?, context?, tools?, memory?, onEvent?

`CapabilityError` -- thrown when provider cannot satisfy pact requirements

### Middleware

`budgetEnforcer(inner, pact, onEvent?)` -- tracks turns, tokens, cost, duration; emits warnings at 80%

`BudgetExhaustedError`, `BudgetState`

`outputValidator(inner, pact, onEvent?)` -- validates output against schema, retries with verbal feedback

### Reference Agents

`codeAgent(config)`, `researchAgent(config)`, `reviewAgent(config)`

`createReferenceAgent(defaultPact, config, reasoning?, context?)` -- factory for custom reference agents

`ReferenceAgent<T>` -- extends Agent with `.with(overrides)` for non-destructive customization

`ReferenceAgentConfig`, `ReferenceAgentPactOverrides`

## Architecture

```
src/
  pact.ts                          Pact<T>, AgentRequest, AgentResult, TokenUsage, CostReport
  scope.ts                         ScopeContract
  events.ts                        AgentEvent discriminated union (12 variants)
  modes/
    execution-mode.ts              ExecutionMode — oneshot, resumable, persistent
  budget/
    budget-contract.ts             BudgetContract — resource limits
  output/
    output-contract.ts             OutputContract — schema validation
  ports/
    agent-provider.ts              AgentProvider + Streamable, Resumable, Killable
    tool-provider.ts               ToolProvider, ToolDefinition, ToolResult
    memory-port.ts                 MemoryPort, AgentNote, NoteFilter
  context/
    context-policy.ts              ContextPolicy — declarative config
    context-middleware.ts          ContextMiddleware type
    compaction-manager.ts          Summarize-in-place strategy
    note-taking-manager.ts         External scratchpad via MemoryPort
    subagent-delegator.ts          Fresh context window delegation
    system-prompt-budget-tracker.ts  System prompt token tracking
  reasoning/
    reasoning-policy.ts            ReasoningPolicy, AgentExample
    reasoner-middleware.ts         ReasonerMiddleware type
    react-reasoner.ts              ReAct: think tool + planning
    reflexion-reasoner.ts          Multi-trial verbal self-critique
    few-shot-injector.ts           Example injection into system prompt
    effort-mapper.ts               Effort level → provider params
  engine/
    create-agent.ts                Composition function + capability validation
  middleware/
    budget-enforcer.ts             Budget tracking + exhaustion handling
    output-validator.ts            Schema validation + retry logic
  agents/
    reference-agent.ts             ReferenceAgent with .with() pattern
    code-agent.ts                  Pre-assembled coding agent
    research-agent.ts              Pre-assembled research agent
    review-agent.ts                Pre-assembled review agent
```

## Development

```bash
npm run build            # TypeScript build
npm test                 # Run all tests
```
