# ports/ — Pacta Port Interfaces

Port interfaces that isolate `@method/pacta` from external infrastructure. All external dependencies (LLM providers, embeddings, memory persistence, rate governors) enter through these interfaces.

## Ports

| Port | Description |
|------|-------------|
| `AgentProvider` | Core provider interface: `run(pact) → Promise<AgentResult>`. Also: `Streamable`, `Resumable`, `Killable`, `Lifecycle` mixins |
| `MemoryPort` | Read/write interface for agent working memory |
| `MemoryPersistence` | Durability interface — persists memory to disk/DB |
| `AttentionPort` | Attention mechanism port — filters context window contents |
| `EmbeddingPort` | Text embedding interface — used by memory retrieval |
| `RateGovernor` | Rate limiting port — consulted before each provider call |
| `ToolProvider` | Provides tool definitions to the agent at call time |
| `VoyageEmbedding` | `VoyageEmbeddingClient` implementation of `EmbeddingPort` |

## Design

Ports are the `pacta` package's external API surface. Provider implementations (`pacta-provider-*`) implement `AgentProvider`. Infrastructure adapters implement the other ports. All are injected at the composition root — no domain code imports concrete implementations.
