---
title: Common Patterns and Technology Picks
scope: section
---

# Common Patterns and Technology Picks

This section maps FCA's abstract concepts to concrete implementation patterns, technology choices, and decision criteria. Each pattern is shown with when to use it, when to avoid it, and how it manifests at different levels.

### Port Patterns

#### The Provider Interface

The most common port pattern. Define an interface in the component that needs the dependency. Implement it elsewhere.

**When:** The component depends on an external system (database, API, filesystem, clock, randomness) and needs to be verifiable in isolation.

**When not:** The dependency is a pure library with no I/O (e.g., a math library, a string formatter). Those are direct imports, not ports.

```typescript
// Port definition — lives in @taskflow/core
interface DatabasePort {
  query<T>(sql: string, params: unknown[]): Promise<T[]>;
  execute(sql: string, params: unknown[]): Promise<{ rowCount: number }>;
  transaction<T>(fn: (tx: DatabasePort) => Promise<T>): Promise<T>;
}

// Production — lives in @taskflow/api
class PostgresDatabase implements DatabasePort { ... }

// Verification — lives in @taskflow/testkit
class InMemoryDatabase implements DatabasePort {
  private tables = new Map<string, unknown[]>();
  queries: Array<{ sql: string; params: unknown[] }> = []; // Recording for assertions
  // ...20 lines total
}
```

**Technology picks by ecosystem:**

| Ecosystem | Port mechanism | Example |
|-----------|---------------|---------|
| TypeScript | `interface` + constructor injection | `class Service { constructor(private db: DatabasePort) {} }` |
| TypeScript + Effect | `Context.Tag` + `Layer` | `const Database = Context.Tag<DatabasePort>()` |
| Scala + Cats Effect | Tagless final (`F[_]: Monad`) | `class Service[F[_]: Monad](db: DatabasePort[F])` |
| Rust | Trait + generic parameter | `struct Service<D: DatabasePort> { db: D }` |
| Go | Interface + struct field | `type Service struct { db DatabasePort }` |

#### The Effect Service Layer

When ports need lifecycle management (connection pools, cleanup, startup) and composable error handling, use an effect system to formalize the port as a service layer.

**When:** The port has lifecycle concerns (must be opened/closed), can fail in structured ways, or needs to participate in resource management.

**When not:** The port is stateless and infallible (e.g., a clock, a UUID generator). A plain interface is simpler.

```typescript
// Effect-based port — the Requirements type parameter IS the port
import { Effect, Context, Layer } from 'effect';

class Database extends Context.Tag('Database')<Database, {
  query: <T>(sql: string, params: unknown[]) => Effect.Effect<T[], DatabaseError>;
  execute: (sql: string, params: unknown[]) => Effect.Effect<number, DatabaseError>;
}>() {}

// Usage in domain logic — declares the port in the type signature
const createTask = (input: CreateTaskInput): Effect.Effect<Task, TaskError, Database> =>
  Effect.gen(function* () {
    const db = yield* Database;
    const task = buildTask(input);
    yield* db.execute('INSERT INTO tasks ...', [task.id, task.title]);
    return task;
  });

// Production Layer — provides the port implementation
const PostgresLayer = Layer.succeed(Database, {
  query: (sql, params) => Effect.tryPromise(() => pool.query(sql, params)),
  execute: (sql, params) => Effect.tryPromise(() => pool.query(sql, params).then(r => r.rowCount)),
});

// Test Layer — provides the mock
const TestLayer = Layer.succeed(Database, {
  query: () => Effect.succeed([]),
  execute: () => Effect.succeed(1),
});
```

**Technology picks:**

| Need | Technology | Why |
|------|-----------|-----|
| TypeScript with structured concurrency | Effect | `Effect<A, E, R>` encodes interface (A), error domain (E), and ports (R) in the type |
| Scala with structured concurrency | Cats Effect + Tagless Final | `F[_]` abstracts over the effect type, resources manage lifecycle |
| Rust with structured concurrency | Tower service trait | `Service<Request>` with `Future` return type |
| Simple TypeScript, no effect system | Plain interfaces + async/await | `interface DatabasePort { query(...): Promise<T> }` |

