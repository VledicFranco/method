---
type: prd
id: "046"
title: "Runtime Consolidation — Unified Gates, SPL-Strategy Integration, Visual App Foundation"
date: "2026-04-03"
status: implemented
domains: [methodts/gate, methodts/semantic, methodts/runtime, methodts/strategy, methodts/provider, bridge/strategies]
surfaces: [DagGateEvaluator, SemanticNodeExecutor, StructuredAgentProvider, RuntimeObserver]
review: "fcd-review 2026-04-03 — 11 findings (2 critical, 5 high, 4 medium), all critical/high resolved"
evidence: "exp-spl-design (6 runs), exp-spl-explore (3 runs)"
---

# PRD 046 — Runtime Consolidation

## Problem

pv-method has three overlapping systems for orchestrating LLM agent work: the **methodology runtime** (coalgebraic state machine from F1-FTH), **strategy DAG execution** (declarative YAML pipelines), and **SPL semantic algorithms** (typed composable functions). They share the same AgentProvider, similar gate-check-retry loops, and overlapping DAG execution — but can't interoperate. A visual development app that drives FCD processes needs a unified, clean runtime underneath. The current redundancy makes that impossible to build well.

### Evidence (exp-spl-design)

The SPL experiment (6 runs, 2 scales, 8 conditions) established:
- Flat design outperforms recursive at all tested scales (3 and 10 domains)
- Gate-check-retry achieves 100% reliability with deterministic algorithmic gates
- Parser robustness (P(parse)^N) is the practical bottleneck for recursive agents
- Structured output would eliminate the parser problem (P(parse) = 1.0)
- Concrete format examples dramatically improve LLM output quality

These findings motivate: unified gates, structured output support, and SPL-strategy integration.

## Constraints

- **Theory faithfulness** — F1-FTH formal theory is the source of truth
- **Registry stability** — 6+ compiled methodologies in production
- **Bridge live** — strategy execution, triggers, sessions deployed via Tailscale
- **Incremental delivery** — each wave leaves the system working
- **Single developer** — waves must be sequenceable

## Success Criteria

1. **Unified gate evaluation** — strategy `DagGateConfig` and SPL `GateCheckResult` converge into the existing `gate/gate.ts` module
2. **SPL as strategy node type** — strategy DAGs can invoke `explore`, `design`, `implement`, `review` as typed semantic functions
3. **Visual app feasibility** — `RuntimeObserver` port defined, enabling frontends to subscribe to DAG state, gate results, and artifact flow in real-time

## Scope

**In scope:** Gate unification into existing module, SPL as strategy node type, AgentProvider structured output, RuntimeObserver port for visual apps.

**Out of scope:** Building the visual app, rewriting F1-FTH, changing registry YAML format, SLM compilation research, Pacta/Effect AgentProvider convergence (noted as future work).

## Domain Map

```
methodts/gate (EXTEND) ←── methodts/runtime     (methodology steps — typed Gate<S>)
       ↑                   methodts/strategy    (strategy nodes — DagGateEvaluator)
       ↑                   methodts/semantic    (SPL — algorithmic gate checks)

methodts/semantic ──→ methodts/strategy          (SPL algorithms as node type)

methodts/provider ←── methodts/runtime           (agent steps — Effect AgentProvider)
       ↑              methodts/strategy          (methodology nodes — Pacta AgentProvider)
       ↑              methodts/semantic           (SPL execution — Effect AgentProvider)
```

**Note (from review F-S-004):** Two distinct AgentProvider interfaces exist — Pacta's imperative `invoke()` and methodts' Effect-based `execute()`. This PRD does not unify them. StructuredAgentProvider extends the Effect-based interface only. Pacta integration is future work.

## Surfaces (Primary Deliverable)

### DagGateEvaluator — Strategy gate evaluation extracted as port

Owner: methodts/gate | Consumer: methodts/strategy

The existing `gate/gate.ts` has typed `Gate<S>` for methodology use. Strategy uses a separate `DagGateConfig` with expression-based evaluation. These two models are **intentionally separate** (review F-S-001) — typed `Gate<S>` requires a state type parameter; `DagGateConfig` operates on stringly-typed context bags. Merging them erases the type parameter that makes `Gate<S>` valuable.

This surface extracts strategy-specific gate evaluation as a port, so the strategy executor doesn't own gate logic directly.

```typescript
/** Port for evaluating strategy DAG gates. */
export interface DagGateEvaluator {
  /** Evaluate a single DAG gate against its context. */
  evaluate(gate: DagGateConfig, gateId: string, context: DagGateContext,
           resolver?: HumanApprovalResolver, approvalCtx?: HumanApprovalContext): Promise<DagGateResult>;
}

// DagGateConfig, DagGateContext, DagGateResult — existing types from dag-types.ts, unchanged.
```

