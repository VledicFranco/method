# State Model

## Decision

Session state is separated into two concerns:

- **`LoadedMethod`** — what's loaded (produced by the loader, immutable after load)
- **`SessionState`** — traversal pointer (mutable, managed by the state module)

## Factory-Based Session

`packages/core/src/state.ts` exports a `createSession()` factory that returns a closure-based session object:

```typescript
export function createSession() {
  let method: LoadedMethod | null = null;
  let currentIndex: number = 0;

  return {
    load(m: LoadedMethod): void,
    current(): Step,
    advance(): { previousStep: string; nextStep: string | null },
    status(): SessionStatus,
    isLoaded(): boolean,
  };
}
```

One instance in production (created at MCP server startup). Fresh instances in tests.

## API Contracts

### `load(method: LoadedMethod): void`
Resets the session. Sets `method` and `currentIndex = 0`. Any previous session is discarded.

### `current(): Step`
Returns `method.steps[currentIndex]`. Throws `"No methodology loaded"` if `method` is null.

### `advance(): { previousStep: string; nextStep: string | null }`
Increments `currentIndex`. Returns the previous step ID and the new current step ID. If the method is already at the terminal step, throws `"Already at terminal step"`. If advancing to the terminal step, returns `nextStep: null` to signal method completion.

### `status(): SessionStatus`
Returns:
```typescript
type SessionStatus = {
  methodologyId: string;
  methodId: string;
  currentStepId: string;
  currentStepName: string;
  stepIndex: number;
  totalSteps: number;
};
```
Throws `"No methodology loaded"` if `method` is null.

### `isLoaded(): boolean`
Returns `method !== null`.

## Rationale

- **Factory over class**: closure captures state without exposing it. No `this` binding issues.
- **Factory over module singleton**: tests can create isolated sessions. Production creates one.
- **Separated LoadedMethod**: the loader doesn't know about traversal. The state module doesn't know about YAML. Clean dependency direction: loader → types ← state.
- **Linear traversal only**: `currentIndex` advances by 1. DAG-aware traversal is post-MVP (PRD explicitly defers branching and loop edges).

## SessionManager (P3 — Multi-Session)

### Design

`SessionManager` is an additive layer above `createSession()`. It manages a `Map<string, Session>` keyed by session ID and provides a single lookup function:

```typescript
export function createSessionManager() {
  const sessions = new Map<string, Session>();

  return {
    getOrCreate(sessionId: string): Session,
  };
}
```

### `getOrCreate(sessionId: string): Session`

If a session with the given ID exists in the map, return it. Otherwise call `createSession()`, store it under the key, and return it.

### Default Session

When the MCP layer receives a tool call with no `session_id` parameter, it passes a well-known key (`"__default__"`) to `getOrCreate`. This means:

