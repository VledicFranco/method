# commission/ — Agent Commission Builder

Typed commission construction: wraps an agent task specification with execution parameters (provider, retries, timeout, bridge params) and renders it into a structured prompt for an `AgentProvider`.

## Components

| Component | Description |
|-----------|-------------|
| `commission()` | Builder function — creates a `Commission<A>` from a task spec and config |
| `batchCommission()` | Runs multiple commissions in parallel and collects typed results |
| `templates.ts` | Prompt rendering helpers — formats commission specs into structured LLM prompts |

## Key Types

| Type | Description |
|------|-------------|
| `Commission<A>` | A fully-specified agent task with typed output `A` |
| `CommissionMetadata` | Metadata attached to a commission execution (timestamps, retries used) |
| `BridgeParams` | Parameters for bridge-backed execution (session scope, tool access) |

## Usage

Commissions are the primary unit of work dispatched to agent providers. A commission specifies what to do (task prompt), how to do it (provider config, tool access), and what to return (typed output schema via Zod).
