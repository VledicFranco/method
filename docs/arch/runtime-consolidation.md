# Architecture: Runtime Consolidation (PRD 046)

Three overlapping gate-check-retry implementations (semantic SPL, strategy DAG, methodology runtime) consolidated into one.

## Unified Gate-Check-Retry: `executeWithRetry()`

**Location:** `packages/methodts/src/gate/gate.ts`

A single generic utility replaces three inline retry loops:

```
executeWithRetry<I, O, E, R>({
  name, execute, check, buildFeedback, maxRetries, input, observer?
}) → Effect<{ data, attempts, confidence }, RetryExhausted | E, R>
```

**Behavior:** execute → check → pass (return with confidence) or fail (build feedback, notify observer, retry). Confidence degrades: `max(0.5, 0.90 - attempt * 0.10)`. Exhaustion produces `RetryExhausted` error with `lastOutput` for soft-failure recovery.

**Consumers:**
- `semantic/run.ts` — `runAtomic()` wraps provider call + parse + postcondition check
- `strategy/dag-executor.ts` — `executeNode()` wraps node execution + gate evaluation
- `runtime/run-step.ts` — `runStep()` wraps agent step + axiom/postcondition check

Each consumer provides its own `execute`, `check`, and `buildFeedback` callbacks — the retry mechanics are identical.

## RuntimeObserver

**Location:** `packages/methodts/src/gate/runtime-observer.ts`

Lightweight fire-and-forget observation hook:

```
onGateEvaluated({ gateId, passed, attempt, detail })
onNodeStarted({ nodeId, type })
onNodeCompleted({ nodeId, cost: { tokens, usd, duration_ms } })
onRetryAttempt({ name, attempt, maxRetries, feedback })
```

Injected optionally via `executeWithRetry()` config. Consumers: bridge visual app (WebSocket subscription), strategy executor (BridgeEvent adapter). The `nullObserver` no-op is used when no observer is provided.

## DagGateEvaluator Port

**Location:** `packages/methodts/src/gate/dag-gate-evaluator.ts` (interface)
**Implementation:** `packages/methodts/src/strategy/dag-gates.ts`

Extracts strategy-specific gate evaluation behind a port. Intentionally separate from `Gate<S>` (typed state parameter) — strategy gates operate on stringly-typed context bags (`DagGateConfig`, `DagGateContext`). Merging would erase the type parameter.

## StructuredAgentProvider

**Location:** `packages/methodts/src/provider/structured-provider.ts`

Extension of AgentProvider that returns typed JSON directly:

```
executeStructured<T>(commission: StructuredCommission) → Effect<StructuredResult<T>, AgentError>
```

`createStructuredProvider(provider)` wraps any AgentProvider by injecting a JSON schema constraint into the prompt and parsing the response. `StructuredClaudeHeadlessProvider` wires this into the CLI backend.

`runAtomic()` in `semantic/run.ts` accepts an optional `structuredProvider` + `schema` in `RunSemanticConfig` to bypass text parsing entirely.

## Layer Compliance

All new surfaces live in L2 (`@method/methodts`). No transport dependencies. The bridge (L4) consumes via port injection at the composition root (`server-entry.ts`). Dependency flows downward only:

```
L4  bridge → wires ports at composition root
L3  mcp → thin tool wrappers
L2  methodts/gate ← executeWithRetry, RuntimeObserver, DagGateEvaluator
    methodts/semantic ← SemanticNodeExecutor, runAtomic structured path
    methodts/strategy ← DagGateEvaluator impl, semantic node dispatch
    methodts/runtime ← executeWithRetry integration
    methodts/provider ← StructuredAgentProvider
```
