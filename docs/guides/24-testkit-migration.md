---
guide: 24
title: "Testkit: Migration"
domain: testkit
audience: [contributors]
summary: >-
  Migrating existing manual test patterns to the testkit framework.
prereqs: [22, 23]
touches:
  - packages/testkit/src/
---

# Guide 24 — Testkit: Migrating from Manual Test Patterns

If you have existing methodology tests written against `@methodts/methodts` directly (like the e2e tests in `packages/methodts/src/__tests__/`), this guide shows how to incrementally adopt `@methodts/testkit`.

## Before: Manual Pattern

The existing e2e tests construct everything from scratch:

```typescript
// 40+ lines of domain, role, step, method, methodology construction
import { Effect } from "effect";
import { check, and, not } from "../predicate/predicate.js";
import type { DomainTheory } from "../domain/domain-theory.js";
import type { Role } from "../domain/role.js";
import type { Step } from "../method/step.js";
import type { Method } from "../method/method.js";
import type { Methodology } from "../methodology/methodology.js";
import { evaluateTransition } from "../methodology/transition.js";
import { runMethodology } from "../runtime/run-methodology.js";
import { MockAgentProvider } from "@methodts/methodts";
import type { WorldState } from "../state/world-state.js";

type TaskState = { ... };

const hasOpen = check<TaskState>("has_open", s => ...);
// ... more predicates ...

const D_TASKS: DomainTheory<TaskState> = {
  id: "D_TASKS",
  signature: {
    sorts: [
      { name: "Task", description: "A work item", cardinality: "unbounded" },
    ],
    functionSymbols: [],
    predicates: { has_open: hasOpen, ... },
  },
  axioms: {},
};

const workerRole: Role<TaskState> = {
  id: "worker",
  description: "Worker",
  observe: s => s,
  authorized: ["pick_step"],
  notAuthorized: [],
};

const pickStep: Step<TaskState> = {
  id: "pick_step",
  name: "Pick",
  role: "worker",
  precondition: and(hasOpen, noCurrent),
  postcondition: hasCurrent,
  execution: {
    tag: "script",
    execute: s => Effect.succeed({ ...s, currentTask: ... }),
  },
};

// ... method, methodology construction (another 30 lines) ...

const mockLayer = MockAgentProvider({
  responses: [],
  fallback: { raw: "{}", cost: { tokens: 0, usd: 0, duration_ms: 0 } },
});

// Test
const effect = runMethodology(taskMethodology, initialState).pipe(
  Effect.provide(mockLayer),
);
const result = await Effect.runPromise(effect);
expect(result.status).toBe("completed");
```

**Pain points:**
- ~80 lines of boilerplate before the first assertion
- Must import from 8+ internal modules
- `Effect.provide(mockLayer)` + `Effect.runPromise()` in every test
- Manual `evaluateTransition` calls for routing checks
- No diagnostic output on assertion failure

## After: Testkit Pattern

