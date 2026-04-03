---
type: prd
title: "Runtime Consolidation — Unified Gates, SPL-Strategy Integration, Visual App Foundation"
date: "2026-04-03"
status: draft
domains: [methodts/gate, methodts/semantic, methodts/runtime, methodts/strategy, methodts/provider, bridge/strategies]
surfaces: [GateEvaluator, RetryLoop, SemanticNodeExecutor, StructuredAgentProvider]
---

# Runtime Consolidation — Unified Gates, SPL-Strategy Integration, Visual App Foundation

## Problem

pv-method has three overlapping systems for orchestrating LLM agent work: the methodology runtime (coalgebraic state machine), strategy DAG execution (declarative YAML pipelines), and SPL semantic algorithms (typed composable functions). They share the same AgentProvider, similar gate-check-retry loops, and overlapping DAG execution — but can't interoperate. A visual development app that drives FCD processes needs a unified, clean runtime underneath. The current redundancy makes that impossible to build well.

## Constraints

- F1-FTH formal theory is the source of truth — consolidation must preserve formal guarantees
- 6+ compiled methodologies in production registry — must remain loadable
- Bridge is deployed (Tailscale) — strategy execution, triggers, sessions are live
- Each wave must leave the system working — no big-bang rewrite
- Single developer — waves must be sequenceable

## Success Criteria

1. **One gate-check-retry implementation** shared across methodology steps, strategy gates, and SPL postconditions
2. **Strategy nodes can invoke SPL algorithms** — design, implement, explore, review as typed semantic functions
3. **Visual app feasibility** — consolidated runtime exposes typed structure (DAG state, gate results, artifact versions, surface freeze status) for frontend consumption

## Scope

**In scope:** Unify gate-check-retry, SPL as strategy node type, AgentProvider structured output, visual app port surface definition.

**Out of scope:** Building the visual app, rewriting F1-FTH, changing registry YAML format, SLM compilation research.

## Domain Map

```
methodts/gate (NEW) ←── methodts/runtime    (methodology steps)
       ↑                methodts/strategy   (strategy nodes)
       ↑                methodts/semantic   (SPL postconditions)

methodts/semantic ──→ methodts/strategy     (SPL as node type)

methodts/provider ←── methodts/runtime      (agent steps)
       ↑              methodts/strategy     (methodology nodes)
       ↑              methodts/semantic     (SPL execution)
```

## Surfaces (Primary Deliverable)

### GateEvaluator — Unified gate evaluation

Owner: gate | Consumers: runtime, strategy, semantic

```typescript
export interface GateEvaluator {
  evaluate(gate: GateCheck, context: GateContext): GateResult;
  evaluateAll(gates: readonly GateCheck[], context: GateContext): GateReport;
}

export type GateCheck =
  | { type: 'predicate'; predicate: Predicate<unknown>; label: string }
  | { type: 'algorithmic'; check: (context: GateContext) => GateResult }
  | { type: 'expression'; expr: string }

export interface GateContext {
  output: unknown;
  artifacts?: Record<string, unknown>;
  files?: readonly FileArtifact[];
  metadata?: Record<string, unknown>;
}

export interface GateResult {
  gate: string; passed: boolean; detail: string; confidence: 1.0;
}

export interface GateReport {
  results: readonly GateResult[]; passRate: number; allPassed: boolean;
}
```

### RetryLoop — Unified gate-check-retry

Owner: gate | Consumers: runtime, strategy, semantic

```typescript
export interface RetryLoop {
  executeWithRetry<I, O>(config: RetryConfig<I, O>): Effect.Effect<RetryResult<O>, RetryError, AgentProvider>;
}

export interface RetryConfig<I, O> {
  name: string;
  execute: (input: I, attempt: number) => Effect.Effect<O, unknown, AgentProvider>;
  gates: readonly GateCheck[];
  buildFeedback: (result: O, failures: readonly GateResult[]) => string;
  maxRetries: number;
  input: I;
}

export interface RetryResult<O> {
  data: O; gateReport: GateReport; attempts: number; confidence: number;
}
```

### SemanticNodeExecutor — SPL algorithms as strategy nodes

Owner: semantic | Consumer: strategy

