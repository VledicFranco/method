# Pacta — Modular Agent SDK

## Responsibility

`@method/pacta` is a modular agent SDK that makes agent deployment a composition problem rather than a framework choice. Agents are assemblies of typed parts bound to a declarative contract (the pact). Every part — provider, reasoning strategy, context management, budget enforcement, output validation — is replaceable through port interfaces.

**Position in the layer stack:** L3 (library), same layer as `@method/methodts` and `@method/testkit`. Zero runtime dependencies — the core package has no `dependencies` field in `package.json`.

**Core thesis:** A pact declares *what* (constraints). Ports provide *how* (implementations). `createAgent()` binds them at composition time, validating that the provider supports the pact's requirements before any invocation occurs.

**Key constraints:**
- Core package (`@method/pacta`) has zero runtime dependencies (G-PORT gate)
- No cross-domain imports within pacta — engine/middleware/ports must not import from agents/ (G-BOUNDARY gate)
- No upward layer violations — pacta must not import from bridge L4 (G-LAYER gate)
- Streaming is orthogonal to execution mode — any mode can stream events
- Reference agents require an explicit provider — no default provider coupling

## Package Structure

Five packages, strict dependency flow:

```
@method/pacta-playground ──→ @method/pacta-testkit ──→ @method/pacta
@method/pacta-provider-claude-cli ──→ @method/pacta
@method/pacta-provider-anthropic ──→ @method/pacta
@method/bridge (L4) ──→ @method/pacta, @method/pacta-provider-*
```

| Package | Layer | Description |
|---------|-------|-------------|
| `@method/pacta` | L3 | Core types, ports, middleware, composition engine, reference agents |
| `@method/pacta-testkit` | L3 | RecordingProvider, fluent builders, assertion helpers |
| `@method/pacta-playground` | L3 | Simulated evaluation — virtual FS, scripted tools, scenario runner, comparative eval |
| `@method/pacta-provider-claude-cli` | L3 | Claude Code CLI provider (`--print`/`--resume`) |
| `@method/pacta-provider-anthropic` | L3 | Anthropic Messages API provider (raw fetch, SSE streaming) |

## Core Abstractions

### The Pact

The central data structure — a typed contract declared before invocation. Pure data, no behavior.

```typescript
interface Pact<TOutput = unknown> {
  mode: ExecutionMode;                    // How the agent runs
  streaming?: boolean | StreamOptions;    // Orthogonal to mode
  budget?: BudgetContract;                // Resource limits
  output?: OutputContract<TOutput>;       // Result shape validation
  scope?: ScopeContract;                  // Capability constraints
  context?: ContextPolicy;                // Context window management
  reasoning?: ReasoningPolicy;            // Reasoning behavior config
}
```

### ExecutionMode

Three behavioral contracts for agent lifecycle:

```typescript
type ExecutionMode = OneshotMode | ResumableMode | PersistentMode;

interface OneshotMode    { type: 'oneshot'; }
interface ResumableMode  { type: 'resumable'; sessionId?: string; }
interface PersistentMode { type: 'persistent'; keepAlive?: boolean; idleTimeoutMs?: number; }
```

### BudgetContract

Resource limits enforced at runtime. All fields optional — declare only what you want to constrain.

```typescript
interface BudgetContract {
  maxTokens?: number;         // Total token limit across all turns
  maxOutputTokens?: number;   // Per-invocation output token limit
  maxCostUsd?: number;        // Dollar cap for pact lifetime
  maxDurationMs?: number;     // Wall-clock timeout
  maxTurns?: number;          // Maximum agentic turns
  onExhaustion?: 'stop' | 'warn' | 'error';
}
```

### OutputContract

Structural validation of agent results. Schema accepts `unknown` to handle both string (CLI) and structured (API) output.

```typescript
interface OutputContract<T = unknown> {
  schema?: SchemaDefinition<T>;
  retryOnValidationFailure?: boolean;
  maxRetries?: number;          // default: 2
  retryPrompt?: string;
}

interface SchemaDefinition<T> {
  parse(raw: unknown): SchemaResult<T>;
  description?: string;
}

type SchemaResult<T> = { success: true; data: T } | { success: false; errors: string[] };
```

