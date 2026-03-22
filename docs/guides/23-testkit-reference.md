# Guide 23 — Testkit Reference

Complete API reference for `@method/testkit`.

## Builders

Fluent constructors that eliminate boilerplate when defining typed MethodTS values in tests.

### `domainBuilder<S>(id: string): DomainBuilder<S>`

Build a `DomainTheory<S>` incrementally.

```typescript
const domain = domainBuilder<MyState>("D_MY")
  .sort("Item", "unbounded", "A work item")
  .sort("Status", "finite")
  .predicate("has_items", s => s.items.length > 0)
  .predicateFrom("is_ready", existingPredicate)     // from existing Predicate<S>
  .functionSymbol("count", ["Item"], "number")
  .axiom("non_empty", s => s.items.length > 0)
  .axiomFrom("coverage", existingAxiomPredicate)     // from existing Predicate<S>
  .build();
```

**Methods:**

| Method | Description |
|--------|-------------|
| `.sort(name, cardinality, description?)` | Add a sort declaration |
| `.predicate(name, fn)` | Add a named predicate from a function |
| `.predicateFrom(name, pred)` | Add a named predicate from an existing `Predicate<S>` |
| `.functionSymbol(name, inputSorts, outputSort, totality?)` | Add a function symbol |
| `.axiom(name, fn)` | Add an axiom from a function |
| `.axiomFrom(name, pred)` | Add an axiom from an existing `Predicate<S>` |
| `.build()` | Return the `DomainTheory<S>` |

### `scriptStep<S>(id, options): Step<S>`

Build a script step (pure state transform, no LLM).

```typescript
const step = scriptStep<MyState>("pick_item", {
  role: "worker",                              // default: "default"
  pre: and(hasItems, noCurrent),               // default: TRUE
  post: hasCurrent,                            // default: TRUE
  execute: s => ({ ...s, current: s.items[0] }),
  tools: ["pick_tool"],                        // optional
});
```

### `scriptStepEffect<S>(id, options): Step<S>`

Build a script Step whose execution can fail in the Effect sense. Unlike `scriptStep` (which wraps a pure function in `Effect.succeed`), this accepts an execute function that returns an `Effect` directly.

```typescript
import { Effect } from "effect";

const step = scriptStepEffect<MyState>("validate", {
  role: "validator",
  pre: hasData,
  post: isValid,
  execute: s => s.data.length > 0
    ? Effect.succeed({ ...s, valid: true })
    : Effect.fail({ _tag: "StepError", message: "No data to validate" }),
});
```

### `agentStep<S>(id, options): Step<S>`

Build an agent step (LLM-backed execution). Requires `Prompt` which is re-exported from `@method/testkit`.

```typescript
import { Prompt, agentStep } from "@method/testkit";

const step = agentStep<MyState>("analyze", {
  role: "analyst",
  pre: hasData,
  post: hasAnalysis,
  prompt: new Prompt(ctx => `Analyze: ${JSON.stringify(ctx.state)}`),
  parse: (raw, current) => ({ ...current, analysis: raw }),
});
```

### `methodBuilder<S>(id: string): MethodBuilder<S>`

Build a `Method<S>` incrementally.

```typescript
const method = methodBuilder<MyState>("M_TRIAGE")
  .name("Triage Incident")
  .domain(domain)
  .role("oncall", s => s, ["triage_step"])     // id, observe, authorized
  .steps([triageStep, escalateStep])           // builds linear DAG
  .edge("triage", "escalate")                  // explicit edge (optional)
  .objective(isTriaged)
  .measure("progress", "Triage Progress", s => s.triaged ? 1 : 0, [0, 1], 1)
  .build();
```

Steps are arranged in a **linear DAG** by default (sequential execution in array order). Use `.edge()` to override with explicit edges for branching/parallel DAGs.

### `methodologyBuilder<S>(id: string): MethodologyBuilder<S>`

Build a `Methodology<S>` incrementally.

