---
guide: 25
title: "Testkit: Diagnostics"
domain: testkit
audience: [method-designers]
summary: >-
  Compilation diagnostics, trace evaluation, simulation, and custom output formatting.
prereqs: [22, 23]
touches:
  - packages/testkit/src/
  - packages/methodts/src/
---

# Guide 25 — Testkit: Diagnostics and Custom Output

The testkit provides formatting utilities for predicate traces, compilation reports, and coherence results. These are used internally by assertions (they power the detailed failure messages) but are also available for custom test output and debugging.

## Predicate Trace Formatting

When a predicate fails, you often need to know *which sub-predicate* caused the failure. The `EvalTrace` type captures the full evaluation tree, and the formatting functions render it as a readable tree.

### `formatTrace(trace)`

Renders an `EvalTrace` as an indented tree:

```typescript
import { evaluateWithTrace, and, check, formatTrace } from "@methodts/testkit";

type S = { items: string[]; current: string | null };
const pred = and(
  check<S>("has_items", s => s.items.length > 0),
  check<S>("no_current", s => s.current === null),
);

const trace = evaluateWithTrace(pred, { items: ["a"], current: "a" });
console.log(formatTrace(trace));
```

Output:
```
AND ── false
├─ has_items ── true
└─ no_current ── false
```

### `formatTraceWithFailures(trace)`

Same tree but marks failing leaf nodes with `← FAILED`:

```typescript
import { formatTraceWithFailures } from "@methodts/testkit";

console.log(formatTraceWithFailures(trace));
```

Output:
```
AND ── false
├─ has_items ── true
└─ no_current ── false ← FAILED
```

### Using traces in custom assertions

If you need custom predicate checks beyond `assertHolds`/`assertRejects`, use `evaluateWithTrace` directly:

```typescript
import { evaluate, evaluateWithTrace, formatTraceWithFailures } from "@methodts/testkit";

function assertMyCustomCondition<S>(pred: Predicate<S>, state: S) {
  if (!evaluate(pred, state)) {
    const trace = evaluateWithTrace(pred, state);
    console.error("Custom condition failed:");
    console.error(formatTraceWithFailures(trace));
    throw new Error("Custom assertion failed");
  }
}
```

## Compilation Report Formatting

### `formatCompilationReport(report)`

Formats a `CompilationReport` from `compileMethod()` with per-gate status:

```typescript
import { compileMethod, formatCompilationReport } from "@methodts/testkit";

const report = compileMethod(method, testStates);
if (report.overall === "failed") {
  console.log(formatCompilationReport(report));
}
```

Output:
```
Compilation report for M_BROKEN: FAILED

  [PASS] G1-domain: PASS — Signature and axioms valid
  [PASS] G2-objective: PASS — Objective is a typed Predicate<S>
  [FAIL] G3-roles: FAIL — Uncovered roles: reviewer
  [PASS] G4-dag: PASS — All edges composable
  [PASS] G5-guidance: PASS — No agent steps
  [PASS] G6-serializable: PASS — Method structure serializable
```

The `assertCompiles` assertion uses this internally — you only need `formatCompilationReport` if you're doing custom compilation logic or want to log reports for passing methods.

## Coherence Result Formatting

### `formatCoherenceResult(result, methodologyId?)`

Formats a `CoherenceResult` from `checkCoherence()` with per-check status:

```typescript
import { checkCoherence, formatCoherenceResult } from "@methodts/testkit";

const result = checkCoherence(methodology, testStates);
console.log(formatCoherenceResult(result, methodology.id));
```

Output:
```
Coherence check for PHI_TASKS: COHERENT

  [PASS] no_dead_arms: All arms fire for at least one test state
  [PASS] terminate_arm_exists: Terminate arm found
  [PASS] terminate_reachable: Terminate arm fires for at least one test state
  [PASS] unique_priorities: All arm priorities are unique
  [PASS] domain_satisfiable: Domain axioms satisfiable by test states
```

## Transition Function Debugging

For debugging routing issues, use `evaluateTransition` directly and inspect the arm traces:

```typescript
import { evaluateTransition } from "@methodts/testkit";

const result = evaluateTransition(methodology, state);

// Which arm fired?
console.log("Fired:", result.firedArm?.label ?? "none");
console.log("Selected:", result.selectedMethod?.id ?? "terminate");

// Why did each arm fire or not?
for (const trace of result.armTraces) {
  console.log(`  [${trace.label}] fired=${trace.fired} condition=${trace.trace.result}`);
}
```

## Simulation Dry Runs

For testing routing trajectories without executing steps, use `simulateRun`:

```typescript
import { simulateRun } from "@methodts/testkit";

const sim = simulateRun(methodology, [state0, state1, state2, state3]);

console.log("Method sequence:", sim.methodSequence);
console.log("Terminates at index:", sim.terminatesAt);

// Per-state routing detail
for (const [i, sel] of sim.selections.entries()) {
  console.log(`State ${i}: → ${sel.selectedMethod?.id ?? "TERMINATE"}`);
}
```

## Combining Diagnostics in Test Output

A pattern for rich test failure diagnostics:

```typescript
import {
  assertCompiles, assertCoherent, assertRoutesTo,
  compileMethod, checkCoherence, formatCompilationReport, formatCoherenceResult,
} from "@methodts/testkit";

describe("methodology validation", () => {
  it("compiles and is coherent (with diagnostic dump)", () => {
    // These throw with diagnostics on failure
    assertCompiles(method, testStates);
    assertCoherent(methodology, testStates);
  });

  it("dump full diagnostics for debugging", () => {
    // Manual diagnostics when you want to see everything regardless of pass/fail
    const report = compileMethod(method, testStates);
    console.log(formatCompilationReport(report));

    const coherence = checkCoherence(methodology, testStates);
    console.log(formatCoherenceResult(coherence, methodology.id));
  });
});
```
