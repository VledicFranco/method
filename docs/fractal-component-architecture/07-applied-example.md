---
title: "Applied Example: Task Management Platform"
scope: section
---

# Applied Example: Task Management Platform

This section applies FCA to a task management platform (think Linear, Jira, or Asana) — a system every developer has used. It demonstrates how the fractal pattern manifests at every level, from pure functions through the running platform.

### The fractal at every level

**L0 — Function:** A pure state transition at the heart of the task domain.

```typescript
/** Transition a task's state in response to a workflow event. Pure function. */
function transitionTaskState(task: Task, event: TaskEvent): Task {
  // Interface: (Task, TaskEvent) => Task
  // Domain: task state machine (ADTs: TaskState, TaskEvent)
  // Boundary: pure — no I/O, no database, no side effects
  // Port: none needed — all inputs are values
  // Verification: call with test inputs, assert output
  // Observability: return value carries the transition metadata
  // Documentation: JSDoc + type signature
}
```

**L1 — Module:** Groups related transition functions.

```typescript
// source/tasks/task-transitions.ts
// Interface: exported functions (transitionTaskState, validateTransition, canTransition)
// Domain: all functions operate on Task + TaskEvent types
// Boundary: module scope — internal helpers not exported
// Port: none — pure module
// Verification: import and call with test data
// Observability: (inherited from L0 function traces)
// Documentation: module-level JSDoc

export function transitionTaskState(task: Task, event: TaskEvent): Task { ... }
export function validateTransition(from: TaskState, to: TaskState): boolean { ... }
export function canTransition(task: Task, event: TaskEvent): boolean { ... }
```

**L2 — Domain:** The `tasks/` directory groups all task-related modules.

```
source/tasks/
  README.md                    # Domain overview: task lifecycle, state machine, validation
  index.ts                     # Domain interface: re-exports public surface
  task-transitions.ts          # State machine transitions (pure)
  task-transitions.test.ts     # Verification — co-located
  task-transitions.metrics.ts  # Observability — transition counts, duration histograms
  task-validation.ts           # Input validation rules (pure)
  task-validation.test.ts
  task-queries.ts              # Query builders (pure — returns query objects, not results)
  task-queries.test.ts
```

**L3 — Package:** `@taskflow/core` — the domain logic library.

```
packages/core/
  source/
    README.md
    tasks/                     # Task domain (L2)
    workflows/                 # Workflow domain (L2)
    projects/                  # Project domain (L2)
    permissions/               # Authorization domain (L2)
    ports/
      README.md
      database-port.ts         # interface DatabasePort { query, execute, transaction }
      search-port.ts           # interface SearchPort { index, search, delete }
      notification-port.ts     # interface NotificationPort { send, sendBatch }
    index.ts                   # Package interface: re-exports from all domains + ports
  documentation/
    README.md
    guides/
      README.md
      task-lifecycle.md
      workflow-engine.md
      implementing-ports.md
  package.json
```

**L4 — Service:** `@taskflow/api` — the HTTP server that composes packages.

```
packages/api/
  source/
    README.md
    services/                  # Composes core domains with port implementations
      task-service.ts          # core.tasks + database + search + notifications
      workflow-service.ts      # core.workflows + database + queue
    infrastructure/            # Port implementations
      postgres-database.ts     # implements DatabasePort
      elasticsearch-search.ts  # implements SearchPort
      email-notification.ts    # implements NotificationPort
    routes/                    # Thin HTTP handlers — parse, delegate, format
      task-routes.ts           # POST /tasks, PATCH /tasks/:id → task-service
      workflow-routes.ts       # POST /workflows → workflow-service
    index.ts                   # Composition: wire services, register routes, start server
  documentation/
    README.md
```

**L5 — System:** The TaskFlow platform — API + worker + frontend + infrastructure.

```
TaskFlow Platform
  @taskflow/api              # HTTP API service
  @taskflow/worker           # Background job processor (workflow execution, notifications)
  @taskflow/frontend         # React SPA (HTTP consumer, defines own types)
  infrastructure/
    postgres                 # Database
    elasticsearch            # Search engine
    redis                    # Queue + cache
```

### L3 Component Graph

```
@taskflow/types          (zero deps — pure type definitions)
    ^                    Task, TaskState, TaskEvent, Workflow, Project, Permission
    |
@taskflow/core           (depends on: types)
    ^                    Pure domain logic: tasks, workflows, projects, permissions.
    |                    No database, no network, no I/O. Accepts ports.
    |
@taskflow/testkit        (depends on: types, core)
    ^                    Builders, assertions, harnesses for domain verification.
    |                    taskBuilder(), workflowBuilder(), assertTransitionsTo(), etc.
    |
@taskflow/api            (depends on: types, core)
    |                    HTTP server. L4 composition layer.
    |                    Wires port implementations, registers routes.
    |
@taskflow/worker         (depends on: types, core)
    |                    Background processor. L4 composition layer.
    |                    Wires queue port, executes workflows.
    |
@taskflow/frontend       (zero @taskflow deps — HTTP consumer only)
                         React SPA. Defines own DTO types from the API interface.
```

