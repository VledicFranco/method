# testkit/ — Methodology Testing Framework

Testing utilities for `@methodts/methodts`. Provides builders, assertions, runners, and diagnostics for writing unit and integration tests against methodology definitions.

## Subdirectories

| Dir | Description |
|-----|-------------|
| `assertions/` | Custom assertion functions: `assertGatePassed()`, `assertStepOutputMatches()`, etc. |
| `builders/` | Test builders for methods, steps, methodologies, and domain facts |
| `diagnostics/` | Diagnostic utilities: trace inspection, gate failure analysis, world state diff |
| `runners/` | Test execution helpers: `runMethodologyInTest()`, `runStepInTest()` with mock providers |
| `provider/` | Mock agent provider: returns configured stub responses, records calls |

## Usage

```typescript
import { buildMethod, runMethodologyInTest, assertGatePassed } from '@methodts/methodts/testkit';

const method = buildMethod({ name: 'test', steps: [...] });
const result = await runMethodologyInTest(method, { worldState: { ... } });
assertGatePassed(result, 'quality-gate');
```
