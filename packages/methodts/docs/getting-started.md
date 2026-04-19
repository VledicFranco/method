# Getting Started with MethodTS

A 5-minute tour of the typed methodology SDK. Each section builds on the previous, using a "task management" domain as the running example.

## 1. Install

```bash
npm install @methodts/methodts
```

MethodTS has two entry points:

- `@methodts/methodts` -- core SDK (prompts, predicates, domains, methods, runtime)
- `@methodts/methodts/stdlib` -- standard library (P0-META, reusable predicates, prompts, gates)

## 2. Compose Prompts

A `Prompt<A>` is a pure function from context `A` to instruction text. Prompts are the typed form of *guidance* from the formal theory.

```typescript
import { Prompt, constant, sequence } from "@methodts/methodts";

// A constant prompt ignores context
const header = constant<{ project: string }>("You are a task planner.");

// A dynamic prompt reads from context
const scope = new Prompt<{ project: string }>(
  (ctx) => `Plan tasks for the "${ctx.project}" project.`
);

// Compose with andThen (monoid operation)
const combined = header.andThen(scope);

// Or compose with sequence
const full = sequence(
  header.section("Role"),
  scope.section("Scope"),
);

// Render against a concrete context
const text = full.run({ project: "website-redesign" });
// => "## Role\n\nYou are a task planner.\n\n## Scope\n\nPlan tasks for the ..."
```

Key operations:

- **`andThen`** -- sequential composition (monoid)
- **`contramap`** -- adapt the context type (contravariant functor)
- **`section`** -- wrap output in a markdown heading
- **`when`** -- conditional inclusion
- **`map`** -- transform the output string

## 3. Define Predicates

A `Predicate<A>` is a first-order logic expression over TypeScript values. Predicates serve as preconditions, postconditions, axioms, and objectives.

```typescript
import { check, and, or, not, evaluate } from "@methodts/methodts";

type TaskState = {
  tasks: string[];
  assigned: Record<string, string>;
  reviewed: boolean;
};

// Named runtime checks
const hasTasks = check<TaskState>(
  "has-tasks",
  (s) => s.tasks.length > 0,
);

const allAssigned = check<TaskState>(
  "all-assigned",
  (s) => s.tasks.every((t) => t in s.assigned),
);

const isReviewed = check<TaskState>(
  "is-reviewed",
  (s) => s.reviewed,
);

// Compose with logical connectives
const readyForDelivery = and(hasTasks, allAssigned, isReviewed);

// Evaluate against concrete state
const state: TaskState = {
  tasks: ["build-api", "write-tests"],
  assigned: { "build-api": "alice", "write-tests": "bob" },
  reviewed: true,
};

evaluate(readyForDelivery, state); // => true
```

Additional connectives: `or`, `not`, `implies`, `forall`, `exists`, `TRUE`, `FALSE`.

For diagnostics, use `evaluateWithTrace` to get a full tree of which sub-predicates passed or failed.

## 4. Build a Domain Theory

A `DomainTheory<S>` is the formal specification of a problem domain: sorts (types), function symbols (operations), named predicates, and axioms (invariants that must always hold).

```typescript
import {
  type DomainTheory,
  type Predicate,
  check,
  and,
  validateAxioms,
  validateSignature,
} from "@methodts/methodts";

type TaskState = {
  tasks: string[];
  assigned: Record<string, string>;
  reviewed: boolean;
};

const taskDomain: DomainTheory<TaskState> = {
  id: "task-management",
  signature: {
    sorts: [
      { name: "Task", description: "A work item", cardinality: "finite" },
      { name: "Assignee", description: "A team member", cardinality: "finite" },
    ],
    functionSymbols: [
      {
        name: "assign",
        inputSorts: ["Task", "Assignee"],
        outputSort: "Task",
        totality: "partial",
      },
    ],
    predicates: {
      "has-tasks": check<TaskState>("has-tasks", (s) => s.tasks.length > 0),
      "all-assigned": check<TaskState>(
        "all-assigned",
        (s) => s.tasks.every((t) => t in s.assigned),
      ),
    },
  },
  axioms: {
    "non-empty-tasks": check<TaskState>(
      "non-empty-tasks",
      (s) => s.tasks.length > 0,
    ),
  },
};

// Validate signature coherence (all sort references exist)
const sigResult = validateSignature(taskDomain);
// => { valid: true, errors: [] }

// Validate axioms against a state (Mod(D) membership test)
const axiomResult = validateAxioms(taskDomain, {
  tasks: ["build-api"],
  assigned: {},
  reviewed: false,
});
// => { valid: true, violations: [] }
```