**Decision criterion:** If your L0 functions need to express "I require these capabilities" in their type signature, use an effect system. If port injection only happens at L2-L3 (service construction), plain interfaces suffice.

### Verification Patterns

#### Unit Verification (L0-L2)

Test pure logic by calling it with constructed inputs. No mocks, no infrastructure.

**When:** Always, for every pure function and module.

```typescript
// L0 — call the function
assert.deepEqual(
  transitionTaskState(
    { id: '1', state: 'todo', assignee: null },
    { type: 'assign', userId: 'user-1' }
  ),
  { id: '1', state: 'todo', assignee: 'user-1' }
);
```

#### Builder Pattern (L2-L3)

Construct complex domain objects with sensible defaults. Tests override only what they care about.

**When:** Domain objects have many fields and tests only care about a few. Without builders, every test file constructs objects with 15 fields — most irrelevant to the assertion.

```typescript
// In testkit — fluent builder
const task = taskBuilder()
  .withState('in_progress')
  .withAssignee('user-123')
  .build();

// The builder provides sensible defaults for id, title, createdAt, priority, etc.
// The test only specifies what it's actually testing.
```

**Technology picks:**

| Approach | When | Example |
|----------|------|---------|
| Fluent builder (method chaining) | Complex objects with many optional fields | `taskBuilder().withState('done').build()` |
| Factory function with partial overrides | Simpler objects, fewer variations | `makeTask({ state: 'done' })` |
| Faker/fixture library | Need realistic random data | `taskFactory.create({ state: 'done' })` |

#### Recording Provider (L2-L3)

A test double that implements a port interface and records all interactions for later assertion.

**When:** You need to verify that a component called the right port methods with the right arguments, without running the actual external system.

```typescript
const recorder = new RecordingNotificationPort();
const service = new TaskService(db, search, recorder);

await service.completeTask('task-1');

assert.equal(recorder.calls.length, 1);
assert.equal(recorder.calls[0].method, 'send');
assert.deepEqual(recorder.calls[0].args.recipient, 'assignee@example.com');
```

#### Contract Verification (L3-L4)

Verify that a port implementation actually satisfies the port interface's behavioral contract — not just the type signature.

**When:** You have multiple port implementations (Postgres in production, SQLite in CI, InMemory in unit tests) and need to ensure they all behave identically.

```typescript
// Shared contract test — runs against any DatabasePort implementation
function databaseContractSuite(createDb: () => Promise<DatabasePort>) {
  it('returns empty array for no results', async () => {
    const db = await createDb();
    const results = await db.query('SELECT * FROM tasks WHERE id = $1', ['nonexistent']);
    assert.deepEqual(results, []);
  });

  it('execute returns affected row count', async () => {
    const db = await createDb();
    const result = await db.execute('INSERT INTO tasks (id, title) VALUES ($1, $2)', ['1', 'Test']);
    assert.equal(result.rowCount, 1);
  });
}

// Run the same contract against all implementations
describe('PostgresDatabase',  () => databaseContractSuite(() => createPostgresDb()));
describe('InMemoryDatabase',  () => databaseContractSuite(() => createInMemoryDb()));
describe('SQLiteDatabase',    () => databaseContractSuite(() => createSQLiteDb()));
```

### Observability Patterns

#### Metric Definitions (L1-L2)

Define what a module measures in a co-located `*.metrics.ts` file. The definitions are declarative — they describe the metric, not the infrastructure.

**When:** The module performs operations that have meaningful rates, durations, or counts.

```typescript
// task-transitions.metrics.ts — co-located with task-transitions.ts
import { counter, histogram } from '@observability/definitions';

export const taskTransitionCount = counter({
  name: 'task_transitions_total',
  description: 'Number of task state transitions',
  labels: ['from_state', 'to_state', 'trigger'],
});

export const taskTransitionDuration = histogram({
  name: 'task_transition_duration_ms',
  description: 'Duration of task state transition processing',
  buckets: [1, 5, 10, 25, 50, 100],
});
```

Build tools extract these definitions and generate infrastructure-specific outputs (Prometheus metrics, Grafana dashboards, DataDog monitors).

#### Domain Events (L2-L3)

Emit semantic events that describe what happened in the domain — not what functions were called.

