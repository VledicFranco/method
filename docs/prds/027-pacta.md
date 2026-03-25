# PRD 027: Pacta — Modular Agent SDK

**Status:** Draft
**Author:** PO + Lysica
**Date:** 2026-03-25
**Package:** `@method/pacta` (L3 — library)
**Depends on:** None (standalone L3 library)
**Organization:** Vidtecci — vida, ciencia y tecnología

## Problem

Building an agent today means choosing a framework and accepting its assumptions. Claude Agent SDK locks you to Claude. OpenAI Agents SDK abstracts the chat API but not execution semantics. LangGraph gives you graph-based state machines. PydanticAI gives you output schemas. CrewAI gives you role-based teams. None gives you all of it. None lets you swap parts.

The deeper problem: these frameworks are **monoliths disguised as libraries**. You can't use OpenAI's guardrails with Claude's budget tracking. You can't use PydanticAI's output validation with LangGraph's checkpointing. You can't use Anthropic's think tool pattern with OpenAI's handoff model. Each framework bundles its own reasoning strategy, context management, tool integration, and provider coupling into a single opinionated package.

What's missing is a **modular agent SDK** — a framework where every part of the agent is a composable, replaceable component:

- The **LLM provider** is a port (swap Claude for OpenAI for Ollama)
- The **reasoning strategy** is a policy (ReAct, Reflexion, think tool, planning-first)
- The **context management** is a policy (compaction, note-taking, sub-agent delegation)
- The **budget enforcement** is a contract (tokens, cost, duration, turns)
- The **output validation** is a contract (schema + retry)
- The **tool integration** is a port (MCP, function tools, built-in)
- The **memory** is a port (in-context, external store, vector DB)

## Objective

Create `@method/pacta` — a modular Agent SDK where agents are assembled from typed, composable parts. Like building a robot: Pacta provides the frame (pact contracts), a library of functional parts (reasoning strategies, context policies, budget enforcers, output validators, provider adapters), and the modularity to define your own parts.

Three usage tiers:

1. **Use a pre-assembled agent** — import a ready-made configuration, provide your API key, run
2. **Assemble your own agent** — pick parts from the library, compose them into a custom agent
3. **Build custom parts** — implement the port interfaces to create new providers, reasoning strategies, or policies

## Core Thesis

An agent is not a monolith. It is an **assembly of parts under a pact**:

```
┌─────────────────────────────────────────────────────┐
│                     THE PACT                         │
│  Execution Mode · Budget · Output · Scope            │
│  Context Policy · Reasoning Policy                   │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ Provider │  │ Reasoner │  │ Context Manager  │   │
│  │  (port)  │  │  (port)  │  │     (port)       │   │
│  └──────────┘  └──────────┘  └──────────────────┘   │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │  Tools   │  │  Memory  │  │ Output Validator │   │
│  │  (port)  │  │  (port)  │  │     (port)       │   │
│  └──────────┘  └──────────┘  └──────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │           Budget Enforcer (wrapper)           │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

The pact declares the contracts. The parts fulfill them. The SDK enforces the contracts at runtime.

## Architecture

### Layer Position

```
L4  @method/bridge     Uses pacta to deploy agents
L3  @method/pacta      ← Modular Agent SDK
L3  @method/mcp        Protocol adapter — thin MCP tool wrappers over methodts
L2  @method/methodts   Domain extensions — type system, stdlib catalog, strategy logic
```

### The Pact (Extended)

```typescript
interface Pact<TOutput = string> {
  /** How the agent executes — behavioral contract */
  mode: ExecutionMode;

  /** What the agent may consume — resource limits */
  budget?: BudgetContract;

  /** The shape of the result — structural validation */
  output?: OutputContract<TOutput>;

  /** What capabilities the agent has — tool/path/model constraints */
  scope?: ScopeContract;

  /** How the agent manages its context window */
  context?: ContextPolicy;

  /** How the agent reasons between actions */
  reasoning?: ReasoningPolicy;
}
```

### Execution Modes

```typescript
type ExecutionMode =
  | { type: 'oneshot' }
  | { type: 'resumable'; sessionId?: string }
  | { type: 'persistent'; keepAlive?: boolean; idleTimeoutMs?: number }
  | { type: 'streaming'; format?: 'events' | 'text' }