## 5. Define a Method

A `Method<S>` is the 5-tuple from the formal theory: domain, roles, step DAG, objective, and measures.

```typescript
import {
  type Method,
  type Step,
  type StepDAG,
  type Role,
  type Measure,
  type Prompt,
  check,
  and,
  TRUE,
} from "@methodts/methodts";
import { Effect } from "effect";

type TaskState = {
  tasks: string[];
  assigned: Record<string, string>;
  reviewed: boolean;
};

// Define a role
const planner: Role<TaskState> = {
  id: "planner",
  description: "Plans and assigns tasks",
  observe: (s) => s,
  authorized: ["plan-tasks", "assign-tasks"],
  notAuthorized: [],
};

// Define steps
const planStep: Step<TaskState> = {
  id: "plan-tasks",
  name: "Plan Tasks",
  role: "planner",
  precondition: TRUE,
  postcondition: check<TaskState>("has-tasks", (s) => s.tasks.length > 0),
  execution: {
    tag: "script",
    execute: (state) =>
      Effect.succeed({
        ...state,
        tasks: ["build-api", "write-tests", "deploy"],
      }),
  },
};

const assignStep: Step<TaskState> = {
  id: "assign-tasks",
  name: "Assign Tasks",
  role: "planner",
  precondition: check<TaskState>("has-tasks", (s) => s.tasks.length > 0),
  postcondition: check<TaskState>(
    "all-assigned",
    (s) => s.tasks.every((t) => t in s.assigned),
  ),
  execution: {
    tag: "script",
    execute: (state) =>
      Effect.succeed({
        ...state,
        assigned: Object.fromEntries(
          state.tasks.map((t) => [t, "alice"]),
        ),
      }),
  },
};

// Define the step DAG
const dag: StepDAG<TaskState> = {
  steps: [planStep, assignStep],
  edges: [{ from: "plan-tasks", to: "assign-tasks" }],
  initial: "plan-tasks",
  terminal: "assign-tasks",
};

// Define a progress measure
const completionMeasure: Measure<TaskState> = {
  id: "task-completion",
  name: "Task Completion",
  compute: (s) => {
    if (s.tasks.length === 0) return 0;
    const assignedCount = s.tasks.filter((t) => t in s.assigned).length;
    return assignedCount / s.tasks.length;
  },
  range: [0, 1],
  terminal: 1,
};

// Assemble the method (5-tuple)
const taskMethod: Method<TaskState> = {
  id: "M-TASK-PLAN",
  name: "Task Planning Method",
  domain: taskDomain,  // from section 4
  roles: [planner],
  dag,
  objective: and(
    check<TaskState>("has-tasks", (s) => s.tasks.length > 0),
    check<TaskState>(
      "all-assigned",
      (s) => s.tasks.every((t) => t in s.assigned),
    ),
  ),
  measures: [completionMeasure],
};
```

## 6. Compile It

`compileMethod` runs the method through six compilation gates (G1-G6) and produces a report.

```typescript
import { compileMethod } from "@methodts/methodts";

// Test states for axiom and composability checking
const testStates: TaskState[] = [
  { tasks: ["build-api"], assigned: {}, reviewed: false },
  { tasks: ["build-api"], assigned: { "build-api": "alice" }, reviewed: false },
  {
    tasks: ["build-api", "write-tests"],
    assigned: { "build-api": "alice", "write-tests": "bob" },
    reviewed: true,
  },
];

const report = compileMethod(taskMethod, testStates);

console.log(report.overall);
// => "compiled" (all gates pass — no agent steps means G5 passes cleanly)

for (const gate of report.gates) {
  console.log(`${gate.gate}: ${gate.status} — ${gate.details}`);
}
// G1-domain: pass — Signature and axioms valid
// G2-objective: pass — Objective is a typed Predicate<S>
// G3-roles: pass — All step roles have definitions
// G4-dag: pass — All edges composable
// G5-guidance: pass — All steps are script steps (no agent review needed)
// G6-serializable: pass — Method structure serializable
```

