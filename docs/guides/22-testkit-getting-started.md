# Guide 22 — Testkit: Getting Started

The `@method/testkit` package provides builders, assertions, harnesses, and test doubles for testing MethodTS methodologies, methods, steps, predicates, and domain theories. It eliminates the boilerplate of constructing typed values, running Effect-based execution, and interpreting failures.

## Installation

The testkit is part of the monorepo workspace. No separate install needed:

```typescript
import {
  // Builders
  domainBuilder, scriptStep, methodBuilder, methodologyBuilder, worldState,
  // Assertions
  assertHolds, assertRoutesTo, assertCompiles, assertCoherent,
  // Runners
  runMethodologyIsolated, scenario,
  // Re-exported from @method/methodts (no dual imports needed)
  check, and, not,
} from "@method/testkit";
```

## Quick Start: Testing a Methodology

Here's a minimal example — a counter methodology that increments to a target, then finalizes.

### 1. Define your domain and predicates

```typescript
import {
  check, and,
  domainBuilder, scriptStep, methodBuilder, methodologyBuilder,
} from "@method/testkit";

type CounterState = {
  count: number;
  target: number;
  done: boolean;
};

const notDone = check<CounterState>("not_done", s => !s.done);
const isDone = check<CounterState>("is_done", s => s.done);
const belowTarget = check<CounterState>("below_target", s => s.count < s.target);
const atTarget = check<CounterState>("at_target", s => s.count >= s.target);

const domain = domainBuilder<CounterState>("D_COUNTER")
  .sort("Counter", "singleton")
  .predicate("not_done", s => !s.done)
  .predicate("is_done", s => s.done)
  .axiom("non_negative", s => s.count >= 0)
  .build();
```

### 2. Build steps and methods

```typescript
const incrementStep = scriptStep<CounterState>("increment", {
  role: "counter",
  pre: and(notDone, belowTarget),
  post: notDone,
  execute: s => ({ ...s, count: s.count + 1 }),
});

const finalizeStep = scriptStep<CounterState>("finalize", {
  role: "counter",
  pre: atTarget,
  post: isDone,
  execute: s => ({ ...s, done: true }),
});

const incrementMethod = methodBuilder<CounterState>("M_INCREMENT")
  .domain(domain)
  .role("counter", s => s)
  .steps([incrementStep])
  .objective(notDone)
  .build();

const finalizeMethod = methodBuilder<CounterState>("M_FINALIZE")
  .domain(domain)
  .role("counter", s => s)
  .steps([finalizeStep])
  .objective(isDone)
  .build();
```

### 3. Build the methodology

```typescript
const methodology = methodologyBuilder<CounterState>("PHI_COUNTER")
  .domain(domain)
  .arm(1, "increment", and(notDone, belowTarget), incrementMethod)
  .arm(2, "finalize", and(notDone, atTarget), finalizeMethod)
  .arm(3, "terminate", isDone, null)
  .objective(isDone)
  .terminationMeasure(
    s => s.done ? 0 : s.target - s.count + 1,
    "Distance to target decreases each cycle.",
  )
  .build();
```

### 4. Write tests

