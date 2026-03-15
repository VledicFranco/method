# Bridge

## Responsibility

`packages/bridge/` is a standalone HTTP server that manages a pool of Claude Code PTY sessions. It spawns Claude Code processes, sends prompts, extracts responses from PTY output, and exposes this as a REST API.

**Key constraints:**
- No dependency on `@method/core` or `@method/mcp` — the bridge is methodology-unaware
- No MCP protocol — plain HTTP/JSON
- Spawned agents pick up their MCP configuration from the workdir's `.mcp.json`

### Relationship to Other Packages

```
Human's Claude Code session (P3-DISPATCH orchestrator)
    ├── MCP tools ──→ @method/mcp (methodology intelligence)
    │                    └── reads registry/, theory/
    └── HTTP API ──→ @method/bridge (agent spawning)
                         └── spawns Claude Code agents via PTY
                               └── each agent has own MCP connection
```

The bridge and MCP server are peers. The orchestrating agent calls MCP tools for methodology logic and calls the bridge HTTP API for agent management. No circular dependency exists.

## File Structure

```
packages/bridge/
├── src/
│   ├── index.ts            HTTP server (Fastify), route definitions
│   ├── pty-session.ts      Single PTY session lifecycle (spawn, prompt, kill)
│   ├── pool.ts             Session pool (Map<id, PtySession>), capacity management
│   ├── parser.ts           PTY output extraction (●-based parser)
│   ├── usage-poller.ts     Anthropic OAuth subscription usage polling
│   ├── token-tracker.ts    Per-session JSONL log parsing for token data
│   ├── dashboard-route.ts  Fastify route handler for GET /dashboard
│   ├── dashboard.html      HTML template (Vidtecci OS design system)
│   └── __tests__/
│       └── parser.test.ts    Parser unit tests
├── package.json            @method/bridge
└── tsconfig.json
```

Eight source files, one test file. Each source file has a single responsibility.

## Type Definitions

### Session States

```typescript
type SessionStatus = 'initializing' | 'ready' | 'working' | 'dead';
```

State transitions:
- `initializing` → `ready`: PTY process spawns and first `❯` prompt appears
- `ready` → `working`: `sendPrompt()` called
- `working` → `ready`: response extraction complete
- Any → `dead`: PTY process exits, kill() called, or fatal error

### API Request / Response Types

#### `POST /sessions`
```typescript
// Request
{ workdir: string; initial_prompt?: string }

// Response 201
{ session_id: string; status: string }

// Error 503 — pool full
```

#### `POST /sessions/:id/prompt`
```typescript
// Request
{ prompt: string; timeout_ms?: number }

// Response 200
{ output: string; timed_out: boolean }

// Error 404 — session not found
// Error 400 — session is dead
```

#### `GET /sessions/:id/status`
```typescript
// Response 200
{ session_id: string; status: string; queue_depth: number }

// Error 404 — session not found
```

#### `DELETE /sessions/:id`
```typescript
// Response 200
{ session_id: string; killed: boolean }

// Error 404 — session not found
```

#### `GET /sessions`
```typescript
// Response 200
Array<{ session_id: string; status: string; queue_depth: number }>
```

#### `GET /dashboard`
```
// Response 200
Content-Type: text/html

Server-rendered HTML dashboard showing pool health, per-session token usage,
aggregate token metrics, and subscription usage meters. Auto-refreshes every 5s.
```

## Output Parser Algorithm

The parser extracts Claude Code's response from raw PTY output. The PTY buffer contains ANSI escape sequences, TUI chrome, cursor movements, and multiple overwrites on the same line.

Algorithm (`extractResponse`):

1. **Slice from last `●` marker** — Claude Code emits `●` before its response text. Take everything from the last `●` to the end of the buffer.
2. **Replace cursor-right escapes** — `\x1b[1C` (cursor move right 1) is replaced with a space. This is an artifact of Claude Code's TUI rendering.
3. **Strip ANSI escapes** — Remove all remaining `\x1b[...]` sequences using `strip-ansi`.
4. **Simulate carriage return overwriting** — For each line, if it contains `\r`, keep only the content after the last `\r`. This mirrors how a real terminal handles `\r` (cursor returns to column 0, subsequent text overwrites).
5. **Cut at `❯` prompt** — The `❯` character marks Claude Code's input prompt. Take content before the first `❯`.
6. **Filter TUI chrome lines** — Remove lines matching decorative patterns:
   - Lines that are only whitespace
   - Lines composed entirely of box-drawing characters (`─│┌┐└┘├┤┬┴┼`)
   - Lines starting with common TUI status patterns
7. **Trim** — Remove leading/trailing whitespace from the result.

### Why This Works

Claude Code's PTY output follows a consistent pattern:
- `●` marks the start of response content
- The response text follows, possibly interspersed with ANSI codes and TUI artifacts
- `❯` marks the return to the input prompt