**Boundary constraints:**
- `@taskflow/core` never imports `pg`, `elasticsearch`, `nodemailer`, or any I/O library. All external access goes through ports.
- `@taskflow/api` and `@taskflow/worker` never import each other. They communicate through the database and queue — shared infrastructure, not shared code.
- `@taskflow/frontend` never imports from any `@taskflow/*` server package. It defines its own types from the HTTP contract.

### Ports in practice

The core package defines the port interfaces. Each L4 service chooses its implementations:

```typescript
// In @taskflow/core — port definition
interface DatabasePort {
  query<T>(sql: string, params: unknown[]): Promise<T[]>;
  execute(sql: string, params: unknown[]): Promise<{ rowCount: number }>;
  transaction<T>(fn: (tx: DatabasePort) => Promise<T>): Promise<T>;
}

// In @taskflow/api — port implementation (production)
class PostgresDatabase implements DatabasePort { ... }

// In @taskflow/testkit — port implementation (verification)
class InMemoryDatabase implements DatabasePort { ... }
```

The `TaskService` in the API accepts the port, never the implementation:

```typescript
// In @taskflow/api — service layer (composition)
class TaskService {
  constructor(
    private db: DatabasePort,           // injected
    private search: SearchPort,         // injected
    private notifications: NotificationPort,  // injected
  ) {}

  async createTask(input: CreateTaskInput): Promise<Task> {
    const task = core.tasks.createTask(input);           // Pure domain logic
    await this.db.execute(/* insert */);                 // Through port
    await this.search.index('tasks', task);              // Through port
    await this.notifications.send(/* new task */);       // Through port
    return task;
  }
}
```

### Co-located artifacts in practice

A single domain module with all seven artifacts:

```
source/tasks/
  task-transitions.ts            # 1. Implementation — pure state machine
  task-transitions.test.ts       # 2. Verification — unit tests co-located
  task-transitions.metrics.ts    # 3. Observability — transition counters, state histograms
  task-transitions.config.ts     # 4. Configuration — max retries, timeout defaults
  task-transitions.example.ts    # 5. Examples — usage demos, integration tests
  README.md                      # 6. Documentation — domain overview
  index.ts                       # 7. Types/Interface — re-exports public surface
```

Build tools separate:
- `build:runtime` → ships `task-transitions.ts`, `task-transitions.config.ts`, `index.ts`
- `build:test` → includes everything
- `build:observe` → extracts `task-transitions.metrics.ts` → generates Grafana dashboard JSON

### Testkit in practice

The testkit ships builders that mirror the domain:

```typescript
import { taskBuilder, workflowBuilder, assertTransitionsTo } from '@taskflow/testkit';
import { InMemoryDatabase } from '@taskflow/testkit/ports';

// Build a task in a specific state with sensible defaults
const task = taskBuilder()
  .withState('in_progress')
  .withAssignee('user-123')
  .build();

// Assert a pure domain transition
assertTransitionsTo(task, { type: 'complete' }, 'done');

// Test a service with mock ports
const db = new InMemoryDatabase();
const service = new TaskService(db, mockSearch, mockNotifications);
const created = await service.createTask({ title: 'Test task' });
assert.equal(db.queries.length, 1);  // Verify port interaction
```

### Self-Containment Pattern

Every L3 component follows:

```
packages/{component-name}/
  source/
    README.md                   # Architecture: modules, ports, entry point
    index.ts                    # Interface: public exports
    {domain}/
      README.md                 # Domain overview
      {module}.ts               # Implementation
      {module}.test.ts          # Verification (co-located)
      {module}.metrics.ts       # Observability (co-located)
      {module}.config.ts        # Configuration (co-located)
    ports/
      README.md                 # Port definitions
      {port-name}.ts
  examples/
    README.md                   # Example index
    {use-case}.ts
  documentation/
    README.md                   # Component front door
    guides/
      README.md                 # Guide index
      {use-case-name}.md
    decisions/
      README.md                 # Decision log
      NNN-{decision-name}.md
  package.json
  tsconfig.json
```

**The README rule:** every directory with more than one file has a `README.md` with frontmatter (`title`, `scope`, `contents`). Every README indexes its children.

---

