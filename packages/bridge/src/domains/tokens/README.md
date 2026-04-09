# tokens/ — Token Usage Tracking Domain

Tracks LLM token consumption across all bridge sessions and exposes usage data for cost governance, budget enforcement, and subscription polling.

## Purpose

Every agent session burns tokens. This domain maintains a running log of token usage per session, project, and time window. Feeds into the cost-governor domain for rate limiting and into the MCP server for usage reporting.

## Responsibilities

- Record token usage events emitted by bridge sessions (prompt + completion tokens, model, cost estimate)
- Aggregate usage by session, project, and time window
- Poll subscription status and enforce token budgets
- Expose usage stats via bridge HTTP routes
