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

### `priorStepOutputs` — Phase 1 Limitation

In Phase 1, `priorStepOutputs` always returns an empty array (`[]`). The session does not currently track step outputs — there is no mechanism to record what an agent produced at each step.

Phase 3's `step_validate` tool will add output recording to the session. Once outputs are recorded, `context()` will return them as prior step summaries. The `StepContext` type includes `priorStepOutputs` from the start so the response shape is stable across phases — consumers never see a field appear or disappear.

### Error Cases

- No methodology loaded: `"No methodology loaded"` (same guard as `current()`)

### Design Note

`context()` reads the same internal state as `current()` and `status()`. It is intentionally a superset — an agent that calls `step_context` does not need to also call `step_current` or `methodology_status`. The three methods coexist because `step_current` and `methodology_status` are established tools with existing consumers; `step_context` is additive, not a replacement.

## Post-MVP

When DAG traversal is added, `advance()` will need to accept a branch selector or evaluate preconditions to determine the next step. The factory API stays the same; the internal logic changes.
