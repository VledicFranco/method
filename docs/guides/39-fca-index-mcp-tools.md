---
guide: 39
title: "fca-index: MCP Context Tools"
domain: fca-index/mcp
audience:
  - agent-operators
summary: >-
  Using context_query, context_detail, and coverage_check MCP tools for efficient context gathering. Two deployment options: bundled in @method/mcp or standalone via fca-index-mcp.
prereqs: [38]
touches:
  - packages/mcp/src/context-tools.ts
  - packages/fca-index/src/mcp/server.ts
  - packages/fca-index/src/mcp/formatters.ts
  - packages/fca-index/src/ports/context-query.ts
  - packages/fca-index/src/ports/coverage-report.ts
  - packages/fca-index/src/ports/component-detail.ts
---

# Guide 39 — fca-index: MCP Context Tools

## What are the context tools?

Three MCP tools expose the `@method/fca-index` ports to agents:

| Tool | Port | What it does |
|------|------|-------------|
| `context_query` | `ContextQueryPort` | Semantic search over the FCA index. Returns ranked component descriptors. |
| `context_detail` | `ComponentDetailPort` | Full detail (parts + full docText up to 2KB) for a single component by path. |
| `coverage_check` | `CoverageReportPort` | Coverage summary + mode (discovery/production). Tells you how much to trust the index. |

These replace the grep-file-read loop. Instead of reading 20+ files to find the right one, an agent calls `context_query`, gets a ranked list of 3–5 component paths, and either calls `context_detail` on the top result or reads the specific files it needs.

The top-1 result is rendered with expanded excerpts (up to 350 chars per FCA part, 1,400 total) so an agent can often act on it without any follow-up reads at all.

## Two deployment options

### Option A — bundled in `@method/mcp` (method-internal)

For projects running the full method server (methodology + bridge + strategies + fca-index tools), the context tools are already registered when `VOYAGE_API_KEY` is set. No extra setup needed beyond what Guide 38 covers.

### Option B — standalone `fca-index-mcp` (recommended for external projects)

For projects that only want the FCA index tools and don't need methodology/bridge/strategy surfaces, use the standalone MCP server bundled with `@method/fca-index`:

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

The standalone server exposes the same three tools with identical schemas and rendering. Choose based on which other tools you want alongside.

## Setup

Two requirements before the tools are active:

**1. Index must exist.** Run `fca-index scan` on the project first:

```bash
export VOYAGE_API_KEY=your_key
fca-index scan /path/to/project
```

**2. `VOYAGE_API_KEY` must be set** in the environment where the MCP server runs. The tools are gracefully absent when the key is not set (in `@method/mcp`) or the server fails fast with a clear error (in standalone `fca-index-mcp`).

For `@method/mcp`, the `METHOD_ROOT` environment variable is used as the default `projectRoot`. For `fca-index-mcp`, use `FCA_INDEX_ROOT` (defaults to the cwd).

## Permissions for print-mode agents (Claude Code)

Spawned Claude Code agents in print mode (non-interactive) require MCP tool invocations to be **pre-approved** via `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__method__*",
      "mcp__fca-index__*"
    ]
  }
}
```

Without this, invocations are denied even with `--permission-mode bypassPermissions` or `--dangerously-skip-permissions`. This is a Claude Code behaviour. Include both wildcards in projects that use the method bridge to spawn sub-agents.

## context_query

Queries the semantic index and returns ranked component descriptors.

### Input parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | `string` | yes | — | Natural-language description of the code or concept needed |
| `topK` | `number` | no | `5` | Maximum number of results |
| `parts` | `string[]` | no | all parts | Filter to specific FCA parts: `interface`, `port`, `domain`, `verification`, `observability`, `documentation`, `architecture`, `boundary` |
| `levels` | `string[]` | no | all levels | Filter to specific FCA levels: `L0`, `L1`, `L2`, `L3`, `L4`, `L5` |
| `minCoverageScore` | `number` | no | none | Exclude components below this coverage score (0–1) |

### Example call

```json
{
  "name": "context_query",
  "arguments": {
    "query": "session lifecycle and PTY management",
    "topK": 3,
    "parts": ["port", "interface"]
  }
}
```

### Example response

```
[mode: production]
[3 results for "session lifecycle and PTY management"]

1. src/domains/sessions/ (L2) — relevance: 0.94, coverage: 0.89
   port: src/domains/sessions/ports.ts
     > export interface SessionPort { create(config: SessionConfig): Promise<Session> ...
   interface: src/domains/sessions/index.ts
     > export type { Session, SessionConfig, SessionState } from './types.js'

2. src/domains/sessions/session-pool.ts (L1) — relevance: 0.81, coverage: 0.75
   interface: src/domains/sessions/session-pool.ts
     > export class SessionPool implements SessionPoolPort { ...

3. src/ports/pty.ts (L1) — relevance: 0.73, coverage: 0.92
   port: src/ports/pty.ts
     > export interface PtyPort { spawn(command: string, ...
```

Each result shows:
- Path relative to the project root
- FCA level
- Relevance score (semantic similarity to the query, 0–1)
- Coverage score (documentation completeness, 0–1)
- Each detected FCA part with its file path and a brief excerpt