### ScopeContract

Capability constraints — tool whitelist/blacklist, filesystem paths, model selection, permission mode.

```typescript
interface ScopeContract {
  allowedTools?: string[];
  deniedTools?: string[];
  allowedPaths?: string[];
  model?: string;
  permissionMode?: 'ask' | 'auto' | 'deny';
}
```

### ContextPolicy

Declarative configuration for context window management. The `strategy` field selects the implementation.

```typescript
interface ContextPolicy {
  compactionThreshold?: number;          // Fraction 0-1, default 0.8
  compactionInstructions?: string;
  strategy?: 'compact' | 'notes' | 'subagent' | 'none';
  memory?: MemoryPort;                   // Required for 'notes' strategy
  subagentSummaryTokens?: number;        // Token budget for subagent summaries
  systemPromptBudget?: number;           // Token budget for system prompt
}
```

### ReasoningPolicy

Declarative configuration for reasoning behavior. Pure data — factory functions turn it into middleware.

```typescript
interface ReasoningPolicy {
  thinkTool?: boolean;               // Zero-side-effect scratchpad tool
  planBetweenActions?: boolean;       // Inject planning instructions
  reflectOnFailure?: boolean;         // Verbal self-critique on failure
  maxReflectionTrials?: number;       // default: 3
  examples?: AgentExample[];          // Few-shot prompt-response pairs
  effort?: 'low' | 'medium' | 'high';// Maps to provider-specific controls
  instructions?: string;             // Custom reasoning instructions
}
```

## Port Interfaces

Three port interfaces enable swappable implementations.

### AgentProvider

The primary port — base interface plus optional capability interfaces.

```typescript
interface AgentProvider {
  readonly name: string;
  capabilities(): ProviderCapabilities;
  invoke<T>(pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>>;
}

interface Streamable {
  stream(pact: Pact, request: AgentRequest): AsyncIterable<AgentEvent>;
}

interface Resumable {
  resume<T>(sessionId: string, pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>>;
}

interface Killable {
  kill(sessionId: string): Promise<void>;
}

interface Lifecycle {
  init(): Promise<void>;
  dispose(): Promise<void>;
}
```

`ProviderCapabilities` declares what the provider supports — validated at composition time by `createAgent()`:

```typescript
interface ProviderCapabilities {
  modes: ExecutionMode['type'][];                    // Which modes are supported
  streaming: boolean;
  resumable: boolean;
  budgetEnforcement: 'native' | 'client' | 'none';
  outputValidation: 'native' | 'client' | 'none';
  toolModel: 'builtin' | 'mcp' | 'function' | 'none';
  models?: string[];
}
```

### ToolProvider

Lists available tools and executes them by name. Implementations wrap MCP servers, function registries, or scripted responses.

```typescript
interface ToolProvider {
  list(): ToolDefinition[];
  execute(name: string, input: unknown): Promise<ToolResult>;
}

interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}
```

### MemoryPort

Unified memory interface for context strategies — key-value storage with optional semantic search and note-taking.

```typescript
interface MemoryPort {
  store(key: string, value: string, metadata?: Record<string, unknown>): Promise<void>;
  retrieve(key: string): Promise<string | null>;
  search?(query: string, limit?: number): Promise<MemoryEntry[]>;
  writeNote?(note: AgentNote): Promise<void>;
  readNotes?(filter?: NoteFilter): Promise<AgentNote[]>;
}
```

## Composition Engine

### createAgent()

The central composition function. Validates capabilities, builds the middleware pipeline, returns an `Agent` object.