```typescript
export interface SemanticNodeExecutor {
  execute(config: SemanticNodeConfig): Effect.Effect<SemanticNodeResult, SemanticNodeError, AgentProvider>;
}

export interface SemanticNodeConfig {
  algorithm: 'explore' | 'design' | 'implement' | 'review';
  input: Record<string, unknown>;
  gates?: readonly GateCheck[];
}

export interface SemanticNodeResult {
  output: Record<string, unknown>;
  gateReport: GateReport;
  truths: readonly Truth[];
  cost: { tokens: number; usd: number; duration_ms: number };
}
```

### StructuredAgentProvider — Typed LLM output

Owner: provider | Consumers: all systems

```typescript
export interface StructuredAgentProvider extends AgentProvider {
  executeStructured<T>(commission: StructuredCommission<T>): Effect.Effect<StructuredResult<T>, AgentError, never>;
}

export interface StructuredCommission<T> {
  prompt: string; schema: JsonSchema; schemaName: string;
}

export interface StructuredResult<T> {
  data: T; raw: string; cost: AgentCost;
}
```

### Canonical Entities

| Entity | Location | Notes |
|--------|----------|-------|
| `GateCheck` | `methodts/gate` | Unifies Predicate postconditions, DagGateConfig, GateCheckResult |
| `GateResult` | `methodts/gate` | Replaces three different gate result types |
| `FileArtifact` | `methodts/gate` | Moved from semantic — gates need file content |
| `Truth` | `methodts/semantic` | Stays — GateResult converts via adapter |

## Per-Domain Architecture

### methodts/gate (NEW — L2)

```
src/gate/
  gate-types.ts          — GateCheck, GateResult, GateReport, GateContext
  gate-evaluator.ts      — evaluate(), evaluateAll()
  retry-loop.ts          — executeWithRetry()
  algorithmic-gates.ts   — checkNoAny, checkNoTodos, checkPortSubstance (from semantic)
  index.ts
```

Pure module, no transport deps. Expression gates use safe evaluator.

### methodts/semantic (MODIFY — L2)

- Remove gate-runner.ts → import from gate/
- Export SemanticNodeExecutor implementation
- runAtomic uses RetryLoop

### methodts/runtime (MODIFY — L2)

- run-step.ts agent retry uses RetryLoop
- Step postconditions expressed as GateCheck predicates

### methodts/strategy (MODIFY — L2)

- dag-gates.ts delegates to GateEvaluator
- dag-executor.ts uses RetryLoop
- New node type: semantic (via SemanticNodeExecutor)

### methodts/provider (MODIFY — L2)

- AgentProvider extended with executeStructured<T>
- ClaudeHeadless: --output-format json
- BridgeProvider: Anthropic API tool_use

### bridge/strategies (MODIFY — L4)

- strategy-executor.ts handles semantic node type
- Wires SemanticNodeExecutor from methodts

## Phase Plan

### Wave 0 — Surfaces (types + interfaces only)

- Create gate/ with type definitions and port interfaces
- Add SemanticNodeExecutor port interface
- Add StructuredAgentProvider interface extension
- Architecture gate assertions
- **No business logic.**

### Wave 1 — Gate Unification

- Implement GateEvaluator and RetryLoop
- Move algorithmic gates from semantic to gate/
- Update SPL to use RetryLoop and GateEvaluator
- All semantic tests pass

### Wave 2 — Runtime + Strategy Integration

- Methodology run-step.ts uses RetryLoop
- Strategy dag-gates.ts uses GateEvaluator
- Strategy dag-executor.ts uses RetryLoop
- Semantic node type in strategy DAG
- SemanticNodeExecutor implementation
- All tests pass

### Wave 3 — Structured Output

- executeStructured<T> in ClaudeHeadlessProvider
- SPL parsers optionally use structured output
- Re-run recursive experiment — test P(parse) = 1.0 hypothesis
- Provider tests

### Wave 4 — Visual App Surface (design only)

- Define VisualRuntimePort (DAG state, gates, artifacts, surfaces)
- Architecture doc for visual app integration
- Port definition only — no app implementation

## Risks

- **Wave 2 risk:** Touching strategy executor + methodology runner simultaneously. Mitigate: old implementations behind flag until validated.
- **Breaking change:** GateCheck replacing three gate types. Mitigate: adapter functions during migration.
- **Structured output:** claude --print JSON mode support varies. Mitigate: optional, falls back to free-text parser.
