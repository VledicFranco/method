# PRD 027: Pacta — Agent Deployment Contracts

**Status:** Draft
**Author:** PO + Lysica
**Date:** 2026-03-25
**Package:** `@method/pacta` (L3 — library)
**Depends on:** None (standalone L3 library)

## Problem

Every agent framework treats execution mode as an implementation detail. Claude's `--print` mode promises "one cycle, structured JSON return." PTY mode promises "persistent session, prompt-response loop." OpenAI's chat completions promise "one response per request." These are fundamentally different behavioral contracts — but no library formalizes them.

The result:
- **Provider lock-in.** Claude Agent SDK is Claude-only. OpenAI Agents SDK abstracts the chat API but not execution semantics. Switching providers means rewriting orchestration logic.
- **Implicit contracts.** What does an agent invocation *promise*? Will it return? Will it stream? Can it be resumed? What events will it emit? These are discovered empirically, not declared.
- **No resource contracts.** Only Claude Agent SDK has budget caps. Everyone else leaves token tracking, cost limits, and timeout enforcement to the application layer.
- **Ad-hoc event vocabularies.** Each framework invents its own event types. No shared contract for "this agent will emit these events with these guarantees."

The bridge already has two agent backends (`PtySession` for persistent PTY, `PrintSession` for headless `--print`) behind a shared `PtySession` interface. But the interface is shaped by PTY semantics — `resize()`, `pid`, `transcript` as a string buffer. It conflates the execution contract with the transport mechanism.

## Objective

Create `@method/pacta` — an L3 library that formalizes agent deployment as **pacts**: typed contracts specifying execution mode, resource limits, event emissions, and output shape. The library abstracts the agent provider behind these pacts, so orchestration code depends on behavioral guarantees, not provider implementation.

## Core Thesis

An agent invocation is not a function call. It is a **pact** between the caller and the agent runtime:

1. **Execution Mode** — how the agent runs (one-shot, resumable, persistent, streaming)
2. **Resource Budget** — what the agent may consume (tokens, cost, time, turns)
3. **Event Contract** — what signals the agent will emit and when
4. **Output Contract** — the shape/schema of the result
5. **Scope Contract** — what capabilities the agent has (tools, paths, models)

The pact is declared before invocation. The runtime enforces it. Violations are observable events, not silent failures.

## Architecture

### Layer Position

```
L4  @method/bridge     Uses pacta to deploy agents (replaces direct PtySession/PrintSession)
L3  @method/pacta      ← NEW — agent deployment contracts
L3  @method/mcp        Protocol adapter — thin MCP tool wrappers over methodts
L2  @method/methodts   Domain extensions — type system, stdlib catalog, strategy logic
```

Pacta is a pure library — no HTTP server, no process management, no transport. It defines the contracts and provides the composition machinery. Concrete providers (Claude CLI, Anthropic API, OpenAI, Ollama) implement the provider port.

### The Pact

```typescript
interface Pact<TOutput = string> {
  // ── Execution Mode ──
  mode: ExecutionMode;

  // ── Resource Budget ──
  budget?: BudgetContract;

  // ── Output Contract ──
  output?: OutputContract<TOutput>;

  // ── Scope Contract ──
  scope?: ScopeContract;
}
```

### Execution Modes

```typescript
type ExecutionMode =
  | { type: 'oneshot' }                          // Invoke, get result, done
  | { type: 'resumable'; sessionId?: string }    // Invoke, get result, can resume later
  | { type: 'persistent'; keepAlive?: boolean }  // Spawn, prompt/response loop, explicit kill
  | { type: 'streaming'; format?: 'events' | 'text' }  // Invoke, get event stream
```

Each mode is a behavioral contract:
- **oneshot** — caller gets exactly one response. No state survives.
- **resumable** — caller gets one response per invocation, but can resume with prior context. The provider handles session persistence.
- **persistent** — caller spawns a long-lived agent. Multiple prompt/response cycles. Caller must explicitly kill.
- **streaming** — caller gets a stream of typed events during execution. The stream terminates when the agent completes.

### Resource Budget

```typescript
interface BudgetContract {
  maxTokens?: number;           // Total token limit (input + output)
  maxOutputTokens?: number;     // Output token limit per invocation
  maxCostUsd?: number;          // Dollar cap
  maxDurationMs?: number;       // Wall-clock timeout
  maxTurns?: number;            // Agentic loop iteration cap
  onExhaustion?: 'stop' | 'warn' | 'error';  // What happens when budget runs out
}
```

### Output Contract

```typescript
interface OutputContract<T> {
  schema?: ZodSchema<T>;        // Structural validation (à la PydanticAI)
  retryOnValidationFailure?: boolean;  // Re-prompt if output doesn't match
  maxRetries?: number;
}
```

### Scope Contract

```typescript
interface ScopeContract {
  allowedTools?: string[];       // Tool whitelist
  deniedTools?: string[];        // Tool blacklist
  allowedPaths?: string[];       // Filesystem scope
  model?: string;                // Model constraint
  permissionMode?: 'ask' | 'auto' | 'deny';  // How tool permissions are handled
}
```

### Agent Provider Port

