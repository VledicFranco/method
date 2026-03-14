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

## Post-MVP

When DAG traversal is added, `advance()` will need to accept a branch selector or evaluate preconditions to determine the next step. The factory API stays the same; the internal logic changes.