## context_detail

Returns full detail for a single indexed component — all FCA parts with file
locations and excerpts (up to 300 chars each), plus the full concatenated
`docText` (up to 2KB) that was used for embedding. Use this after
`context_query` to get complete context on a specific component without
reading its source files.

### Input parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | `string` | yes | — | Component path relative to projectRoot (e.g. `src/domains/sessions`) |
| `projectRoot` | `string` | no | `METHOD_ROOT` / `FCA_INDEX_ROOT` / cwd | Absolute path to the project root |

### Example response

```
path: src/domains/sessions
level: L2
indexedAt: 2026-04-13T01:56:12.760Z

parts:
  port: src/domains/sessions/ports.ts
    > /**
     * Session lifecycle port — create, advance, terminate PTY sessions.
     * ...
  interface: src/domains/sessions/index.ts
    > export type { Session, SessionConfig } from './types.js'
  documentation: src/domains/sessions/README.md
    > # sessions/ — PTY Session Lifecycle

docText:
# sessions/ — PTY Session Lifecycle
Manages the lifecycle of PTY-backed Claude Code subprocesses...
(up to 2KB of concatenated indexed text)
```

**When to use it:** prefer `context_detail` over `Read` on the component's
source files when you want structural context. It returns the documentation
that was actually used for the query embedding, not raw source.

## coverage_check

Returns a coverage summary and tells you whether the index is in discovery or production mode.

### Input parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `projectRoot` | `string` | no | `METHOD_ROOT` env var | Absolute path to the project root |
| `verbose` | `boolean` | no | `false` | Include per-component breakdown (lowest coverage first) |

### Example response

```
[mode: discovery]
Coverage: 0.72 / threshold 0.80  ✗

By part:
  documentation    0.91 ██████████████████░░
  interface        0.87 █████████████████░░░
  port             0.34 ██████░░░░░░░░░░░░░░
  verification     0.28 █████░░░░░░░░░░░░░░░
  observability    0.21 ████░░░░░░░░░░░░░░░░
  architecture     0.61 ████████████░░░░░░░░
  domain           0.79 ███████████████░░░░░
  boundary         0.45 █████████░░░░░░░░░░░

Components: 42 total | 18 fully documented | 17 partial | 7 undocumented
```

A `✓` next to the coverage score means the index is in production mode. A `✗` means discovery mode.

## Typical agent workflow

```
1. coverage_check
   → Check mode before trusting results
   → Skip this step on repeat visits if production mode is already known

2. context_query  (query: "what I'm looking for")
   → Get 3–5 ranked component paths
   → The top-1 result has expanded excerpts (up to 1,400 chars total)
     — often enough to act on without any further reads

3. If you need more than the top-1's expanded excerpt:
   - Call context_detail on a specific component for full indexed docs
     (cheaper than opening source files)
   - Only open source files with Read when you need to see implementation
     beyond what the index captured
```

If the top-1 result's rendered excerpt is enough to answer the question, stop
there. This is the single biggest token saving — the whole tool was designed
to let you skip source reads when the index has what you need.

## When the index doesn't exist

If `fca-index scan` has not been run, both tools return an error message rather than throwing:

```
[error: INDEX_NOT_FOUND]
Run 'fca-index scan <projectRoot>' to build the index.
```

**To fix:** Run `fca-index scan /path/to/project` with `VOYAGE_API_KEY` set, then retry.

## Discovery mode vs production mode

| | Discovery mode | Production mode |
|-|---------------|----------------|
| **Condition** | `overallScore < threshold` | `overallScore >= threshold` |
| **What it means** | Index covers a fraction of components | Index covers the full codebase |
| **Trust level** | Partial — may miss undocumented components | High — results represent the full component space |
| **Agent behavior** | Use results as leads, not conclusions. Supplement with file exploration for coverage gaps. | Use results as the primary context source. |
| **Improving it** | Add missing docs (port interfaces, READMEs), re-scan | Maintain docs as code changes, re-scan on significant changes |

Discovery mode does not mean the index is wrong — it means some components weren't documented enough to be indexed. Query results for well-documented components in discovery mode are still reliable.

## Tips for effective queries

**Natural language beats file paths.** The index is semantic. Write what you're looking for conceptually:

```
# Good
"rate limiting and request throttling"
"how authentication tokens are validated"
"the interface for spawning PTY sessions"

# Less effective
"rate-limiter.ts"
"auth"
"pty"
```

**Use `parts` for targeted search.** If you need to understand an API rather than an implementation, filter to `port` and `interface`:

```json
{ "query": "session management", "parts": ["port", "interface"] }
```

If you're looking for test coverage or verification patterns, filter to `verification`:

```json
{ "query": "session management", "parts": ["verification"] }
```

**Use `minCoverageScore` in discovery mode.** In discovery mode, filtering to well-documented components gives more reliable results:

```json
{ "query": "session management", "minCoverageScore": 0.7 }
```

**Adjust `topK` for the task.** For a focused implementation task, 3 results is usually enough. For architecture exploration, request 8–10 to get a broader map.
