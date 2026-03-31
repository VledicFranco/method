---
title: "PRD 027: Pacta — Modular Agent SDK"
status: implemented
---

# PRD 027: Pacta — Modular Agent SDK

**Status:** Implemented (2026-03-25)
**Author:** PO + Lysica
**Date:** 2026-03-25
**Package:** `@method/pacta` (L3 — library)
**Depends on:** None (standalone L3 library)
**Organization:** Vidtecci — vida, ciencia y tecnología

## Problem

Building an agent today means choosing a framework and accepting its assumptions. Claude Agent SDK locks you to Claude. OpenAI Agents SDK abstracts the chat API but not execution semantics. LangGraph gives you graph-based state machines. PydanticAI gives you output schemas. CrewAI gives you role-based teams. None gives you all of it. None lets you swap parts.

The deeper problem: these frameworks bundle reasoning strategy, context management, tool integration, and provider coupling into single opinionated packages. You can't use OpenAI's guardrails with Claude's budget tracking. You can't use PydanticAI's output validation with LangGraph's checkpointing.

Pacta's value: **unify agent contracts that other frameworks scatter across incompatible APIs** — typed composition of budget, output, scope, context, and reasoning under a single declarative pact, with every part replaceable through port interfaces.

> **Honest framing:** Pacta mitigates coupling through port interfaces — each part can be
> used independently or replaced. Existing frameworks also have internal seams (LangGraph's
> graph nodes, PydanticAI's DI, Claude SDK's hooks). Pacta's differentiator is more seams
> in more places, with typed contracts at each seam.

## Target Users

- **Primary (Tier 2):** Developers building custom agents who need control over individual
  components — choice of provider, reasoning strategy, context management, output validation.
- **Secondary (Tier 1):** Teams evaluating agent architectures who want a quick start with
  reference implementations before investing in customization.
- **Extension (Tier 3):** Infrastructure developers building new providers, reasoning
  strategies, or tool integrations via the port interfaces.
- **Not targeting:** No-code users, enterprise orchestration buyers, or teams that need a
  managed agent service.

## Objective

Create `@method/pacta` — a modular Agent SDK where agents are assembled from typed, composable parts. Pacta provides the frame (pact contracts), a library of functional parts (reasoning strategies, context policies, budget enforcers, output validators, provider adapters), and the modularity to define your own parts.

## Core Thesis

An agent is not a monolith. It is an **assembly of parts under a pact**:

```
┌─────────────────────────────────────────────────────┐
│                     THE PACT                         │
│  Execution Mode · Budget · Output · Scope            │
│  Context Policy · Reasoning Policy · Streaming       │
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

### Configuration Model

The **Pact** is a plain data object describing constraints (budget, output schema, scope, mode).
`createAgent()` is the composition function that binds **port instances** (provider, reasoner,
context manager) to a pact. Pact = declarative what. Ports = runtime how.

```typescript
// Pact is data — no behavior, no dependencies
const pact: Pact = { mode: { type: 'resumable' }, budget: { maxCostUsd: 1.0 } };

// createAgent binds ports to pact — validates capabilities at composition time
const agent = createAgent({ pact, provider: myProvider, reasoning: myReasoner });
```

## Architecture

### Layer Position

```
L4  @method/bridge                    Uses pacta to deploy agents
L3  @method/pacta                     ← Modular Agent SDK (core: types + engine)
L3  @method/pacta-testkit             ← Verification affordances (FCA P4: builders, recording providers, assertions)
L3  @method/pacta-playground          ← Integration verification (FCA P6: scenarios, virtual FS, comparative eval)
L3  @method/pacta-provider-claude-cli ← Claude CLI provider (separate package)
L3  @method/pacta-provider-anthropic  ← Anthropic API provider (separate package)
L3  @method/mcp                       Protocol adapter
L2  @method/methodts                  Domain extensions
```

Dependency graph:
```
pacta-playground ──→ pacta-testkit ──→ pacta
pacta-provider-* ──→ pacta
bridge ──→ pacta, pacta-provider-*
```

> **Layer note:** Phase 1 produces L0-equivalent artifacts (pure types, zero behavior). The
> package reaches L3 when Phase 1 adds the composition engine and provider. This is an
> intentional L0→L3 promotion within a single phase (FCA §02, "Promotion and demotion").

### The Pact

```typescript
interface Pact<TOutput = unknown> {
  /** How the agent executes — behavioral contract */
  mode: ExecutionMode;