```typescript
interface AgentProvider {
  /** What this provider supports */
  capabilities(): ProviderCapabilities;

  /** Execute an agent under a pact */
  invoke(pact: Pact, request: AgentRequest): Promise<AgentResult>;

  /** Execute with streaming events */
  stream(pact: Pact, request: AgentRequest): AsyncIterable<AgentEvent>;

  /** Resume a prior session (only if provider supports resumable/persistent modes) */
  resume(sessionId: string, request: AgentRequest): Promise<AgentResult>;

  /** Kill a persistent session */
  kill(sessionId: string): Promise<void>;
}

interface ProviderCapabilities {
  modes: ExecutionMode['type'][];           // Which modes are supported
  streaming: boolean;                        // Can stream events
  resumable: boolean;                        // Can resume sessions
  budgetEnforcement: 'native' | 'client';   // Who enforces budgets
  outputValidation: 'native' | 'client';    // Who validates output schemas
  tools: 'builtin' | 'mcp' | 'function' | 'none';  // Tool integration model
}
```

### Agent Events

```typescript
type AgentEvent =
  | { type: 'started'; sessionId: string; timestamp: string }
  | { type: 'text'; content: string }
  | { type: 'tool_use'; tool: string; input: unknown }
  | { type: 'tool_result'; tool: string; output: unknown }
  | { type: 'turn_complete'; turnNumber: number; usage: TokenUsage }
  | { type: 'budget_warning'; consumed: Partial<BudgetContract>; remaining: Partial<BudgetContract> }
  | { type: 'budget_exhausted'; consumed: Partial<BudgetContract> }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'completed'; result: string; usage: TokenUsage; cost: CostReport }
```

### Token Usage & Cost

```typescript
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens: number;
}

interface CostReport {
  totalUsd: number;
  perModel: Record<string, { tokens: TokenUsage; costUsd: number }>;
  budgetConsumedPercent?: number;
}
```

## Comparison to Existing Solutions

| Dimension | Pacta | Claude Agent SDK | OpenAI Agents SDK | LangGraph | PydanticAI |
|-----------|-------|-----------------|-------------------|-----------|------------|
| **Execution modes** | First-class typed contracts | Implicit (streaming generator) | Implicit (Runner) | Graph states | run/stream |
| **Provider** | Port interface, any provider | Claude only | Agnostic via LiteLLM | Agnostic via LangChain | Agnostic native |
| **Budget contracts** | Declared + enforced | max_budget_usd only | None | None | None |
| **Output contracts** | Zod schemas + retry | None | Guardrails | State schema | Pydantic models |
| **Event contracts** | Typed, guaranteed vocabulary | Typed messages | Streaming events | State transitions | Streaming |
| **Scope contracts** | Tools, paths, permissions | allowed_tools | Guardrails | N/A | N/A |
| **Formal pact** | Yes — declared before invocation | No | No | No | Partial (output only) |

## Phases

### Phase 1: Core Types + Port Interface
- Define `Pact`, `ExecutionMode`, `BudgetContract`, `OutputContract`, `ScopeContract`
- Define `AgentProvider` port interface
- Define `AgentEvent`, `AgentResult`, `TokenUsage`, `CostReport`
- Define `ProviderCapabilities`
- Package scaffold: `@method/pacta` with FCA structure
- Zero dependencies — pure types and composition

### Phase 2: Budget Enforcement
- Client-side budget tracker (wraps any provider)
- Token counting, cost accumulation, duration tracking
- Budget exhaustion policy (stop/warn/error)
- Budget events emitted to caller

### Phase 3: Output Validation
- Zod-based output validation layer
- Retry-on-failure with re-prompting
- Validation events emitted to caller

### Phase 4: Claude Code Provider
- Implement `AgentProvider` for Claude CLI (`--print`, `--resume`, PTY)
- Map Claude's execution modes to Pacta's mode contracts
- Extract from bridge's existing `PrintSession` + `LlmProvider`

### Phase 5: Anthropic API Provider
- Implement `AgentProvider` for direct Anthropic API
- Messages API for oneshot/streaming
- Tool use mapping

### Phase 6: Bridge Integration
- Replace bridge's direct `PrintSession`/`PtySession` with Pacta-backed invocations
- Strategy pipelines use Pacta pacts instead of raw LlmProvider
- Session pool delegates to Pacta for spawn decisions

## Non-Goals

- **Prompt engineering.** Pacta deploys agents, it doesn't design their prompts.
- **Multi-agent orchestration.** Pacta handles single-agent pacts. Orchestration patterns (pipelines, teams, hierarchies) belong to the consumer (bridge, strategy domain).
- **Agent-to-agent protocol.** MCP and A2A handle inter-agent communication. Pacta handles deployment.
- **Durable execution.** Temporal-style replay and checkpointing are infrastructure concerns, not library concerns. Pacta's resumable mode uses provider-native session persistence.

## Success Criteria

1. An agent can be deployed under a typed pact that declares mode, budget, output shape, and scope
2. The same orchestration code works with at least two different providers (Claude CLI + Anthropic API)
3. Budget enforcement stops/warns before exceeding declared limits
4. Output validation retries on schema mismatch
5. All agent lifecycle events are typed and emitted through a single event vocabulary
6. Zero transport dependencies in the core package (pure types + composition)
7. FCA gates pass (G-PORT, G-BOUNDARY, G-LAYER)

## Open Questions

1. **Should persistent mode sessions be first-class in Pacta, or should that stay in the bridge?** Persistent PTY sessions have OS-level concerns (node-pty, resize, shell detection) that may not belong in a pure library.

2. **Zod as the only schema validator?** PydanticAI uses Pydantic (Python-native). Should Pacta support pluggable validators, or is Zod the right bet for TypeScript?

3. **How does Pacta relate to MCP?** MCP defines tool interfaces. Pacta defines deployment contracts. They're complementary — a Pacta scope contract can reference MCP server capabilities. But should Pacta have first-class MCP awareness?

4. **Event contract as part of the pact vs. emergent?** Should the pact declare "this agent will emit progress events every N turns" or should events just flow based on what happens?