```

### Context Policy

Formalizes the three canonical strategies for long-horizon tasks (from Anthropic's
context engineering research):

```typescript
interface ContextPolicy {
  /** Maximum context window usage before compaction triggers (0-1, default: 0.835) */
  compactionThreshold?: number;

  /** Custom instructions for compaction summary (what to preserve) */
  compactionInstructions?: string;

  /** Strategy for managing context growth */
  strategy?: 'compact' | 'notes' | 'subagent' | 'none';

  /** For 'notes' strategy: persistent memory store port */
  noteStore?: NoteStore;

  /** For 'subagent' strategy: max summary tokens returned from sub-agents */
  subagentSummaryTokens?: number;

  /** System prompt budget — max tokens allocated to static context */
  systemPromptBudget?: number;
}
```

### Reasoning Policy

Declarative reasoning strategies assembled from provider-agnostic techniques:

```typescript
interface ReasoningPolicy {
  /** Include a zero-side-effect think tool for mid-stream reasoning (+54% policy adherence) */
  thinkTool?: boolean;

  /** Require explicit planning before each tool call (+4% SWE-bench) */
  planBetweenActions?: boolean;

  /** On failure, reflect and retry with verbal self-critique (Reflexion pattern) */
  reflectOnFailure?: boolean;
  maxReflectionTrials?: number;

  /** Few-shot examples injected into system prompt (3-5 recommended) */
  examples?: AgentExample[];

  /** Reasoning effort level — maps to provider-specific thinking controls */
  effort?: 'low' | 'medium' | 'high';

  /** Custom reasoning instructions prepended to system prompt */
  instructions?: string;
}

interface AgentExample {
  /** User prompt */
  input: string;
  /** Expected reasoning trace (with <thinking> tags) */
  thinking?: string;
  /** Expected output */
  output: string;
}
```

### Budget Contract

```typescript
interface BudgetContract {
  maxTokens?: number;
  maxOutputTokens?: number;
  maxCostUsd?: number;
  maxDurationMs?: number;
  maxTurns?: number;
  onExhaustion?: 'stop' | 'warn' | 'error';
}
```

### Output Contract

```typescript
interface OutputContract<T> {
  schema?: SchemaDefinition<T>;
  retryOnValidationFailure?: boolean;
  maxRetries?: number;
  retryPrompt?: string;
}