Everything between `●` and `❯` is the response. The parser cleans up rendering artifacts.

## Error Handling

### Session-level Errors
- PTY process exits unexpectedly → session status set to `dead`, pending prompt resolves with whatever was captured
- Prompt timeout → return partial output with `timed_out: true`
- Prompt sent to dead session → throw descriptive error

### Pool-level Errors
- Pool full → reject `create()` with capacity error
- Session not found → throw with session ID in message
- Dead session prompt → throw with status information

### HTTP-level Errors
- Session not found → 404 with `{ error: "Session not found" }`
- Bad input (missing required fields) → 400 with `{ error: "..." }`
- Pool full → 503 with `{ error: "Session pool full" }`
- Dead session → 400 with `{ error: "Session is dead" }`

No error taxonomy or error codes beyond HTTP status. The message is the interface.

## Configuration

All via environment variables with sensible defaults:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | HTTP server listen port |
| `CLAUDE_BIN` | `"claude"` | Path to the Claude Code binary |
| `CLAUDE_WORKDIR` | `process.cwd()` | Default workdir for new sessions |
| `SETTLE_DELAY_MS` | `2000` | Debounce interval for response completion detection |
| `MAX_SESSIONS` | `5` | Maximum concurrent PTY sessions in the pool |
| `CLAUDE_OAUTH_TOKEN` | `null` | Anthropic OAuth token for subscription usage polling |
| `USAGE_POLL_INTERVAL_MS` | `60000` | Interval between subscription usage API polls |
| `CLAUDE_SESSIONS_DIR` | `~/.claude/projects` | Base directory for Claude Code session JSONL logs |

### Completion Detection

Response completion is detected via debounce: no new PTY output for `SETTLE_DELAY_MS` milliseconds AND the buffer ends with the `❯` prompt character. This avoids premature extraction while Claude Code is still streaming its response.

## Dependencies

| Package | Purpose |
|---------|---------|
| `node-pty` | PTY spawning — provides a pseudo-terminal for Claude Code |
| `fastify` | HTTP server framework |
| `p-queue` | Per-session prompt serialization (concurrency 1 queue) |
| `strip-ansi` | ANSI escape sequence removal |

These are transport/infrastructure dependencies. DR-03 (no transport deps in core) does not apply — the bridge is a standalone service, not a domain library.

## Integration with Methodology Sessions (PRD 004)

PRD 004 introduced runtime methodology execution — `methodology_start`, `methodology_route`, `methodology_load_method`, `methodology_transition`. These tools manage the *what* (which method, which step, what outputs). The bridge manages the *who* (spawned agents that do the work).

### Session ID Architecture

Two independent ID spaces:

| ID | Managed by | Scope |
|----|-----------|-------|
| Methodology session ID | `@method/core` MethodologySessionManager | Persists across method transitions. Passed to all MCP tool calls via `session_id`. |
| Bridge session ID | `@method/bridge` session pool | Ephemeral per spawned agent. Created via `POST /sessions`, destroyed after method completes. |

The orchestrator maps between them. A single methodology session may spawn multiple bridge sessions (one per method execution). Bridge sessions are disposable; methodology sessions track durable state (completed methods, outputs, routing decisions).

### Data Flow

```
Orchestrator
  │
  ├─ methodology_load_method("M1-COUNCIL")     ← MCP: sets up method context
  ├─ POST /sessions { workdir }                 ← Bridge: spawns sub-agent
  │
  │  for each step:
  │    ├─ step_context()                        ← MCP: gets step + priorMethodOutputs
  │    ├─ POST /sessions/:id/prompt { ... }     ← Bridge: sub-agent executes step
  │    ├─ step_validate({ output })             ← MCP: records output
  │    └─ step_advance()                        ← MCP: moves to next step
  │
  ├─ DELETE /sessions/:id                       ← Bridge: cleanup
  └─ methodology_transition()                   ← MCP: completes method, re-routes
```

### Cross-Method Output Forwarding

When `methodology_load_method` is called for the second method, it calls `session.setPriorMethodOutputs()` with outputs from all completed methods. These appear in `step_context().priorMethodOutputs` for the new method's sub-agent. The bridge itself is unaware of this — it just relays prompts. The orchestrator includes the prior outputs in the prompt it sends to the sub-agent.

### Why the Bridge Stays Methodology-Unaware

The bridge has no dependency on `@method/core`. This is intentional:
- The bridge spawns *any* Claude Code agent, not just methodology-following ones
- Methodology intelligence lives in the MCP server, which the spawned agents access via their own MCP connections
- The orchestrator is the integration point — it calls both systems and composes the workflow

Adding methodology awareness to the bridge would create a circular dependency and couple agent spawning to the method system's type hierarchy.
