# @methodts/mcp — MCP Protocol Adapter

L3 package. Thin MCP (Model Context Protocol) server that exposes `@methodts/methodts` methodology tools and `@methodts/fca-index` context tools to Claude agents via the standard MCP stdio transport.

## Purpose

Bridges Claude agents to the method runtime. An agent with this MCP server configured can:
- List and load formal methodology steps (`methodology_list`, `methodology_load`, `methodology_step`)
- Execute methodology steps with structured output validation
- Look up formal theory definitions (`theory_lookup`)
- Query the FCA index for relevant code components (`context_query`, `context_detail`)
- Check FCA documentation coverage (`coverage_check`)
- Control bridge sessions, run experiments, and orchestrate sub-agents

## Tools Exposed

| Tool | Domain | Description |
|------|--------|-------------|
| `methodology_list` | methodts | List all installed methodologies and methods |
| `methodology_load` | methodts | Activate a method in the session |
| `methodology_step` | methodts | Execute next step of the active method |
| `methodology_status` | methodts | Current method progress and state |
| `theory_lookup` | theory | Look up formal theory definitions from F1-FTH/F4-PHI |
| `context_query` | fca-index | Semantic search over FCA-indexed components |
| `context_detail` | fca-index | Full interface + docText for a specific component path |
| `coverage_check` | fca-index | FCA documentation coverage report for the project |
| `bridge_*` | bridge | Session management, project listing, PTY control |
| `experiment_*` | experiments | Cognitive experiment lab access |

## Key Design Rule (DR-04)

MCP handlers are thin wrappers only: parse input → call port → format output. No domain logic in handlers. All business logic lives in `@methodts/methodts`, `@methodts/fca-index`, or `@methodts/bridge`.

## FCA Index Integration

Tools `context_query`, `context_detail`, and `coverage_check` are only registered when `VOYAGE_API_KEY` is set in the environment. Without the key, the server starts normally but omits those tools. Index is lazily initialized at startup via `createDefaultFcaIndex`.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `METHOD_ROOT` | No | Project root for theory lookup and FCA index. Defaults to `cwd()`. |
| `BRIDGE_URL` | No | Bridge server URL. Defaults to `http://localhost:3456`. |
| `VOYAGE_API_KEY` | No | Enables FCA index tools. Without it, context_query/detail/coverage are hidden. |
| `BRIDGE_TIMEOUT_MS` | No | Bridge request timeout in ms. Defaults to 30000. |

## Security

Project isolation validation (F-SECUR-003) runs on every tool call via `createValidationMiddleware`. Requests that would access files outside the authorized project root are denied before reaching any handler.