```typescript
function createAgent<TOutput = unknown>(options: CreateAgentOptions<TOutput>): Agent<TOutput>;

interface CreateAgentOptions<TOutput = unknown> {
  pact: Pact<TOutput>;
  provider: AgentProvider;
  reasoning?: ReasoningPolicy;
  context?: ContextPolicy;
  tools?: ToolProvider;
  memory?: MemoryPort;
  onEvent?: (event: AgentEvent) => void;
}

interface Agent<TOutput = unknown> {
  invoke(request: AgentRequest): Promise<AgentResult<TOutput>>;
  readonly pact: Pact<TOutput>;
  readonly provider: AgentProvider;
}
```

**Capability validation at composition time:** `createAgent()` checks that the provider's `capabilities().modes` includes the pact's `mode.type`, and that streaming is supported if requested. Throws `CapabilityError` on mismatch — failing fast before any invocation.

**Middleware pipeline ordering:** Budget Enforcer (outer) -> Output Validator (inner) -> Provider. The budget enforcer wraps everything so it can stop execution before output validation retries consume more budget. The output validator wraps the provider directly so it can retry with verbal feedback.

## Reasoning Architecture

Reasoning is split: **ReasoningPolicy** is pure config data, **factory functions** produce middleware that implements the strategy.

All reasoning middleware follows the `ReasonerMiddleware` type:

```typescript
type ReasonerMiddleware = <T>(
  inner: InvokeFn<T>,
  pact: Pact<T>,
  onEvent?: (event: AgentEvent) => void,
) => InvokeFn<T>;
```

### Factory Functions

| Factory | Strategy | Behavior |
|---------|----------|----------|
| `reactReasoner(policy?)` | ReAct | Injects think tool definition via metadata, appends planning instructions to system prompt, adds custom reasoning instructions |
| `reflexionReasoner(policy?)` | Reflexion | Multi-trial retry with verbal self-critique. On retriable failure (stopReason `error`), constructs critique from prior output and retries. Emits `AgentReflection` events. Budget exhaustion/timeout/kill are non-retriable. |
| `fewShotInjector(examples)` | Few-shot | Formats `AgentExample[]` into labeled prompt-response pairs, appends to system prompt |
| `effortMapper(effort)` | Effort mapping | Maps `'low'`/`'medium'`/`'high'` to concrete `EffortParams` (thinkingBudgetTokens, temperature, maxTokens) placed in `request.metadata.effortParams` for providers to consume |

**Effort parameter mapping:**

| Level | thinkingBudgetTokens | temperature | maxTokens |
|-------|---------------------|-------------|-----------|
| low | 1,024 | 0.0 | 2,048 |
| medium | 4,096 | 0.3 | 4,096 |
| high | 16,384 | 0.5 | 8,192 |

### Think Tool

The ReAct reasoner can inject a `think` tool — a zero-side-effect scratchpad that the agent uses for structured reasoning. The tool definition is added to `request.metadata.reasoningTools` for providers to include in their tool lists.

## Context Management

Four strategies for managing context window pressure, each implemented as `ContextMiddleware`:

```typescript
type ContextMiddleware<T = unknown> = (
  inner: InvokeFn<T>,
  pact: Pact<T>,
  onEvent?: (event: AgentEvent) => void,
) => InvokeFn<T>;
```

| Manager | Strategy | Behavior |
|---------|----------|----------|
| `compactionManager(policy?)` | `compact` | Monitors cumulative token usage. When usage exceeds threshold (default 0.8), sends a compaction request asking the provider to summarize the conversation, then resets cumulative count. Emits `context_compacted`. |
| `noteTakingManager(policy?)` | `notes` | Before each turn: retrieves notes from MemoryPort, prepends to prompt. After each turn: stores key observation as a note. Requires `policy.memory` to be set. |
| `subagentDelegator(policy?)` | `subagent` | Under context pressure, builds a summary-prefixed request for delegation to a fresh context window. Accumulates conversation summary across turns, truncates to token budget. Emits `context_compacted`. |
| `systemPromptBudgetTracker(budget)` | (cross-cutting) | Estimates system prompt token count (4 chars/token heuristic). Warns at 80% budget, truncates at 100%. |

## Event Model

`AgentEvent` is a discriminated union of 12 typed lifecycle signals. Events are the observability surface of the pact — emitted during execution through the `onEvent` callback.