```typescript
const methodology = methodologyBuilder<MyState>("PHI_INCIDENT")
  .name("Incident Response")
  .domain(domain)
  .arm(1, "triage", isDetected, triageMethod)
  .arm(2, "resolve", isTriaged, resolveMethod)
  .arm(3, "terminate", isResolved, null)        // null = termination arm
  .objective(isResolved)
  .terminationMeasure(s => stagesRemaining(s), "Stages decrease each cycle.")
  .safety({ maxLoops: 10, maxTokens: 500_000 }) // partial override of defaults
  .build();
```

**Default safety bounds:** `maxLoops: 20`, `maxTokens: 1_000_000`, `maxCostUsd: 50`, `maxDurationMs: 120_000`, `maxDepth: 5`.

### `worldState<S>(value: S): WorldState<S>`

Create a `WorldState<S>` from a plain value. Axiom status defaults to valid.

```typescript
const ws = worldState({ count: 0, target: 5, done: false });
```

### `worldStateWithViolations<S>(value, violations): WorldState<S>`

Create a `WorldState<S>` with axiom violations for testing error paths.

```typescript
const ws = worldStateWithViolations(state, ["axiom_1", "axiom_2"]);
```

---

## Assertions

Every assertion throws with diagnostic traces on failure — not bare "expected true got false".

### Predicate Assertions

| Function | Description |
|----------|-------------|
| `assertHolds(pred, value, msg?)` | Assert predicate evaluates to true. Shows `EvalTrace` on failure. |
| `assertRejects(pred, value, msg?)` | Assert predicate evaluates to false. Shows `EvalTrace` on failure. |
| `assertEquivalent(predA, predB, values, msg?)` | Assert two predicates agree on all test values. |

### Domain Assertions

| Function | Description |
|----------|-------------|
| `assertSignatureValid(domain)` | Assert domain signature is well-formed. |
| `assertAxiomsSatisfied(domain, states)` | Assert at least one state satisfies all axioms. |
| `assertAxiomsHold(domain, state)` | Assert all axioms hold for a specific state. |
| `assertAxiomsViolated(domain, state, names)` | Assert specific axioms are violated. |

### Method Assertions

| Function | Description |
|----------|-------------|
| `assertCompiles(method, states)` | Run G1–G6 compilation gates. Returns report. Throws with per-gate detail on failure. |
| `assertDAGAcyclic(method)` | Assert step DAG has no cycles. |
| `assertDAGComposable(method, states)` | Assert all DAG edges are composable (post ⊆ pre). |
| `assertRolesCovered(method)` | Assert all step roles have definitions. |

### Methodology Assertions

| Function | Description |
|----------|-------------|
| `assertCoherent(methodology, states)` | Check all 5 coherence properties. Returns result. Throws with per-check detail. |
| `assertRoutesTo(methodology, state, label)` | Assert δ_Φ routes to named arm. Pass `null` for termination. |
| `assertTerminates(methodology, trajectory)` | Assert termination measure changes monotonically, has strict progress, last state terminates, and objective met. |
| `assertRoutingTotal(methodology, states)` | Assert every state fires at least one arm. |

### Retraction Assertions

| Function | Description |
|----------|-------------|
| `assertRetracts(retraction, states, compare?)` | Assert `project(embed(s)) = s` for all states. |

---

## Runners

Execution harnesses that hide Effect ceremony.

### `runStepIsolated<S>(step, stateValue, options?): Promise<StepHarnessResult<S>>`

Run a single step. Returns a discriminated union on `status`:

```typescript
const result = await runStepIsolated(triageStep, STATES.detected);

switch (result.status) {
  case "precondition_failed":
    result.preconditionTrace  // EvalTrace — why precondition failed
    break;
  case "completed":
    result.postconditionMet   // boolean
    result.postconditionTrace // EvalTrace
    result.state              // S — the transformed state (not nullable)
    break;
  case "error":
    result.error              // string — execution error message
    break;
}
result.recordings             // Recording[] — always available
result.preconditionTrace      // EvalTrace — always available
```

**Options:** `{ agentResponses?: AgentResult[] }` — for agent steps.

Effect defects (bugs in step code) propagate as thrown exceptions to the test runner rather than being captured in the result.