```typescript
import { describe, it, expect } from "vitest";
import {
  assertHolds, assertRejects, assertRoutesTo, assertCoherent,
  assertCompiles, assertTerminates, scenario, runMethodologyIsolated,
  worldState,
} from "@method/testkit";

describe("Counter methodology", () => {
  const STATES = {
    start:    { count: 0, target: 3, done: false },
    mid:      { count: 2, target: 3, done: false },
    atTarget: { count: 3, target: 3, done: false },
    done:     { count: 3, target: 3, done: true },
  };

  // Predicate tests
  it("belowTarget holds at start", () => {
    assertHolds(belowTarget, STATES.start);
    assertRejects(belowTarget, STATES.atTarget);
  });

  // Compilation
  it("methods compile", () => {
    assertCompiles(incrementMethod, Object.values(STATES));
    assertCompiles(finalizeMethod, Object.values(STATES));
  });

  // Coherence
  it("methodology is coherent", () => {
    assertCoherent(methodology, Object.values(STATES));
  });

  // Routing
  it("routes correctly", () => {
    assertRoutesTo(methodology, STATES.start, "increment");
    assertRoutesTo(methodology, STATES.atTarget, "finalize");
    assertRoutesTo(methodology, STATES.done, null);  // terminates
  });

  // Scenario — full trajectory
  it("follows expected routing sequence", () => {
    scenario(methodology)
      .given(STATES.start)
      .expectsRoute("increment")
      .then(STATES.mid)
      .expectsRoute("increment")
      .then(STATES.atTarget)
      .expectsRoute("finalize")
      .then(STATES.done)
      .expectsTermination()
      .run();
  });

  // Full execution
  it("runs to completion", async () => {
    const result = await runMethodologyIsolated(
      methodology,
      worldState(STATES.start),
    );

    expect(result.status).toBe("completed");
    expect(result.finalState.value.done).toBe(true);
    expect(result.accumulator.loopCount).toBe(4);
  });
});
```

## Testing Layers

The testkit follows the same layered architecture as MethodTS. Test from the bottom up:

| Layer | What to test | Testkit tools |
|-------|-------------|---------------|
| **Predicates** | Classification accuracy | `assertHolds`, `assertRejects`, `assertEquivalent` |
| **Domain theory** | Signature validity, axiom satisfaction | `assertSignatureValid`, `assertAxiomsSatisfied`, `assertAxiomsHold` |
| **Steps** | State transforms, pre/postconditions | `runStepIsolated` |
| **Methods** | Compilation (G1–G6), DAG validity | `assertCompiles`, `assertDAGAcyclic`, `assertRolesCovered` |
| **Methodology** | Routing, coherence, termination | `assertRoutesTo`, `assertCoherent`, `assertTerminates` |
| **Execution** | End-to-end methodology run | `runMethodologyIsolated`, `scenario` |

## Agent Steps

For steps that use LLM agents instead of scripts, provide mock responses:

```typescript
import { runStepIsolated, SequenceProvider, runMethodologyIsolated } from "@method/testkit";

// Step-level: provide agent responses
const result = await runStepIsolated(agentStep, stateValue, {
  agentResponses: [
    { raw: '{"severity":"sev1"}', cost: { tokens: 100, usd: 0.001, duration_ms: 500 } },
  ],
});

// Methodology-level: provide a sequence of responses
const { layer, recordings } = SequenceProvider([
  { raw: '{"action":"triage"}', cost: { tokens: 100, usd: 0.001, duration_ms: 500 } },
  { raw: '{"action":"resolve"}', cost: { tokens: 80, usd: 0.001, duration_ms: 400 } },
]);

const result = await runMethodologyIsolated(methodology, worldState(initial), {
  provider: { layer, recordings },
});

// Inspect what the agent was asked
expect(recordings[0].commission.prompt).toContain("triage");
```

## Diagnostic Output

All assertions include diagnostic traces on failure. For example, `assertHolds` prints the full `EvalTrace` tree:

```
AssertionError: Predicate "AND" rejected state

Trace:
AND ── false
├─ has_open ── true
└─ no_current ── false ← FAILED
```

And `assertCompiles` prints the per-gate compilation report:

```
Compilation failed for M_BROKEN:

Compilation report for M_BROKEN: FAILED

  [PASS] G1-domain: Signature and axioms valid
  [PASS] G2-objective: Objective is a typed Predicate<S>
  [FAIL] G3-roles: Uncovered roles: reviewer
  [PASS] G4-dag: All edges composable
  [PASS] G5-guidance: No agent steps
  [PASS] G6-serializable: Method structure serializable
```

## Next Steps

- **[Guide 23 — Testkit Reference](./23-testkit-reference.md)** — Full API reference for all builders, assertions, harnesses, providers, and diagnostics.
