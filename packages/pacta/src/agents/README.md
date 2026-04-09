# agents/ — Pre-Built Reference Agents

Ready-to-use agent configurations for common LLM tasks. Each reference agent is a pre-assembled `ReferenceAgent` with sensible defaults — customizable via `.with()` overrides without needing to build a full pact from scratch.

## Agents

| Agent | Description |
|-------|-------------|
| `codeAgent` | Code generation and modification — structured output, tool access enabled |
| `researchAgent` | Multi-step research and synthesis — web search, document retrieval |
| `reviewAgent` | Code and document review — analytical reasoning, structured critique output |

## Usage

```typescript
import { codeAgent } from '@method/pacta/agents';

const result = await codeAgent
  .with({ maxTokens: 4096 })
  .run(provider, { task: 'Refactor this function...' });
```

## Design

Reference agents are constructed via `createReferenceAgent()` which wires a pact definition, middleware chain, and default config. The `.with()` method returns a new agent with overrides applied — all agents are immutable and safe to share across requests.
