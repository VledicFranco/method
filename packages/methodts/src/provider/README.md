# provider/ — Agent Provider Implementations

Concrete `AgentProvider` implementations that dispatch methodology step prompts to LLM agents. Each provider handles a different execution backend.

## Components

| Component | Description |
|-----------|-------------|
| `AgentProvider` | Port interface — `run(commission) → Promise<AgentResult>` |
| `MockProvider` | In-memory provider for tests — returns configured stub responses |
| `BridgeProvider` | Dispatches to the bridge HTTP server — used for production methodology execution |
| `SpawnClaude` | Spawns a `claude` subprocess for headless agent execution |
| `ClaudeHeadless` | Wraps `claude` CLI with session management and output parsing |
| `StructuredProvider` | Wraps any provider with Zod-based output validation and retry |

## Design

Providers are injected into the runtime via `RunMethodologyOptions.provider`. The runtime has no knowledge of which provider is used — it only calls `AgentProvider.run()`. This allows swapping between mock (tests), bridge (production), or spawn (batch/headless) without changing methodology definitions.

`StructuredProvider` wraps any provider and adds:
1. Output parsing against a Zod schema
2. Automatic retry with structured feedback if parsing fails
3. Evidence collection for gate evaluation
