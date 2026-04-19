# testkit/runners/ — Test Execution Harnesses

Structured test harnesses for running methods, steps, and scenarios in a controlled test context. Harnesses capture all runtime events and provide typed access to results.

| File | Harness | Description |
|------|---------|-------------|
| `method-harness.ts` | `MethodHarness` | Runs a `Method<S>` with a mock provider; captures step outputs, gate results, events |
| `step-harness.ts` | `StepHarness` | Runs a single `Step<S>` with configurable mock provider response |
| `scenario.ts` | `ScenarioRunner` | Table-driven testing: runs multiple input/expected-output pairs against a method |

## Usage

```typescript
import { MethodHarness } from '@methodts/methodts/testkit';

const harness = new MethodHarness(myMethod, { provider: mockProvider });
const result = await harness.run({ initialState: buildWorldState() });

expect(result.completedSteps).toHaveLength(3);
expect(result.finalState.output).toBe('expected output');
```
