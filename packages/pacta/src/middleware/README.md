# middleware/ — Agent Middleware Pipeline

Composable middleware for intercepting and augmenting agent provider calls. Middleware wraps any `AgentProvider` transparently — the agent doesn't know which middleware is active.

## Components

| Component | Description |
|-----------|-------------|
| `budgetEnforcer()` | Token budget middleware — tracks spend, rejects calls that would exceed the budget |
| `BudgetState` | Current budget state: tokens used, remaining, limit |
| `BudgetExhaustedError` | Thrown when a call would exceed the configured token budget |
| `outputValidator()` | Validates provider output against a Zod schema; retries on parse failure |
| `throttler()` | Rate limiting middleware — queues calls when throughput exceeds configured limits |

## Usage

```typescript
import { budgetEnforcer, throttler } from '@methodts/pacta/middleware';

const provider = throttler({ maxRpm: 60 })(
  budgetEnforcer({ maxTokens: 100_000 })(baseProvider)
);
```

Middleware composes left-to-right: the outermost wrapper is applied first.