**When:** The domain has state transitions, decisions, or lifecycle events that operators, auditors, or other components need to observe.

```typescript
// Domain event — semantic, not infrastructural
interface TaskEvent {
  type: 'task.created' | 'task.transitioned' | 'task.completed' | 'task.escalated';
  taskId: string;
  timestamp: string;
  actor: string;
  metadata: Record<string, unknown>;
}

// Emitted by domain logic, consumed by observability infrastructure
eventBus.emit({
  type: 'task.transitioned',
  taskId: task.id,
  timestamp: new Date().toISOString(),
  actor: 'user-123',
  metadata: { from: 'in_progress', to: 'done', duration_ms: 3600000 },
});
```

**Technology picks:**

| Level | Pattern | Technology examples |
|-------|---------|-------------------|
| L0-L1 | Function traces / spans | OpenTelemetry SDK, Effect tracing, `console.time` |
| L2 | Domain event bus | EventEmitter, Effect PubSub, RxJS Subject |
| L3 | Exported event stream | Node.js EventEmitter export, async iterator, channel system |
| L4 | Structured logging + metrics + traces | Pino/Winston + Prometheus + OpenTelemetry + Grafana |
| L5 | Distributed tracing + SLO dashboards | Jaeger/Tempo + Grafana SLO + PagerDuty |

#### Health and Readiness (L4)

Every service exposes health and readiness endpoints. Health indicates the process is running. Readiness indicates it can serve requests (database connected, caches warm, etc.).

**When:** Always, for every L4 service.

```typescript
// Health — is the process alive?
app.get('/health', () => ({ status: 'ok', uptime_ms: process.uptime() * 1000 }));

// Readiness — can it serve requests?
app.get('/ready', async () => {
  const dbOk = await db.query('SELECT 1').then(() => true).catch(() => false);
  const searchOk = await search.ping().then(() => true).catch(() => false);
  const allReady = dbOk && searchOk;
  return { status: allReady ? 'ready' : 'degraded', checks: { database: dbOk, search: searchOk } };
});
```

### Configuration Patterns

#### Schema-First Configuration (L2-L3)

Define configuration as a typed schema with defaults and validation. The schema is the documentation.

**When:** The component has configurable behavior (timeouts, limits, feature flags, connection strings).

```typescript
// task-service.config.ts — co-located with the service
import { z } from 'zod';

export const TaskServiceConfig = z.object({
  maxTasksPerProject: z.number().default(10_000),
  defaultPriority: z.enum(['low', 'medium', 'high']).default('medium'),
  staleDuration: z.number().default(7 * 24 * 60 * 60 * 1000).describe('Milliseconds before a task is marked stale'),
  enableAutoAssignment: z.boolean().default(false),
});

export type TaskServiceConfig = z.infer<typeof TaskServiceConfig>;
```

**Technology picks:**

| Approach | When | Example |
|----------|------|---------|
| Zod schema | TypeScript, runtime validation needed | `z.object({ port: z.number().default(3000) })` |
| io-ts | TypeScript + fp-ts ecosystem | `t.type({ port: t.number })` |
| Environment variables + schema | L4 services, 12-factor app | `TaskServiceConfig.parse(process.env)` |
| Config files (YAML/JSON) + schema | Complex nested configuration | Load file, validate against Zod schema |

**The rule:** configuration schemas live next to the code they configure. `task-service.config.ts` lives alongside `task-service.ts`. Build tools extract schemas for documentation and validation.

### Documentation Patterns

#### README as Index

Every directory with multiple files gets a README that indexes its contents. The README is the table of contents — it lists children with one-line summaries and links.

**When:** Always, for every directory with more than one file.

```markdown
---
title: Task Domain
scope: domain
package: core
contents:
  - task-transitions.ts
  - task-validation.ts
  - task-queries.ts
---

# Task Domain

State machine, validation rules, and query builders for the task lifecycle.

| Module | Purpose |
|--------|---------|
| [task-transitions](task-transitions.ts) | Pure state machine: `(Task, Event) → Task` |
| [task-validation](task-validation.ts) | Input validation and business rules |
| [task-queries](task-queries.ts) | Type-safe query builders for task retrieval |
```

#### JSDoc for Interface, Comments for Why

