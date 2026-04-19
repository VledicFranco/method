# gate/runners/ — Gate Runner Implementations

Concrete `Gate<S>` implementations for common verification patterns. Each runner wraps an external check (shell command, HTTP endpoint, checklist, test suite) in the gate interface.

## Runners

| Runner | Description |
|--------|-------------|
| `scriptGate` | Runs a shell command; passes if exit code 0. Fast, general-purpose. |
| `testRunner` | Runs the project's test suite (`npm test`, `cargo test`, etc.); passes if all tests pass |
| `httpChecker` | Sends an HTTP request; passes if response is 2xx. Used for service health checks. |
| `checklistGate` | Human-in-the-loop checklist; renders attestation prompts and waits for agent confirmation |
| `callbackGate` | Arbitrary async callback — used for custom gate logic not covered by other runners |

## Usage

Runners are constructed as gate instances and registered in a `GateSuite<S>`:

```typescript
import { scriptGate, testRunner } from '@methodts/methodts';

const suite: GateSuite<S> = {
  pre: [scriptGate({ command: 'npm run lint' })],
  post: [testRunner({ command: 'npm test' })],
};
```

All runners respect the retry/timeout configuration from `GateSuite` and report structured `GateError` evidence on failure.