### `runMethodIsolated<S>(method, initialState, options?): Promise<MethodResult<S>>`

Run a method's step DAG. Returns the standard `MethodResult<S>`.

```typescript
const result = await runMethodIsolated(method, worldState(initial));
result.status       // "completed" | "step_failed" | "objective_not_met"
result.objectiveMet // boolean
result.finalState   // WorldState<S>
result.stepResults  // StepResult<S>[]
```

### `runMethodologyIsolated<S>(methodology, initialState, options?): Promise<MethodologyResult<S>>`

Run the full coalgebraic loop. Returns the standard `MethodologyResult<S>`.

```typescript
const result = await runMethodologyIsolated(methodology, worldState(initial));
result.status                    // "completed" | "safety_violation" | "failed"
result.accumulator.loopCount     // number of δ_Φ iterations
result.accumulator.completedMethods  // CompletedMethodRecord[]
result.finalState.value          // the terminal state
```

**Options:**

```typescript
{
  agentResponses?: AgentResult[];          // consumed in order
  provider?: RecordingProviderResult;      // full control + recording
}
```

### `scenario<S>(methodology): ScenarioRunner<S>`

Declarative routing trajectory verification.

```typescript
scenario(methodology)
  .given(state0)             // set initial state
  .expectsRoute("triage")   // assert δ_Φ routes here
  .then(state1)              // advance to next state
  .expectsRoute("resolve")
  .then(state2)
  .expectsTermination()      // assert δ_Φ selects null
  .run();                    // execute all assertions
```

On failure, reports the exact step that diverged with arm traces:

```
ScenarioError: Scenario step 3: Expected route "resolve", got "triage"
Arm traces:
  [triage] condition=true fired=true
  [resolve] condition=false fired=false
  [terminate] condition=false fired=false
```

---

## Providers

Test doubles for `AgentProvider`.

### `RecordingProvider(config): { layer, recordings }`

Wraps `MockAgentProvider` with recording. Same match-based config.

```typescript
const { layer, recordings } = RecordingProvider({
  responses: [
    { match: c => c.prompt.includes("triage"), result: { raw: "done", cost: { tokens: 100, usd: 0.01, duration_ms: 500 } } },
  ],
  fallback: { raw: "{}", cost: { tokens: 0, usd: 0, duration_ms: 0 } },
  failOn: [
    { match: c => c.prompt.includes("crash"), error: { _tag: "AgentCrash", message: "boom" } },
  ],
});

// Use with harness
const result = await runMethodologyIsolated(methodology, state, { provider: { layer, recordings } });

// Inspect recordings
recordings[0].commission.prompt  // what was sent
recordings[0].result?.raw        // what was returned
recordings[0].error              // AgentError if failOn matched
```

### `SequenceProvider(responses, fallback?): { layer, recordings }`

Sequential responses without match functions. Simpler when order is all you need.

```typescript
const { layer, recordings } = SequenceProvider([
  { raw: "first", cost: { tokens: 10, usd: 0.001, duration_ms: 100 } },
  { raw: "second", cost: { tokens: 20, usd: 0.002, duration_ms: 200 } },
]);
// Call 1 → "first", Call 2 → "second", Call 3+ → fallback or AgentSpawnFailed
```

### `silentProvider(): Layer<AgentProvider>`

Fail-fast provider for script-only execution. If an agent step accidentally invokes it, fails with a clear `AgentSpawnFailed` error explaining that no responses were configured. Script steps never hit the provider, so this is transparent for script-only methodologies. Used internally by harnesses when no agent config is provided.

---

## Diagnostics

Formatting utilities for failure output.

### `formatTrace(trace, indent?, isLast?): string`

Pretty-print an `EvalTrace` as a tree.

```
AND ── false
├─ has_open ── true
└─ no_current ── false
```

### `formatTraceWithFailures(trace): string`

Same as `formatTrace` but marks failing leaf nodes with `← FAILED`.

### `formatCompilationReport(report): string`

Format a `CompilationReport` with per-gate status.

### `formatCoherenceResult(result, methodologyId?): string`

Format a `CoherenceResult` with per-check status.