**Interface-level (L0-L1):** Every exported function, type, and interface gets JSDoc describing what it does and when to use it.

**Implementation-level:** Comments only where the *why* is non-obvious. Never comment *what* — the code already says what.

```typescript
/**
 * Transition a task's state in response to a workflow event.
 *
 * Returns a new Task with the updated state. Does not persist —
 * the caller decides whether to commit the transition.
 */
export function transitionTaskState(task: Task, event: TaskEvent): Task {
  // Validate before transitioning — invalid transitions return the task unchanged
  // rather than throwing, because batch processors need to continue on failure.
  if (!canTransition(task.state, event.type)) return task;

  return { ...task, state: nextState(task.state, event.type) };
}
```

#### Decision Records

When a non-obvious architectural choice is made, document the alternatives considered, the decision, and the rationale. Named `NNN-descriptive-title.md` in a `decisions/` directory.

**When:** You chose between two reasonable alternatives and someone will later ask "why didn't we do X instead?"

```markdown
---
title: PostgreSQL over MongoDB for task storage
status: accepted
date: 2026-03-15
---

# 001 — PostgreSQL over MongoDB for Task Storage

# Context
Tasks have relational structure (projects → tasks → comments → attachments).
Workflow transitions are transactional (move task + update counters + log event).

# Decision
Use PostgreSQL with JSONB columns for flexible metadata.

# Alternatives Considered
- **MongoDB**: Better for unstructured data, but task relationships are relational.
  Transactions across collections are complex and slower.
- **SQLite**: Simpler, but doesn't support concurrent writers for multi-worker deployment.

# Consequences
- Need schema migrations for structural changes.
- JSONB gives flexibility for custom fields without schema changes.
- Transactions are straightforward with `BEGIN/COMMIT`.
```

### Frontend Patterns

Frontend code presents a unique FCA question: it shares domain knowledge with the backend (types, validation, constants) but runs in a different runtime (browser vs server) with different constraints (no filesystem, no database, different security model). Three patterns exist, each appropriate at different scales and with different trade-offs.

#### Pattern A: Shared Types, Separate Frontend Package

The frontend is its own L3 component. It imports shared types and validation schemas from a lower-layer types package but defines its own UI components, API clients, and state management. Frontend and backend are separate packages with separate builds.

**When:** Most projects. The frontend has its own deployment (CDN, static hosting), its own build tooling (Vite, webpack), and its own framework (React, Vue, Svelte). The runtime boundary between browser and Node is real and significant.

```
packages/
  types/                # Shared: types, Zod schemas, domain constants
  core/                 # Server: pure domain logic
  api/                  # Server: HTTP routes + port implementations
  frontend/             # Client: React SPA, imports from @taskflow/types only
    source/
      tasks/            # Mirrors backend task domain
        task-list.tsx
        task-api.ts     # HTTP client for /api/tasks
      workflows/        # Mirrors backend workflow domain
        workflow-editor.tsx
        workflow-api.ts
```

**Key rule:** the frontend mirrors the backend domain structure internally. It organizes by domain (`tasks/`, `workflows/`), not by artifact type (`components/`, `hooks/`, `pages/`). Each frontend domain is an L2 component whose vocabulary matches the corresponding backend domain.

**Co-location achieved through:** shared types package. Validation schemas, enums, and constants are written once and imported by both runtimes.

```typescript
// In @taskflow/types — shared between server and client
export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(200),
  priority: z.enum(['low', 'medium', 'high']),
  projectId: z.string().uuid(),
});

// Server uses it for request validation
app.post('/tasks', (req) => { const input = CreateTaskSchema.parse(req.body); ... });

// Client uses it for form validation
const form = useForm({ resolver: zodResolver(CreateTaskSchema) });
```

#### Pattern B: Domain-Co-located UI Artifacts

UI components live inside the backend domain directory alongside server code. Build tools separate for deployment — the server build strips `*.ui.tsx`, the client build strips server-only `*.ts`.

**When:** Full-stack TypeScript teams where the same developer works on both server and client for a domain. Frameworks like Remix or Next.js app router encourage this pattern natively. Requires build tooling that can split by file convention.