  /** Whether to stream events during execution (orthogonal to mode) */
  streaming?: boolean | StreamOptions;

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

Streaming is orthogonal — any mode can stream events.

```typescript
type ExecutionMode =
  | { type: 'oneshot' }
  | { type: 'resumable'; sessionId?: string }
  | { type: 'persistent'; keepAlive?: boolean; idleTimeoutMs?: number }
```

### Context Policy

Formalizes the three canonical strategies for long-horizon tasks:

```typescript
interface ContextPolicy {
  compactionThreshold?: number;
  compactionInstructions?: string;
  strategy?: 'compact' | 'notes' | 'subagent' | 'none';
  memory?: MemoryPort;  // for 'notes' strategy
  subagentSummaryTokens?: number;
  systemPromptBudget?: number;
}
```

### Reasoning Policy

Declarative configuration for reasoning strategies. `ReasoningPolicy` is the config;
factory functions like `reactReasoner()` read the config and return middleware that
implements it. The policy is data; the reasoner is the port implementation.

```typescript
interface ReasoningPolicy {
  thinkTool?: boolean;
  planBetweenActions?: boolean;
  reflectOnFailure?: boolean;
  maxReflectionTrials?: number;
  examples?: AgentExample[];
  effort?: 'low' | 'medium' | 'high';
  instructions?: string;
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
  /** Accepts string (CLI output) or structured object (API response) */
  parse(raw: unknown): SchemaResult<T>;
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

### Port Interfaces

#### Agent Provider (LLM Abstraction)

Split into base + optional capabilities. `createAgent` validates at composition time
that the provider supports the requested execution mode.

```typescript
/** Required — every provider must support invoke */
interface AgentProvider {
  readonly name: string;
  capabilities(): ProviderCapabilities;
  invoke<T>(pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>>;
}

/** Optional — provider can stream events */
interface Streamable {
  stream(pact: Pact, request: AgentRequest): AsyncIterable<AgentEvent>;
}

/** Optional — provider can resume prior sessions */
interface Resumable {
  resume<T>(sessionId: string, pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>>;
}

/** Optional — provider can kill persistent sessions */
interface Killable {
  kill(sessionId: string): Promise<void>;
}

interface ProviderCapabilities {
  modes: ExecutionMode['type'][];
  streaming: boolean;
  resumable: boolean;
  budgetEnforcement: 'native' | 'client' | 'none';
  outputValidation: 'native' | 'client' | 'none';
  toolModel: 'builtin' | 'mcp' | 'function' | 'none';
  models?: string[];
}
```

#### Tool Provider

```typescript
interface ToolProvider {
  list(): ToolDefinition[];
  execute(name: string, input: unknown): Promise<ToolResult>;
}
```

#### Memory Port

Unified memory interface (replaces separate MemoryProvider + NoteStore).
Optional `Lifecycle` for resources that need setup/teardown.

```typescript
interface MemoryPort {
  store(key: string, value: string, metadata?: Record<string, unknown>): Promise<void>;
  retrieve(key: string): Promise<string | null>;
  search?(query: string, limit?: number): Promise<MemoryEntry[]>;
  writeNote?(note: AgentNote): Promise<void>;
  readNotes?(filter?: NoteFilter): Promise<AgentNote[]>;
}

interface Lifecycle {
  init(): Promise<void>;
  dispose(): Promise<void>;
}
```

### Error Model

Middleware ordering: **Budget Enforcer → Output Validator → Provider**.

- Provider errors bubble as `{ type: 'error', recoverable }` events
- Budget exhaustion triggers `budget_exhausted` event then `kill` (if persistent)
- Output validation failures trigger retries within remaining budget
- If budget exhausts during a retry, budget wins (stops the agent)
- Streaming: errors delivered as events. Invoke: errors as rejected promises with typed error

### Pre-Assembled Agents (Reference Implementations)

Pre-assembled agents are **reference implementations and onboarding ramps**, not competitive
products. They demonstrate the composition model and provide sensible defaults that users
customize via Tier 2.

```typescript
// Tier 1: Use a reference agent
import { codeAgent } from '@method/pacta/agents';

const result = await codeAgent.invoke({
  prompt: 'Add error handling to the payment service',
  workdir: '/path/to/project',
});

// Tier 2: Assemble your own
import { createAgent } from '@method/pacta';
import { claudeCliProvider } from '@method/pacta-provider-claude-cli';

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
  capabilities() { return { modes: ['oneshot'], streaming: false, ... }; }
  async invoke(pact, request) { /* ... */ }
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
  | { type: 'completed'; result: unknown; usage: TokenUsage; cost: CostReport }
```

## Comparison to Existing Solutions

| Dimension | Pacta SDK | Claude Agent SDK | OpenAI Agents SDK | LangGraph | PydanticAI |
|-----------|-----------|-----------------|-------------------|-----------|------------|
| **Philosophy** | Typed contracts + port composition | Opinionated, batteries-included | Lightweight, handoff-based | Graph-based state machines | Contract-first outputs |
| **Provider** | Port interface, any provider | Claude only | Agnostic via LiteLLM | Agnostic via LangChain | Agnostic native |
| **Reasoning** | Declarative config + factory ports | Lifecycle hooks | Guardrails | Graph-defined | Implicit |
| **Context** | Declarative config + strategy ports | Built-in compaction | Sessions | Checkpoints | None |
| **Budget** | Declared contracts + enforcement | max_budget_usd | None | None | None |
| **Output** | Pluggable validators (Zod, custom) | None | Guardrails | State schema | Pydantic models |
| **Memory** | Port interface (kv, search, notes) | Session persistence | Session stores | Thread state | None |
| **Tools** | Port interface (MCP, function, built-in) | Built-in + MCP | Functions + MCP | Graph nodes | DI functions |

> **Provider-agnostic note:** The port interface is provider-agnostic by design. Initial
> shipped providers are Anthropic-first (Claude CLI, Anthropic API) by pragmatic choice.
> Community providers (Ollama, OpenAI) are expected post-launch. True validation of the
> port abstraction comes when a non-Anthropic provider implements it without stub methods.

## Phases

> Phases are logical groupings, not calendar commitments. Phases 3a and 3b are independent
> and may proceed concurrently.

### Phase 1: MVP — Types + Engine + Claude CLI Provider + Testkit

**Exit criteria:** `createAgent({ provider: claudeCliProvider() }).invoke("hello")` returns
a response. Gate tests pass (G-PORT, G-BOUNDARY, G-LAYER). Testkit ships alongside core.

**`@method/pacta` (core):**
- Pact, ExecutionMode, BudgetContract, OutputContract, ScopeContract, ContextPolicy, ReasoningPolicy
- AgentProvider (base + Streamable/Resumable/Killable), ToolProvider, MemoryPort
- AgentEvent, AgentResult, TokenUsage, CostReport
- `createAgent()` — compose ports, validate capabilities, wire events
- Middleware: budget enforcer, output validator (composable wrappers)
- Gate test scaffold: G-PORT (core has zero runtime deps), G-BOUNDARY, G-LAYER
- Co-located unit tests (`*.test.ts`) per FCA P8
- Phase 1 output is L0 (pure types) + L3 (composition engine). The package
  reaches full L3 at Phase 1 completion.

**`@method/pacta-testkit` (verification affordances — FCA P4):**
- `RecordingProvider` — implements AgentProvider, records all interactions
- `MockToolProvider` — returns scripted tool results
- `pactBuilder()` — fluent builder with sensible defaults
- `agentRequestBuilder()` — test request construction
- Assertion helpers: `assertToolsCalled()`, `assertBudgetUnder()`, `assertOutputMatches()`
- Recording captures: tool calls (name, input, output, timing), token usage per turn,
  cost per turn, reasoning traces, final output + stop reason. Rich enough for future
  `EvalReport` analysis.

**`@method/pacta-provider-claude-cli` (first provider):**
- Implement AgentProvider for Claude CLI (`--print`, `--resume`)
- Map Claude's execution modes to Pacta's mode contracts
- One reference agent (`simpleCodeAgent`) as integration test + Tier 1 on-ramp

### Phase 2: Playground — Simulated Agent Evaluation Environment

**Exit criteria:** A scenario runs an agent against a virtual filesystem, asserts on tool
calls and output, and produces an eval report. Gate tests pass.

**`@method/pacta-playground` (integration verification — FCA P6):**

Tiered simulation fidelity:

| Tier | Simulation | Fidelity | Cost |
|------|-----------|----------|------|
| **Stub** | All tools return canned responses | Low — tests agent logic | Free (no LLM) |
| **Script** | Tools follow scripted rules (given input X → return Y) | Medium — tests agent response to specific results | Free |
| **Virtual** | In-memory FS via `memfs`; Read/Write/Edit operate on virtual FS | High — tests actual file editing and verification | Cheap (no host side effects) |

> **Fidelity boundary:** Tier 3 = virtual filesystem only. Shell commands beyond FS
> operations are Tier 2 (scripted responses). No virtual git, no virtual npm. The
> `FidelityLevel` type enforces this at compile time.

Core deliverables:
- `FidelityLevel` type — scenarios declare their tier; type system enforces boundaries
- `VirtualToolProvider` — implements `ToolProvider` backed by `memfs` (Tier 3)
- `ScriptedToolProvider` — rule-based tool responses (Tier 2)
- Scenario runner: given filesystem state + tools + prompt → run agent → collect results
- Comparative runner: same scenario against two agent configs, diff behavior
- `EvalReport` schema (type definition — measurement logic deferred):
  ```typescript
  interface EvalReport {
    scenario: string;
    agent: string;
    behavioral: { toolsCorrect: boolean; sequenceCorrect: boolean };
    output: { schemaValid: boolean; qualityScore?: number };
    resources: { tokens: number; cost: number; turns: number; durationMs: number };
    reasoning: { planDetected: boolean; reflectionDetected: boolean; thinkToolUsed: boolean };
    robustness?: { faultInjected: string; recovered: boolean };
  }
  ```
- Scenario format: declarative, agent-agnostic data
  ```typescript
  scenario('code-review-agent')
    .given(filesystem({ 'src/main.ts': buggyCode }))
    .given(tools(['Read', 'Grep', 'Edit']))
    .when(prompt('Review this file for bugs'))
    .then(toolsCalled(['Read', 'Grep']))
    .then(outputMatches(reviewSchema))
    .then(tokensBelow(5000))
  ```

**External agents:** Scenarios are agent-agnostic data. The runner is Pacta-native.
External agents (Claude Code sub-agents, OpenAI) participate via `AgentProvider` adapter.
We don't build the adapter but don't prevent it.

**Deferred to Playground Phase 2:**
- `EvalReport` measurement logic (LLM quality judges, rubric scoring)
- Interactive step-through mode (watch agent run step-by-step)
- Fault injection (tool failures, ambiguous prompts, context pressure)

### Phase 3a: Reasoning Strategies (Library) — parallelizable with 3b

**Exit criteria:** Think tool + plan-between-actions demonstrated to change agent behavior
on a playground scenario. Gate tests pass.

- Think tool implementation (zero-side-effect scratchpad)
- Plan-between-actions system prompt injection
- Reflexion loop (multi-trial with verbal self-critique)
- Few-shot example injection
- Effort level mapping to provider-specific controls

### Phase 3b: Context Management (Library) — parallelizable with 3a

**Exit criteria:** Compaction manager triggers and preserves context on a long-running
playground scenario. Gate tests pass.

- Compaction manager (configurable threshold + custom instructions)
- Note-taking manager (MemoryPort + retrieval)
- Sub-agent delegator (fresh windows, summary extraction)
- System prompt budget tracking

### Phase 4: Second Provider + Reference Agents

**Exit criteria:** Same assembled agent runs with both Claude CLI and Anthropic API providers.
Reference agents work out of the box. Success criterion #2 validated.

**`@method/pacta-provider-anthropic`:**
- Implement AgentProvider for direct Anthropic Messages API
- Messages API for oneshot/streaming + tool use
- Prompt caching integration
- Port interface validated with two real implementations

**Reference agents:**
- Pre-assembled reference agents: `codeAgent`, `researchAgent`, `reviewAgent`
- `.with(overrides)` pattern for Tier 1→2 customization bridge
- Documentation: guides for implementing providers, writing reasoning strategies

### Phase 5: Bridge Integration

**Exit criteria:** At least one bridge session path uses Pacta. Spike validates integration
surface before full implementation.

- Begin with integration spike to validate Pacta-bridge boundary
- Replace bridge's direct PrintSession/PtySession with Pacta agents
- Strategy pipelines use Pacta pacts
- Session pool delegates to Pacta for spawn decisions

## Non-Goals

- **Multi-agent orchestration.** Pacta handles single-agent assembly. Orchestration patterns
  (pipelines, teams, hierarchies) belong to the consumer.
- **Agent-to-agent protocol.** MCP and A2A handle inter-agent communication.
- **Durable execution.** Temporal-style replay and checkpointing are infrastructure concerns.
- **Training / fine-tuning.** Pacta uses prompting-based techniques (~80% of fine-tuning
  quality at zero training cost).

## Success Criteria

1. An agent can be assembled from independent, typed parts (provider, reasoner, context manager, validator)
2. The same assembled agent works with at least two different providers (Claude CLI + Anthropic API)
3. Reasoning policies measurably improve agent behavior (think tool, planning, reflection)
4. Context policies prevent context rot on long-running tasks
5. Budget enforcement stops/warns before exceeding declared limits
6. Output validation retries on schema mismatch with verbal feedback
7. Reference agents work out of the box with just an API key
8. All agent lifecycle events are typed and emitted through a single event vocabulary
9. Zero transport dependencies in the core package
10. FCA gates pass (G-PORT, G-BOUNDARY, G-LAYER)
11. Testkit ships with Phase 1 — `RecordingProvider`, builders, assertions (FCA P4)
12. Playground scenarios run agents against virtual filesystem with behavioral assertions

> **Stretch goal:** A community-contributed non-Anthropic provider (e.g., Ollama, OpenAI)
> validates the port interface without stub methods.

## Proposed Refinement: Cognitive Module Architecture

The flat `ReasoningPolicy` and `ContextPolicy` types above are a starting point. Research into
cognitive architectures (ACT-R, SOAR, GWT, Nelson & Narens) suggests a deeper formalization:
agents as **compositions of cognitive modules** operating at two levels.

This refinement is being developed as a separate formal theory:

> **See:** `docs/rfcs/001-cognitive-composition.md` — calculus of cognitive module
> composition. The cognitive composition RFC is exploratory research. No Pacta phase depends
> on it. If the calculus proves useful, it enters through a future PRD, not scope creep
> on this one.

## Open Questions

1. **Should persistent mode (PTY) be a Pacta provider or stay in the bridge?** PTY sessions
   have OS-level concerns (node-pty, resize, shell detection) that may not belong in a pure library.

2. **How does Pacta relate to MCP?** MCP defines tool interfaces. Pacta provides a ToolProvider
   port. Should Pacta ship an MCP-backed ToolProvider implementation, or leave that to consumers?

3. **Should Pacta define its own tool format or adopt MCP's?** MCP's tool schema (JSON-RPC +
   JSON Schema for inputs) is becoming a standard. Pacta could adopt it natively.

## Research References

- `ov-research/knowledge/multi-agent/cognitive-architectures.md` — ACT-R, SOAR, GWT, CLARION, metacognition
- `ov-research/knowledge/multi-agent/agent-reasoning-techniques.md` — ReAct, Reflexion, think tool, LATS
- `ov-research/knowledge/multi-agent/agent-sdk-landscape.md` — 2026 SDK comparison
- `ov-research/knowledge/llm-behavior/context-management.md` — stateless API, compaction, caching, context rot
- `ov-research/knowledge/multi-agent/coding-agent-architecture.md` — OpenDev architecture patterns
- `ov-research/knowledge/multi-agent/agent-failure-modes.md` — eight failure classes and mitigations