Gates:

| Gate | Checks |
|------|--------|
| G1 | Domain signature coherence + axiom validation over test states |
| G2 | Objective is a well-typed Predicate (structural check) |
| G3 | Every step role has a definition in the method's role list |
| G4 | DAG is acyclic + step composability (post(A) implies pre(B)) |
| G5 | Agent steps have prompts (flags for manual review) |
| G6 | Method structure survives JSON round-trip |

Use `assertCompiled` for a throwing variant that fails on any gate failure.

## 7. Generate a Commission

A `Commission<A>` bundles a rendered prompt with bridge spawn parameters. This is how you deploy sub-agents.

```typescript
import { commission, Prompt, constant, sequence } from "@methodts/methodts";

type TaskContext = {
  project: string;
  tasks: string[];
};

const commissionPrompt = sequence(
  constant<TaskContext>("You are a task execution agent.").section("Role"),
  new Prompt<TaskContext>((ctx) =>
    `Execute the following tasks for project "${ctx.project}":\n` +
    ctx.tasks.map((t, i) => `${i + 1}. ${t}`).join("\n")
  ).section("Tasks"),
);

const result = commission(
  commissionPrompt,
  { project: "website", tasks: ["build-api", "write-tests"] },
  {
    workdir: "/workspace/website",
    nickname: "task-executor",
    purpose: "Execute planned tasks",
  },
);

console.log(result.prompt);
// => "## Role\n\nYou are a task execution agent.\n\n## Tasks\n\n..."
console.log(result.bridge.nickname);
// => "task-executor"
```

For batch deployments, use `batchCommission` to render one commission per context with unique bridge params.

Built-in templates are available for common patterns:

```typescript
import { templates } from "@methodts/methodts";

const implPrompt = templates.implementation();
const reviewPrompt = templates.review();
const councilPrompt = templates.council();
const retroPrompt = templates.retro();
```

## 8. Run a Methodology

Wrap a method as a `Methodology` and execute it through the coalgebraic runtime loop.

```typescript
import {
  asMethodology,
  runMethodology,
  MockAgentProvider,
  type WorldState,
} from "@methodts/methodts";
import { Effect } from "effect";

// Wrap the method as a trivial one-arm methodology
const methodology = asMethodology(taskMethod);

// Create the initial world state
const initialState: WorldState<TaskState> = {
  value: { tasks: [], assigned: {}, reviewed: false },
  axiomStatus: { valid: true, violations: [] },
};

// Create a mock agent provider for testing
const mockLayer = MockAgentProvider({
  responses: [],
  fallback: {
    raw: "done",
    cost: { tokens: 100, usd: 0.01, duration_ms: 500 },
  },
});

// Run the methodology
const program = runMethodology(methodology, initialState);

const result = await Effect.runPromise(
  program.pipe(Effect.provide(mockLayer)),
);

console.log(result.status);
// => "completed"
console.log(result.accumulator.loopCount);
// => 1
```

The runtime loop:
1. Checks safety bounds (max loops, tokens, cost, duration)
2. Evaluates the transition function (priority-ordered arms)
3. If terminal (null selected) -- complete
4. Runs the selected method via `runMethod`
5. Records result, loops

## 9. Next Steps

- **[Theory Mapping](./theory-mapping.md)** -- how MethodTS types map to F1-FTH formal definitions
- **stdlib** -- `import { ... } from "@methodts/methodts/stdlib"` for P0-META, reusable predicates, prompts, and compilation gates
- **Gate runners** -- `scriptGate`, `testRunner`, `httpChecker`, `checklistGate` for quality gates
- **Strategy layer** -- `StrategyController` for multi-run methodology orchestration with adaptive decisions
- **EventBus** -- `createEventBus` for runtime event subscriptions and hooks
