# @method/pacta — Modular Agent SDK

L3 library. Composable agent execution framework with pluggable LLM providers, middleware pipeline, and cognitive composition engine. Used by the bridge for running structured agent sessions.

## Purpose

Provides the execution layer for running LLM agents with:
- **Providers** — swap Claude CLI, Anthropic API, or Ollama without changing agent logic
- **Middleware** — intercept agent calls (logging, rate limiting, retry, cost tracking)
- **Pacts** — typed contracts between agent caller and agent executor
- **Cognitive composition** — algebra of cognitive modules (operational, task, constraint partitions)
- **Reasoning** — step-by-step reasoning chains with intermediate state

## Key Modules

| Module | Description |
|--------|-------------|
| `src/agents/` | High-level agent runner — coordinates provider + middleware + pact lifecycle |
| `src/middleware/` | Composable middleware pipeline (logging, retry, rate limiting) |
| `src/ports/` | Provider interface + pact types (ProviderPort, PactPort) |
| `src/cognitive/` | Cognitive composition engine: algebra, modules, partitions, presets, engine |
| `src/reasoning/` | Step-by-step reasoning chains with world state threading |
| `src/context/` | Context window management and budget tracking |
| `src/engine/` | Execution engine: runs pacts against providers through middleware |
| `src/config/` | Configuration schema for all pacta components |

## Providers (separate packages)

- `@method/pacta-provider-anthropic` — Anthropic API (claude-opus, claude-sonnet)
- `@method/pacta-provider-claude-cli` — Claude Code CLI subprocess
- `@method/pacta-provider-ollama` — Local Ollama server