```typescript
import { describe, it, expect } from "vitest";
import {
  // Everything from one import
  check, and, not,
  domainBuilder, scriptStep, methodBuilder, methodologyBuilder,
  worldState, assertHolds, assertRejects, assertRoutesTo,
  assertCoherent, assertCompiles, assertTerminates,
  runMethodologyIsolated, scenario,
} from "@methodts/testkit";

type TaskState = { ... };

const hasOpen = check<TaskState>("has_open", s => ...);

// Domain: ~5 lines instead of ~15
const domain = domainBuilder<TaskState>("D_TASKS")
  .sort("Task", "unbounded")
  .predicate("has_open", s => s.tasks.some(t => t.status === "open"))
  .build();

// Step: ~5 lines instead of ~15
const pickStep = scriptStep<TaskState>("pick_step", {
  role: "worker",
  pre: and(hasOpen, noCurrent),
  post: hasCurrent,
  execute: s => ({ ...s, currentTask: s.tasks.find(t => t.status === "open")!.id }),
});

// Method: ~5 lines instead of ~12
const pickMethod = methodBuilder<TaskState>("M_PICK")
  .domain(domain)
  .role("worker", s => s)
  .steps([pickStep])
  .objective(hasCurrent)
  .build();

// Methodology: ~8 lines instead of ~20
const methodology = methodologyBuilder<TaskState>("PHI_TASKS")
  .domain(domain)
  .arm(1, "pick", and(hasOpen, noCurrent), pickMethod)
  .arm(2, "terminate", allDone, null)
  .objective(allDone)
  .terminationMeasure(s => s.tasks.filter(t => t.status !== "done").length, "Tasks decrease.")
  .build();

// Tests — zero Effect ceremony
it("routes correctly", () => {
  assertRoutesTo(methodology, STATES.initial, "pick");
  assertRoutesTo(methodology, STATES.done, null);
});

it("runs to completion", async () => {
  const result = await runMethodologyIsolated(methodology, worldState(STATES.initial));
  expect(result.status).toBe("completed");
});
```

## Incremental Adoption

You don't have to migrate everything at once. The testkit is additive — it imports from `@methodts/methodts` and works alongside existing patterns.

### Step 1: Replace construction boilerplate

Keep your existing test assertions, but replace manual type construction with builders:

```typescript
// Before
const D_TASKS: DomainTheory<TaskState> = {
  id: "D_TASKS",
  signature: { sorts: [...], functionSymbols: [], predicates: {...} },
  axioms: {},
};

// After
const D_TASKS = domainBuilder<TaskState>("D_TASKS")
  .sort("Task", "unbounded")
  .predicate("has_open", s => s.tasks.some(t => t.status === "open"))
  .build();
```

### Step 2: Replace Effect ceremony with harnesses

```typescript
// Before
const mockLayer = MockAgentProvider({ responses: [], fallback: { raw: "{}", cost: {...} } });
const effect = runMethodology(methodology, initialState).pipe(Effect.provide(mockLayer));
const result = await Effect.runPromise(effect);

// After
const result = await runMethodologyIsolated(methodology, worldState(initial));
```

### Step 3: Replace manual routing checks with assertions

```typescript
// Before
const result = evaluateTransition(methodology, state);
expect(result.firedArm).not.toBeNull();
expect(result.firedArm!.label).toBe("pick");

// After (with diagnostic trace on failure)
assertRoutesTo(methodology, state, "pick");
```

### Step 4: Add scenario tests for routing trajectories

```typescript
// New — no equivalent in manual pattern
scenario(methodology)
  .given(STATES.initial)
  .expectsRoute("pick")
  .then(STATES.picked)
  .expectsRoute("complete")
  .then(STATES.done)
  .expectsTermination()
  .run();
```

## What You Keep

- **Predicate definitions** (`check`, `and`, `or`, etc.) — same API, just import from `@methodts/testkit` instead of `@methodts/methodts`
- **State type definitions** — unchanged
- **Test structure** (describe/it blocks) — unchanged
- **Custom assertions** beyond what the testkit provides — unchanged

## What You Replace

| Manual pattern | Testkit replacement |
|---|---|
| `DomainTheory<S>` literal | `domainBuilder<S>()` |
| `Step<S>` literal with `Effect.succeed` | `scriptStep<S>()` |
| `Method<S>` literal with DAG | `methodBuilder<S>()` |
| `Methodology<S>` literal | `methodologyBuilder<S>()` |
| `{ value: x, axiomStatus: { valid: true, violations: [] } }` | `worldState(x)` |
| `MockAgentProvider` + `Effect.provide` + `Effect.runPromise` | `runMethodologyIsolated()` |
| `evaluateTransition()` + manual expect | `assertRoutesTo()` |
| `compileMethod()` + manual gate check | `assertCompiles()` |
| `checkCoherence()` + manual check inspect | `assertCoherent()` |
