# testkit/diagnostics/ — Execution Trace Inspection

Formatting utilities for test output and debugging. Converts execution traces and reports into human-readable strings for test failure messages.

| File | Description |
|------|-------------|
| `report-printer.ts` | Formats gate suite results and coverage reports as readable strings |
| `trace-printer.ts` | Prints step-by-step execution traces with world state diffs between steps |

## Usage

```typescript
import { printTrace, printReport } from '@method/methodts/testkit';

// In test failure output:
const result = await runMethodologyInTest(methodology, options);
if (!result.succeeded) {
  console.log(printTrace(result.trace));
}
```