```
packages/core/source/tasks/
  task-transitions.ts           # Server: pure state machine
  task-transitions.test.ts      # Server: unit verification
  task-transitions.schema.ts    # Shared: Zod validation (both runtimes)
  task-transitions.ui.tsx        # Client: React component showing transitions
  task-transitions.ui.test.tsx   # Client: component test
  README.md
```

Build separation:
- `build:server` → includes `*.ts`, excludes `*.ui.tsx`
- `build:client` → includes `*.ui.tsx` + `*.schema.ts`, excludes server-only code
- `build:test` → includes everything

**Co-location achieved through:** file naming conventions. All artifacts of the task-transitions concept — server logic, client UI, shared validation, tests for both — live in one directory. A developer changing the state machine immediately sees the UI that renders it.

**Trade-off:** Requires custom build tooling. Not standard in the TypeScript ecosystem today (unlike Rust's `#[cfg(test)]` which is built into the compiler).

#### Pattern C: Framework-Mediated Full-Stack

The framework itself manages the server/client split within a single file or route module. Server functions and client components coexist in the same module, and the framework's compiler separates them.

**When:** Using Remix, Next.js app router, SolidStart, or similar full-stack frameworks that provide built-in server/client boundary management.

```typescript
// Remix route module — server and client in one file
// The framework strips server code from the client bundle automatically

export async function loader({ params }: LoaderArgs) {
  // Runs on server only
  const task = await db.query('SELECT * FROM tasks WHERE id = $1', [params.id]);
  return json(task);
}

export default function TaskDetail() {
  // Runs on client only
  const task = useLoaderData<typeof loader>();
  return <div>{task.title} — {task.state}</div>;
}
```

**Co-location achieved through:** the framework. No custom build tooling needed — the framework's compiler knows which code runs where.

**Trade-off:** Couples to a specific framework. The domain logic is not independently composable outside the framework context.

#### Choosing a frontend pattern

| Factor | Pattern A (Separate Package) | Pattern B (Co-located UI) | Pattern C (Framework Full-Stack) |
|--------|----------------------------|--------------------------|--------------------------------|
| **Team structure** | Separate frontend/backend teams | Full-stack developers | Full-stack developers |
| **Build complexity** | Standard (Vite + tsc) | Custom plugins needed | Framework-provided |
| **Domain coherence** | Shared types, mirrored structure | Maximum — one directory per concept | Maximum — one file per route |
| **Runtime safety** | Strong — separate packages can't accidentally share | Requires discipline — build tool enforces | Strong — framework enforces |
| **Framework coupling** | None | None | High (Remix, Next.js, etc.) |
| **Reuse across clients** | Easy — multiple frontends import same types | Harder — UI tied to domain directory | Hardest — tied to framework |
| **Recommended for** | Most projects, API-first design | Monorepo full-stack TypeScript | Framework-native full-stack apps |

The patterns are not mutually exclusive. A project can use Pattern A at L3 (separate frontend package) while using Pattern B at L2 (co-located `*.schema.ts` files in domain directories). The shared types package from Pattern A is valuable regardless of which UI pattern is chosen.

### Choosing Technology by Level

| Concern | L0-L2 (Domain) | L3 (Package) | L4 (Service) |
|---------|----------------|-------------|-------------|
| **Language** | TypeScript strict, pure functions | TypeScript strict | TypeScript, framework-specific |
| **Effect system** | Effect library (optional but recommended) | Effect for port-heavy packages | Plain async/await for route handlers |
| **Validation** | Algebraic data types, branded types | Zod schemas at package boundaries | Zod for HTTP request parsing |
| **Verification** | Node test runner, co-located `*.test.ts` | Testkit package (builders + assertions) | Contract tests, integration tests |
| **Observability** | `*.metrics.ts` definitions | Exported event streams | OpenTelemetry + Prometheus + Grafana |
| **Configuration** | Hardcoded defaults, minimal config | Zod schema per domain | Environment variables + Zod schema |
| **Documentation** | JSDoc + README per directory | `documentation/` with guides + decisions | API docs (OpenAPI), deployment guides |
| **Error handling** | Return types (`Result<T, E>`, `Effect<A, E, R>`) | Typed error hierarchies | HTTP status codes + error response schemas |

---

