# context/ — Context Window Management

Context budget tracking and management utilities for LLM agent calls. Manages the finite context window: compacts old content, tracks budget utilization, and delegates sub-tasks to new agent instances when the window is nearing capacity.

## Components

| Component | Description |
|-----------|-------------|
| `compactionManager()` | Middleware that monitors context size and triggers compaction when threshold exceeded |
| `ContextMiddleware` | Middleware type for context-aware provider wrappers |
| `ContextPolicy` | Configuration: compaction threshold, max context tokens, compaction strategy |
| `NoteTakingManager` | Extracts key facts from completed steps and stores them as compact notes |
| `SubagentDelegator` | Delegates remaining work to a fresh sub-agent when context exhausted |
| `SystemPromptBudgetTracker` | Tracks system prompt token usage separately from conversation tokens |
| `ContextManager` | Pluggable context management strategies (compaction, delegation, truncation) |

## Context Budget Model

Context is modeled as a budget with configurable limits:
- `systemPromptBudget`: reserved for system prompt (not compacted)
- `conversationBudget`: available for conversation history
- `compactionThreshold`: triggers compaction at % of budget used (default: 80%)

When threshold is crossed, `compactionManager` invokes the configured strategy (summarize, truncate, delegate).