```typescript
type AgentEvent =
  | AgentStarted           // { type: 'started'; sessionId; timestamp }
  | AgentText              // { type: 'text'; content }
  | AgentThinking          // { type: 'thinking'; content }
  | AgentToolUse           // { type: 'tool_use'; tool; input; toolUseId }
  | AgentToolResult        // { type: 'tool_result'; tool; output; toolUseId; durationMs }
  | AgentTurnComplete      // { type: 'turn_complete'; turnNumber; usage }
  | AgentContextCompacted  // { type: 'context_compacted'; fromTokens; toTokens }
  | AgentReflection        // { type: 'reflection'; trial; critique }
  | AgentBudgetWarning     // { type: 'budget_warning'; resource; consumed; limit; percentUsed }
  | AgentBudgetExhausted   // { type: 'budget_exhausted'; resource; consumed; limit }
  | AgentError             // { type: 'error'; message; recoverable; code? }
  | AgentCompleted;        // { type: 'completed'; result; usage; cost; durationMs; turns }
```

**Delivery modes:**
- **invoke()** — events delivered synchronously via `onEvent` callback during execution, final result returned as `AgentResult`
- **stream()** (Streamable providers) — events yielded as `AsyncIterable<AgentEvent>`, including real-time text deltas and tool use blocks

## Provider Implementations

### Claude CLI Provider (`@method/pacta-provider-claude-cli`)

Wraps the `claude` CLI binary via `node:child_process.spawn`.

| Aspect | Detail |
|--------|--------|
| Capabilities | modes: `oneshot`, `resumable`. streaming: false. toolModel: `builtin`. |
| Oneshot | Spawns `claude --print` with scope-filtered `--allowedTools`, `--model`, `--system-prompt`. Captures stdout/stderr. |
| Resume | Spawns `claude --resume <sessionId>`. Same capture logic. |
| Token tracking | Not available from CLI — returns empty usage/cost. Budget enforcement is client-side. |
| Executor | `cli-executor.ts` — injectable `SpawnFn` for testing. Configurable binary, timeout (default 300s). |
| Errors | `CliExecutionError` (non-zero exit), `CliTimeoutError`, `CliSpawnError`. |

### Anthropic API Provider (`@method/pacta-provider-anthropic`)

Direct Anthropic Messages API integration via raw `fetch()`. No SDK dependency.

| Aspect | Detail |
|--------|--------|
| Capabilities | modes: `oneshot`. streaming: true. toolModel: `function`. |
| Invoke | Agentic tool use loop: send messages, check for `tool_use` blocks, execute via ToolProvider, feed results back, repeat until `end_turn` or max turns. |
| Streaming | SSE parser (`sse-parser.ts`) reads `ReadableStream<Uint8Array>` from `Response.body`, yields `AnthropicStreamEvent` objects. Maps to `AgentEvent` types during iteration. |
| Tool filtering | Respects `pact.scope.allowedTools` and `pact.scope.deniedTools` when building the tool list for the API request. |
| Token tracking | Full token usage from API response (input, output, cache read/write). Cost calculation via `pricing.ts`. |
| Errors | `AnthropicApiError` with status code and response body. |

## Verification Architecture

### Testkit (`@method/pacta-testkit`)

Testing affordances for Pacta agents. Depends only on `@method/pacta`.

| Export | Purpose |
|--------|---------|
| `RecordingProvider` | AgentProvider that captures all interactions — events, tool calls grouped by turn, thinking traces, final result. Configurable via `addResponse()` (scripted sequence) and `setDefaultResult()`. Reports all modes as supported. |
| `MockToolProvider` | ToolProvider with configurable tool definitions and responses. |
| `PactBuilder` | Fluent builder for `Pact` objects — `pactBuilder().withMode({type:'oneshot'}).withBudget({maxTurns:5}).build()`. Sensible defaults (oneshot mode). |
| `AgentRequestBuilder` | Fluent builder for `AgentRequest` objects. Default prompt: `'test prompt'`. |
| `assertToolsCalled(recording, tools)` | Assert exact ordered tool sequence. |
| `assertToolsCalledUnordered(recording, tools)` | Assert tool set with counts (any order). |
| `assertBudgetUnder(result, limits)` | Assert result within token/cost/duration/turn limits. |
| `assertOutputMatches(result, schema)` | Assert output passes `SchemaDefinition.parse()`. |