*Minimality: one method, matching the existing `evaluateGate()` signature exactly. No new abstractions.*

Gate: G-BOUNDARY — strategy executor imports from `gate/`, not from its own `dag-gates.ts`.
Status: **frozen**.

### SemanticNodeExecutor — SPL algorithms as strategy nodes

Owner: methodts/semantic | Consumer: methodts/strategy

```typescript
export interface SemanticNodeExecutor {
  /** Execute a named SPL algorithm as a strategy node. */
  execute(config: SemanticNodeConfig): Effect.Effect<SemanticNodeResult, SemanticNodeError, AgentProvider>;
}

export interface SemanticNodeConfig {
  /** Which SPL algorithm to run. */
  algorithm: 'explore' | 'design' | 'implement' | 'review';
  /** Algorithm-specific input (typed per algorithm internally). */
  input: Record<string, unknown>;
}

export interface SemanticNodeResult {
  output: Record<string, unknown>;
  truths: readonly Truth[];
  cost: { tokens: number; usd: number; duration_ms: number };
}
```

*Minimality (review F-S-005): `gates` field removed — each algorithm carries its own postconditions. No caller-injected gates.*

Gate: G-BOUNDARY — strategy imports from semantic's node executor port, never from SPL internals.
Status: **frozen**.

### StructuredAgentProvider — Typed LLM output (Effect-based only)

Owner: methodts/provider | Consumers: methodts/semantic, methodts/runtime

```typescript
export interface StructuredAgentProvider extends AgentProvider {
  /** Execute with structured output — returns typed JSON, no parsing needed. */
  executeStructured<T>(commission: StructuredCommission<T>): Effect.Effect<StructuredResult<T>, AgentError, never>;
}

export interface StructuredCommission<T> {
  prompt: string;
  schema: JsonSchema;
  schemaName: string;
}

export interface StructuredResult<T> {
  data: T;
  raw: string;
  cost: AgentCost;
}
```

*Note (review F-S-004): This extends the Effect-based AgentProvider only. Pacta's AgentProvider is a separate interface with different invocation semantics. Strategy nodes using Pacta are unaffected.*

Gate: G-PORT — consumers use this port, never call LLM APIs directly.
Status: **frozen**.

### RuntimeObserver — Visual app subscription surface

Owner: methodts/gate | Consumers: bridge (future visual app)

```typescript
/** Lightweight observation hook for runtime events. */
export interface RuntimeObserver {
  onGateEvaluated(event: { gateId: string; passed: boolean; attempt: number; detail: string }): void;
  onNodeStarted(event: { nodeId: string; type: string }): void;
  onNodeCompleted(event: { nodeId: string; cost: { tokens: number; usd: number; duration_ms: number } }): void;
  onRetryAttempt(event: { name: string; attempt: number; maxRetries: number; feedback: string }): void;
}
```

*Designed now (review F-A-6) so Waves 1-3 carry the fields the visual app needs. Injected optionally via retry/executor config.*

Gate: G-PORT — visual app imports this interface, never reads runtime internals.
Status: **frozen**.

### Canonical Entities

