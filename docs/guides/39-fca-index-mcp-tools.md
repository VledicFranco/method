---
guide: 39
title: "fca-index: MCP Context Tools"
domain: fca-index/mcp
audience:
  - agent-operators
summary: >-
  Using context_query and coverage_check MCP tools for efficient context gathering during methodology execution.
prereqs: [38]
touches:
  - packages/mcp/src/context-tools.ts
  - packages/fca-index/src/ports/context-query.ts
  - packages/fca-index/src/ports/coverage-report.ts
---

# Guide 39 — fca-index: MCP Context Tools

## What are the context tools?

Two MCP tools expose the `@method/fca-index` ports to agents running methodology sessions:

| Tool | Port | What it does |
|------|------|-------------|
| `context_query` | `ContextQueryPort` | Semantic search over the FCA index. Returns ranked component descriptors. |
| `coverage_check` | `CoverageReportPort` | Coverage summary + mode (discovery/production). Tells you how much to trust the index. |

Both tools replace the grep-file-read loop. Instead of reading 20+ files to find the right one, an agent calls `context_query`, gets a ranked list of 3–5 component paths, and reads only those.

## Setup

Two requirements before the tools are active:

**1. Index must exist.** Run `fca-index scan` on the project first:

```bash
export VOYAGE_API_KEY=your_key
fca-index scan /path/to/project
```

**2. `VOYAGE_API_KEY` must be set** in the environment where `@method/mcp` runs. The tools are gracefully absent when the key is not set — they will not appear in the MCP tool list.

The `METHOD_ROOT` environment variable is used as the default `projectRoot` when none is supplied.

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
   → If discovery mode, note which parts are weak (the bar chart)

2. context_query  (query: "what I'm looking for")
   → Get 3–5 ranked component paths

3. Read files at the returned paths
   → Start with port and interface files for API understanding
   → Read domain files for implementation details

4. Proceed with the task
```

If the index is in production mode, skip step 1 unless you have a reason to doubt freshness (e.g., after a large refactor).

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