- All sessionless calls share one session (same behavior as today's single-instance model)
- Callers that provide an explicit `session_id` get an isolated session
- The default session is not special — it is a normal entry in the map that happens to use a reserved key

### Backwards Compatibility

`createSession()` is unchanged. `SessionManager` composes it — it does not modify or replace it. Existing tests that call `createSession()` directly continue to work. The MCP layer is the only consumer of `SessionManager`; it replaces the single `createSession()` call at startup with `createSessionManager()` and routes each tool call through `getOrCreate`.

### Lifecycle

Sessions are never evicted. For the MCP use case (one Claude desktop session), the map stays small. If session cleanup becomes necessary (e.g., long-running server with many clients), an eviction policy can be added later without changing the `getOrCreate` interface.

## Step Context (PRD 003)

### Purpose

`step_context` provides an enriched snapshot for prompt composition — everything an agent needs to execute the current step without making multiple tool calls. It combines methodology context, method metadata, the full step record, position, and prior step outputs into a single response.

### Function Signature

A new method on the `Session` object returned by `createSession()`:

```typescript
context(): StepContext
```

This lives alongside the existing `current()`, `advance()`, `status()`, and `isLoaded()` methods in `state.ts`. It is a session method (not a standalone function) because it needs access to the loaded method and current index — the same state that `current()` reads.

### Return Type

```typescript
type StepContext = {
  methodology: {
    id: string;
    name: string;
    progress: string;          // e.g., "3 / 7"
  };
  method: {
    id: string;
    name: string;
    objective: string | null;
  };
  step: Step;                  // full step record (same as current().step)
  stepIndex: number;
  totalSteps: number;
  priorStepOutputs: PriorStepOutput[];
};

type PriorStepOutput = {
  stepId: string;
  summary: string;
};
```

### Enrichment Over `current()`

`current()` returns the step record with position context (`stepIndex`, `totalSteps`, `methodologyId`, `methodId`). `context()` adds:

| Field | Source | Value in `current()` |
|---|---|---|
| `methodology.name` | `LoadedMethod.name` | Not included |
| `methodology.progress` | Computed from `stepIndex` and `totalSteps` | Not included |
| `method.objective` | `LoadedMethod.objective` | Not included |
| `priorStepOutputs` | Session output history | Not included |

### `priorStepOutputs` — Phase 3 Enabled

`priorStepOutputs` is populated by the `step_validate` tool (Phase 3). When `validateStepOutput()` is called, it records the output in the session via `session.recordStepOutput(stepId, output)`. The `context()` method then returns entries for all steps before the current step index that have recorded outputs, each with `{ stepId, summary }` where `summary` is the first 200 characters of the JSON-stringified output.

Step outputs are cleared when `load()` is called (new method load) but are preserved across `advance()` calls within the same method.

### Methodology Context Tracking (Phase 3)

The session tracks methodology-level context separately from the loaded method. This solves the Phase 1 limitation where `context().methodology.name` returned the method name instead of the methodology name.

#### `setMethodologyContext(methodologyId: string, methodologyName: string): void`

Sets the methodology context for this session. Called by `selectMethodology()` after loading a method. The methodology context persists across `load()` calls — if the same methodology loads a different method, the methodology name is retained.

When methodology context is set:
- `context().methodology.id` returns the methodology ID from context (not from `LoadedMethod`)
- `context().methodology.name` returns the methodology name from context (not the method name)

When methodology context is not set (backward compatibility):
- `context().methodology.id` falls back to `LoadedMethod.methodologyId`
- `context().methodology.name` falls back to `LoadedMethod.name`

#### `recordStepOutput(stepId: string, output: Record<string, unknown>): void`

Records a step's output in the session. Called by `validateStepOutput()` — always records, even when validation fails. Outputs are stored in a `Map<string, Record<string, unknown>>` keyed by step ID.

#### `getStepOutputs(): Array<{ stepId: string; output: Record<string, unknown> }>`

Returns all recorded step outputs as an array.

### Error Cases

- No methodology loaded: `"No methodology loaded"` (same guard as `current()`)

### Design Note

`context()` reads the same internal state as `current()` and `status()`. It is intentionally a superset — an agent that calls `step_context` does not need to also call `step_current` or `methodology_status`. The three methods coexist because `step_current` and `methodology_status` are established tools with existing consumers; `step_context` is additive, not a replacement.

## MethodologySession (PRD 004)

### Purpose

A methodology-level session that tracks global state across method transitions. This is the superordinate goal context — it persists while individual methods are loaded, executed, and completed within it.

The existing `Session` manages traversal within a single method. `MethodologySession` composes multiple method sessions sequentially, tracking which methods have completed, their outputs, and the global objective status.

### Architecture

```
MethodologySessionManager  →  MethodologySessionData
                                      ↓ (shares session_id)
SessionManager  →  Session (for current method)
```

Both managers use the same `session_id` namespace. Methodology tools (`methodology_start`, `methodology_route`, `methodology_load_method`, `methodology_transition`) operate on `MethodologySessionManager`. Method/step tools (`step_current`, `step_advance`, `step_context`, `step_validate`) continue to operate on `SessionManager` unchanged.

When `methodology_load_method` is called, it loads the method into the `Session` from `SessionManager` for the same session ID. This means existing step tools work transparently within a methodology session — they operate on the current method's Session without knowing about the methodology layer.

### State Model

```typescript
type MethodologySessionData = {
  id: string;
  methodologyId: string;
  methodologyName: string;
  challenge: string | null;
  status: MethodologySessionStatus;
  currentMethodId: string | null;
  completedMethods: CompletedMethodRecord[];
  globalObjectiveStatus: GlobalObjectiveStatus;
  routingInfo: RoutingInfo;   // cached at session creation
};

type MethodologySessionStatus =
  | 'initialized'    // after methodology_start
  | 'routing'        // during methodology_route evaluation
  | 'executing'      // method loaded and being traversed
  | 'transitioning'  // during methodology_transition
  | 'completed'      // δ_Φ returned None — methodology complete
  | 'failed';        // terminal failure

type CompletedMethodRecord = {
  methodId: string;
  completedAt: string;   // ISO timestamp
  stepOutputs: Array<{ stepId: string; outputSummary: string }>;
  completionSummary: string | null;
};
```

### MethodologySessionManager

`packages/core/src/methodology-session.ts` exports a factory that returns a map-based manager:

```typescript
export function createMethodologySessionManager() {
  const sessions = new Map<string, MethodologySessionData>();

  return {
    get(sessionId: string): MethodologySessionData | null,
    set(sessionId: string, session: MethodologySessionData): void,
  };
}
```

Unlike `SessionManager.getOrCreate()`, methodology sessions use explicit `get()`/`set()` because they are created by `startMethodologySession`, not auto-created on first access.

### `startMethodologySession`

Core function in `methodology-session.ts`:

```typescript
export function startMethodologySession(
  registryPath: string,
  methodologyId: string,
  challenge: string | null,
  sessionId: string,
): MethodologyStartResult
```

1. Validates methodology exists via `listMethodologies()`
2. Gets routing info via `getMethodologyRouting()` — cached in session data
3. Reads methodology YAML for objective (top-level `objective.formal`)
4. Creates `MethodologySessionData` with status `"initialized"`
5. Returns `MethodologyStartResult` with methodology metadata + transition function summary

The function does not store the session — it returns the data for the caller to store via `MethodologySessionManager.set()`. This keeps the function pure (side-effect-free) for testability, matching how `selectMethodology` takes a pre-resolved session.

### Session ID Sharing

A methodology session and its contained method sessions share a `session_id`. The session ID is the correlation key:

- `methodology_start({ session_id: "abc" })` → creates `MethodologySessionData` under key `"abc"` in `MethodologySessionManager`
- `methodology_load_method({ session_id: "abc" })` → loads method into `Session` under key `"abc"` in `SessionManager`
- `step_current({ session_id: "abc" })` → reads from `Session` under key `"abc"` — unchanged behavior

When no `session_id` is provided, the MCP layer uses `"__default__"` for both managers (same convention as existing tools).

### Relationship to Existing Constructs

| Construct | Role | Changed by PRD 004? |
|-----------|------|---------------------|
| `Session` | Method-level traversal (load, current, advance, context) | No |
| `SessionManager` | Maps session_id → Session | No |
| `MethodologySessionData` | Methodology-level state (methods completed, global objective) | **New** |
| `MethodologySessionManager` | Maps session_id → MethodologySessionData | **New** |
| `selectMethodology()` | Legacy tool — becomes alias for start + load_method in Phase 3 | Phase 3 |

### Lifecycle

```
methodology_start → status: "initialized"
  ↓
methodology_route → status: "routing" → back to "initialized" (decision recorded)
  ↓
methodology_load_method → status: "executing"
  ↓
(agent traverses method steps via step_current/advance/validate)
  ↓
methodology_transition → status: "transitioning"
  ↓
(re-evaluate δ_Φ) → "executing" (next method) or "completed" (terminal)
```

## Post-MVP

When DAG traversal is added, `advance()` will need to accept a branch selector or evaluate preconditions to determine the next step. The factory API stays the same; the internal logic changes.

## Channels (PRD 008)

### Per-Session Channels

Each bridge session gets a set of named channels. Channels are in-memory, append-only message queues with consumption cursors.

```typescript
type Channel = {
  name: string;              // "progress" or "events"
  messages: ChannelMessage[];
  cursors: Map<string, number>;  // reader_id → last-read sequence
};

type ChannelMessage = {
  sequence: number;          // monotonic per channel
  timestamp: string;         // ISO 8601
  sender: string;            // session identifier
  type: string;              // message type
  content: Record<string, unknown>;
};

type SessionChannels = {
  progress: Channel;
  events: Channel;
};
```

Channels are created automatically on session spawn. No persistence — channels live and die with the session. Capped at 1000 messages per channel; oldest evicted on overflow.

### Channel Types

**Progress channel** — what the agent is doing:
- `step_started` — new methodology step begun
- `step_completed` — step finished
- `working_on` — significant non-step work
- `sub_agent_spawned` — child agent spawned

**Events channel** — lifecycle events:
- `started` — session spawned (auto-generated by bridge)
- `completed` — agent finished all work
- `error` — unrecoverable error
- `escalation` — agent needs human/parent input
- `budget_warning` — approaching budget limits
- `stale` — no activity for TTL period (auto-generated by bridge)
- `killed` — session killed (auto-generated by bridge)

### Consumption Cursor Pattern

Readers track their position via cursors (from conclave's dual-cursor model, using only consumption cursor for MVP). First read uses `since_sequence: 0` for full history. Subsequent reads use `since_sequence: last_sequence` for incremental updates.

### Push Notifications

When a child session publishes an event to its events channel, the bridge checks the parent_session_id. For pushable event types (completed, error, escalation, budget_warning, stale), the bridge auto-sends a formatted notification to the parent session via bridge_prompt. Fire-and-forget — response parsing is not needed.

Events do NOT auto-bubble through multi-level chains. Each parent decides whether to propagate.
