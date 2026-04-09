# engine/ — Agent Execution Engine

Core `Agent<TOutput>` type and `createAgent()` factory. Wires a pact definition with a middleware chain and provider to produce a runnable, typed agent.

## Components

| Component | Description |
|-----------|-------------|
| `createAgent()` | Factory — wires pact + middleware + provider capabilities check into `Agent<T>` |
| `Agent<TOutput>` | Runnable agent interface: `run(provider, input) → Promise<TOutput>` |
| `AgentState` | Per-run execution state (messages, tool calls, output) |
| `CreateAgentOptions<TOutput>` | Factory options: pact, output schema, middleware, config |
| `CapabilityError` | Thrown when the provider lacks required capabilities for the pact |

## Usage

```typescript
import { createAgent } from '@method/pacta/engine';

const agent = createAgent({
  pact: myPact,
  outputSchema: z.object({ result: z.string() }),
  middleware: [budgetEnforcer({ maxTokens: 10_000 })],
});

const output = await agent.run(provider, { task: 'Summarize this...' });
```

The factory checks that the provider declares all capabilities required by the pact (streaming, tool use, resumability) and throws `CapabilityError` immediately if there's a mismatch — failing fast before any API call is made.
