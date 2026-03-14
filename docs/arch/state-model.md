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

## Post-MVP

When DAG traversal is added, `advance()` will need to accept a branch selector or evaluate preconditions to determine the next step. The factory API stays the same; the internal logic changes.