| Entity | Location | Change |
|--------|----------|--------|
| `Gate<S>` | `methodts/gate/gate.ts` | Stays — typed methodology gates |
| `DagGateConfig` | `methodts/strategy/dag-types.ts` | Stays — strategy expression gates |
| `GateCheckResult` | `methodts/semantic` → `methodts/gate` | Renamed to align, moved to gate module |
| `FileArtifact` | `methodts/semantic` | Stays in semantic (review F-S-003 — gates don't own file artifacts) |
| `Truth` | `methodts/semantic` | Stays — `GateCheckResult` converts via adapter |

### Shared Utility (not a port)

`executeWithRetry()` — extracted as a module-level function in `gate/gate.ts` (review F-S-002, F-A-2). Not injectable — every call site uses the same implementation. Accepts optional `RuntimeObserver` for event emission (review F-A-5).

```typescript
/** Gate-check-retry loop. Utility function, not a port. */
export function executeWithRetry<I, O>(config: {
  name: string;
  execute: (input: I, attempt: number) => Effect.Effect<O, unknown, AgentProvider>;
  gates: readonly GateCheck[];
  buildFeedback: (result: O, failures: readonly GateResult[]) => string;
  maxRetries: number;
  input: I;
  observer?: RuntimeObserver;
}): Effect.Effect<RetryResult<O>, RetryError, AgentProvider>;
```

## Per-Domain Architecture

### methodts/gate (EXTEND existing — L2)

The gate module already exists (`src/gate/gate.ts`). Changes:
- Add `executeWithRetry()` utility function
- Move SPL's algorithmic checks (`checkNoAny`, `checkNoTodos`, `checkPortSubstance`) here
- Add `RuntimeObserver` interface
- Export `DagGateEvaluator` port interface (implementation stays in strategy)

No new files — extend `gate.ts` and add `algorithmic-checks.ts`.

### methodts/semantic (MODIFY — L2)

- Remove `algorithms/gate-runner.ts` → import algorithmic checks from `gate/`
- Export `SemanticNodeExecutor` implementation
- `runAtomic` uses `executeWithRetry()` instead of inline retry loop

### methodts/runtime (MODIFY — L2)

- `run-step.ts` agent retry uses `executeWithRetry()`
- Step postconditions stay as typed `Gate<S>` — no change to the methodology model

### methodts/strategy (MODIFY — L2)

- `dag-gates.ts` refactored: `evaluateGate()` extracted behind `DagGateEvaluator` port
- `dag-executor.ts` uses `executeWithRetry()` for gate-check-retry
- New node type: `semantic` (dispatches via `SemanticNodeExecutor`)

### methodts/provider (MODIFY — L2)

- `AgentProvider` extended with `executeStructured<T>` (Effect-based only)
- `ClaudeHeadlessProvider`: `claude --print --output-format json`
- `BridgeProvider`: Anthropic API tool_use

### bridge/strategies (MODIFY — L4)

- `strategy-executor.ts` handles `semantic` node type
- Wires `SemanticNodeExecutor` from methodts
- Emits bridge `BridgeEvent` for gate/node lifecycle via `RuntimeObserver` adapter

## Phase Plan

### Wave 0 — Surfaces (types + interfaces only)

- Add `DagGateEvaluator` port interface to `gate/`
- Add `RuntimeObserver` interface to `gate/`
- Add `SemanticNodeExecutor` port interface to `semantic/`
- Add `StructuredAgentProvider` interface extension to `provider/`
- Move `checkNoAny`, `checkNoTodos`, `checkPortSubstance` to `gate/algorithmic-checks.ts`
- Architecture gate assertions for all new surfaces
- **No business logic. No behavioral changes.**

### Wave 1 — Gate Unification (SPL path)

- Implement `executeWithRetry()` in `gate/gate.ts`
- Update SPL `run.ts` to use `executeWithRetry()` for atomic retry
- SPL `implement.ts` imports algorithmic checks from `gate/`
- Delete `semantic/algorithms/gate-runner.ts` (moved to gate/)
- **Gate:** All semantic tests pass, `npm test` green

### Wave 2a — Gate Unification (Strategy path)

- Extract `evaluateGate()` behind `DagGateEvaluator` port in `dag-gates.ts`
- Strategy `dag-executor.ts` uses `executeWithRetry()` for gate retry
- Wire `RuntimeObserver` → bridge `BridgeEvent` adapter for gate lifecycle events
- **Gate:** All strategy tests pass

### Wave 2b — Gate Unification (Methodology path)

- Methodology `run-step.ts` uses `executeWithRetry()` for agent step retry
- **Gate:** All methodology tests pass

### Wave 2c — Semantic Node Type

- Add `semantic` node type to `dag-types.ts` and `dag-parser.ts`
- Implement `SemanticNodeExecutor` in `semantic/`
- Strategy executor dispatches to `SemanticNodeExecutor` for `type: "semantic"` nodes
- Write example strategy YAML using semantic nodes
- **Gate:** New tests pass, smoke test with semantic node

### Wave 3 — Structured Output

- Implement `executeStructured<T>` in `ClaudeHeadlessProvider`
- Update SPL parsers to optionally use structured output when available
- Re-run recursive design experiment — test P(parse) = 1.0 hypothesis
- **Gate:** Provider tests pass, experiment shows parse improvement

## Risks

| Risk | Mitigation |
|------|------------|
| Wave 2a-c touching three execution paths | Split into independent sub-waves, each with own test gate |
| `executeWithRetry()` behavior differences across callers | Each caller provides its own `buildFeedback` and `gates` — loop mechanics are identical |
| Structured output model support varies | Optional — falls back to free-text + parser |
| Pacta vs Effect AgentProvider divergence | Explicitly out of scope — noted as future work |
| Expression gate security (existing `new Function` sandbox) | Strategy keeps existing trust model; unified `GateCheck` type does not include expression variant (review F-A-3) |

## Review History

| Date | Reviewer | Findings | Resolution |
|------|----------|----------|------------|
| 2026-04-03 | fcd-review (Surface + Architecture advisors) | 2 critical, 5 high, 4 medium | All critical/high resolved: GateEvaluator split into typed/DAG, RetryLoop demoted to utility, FileArtifact stays in semantic, SemanticNodeExecutor.gates removed, RuntimeObserver added to Wave 0, Wave 2 split into 2a/2b/2c |