### Playground (`@method/pacta-playground`)

Simulated agent evaluation environment. Three fidelity tiers:

| Tier | Provider | Behavior |
|------|----------|----------|
| Stub | `ScriptedToolProvider` | Rule-based: `given(toolName, matcher).thenReturn(result)`. `givenAny()` for blanket responses. |
| Script | `ScriptedToolProvider` | Same as stub but with input-specific matchers for deterministic multi-step scenarios. |
| Virtual | `VirtualToolProvider` | In-memory `Map<string, string>` filesystem. Implements Read, Write, Edit, Glob, Grep with real semantics (line numbers, glob matching, regex search, Edit uniqueness check). No host side effects. |

**Scenario DSL:**
```typescript
scenario('rename variable')
  .given(filesystem({ '/src/main.ts': 'const foo = 1;' }))
  .when(prompt('Rename foo to bar'))
  .then(toolsCalled(['Read', 'Edit']))
  .then(outputMatches(mySchema))
  .then(tokensBelow(5000))
```

**Comparative evaluation:** `compareAgents(scenario, agentA, agentB)` runs the same scenario against two agent configs and produces a `ComparativeReport` with behavioral and resource diffs (tool sequence match, token/cost/turn deltas, both-correct checks).

**EvalReport** captures: behavioral (tools correct, sequence correct), output (schema valid), resources (tokens, cost, turns, duration), reasoning (plan detected, reflection detected, think tool used).

### Gate Tests (`packages/pacta/src/gates/gates.test.ts`)

FCA architectural invariants enforced as tests:

| Gate | Invariant |
|------|-----------|
| G-PORT | `@method/pacta` has zero runtime dependencies (no `dependencies` in `package.json`). |
| G-BOUNDARY | No cross-domain imports — engine, middleware, ports, gates must not import from `agents/`. The barrel `index.ts` is exempt as the public API surface. |
| G-LAYER | No upward layer violations — no source file may import from `@method/bridge` (L4). |

## Bridge Integration

Pacta operates at L3 as a library. The bridge at L4 is the integration surface:

- Bridge can depend on `@method/pacta` and `@method/pacta-provider-*` packages
- Pacta must not depend on the bridge (G-LAYER)
- The bridge's existing session management (PTY pool, domain-co-located structure) remains separate from Pacta's provider abstraction
- Bridge integration uses Pacta providers to replace or complement the existing PTY-based agent spawning

The bridge composition root (`server-entry.ts`) is where Pacta providers are instantiated and wired to bridge domains.

## Design Decisions

1. **Zero runtime dependencies in core.** `@method/pacta` has no `dependencies` field. All implementations (providers, testkit, playground) are separate packages. This keeps the type contracts portable — they can be consumed without pulling in fetch, node-pty, or any other runtime.

2. **Streaming orthogonal to mode.** Any execution mode can optionally stream events via `Pact.streaming`. Streaming is a provider capability, not a mode variant. This avoids a combinatorial explosion of mode types (oneshot-streaming, resumable-streaming, etc.).

3. **Provider capabilities validated at composition time.** `createAgent()` checks mode support and streaming support before returning an agent. Capability mismatches throw `CapabilityError` immediately, not at invocation time when the cost of failure is higher.

4. **Reference agents require explicit provider.** `codeAgent()`, `researchAgent()`, and `reviewAgent()` take a `ReferenceAgentConfig` with a mandatory `provider` field. No default provider is bundled — this prevents framework lock-in and makes the dependency explicit. The `.with()` method enables selective overrides without full composition knowledge.