interface SchemaDefinition<T> {
  parse(raw: string): SchemaResult<T>;
  description?: string;
}
```

### Scope Contract

```typescript
interface ScopeContract {
  allowedTools?: string[];
  deniedTools?: string[];
  allowedPaths?: string[];
  model?: string;
  permissionMode?: 'ask' | 'auto' | 'deny';
}
```

### Port Interfaces (The Modular Parts)

#### Agent Provider (LLM Abstraction)

```typescript
interface AgentProvider {
  readonly name: string;
  capabilities(): ProviderCapabilities;
  invoke<T>(pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>>;
  stream(pact: Pact, request: AgentRequest): AsyncIterable<AgentEvent>;
  resume<T>(sessionId: string, pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>>;
  kill(sessionId: string): Promise<void>;
}
```

#### Tool Provider

```typescript
interface ToolProvider {
  /** List available tools */
  list(): ToolDefinition[];
  /** Execute a tool */
  execute(name: string, input: unknown): Promise<ToolResult>;
}
```

#### Memory Provider

```typescript
interface MemoryProvider {
  /** Store a memory entry */
  store(key: string, value: string, metadata?: Record<string, unknown>): Promise<void>;
  /** Retrieve by key */
  retrieve(key: string): Promise<string | null>;
  /** Search by semantic similarity or keyword */
  search(query: string, limit?: number): Promise<MemoryEntry[]>;
}
```

#### Note Store (for context policy)

```typescript
interface NoteStore {
  /** Write a structured note */
  write(note: AgentNote): Promise<void>;
  /** Read notes relevant to current task */
  read(filter?: NoteFilter): Promise<AgentNote[]>;
}
```

### Pre-Assembled Agents (Batteries Included)

```typescript
// Tier 1: Use a pre-assembled agent
import { codeAgent, researchAgent, reviewAgent } from '@method/pacta/agents';

const result = await codeAgent.invoke({
  prompt: 'Add error handling to the payment service',
  workdir: '/path/to/project',
});

// Tier 2: Assemble your own
import { createAgent } from '@method/pacta';
import { claudeCliProvider } from '@method/pacta/providers/claude-cli';
import { reactReasoner } from '@method/pacta/reasoning/react';
import { compactionManager } from '@method/pacta/context/compaction';
import { zodValidator } from '@method/pacta/output/zod';

const myAgent = createAgent({
  provider: claudeCliProvider({ model: 'claude-sonnet-4-6' }),
  reasoning: reactReasoner({ thinkTool: true, planBetweenActions: true }),
  context: compactionManager({ threshold: 0.8 }),
  output: zodValidator(MyOutputSchema),
  pact: {
    mode: { type: 'resumable' },
    budget: { maxCostUsd: 1.00, maxTurns: 20 },
    scope: { allowedTools: ['Read', 'Grep', 'Glob', 'Edit'] },
  },
});

// Tier 3: Build custom parts
import type { AgentProvider } from '@method/pacta';

class OllamaProvider implements AgentProvider {
  readonly name = 'ollama';
  capabilities() { return { modes: ['oneshot'], streaming: true, ... }; }
  async invoke(pact, request) { /* ... */ }
  // ...
}
```

## Agent Events

```typescript
type AgentEvent =
  | { type: 'started'; sessionId: string; timestamp: string }
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_use'; tool: string; input: unknown; toolUseId: string }
  | { type: 'tool_result'; tool: string; output: unknown; toolUseId: string }
  | { type: 'turn_complete'; turnNumber: number; usage: TokenUsage }
  | { type: 'context_compacted'; fromTokens: number; toTokens: number }
  | { type: 'reflection'; trial: number; critique: string }
  | { type: 'budget_warning'; resource: string; consumed: number; limit: number }
  | { type: 'budget_exhausted'; resource: string; consumed: number; limit: number }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'completed'; result: string; usage: TokenUsage; cost: CostReport }
```

## Comparison to Existing Solutions

| Dimension | Pacta SDK | Claude Agent SDK | OpenAI Agents SDK | LangGraph | PydanticAI |
|-----------|-----------|-----------------|-------------------|-----------|------------|
| **Philosophy** | Modular parts, composable | Opinionated, batteries-included | Lightweight, handoff-based | Graph-based state machines | Contract-first outputs |
| **Provider** | Port interface, any provider | Claude only | Agnostic via LiteLLM | Agnostic via LangChain | Agnostic native |
| **Reasoning** | Pluggable policies (ReAct, Reflexion, think, plan) | Implicit (model decides) | Implicit | Graph nodes | Implicit |
| **Context** | Pluggable policies (compact, notes, subagent) | Built-in compaction | Sessions | Checkpoints | None |
| **Budget** | Declared contracts + enforcement | max_budget_usd | None | None | None |
| **Output** | Pluggable validators (Zod, custom) | None | Guardrails | State schema | Pydantic models |
| **Memory** | Port interface (in-context, store, vector) | Session persistence | Session stores | Thread state | None |
| **Tools** | Port interface (MCP, function, built-in) | Built-in + MCP | Functions + MCP | Graph nodes | DI functions |
| **Modularity** | Everything is a replaceable part | Monolithic | Semi-modular | Modular (graph nodes) | Semi-modular |
| **Pre-assembled** | Yes (code, research, review agents) | Yes (Claude Code) | No | No | No |

## Phases

### Phase 1: Core Types + Port Interfaces
- Pact, ExecutionMode, BudgetContract, OutputContract, ScopeContract
- ContextPolicy, ReasoningPolicy (new)
- AgentProvider, ToolProvider, MemoryProvider, NoteStore ports
- AgentEvent, AgentResult, TokenUsage, CostReport
- Package scaffold with FCA structure
- Zero dependencies — pure types and composition

### Phase 2: Agent Composition Engine
- `createAgent()` — compose ports into a running agent
- Pact validation — verify provider capabilities match requested pact
- Event stream wiring — connect provider events to caller
- Middleware pattern — budget enforcer, output validator as composable wrappers

### Phase 3: Reasoning Strategies (Library)
- Think tool implementation (zero-side-effect scratchpad)
- Plan-between-actions system prompt injection
- Reflexion loop (multi-trial with verbal self-critique)
- Few-shot example injection
- Effort level mapping to provider-specific controls

### Phase 4: Context Management (Library)
- Compaction manager (configurable threshold + custom instructions)
- Note-taking manager (external store + retrieval)
- Sub-agent delegator (fresh windows, summary extraction)
- System prompt budget tracking

### Phase 5: Claude Code Provider
- Implement AgentProvider for Claude CLI (--print, --resume, PTY)
- Map Claude's execution modes to Pacta's mode contracts
- Extract from bridge's existing PrintSession + LlmProvider

### Phase 6: Anthropic API Provider
- Implement AgentProvider for direct Anthropic Messages API
- Messages API for oneshot/streaming + tool use
- Prompt caching integration

### Phase 7: Pre-Assembled Agents
- `codeAgent` — code editing with scope constraints, think tool, planning
- `researchAgent` — web research with compaction, note-taking
- `reviewAgent` — code review with output schema, Reflexion on findings

### Phase 8: Bridge Integration
- Replace bridge's direct PrintSession/PtySession with Pacta agents
- Strategy pipelines use Pacta pacts
- Session pool delegates to Pacta for spawn decisions

## Non-Goals

- **Multi-agent orchestration.** Pacta handles single-agent assembly. Orchestration patterns
  (pipelines, teams, hierarchies) belong to the consumer. Pacta agents are the building
  blocks that orchestrators compose.
- **Agent-to-agent protocol.** MCP and A2A handle inter-agent communication. Pacta handles
  what happens inside a single agent.
- **Durable execution.** Temporal-style replay and checkpointing are infrastructure concerns.
  Pacta's resumable mode uses provider-native session persistence.
- **Training / fine-tuning.** Pacta uses prompting-based techniques (~80% of fine-tuning
  quality at zero training cost). Model training is out of scope.

## Success Criteria

1. An agent can be assembled from independent, typed parts (provider, reasoner, context manager, validator)
2. The same assembled agent works with at least two different providers (Claude CLI + Anthropic API)
3. Reasoning policies measurably improve agent behavior (think tool, planning, reflection)
4. Context policies prevent context rot on long-running tasks
5. Budget enforcement stops/warns before exceeding declared limits
6. Output validation retries on schema mismatch with verbal feedback
7. Pre-assembled agents work out of the box with just an API key
8. All agent lifecycle events are typed and emitted through a single event vocabulary
9. Zero transport dependencies in the core package
10. FCA gates pass (G-PORT, G-BOUNDARY, G-LAYER)

## Open Questions

1. **Should persistent mode (PTY) be a Pacta provider or stay in the bridge?** PTY sessions
   have OS-level concerns (node-pty, resize, shell detection) that may not belong in a pure library.

2. **How does Pacta relate to MCP?** MCP defines tool interfaces. Pacta provides a ToolProvider
   port. Should Pacta ship an MCP-backed ToolProvider implementation, or leave that to consumers?

3. **Should reasoning strategies be prompt-level or middleware-level?** The think tool is a tool
   definition. Planning instructions are system prompt additions. Reflexion is a retry loop.
   These operate at different layers — should they share an interface?

4. **How opinionated should pre-assembled agents be?** A `codeAgent` that works out of the box
   must make choices (model, tools, reasoning strategy). How customizable should it be while
   remaining "batteries included"?

5. **Should Pacta define its own tool format or adopt MCP's?** MCP's tool schema (JSON-RPC +
   JSON Schema for inputs) is becoming a standard. Pacta could adopt it natively for
   interoperability.

## Research References

- `ov-research/knowledge/multi-agent/agent-reasoning-techniques.md` — ReAct, Reflexion, think tool, LATS, planning-first
- `ov-research/knowledge/multi-agent/agent-sdk-landscape.md` — 2026 SDK comparison
- `ov-research/knowledge/llm-behavior/context-management.md` — stateless API, compaction, caching, context rot
- `ov-research/knowledge/multi-agent/coding-agent-architecture.md` — OpenDev architecture patterns
- `ov-research/knowledge/multi-agent/agent-failure-modes.md` — eight failure classes and mitigations
