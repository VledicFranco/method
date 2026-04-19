# mcp/ — Standalone MCP Server

Composition root that exposes the three fca-index context tools over MCP
stdio — independent of `@methodts/mcp`.

## Role in the FCA

This is a **composition root** (same layer as `cli/`), not a domain.
It wires the frozen fca-index ports into a transport. It imports from:

- `ports/context-query.ts` — `ContextQueryPort`
- `ports/coverage-report.ts` — `CoverageReportPort`
- `ports/component-detail.ts` — `ComponentDetailPort`
- `factory.ts` — `createDefaultFcaIndex`

It does **not** import from `scanner/`, `index-store/`, `query/`, `coverage/`,
`compliance/`, or `cli/`. Enforced by **G-BOUNDARY-MCP** in `architecture.test.ts`.

## What it registers

Three MCP tools, matching their counterparts in `@methodts/mcp` but free of any
coupling to methodology/bridge/strategy/experiment concerns:

| Tool | Port | Purpose |
|------|------|---------|
| `context_query` | `ContextQueryPort` | Ranked semantic search over the FCA index |
| `context_detail` | `ComponentDetailPort` | Full detail for a single component by path |
| `coverage_check` | `CoverageReportPort` | Coverage report + mode (discovery/production) |

Output rendering uses the per-rank budget from PRD 053 SC-1 (council 2026-04-12):
top-1 gets ~350 chars per part (1,400 total) with multi-line `|` prefix; other
results stay at ~120 chars single-line `>` prefix.

## Files

- `server.ts` — stdio MCP entry point. Wires `createDefaultFcaIndex` + 3 tool
  handlers + `StdioServerTransport`. Fail-fast on missing `VOYAGE_API_KEY`.
- `formatters.ts` — pure rendering functions (`formatContextQueryResult`,
  `formatComponentDetail`, `formatCoverageReport`). No ports, no state.
- `formatters.test.ts` — unit tests for the three formatters.

## Usage

As a standalone binary via `npx`:

```json
// .mcp.json in the consumer's project
{
  "mcpServers": {
    "fca-index": {
      "command": "npx",
      "args": ["fca-index-mcp"],
      "env": { "VOYAGE_API_KEY": "..." }
    }
  }
}
```

Or as a programmatic import (e.g., to compose with additional middleware):

```typescript
import '@methodts/fca-index/mcp';
```

The server reads configuration from env:

| Var | Purpose | Default |
|-----|---------|---------|
| `VOYAGE_API_KEY` | Voyage AI API key for embeddings | **required** |
| `FCA_INDEX_ROOT` | Project root to serve | `process.cwd()` |

## Permissions (Claude Code)

Claude Code in print mode (non-interactive) requires MCP tool invocations to be
pre-approved via `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__fca-index__*"
    ]
  }
}
```

Without this, tool invocations are denied even when `context_query` is
discoverable via `ToolSearch`. This is a Claude Code behaviour, not an
fca-index constraint — documented here because it affects adoption.

## Relationship to `@methodts/mcp`

`@methodts/mcp` still exposes the same three tools via its own copy of the
formatters. This standalone server duplicates the rendering logic
intentionally, to keep the two composition roots independent. When a future
change benefits from unifying them, `@methodts/mcp` can import from
`@methodts/fca-index/mcp`. Until then, keep the two copies in sync for the
formatter rendering contract.

## Observability

Uses the package's `ObservabilityPort` (defined in
`ports/observability.ts`). The default `StderrObservabilitySink` emits one
structured JSON line per query to stderr — compatible with `grep`/`jq`
pipelines:

```
[fca-index.query] {"event":"done","ts":"...","top1_path":"...","duration_ms":333}
```

See `ports/observability.ts` and `cli/stderr-observability-sink.ts` for details.