5. **Reasoning policy as data, factories as implementation.** `ReasoningPolicy` is a plain interface with boolean/enum fields. `reactReasoner()`, `reflexionReasoner()`, etc. are factory functions that read the config and return middleware. This separation means the policy can be serialized, stored, and compared — the implementation is only needed at composition time.

6. **Middleware follows a consistent wrapping pattern.** Budget enforcement, output validation, context management, and reasoning all use the same `InvokeFn<T> -> InvokeFn<T>` wrapping pattern. Each middleware takes `(inner, pact, onEvent?)` and returns a new invoke function. This makes the pipeline composable and the ordering explicit.

7. **Output validation accepts `unknown`.** `SchemaDefinition.parse()` takes `unknown`, not `string`. This accommodates both CLI providers (text output) and API providers (structured JSON), allowing the same validation logic regardless of provider type.

## File Structure

```
packages/pacta/
├── src/
│   ├── index.ts                        Barrel exports (public API surface)
│   ├── pact.ts                         Pact, AgentRequest, AgentResult, TokenUsage, CostReport
│   ├── events.ts                       AgentEvent union type (12 variants)
│   ├── scope.ts                        ScopeContract
│   ├── engine/
│   │   └── create-agent.ts             createAgent(), Agent, CapabilityError, pipeline builder
│   ├── modes/
│   │   └── execution-mode.ts           ExecutionMode, OneshotMode, ResumableMode, PersistentMode
│   ├── budget/
│   │   └── budget-contract.ts          BudgetContract
│   ├── output/
│   │   └── output-contract.ts          OutputContract, SchemaDefinition, SchemaResult
│   ├── ports/
│   │   ├── agent-provider.ts           AgentProvider, Streamable, Resumable, Killable, Lifecycle
│   │   ├── tool-provider.ts            ToolProvider, ToolDefinition, ToolResult
│   │   └── memory-port.ts              MemoryPort, MemoryEntry, AgentNote, NoteFilter
│   ├── middleware/
│   │   ├── budget-enforcer.ts          Budget tracking, warnings at 80%, exhaustion handling
│   │   └── output-validator.ts         Schema validation, retry with verbal feedback
│   ├── context/
│   │   ├── context-policy.ts           ContextPolicy
│   │   ├── context-middleware.ts        ContextMiddleware type
│   │   ├── compaction-manager.ts       'compact' strategy
│   │   ├── note-taking-manager.ts      'notes' strategy
│   │   ├── subagent-delegator.ts       'subagent' strategy
│   │   └── system-prompt-budget-tracker.ts  System prompt token tracking
│   ├── reasoning/
│   │   ├── reasoning-policy.ts         ReasoningPolicy, AgentExample
│   │   ├── reasoner-middleware.ts       ReasonerMiddleware, InvokeFn types
│   │   ├── react-reasoner.ts           ReAct factory, THINK_TOOL definition
│   │   ├── reflexion-reasoner.ts       Reflexion factory, retry logic
│   │   ├── few-shot-injector.ts        Few-shot example injection
│   │   ├── effort-mapper.ts            Effort level to parameter mapping
│   │   └── index.ts                    Reasoning module barrel
│   ├── agents/
│   │   ├── reference-agent.ts          ReferenceAgent, .with() customization, deep merge
│   │   ├── code-agent.ts              codeAgent() — oneshot, 20 turns, $2, Read/Grep/Glob/Edit/Write/Bash
│   │   ├── research-agent.ts          researchAgent() — oneshot, 30 turns, $1, Read/Grep/Glob/WebSearch/WebFetch
│   │   └── review-agent.ts            reviewAgent() — oneshot, 15 turns, $1, Read/Grep/Glob (read-only)
│   └── gates/
│       └── gates.test.ts               G-PORT, G-BOUNDARY, G-LAYER architectural invariant tests
└── package.json                        @method/pacta — zero runtime dependencies
```

## References

- PRD 027: Pacta — Modular Agent SDK (`docs/prds/027-pacta.md`)
- FCA specification (`docs/fractal-component-architecture/`)
