# @methodts/methodts

Typed Methodology SDK -- makes the formal theory (F1-FTH) executable in TypeScript.

## Overview

MethodTS encodes formal methodologies as composable, type-safe TypeScript values. It provides a complete pipeline from domain specification through method compilation to runtime execution: define predicates and prompts, compose them into steps and DAGs, compile methods through six verification gates, deploy agents via commissions, and run methodologies through a coalgebraic execution loop with safety bounds, suspension, and observability.

## Install

```bash
npm install @methodts/methodts
```

## Quick Example

**Define a predicate:**

```typescript
import { check, and, evaluate } from "@methodts/methodts";

type TaskState = {
  tasks: string[];
  assigned: Record<string, string>;
  reviewed: boolean;
};

const hasTasks = check<TaskState>("has-tasks", (s) => s.tasks.length > 0);
const allAssigned = check<TaskState>(
  "all-assigned",
  (s) => s.tasks.every((t) => t in s.assigned),
);

const ready = and(hasTasks, allAssigned);

evaluate(ready, {
  tasks: ["build-api"],
  assigned: { "build-api": "alice" },
  reviewed: false,
}); // => true
```

**Define a method:**

```typescript
import { type Method, type Step, type StepDAG, TRUE, check } from "@methodts/methodts";
import { Effect } from "effect";

const planStep: Step<TaskState> = {
  id: "plan",
  name: "Plan Tasks",
  role: "planner",
  precondition: TRUE,
  postcondition: hasTasks,
  execution: {
    tag: "script",
    execute: (s) => Effect.succeed({ ...s, tasks: ["build-api", "write-tests"] }),
  },
};

const assignStep: Step<TaskState> = {
  id: "assign",
  name: "Assign Tasks",
  role: "planner",
  precondition: hasTasks,
  postcondition: allAssigned,
  execution: {
    tag: "script",
    execute: (s) =>
      Effect.succeed({
        ...s,
        assigned: Object.fromEntries(s.tasks.map((t) => [t, "alice"])),
      }),
  },
};

const taskMethod: Method<TaskState> = {
  id: "M-TASK",
  name: "Task Planning",
  domain: taskDomain,
  roles: [{ id: "planner", description: "Plans tasks", observe: (s) => s, authorized: ["plan", "assign"], notAuthorized: [] }],
  dag: { steps: [planStep, assignStep], edges: [{ from: "plan", to: "assign" }], initial: "plan", terminal: "assign" },
  objective: ready,
  measures: [],
};
```

**Compile it:**

```typescript
import { compileMethod } from "@methodts/methodts";

const report = compileMethod(taskMethod, [
  { tasks: ["x"], assigned: {}, reviewed: false },
  { tasks: ["x"], assigned: { x: "a" }, reviewed: true },
]);

console.log(report.overall); // => "compiled"
report.gates.forEach((g) => console.log(`${g.gate}: ${g.status}`));
```

## API Surface

### Prompt Algebra

`Prompt<A>`, `constant`, `empty`, `sequence`, `cond`, `match`, `template`

### Predicate Logic

`Predicate<A>`, `check`, `and`, `or`, `not`, `implies`, `forall`, `exists`, `TRUE`, `FALSE`, `evaluate`, `evaluateWithTrace`

### Domain Theory

`DomainTheory<S>`, `SortDecl`, `FunctionDecl`, `validateAxioms`, `validateSignature`

### World State

`WorldState<S>`, `Snapshot<S>`, `Diff<S>`, `Witness<S>`, `StateTrace<S>`, `diff`

### Roles

`Role<S, V>`, `scopeToRole`

### Steps and DAG

`Step<S>`, `StepExecution<S>`, `StepContext<S>`, `ContextSpec<S>`, `SuspensionPolicy<S>`, `StepDAG<S>`, `StepEdge`, `topologicalOrder`, `checkComposability`

### Method

`Method<S>`, `Measure<S>`, `ProgressOrder<S>`

### Methodology

`Methodology<S>`, `Arm<S>`, `SafetyBounds`, `TerminationCertificate<S>`, `asMethodology`, `evaluateTransition`, `simulateRun`, `checkSafety`

### Retraction

`Retraction<P, C>`, `verifyRetraction`

### Gates

`Gate<S>`, `GateSuite<S>`, `GateResult<S>`, `GateSuiteResult<S>`, `allPass`, `anyPass`, `withRetry`, `scriptGate`, `testRunner`, `httpChecker`, `checklistGate`

### Commission

`Commission<A>`, `BridgeParams`, `commission`, `batchCommission`, `templates`

### Agent Provider

`AgentProvider`, `AgentResult`, `AgentError`, `MockAgentProvider`

### Runtime

`runStep`, `runMethod`, `runMethodology`, `runMethodologyToCompletion`

### Runtime Types

`RuntimeEvent<S>`, `SuspendedMethodology<S>`, `SuspensionReason<S>`, `Resolution<S>`, `RuntimeConfig`, `ExecutionAccumulatorState`, `MethodologyResult<S>`, `MethodResult<S>`, `StepResult<S>`

### Observability

`EventBus<S>`, `createEventBus`, `EventFilter<S>`, `EventHook<S>`

### Strategy

`StrategyController<S>`, `StrategyDecision<S>`, `StrategyResult<S>`, `runStrategy`, prebuilt strategies

### Meta

`compileMethod`, `assertCompiled`, `CompilationReport`, `instantiate`, `instantiateMethodology`, `ProjectCard`, `aggregateEvidence`, `diffDomainTheory`, `classifyDomainChanges`

### Standard Library (`@methodts/methodts/stdlib`)

`MetaState`, `DesignState`, `EvolutionState`, `InstantiationState`, `D_META`, `predicates`, `prompts`, `M1_MDES`, `P0_META`, `compilationGates` (G1-G6)

## Architecture

```
@methodts/methodts
  |
  +-- prompt/         Prompt<A> algebra (contravariant functor, monoid)
  +-- predicate/      Predicate<A> ADT + evaluate engine
  +-- domain/         DomainTheory<S>, Role<S,V>
  +-- state/          WorldState<S>, Snapshot, Diff, Witness
  +-- method/         Step<S>, StepDAG<S>, Method<S>, Measure<S>
  +-- methodology/    Methodology<S>, Arm, transition, safety, retraction
  +-- gate/           Gate framework + runners (script, test, http, checklist)
  +-- commission/     Commission<A>, templates, render helpers
  +-- provider/       AgentProvider service + MockAgentProvider
  +-- runtime/        Execution engine (runStep, runMethod, runMethodology)
  |     +-- events    RuntimeEvent<S> (20 variants)
  |     +-- event-bus EventBus<S> with hooks and subscriptions
  |     +-- context   Step context assembly protocol
  |     +-- suspension SuspendedMethodology, Resolution
  |     +-- accumulator ExecutionAccumulatorState, results
  +-- strategy/       StrategyController, runStrategy, prebuilt strategies
  +-- meta/           compileMethod, instantiate, evolve, ProjectCard
  +-- extractor/      World fragment extraction (command, git)
  +-- stdlib/         P0-META, D_META, M1_MDES, reusable predicates/prompts/gates
```

## Documentation

- **[Getting Started](./docs/getting-started.md)** -- 5-minute tutorial with progressive disclosure
- **[Theory Mapping](./docs/theory-mapping.md)** -- how MethodTS types map to F1-FTH formal definitions

## Development

```bash
npm run build            # TypeScript build
npm test                 # Run all tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage report
```
