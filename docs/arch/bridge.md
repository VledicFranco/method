# Bridge

## Responsibility

`packages/bridge/` is a standalone HTTP server that manages a pool of Claude Code PTY sessions. It spawns Claude Code processes, sends prompts, extracts responses from PTY output, and exposes this as a REST API.

**Key constraints:**
- No dependency on `@methodts/core` or `@methodts/mcp` — the bridge is methodology-unaware
- No MCP protocol — plain HTTP/JSON
- Spawned agents pick up their MCP configuration from the workdir's `.mcp.json`

### Relationship to Other Packages

```
Human's Claude Code session (P3-DISPATCH orchestrator)
    ├── MCP tools ──→ @methodts/mcp (methodology intelligence)
    │                    └── reads registry/, theory/
    └── HTTP API ──→ @methodts/bridge (agent spawning)
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
├── package.json            @methodts/bridge
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

Additional fields tracked by PtySession:
- `promptCount: number` — incremented on each `prompt()` call
- `lastActivityAt: Date` — updated on prompt send and response receive

### API Request / Response Types

#### `GET /health`
```typescript
// Response 200
{ status: 'ok'; instance_name: string; active_sessions: number; max_sessions: number; uptime_ms: number; version: string }
```

#### `POST /sessions`
```typescript
// Request
{ workdir: string; spawn_args?: string[]; initial_prompt?: string; metadata?: Record<string, unknown> }

// Response 201
{ session_id: string; status: string }

// Error 503 — pool full
```

#### `POST /sessions/:id/prompt`
```typescript
// Request
{ prompt: string; timeout_ms?: number; settle_delay_ms?: number }

// Response 200
{ output: string; timed_out: boolean }

// Error 404 — session not found
// Error 400 — session is dead
```

The optional `settle_delay_ms` parameter overrides the session-level `SETTLE_DELAY_MS` for this single prompt. Use a longer settle delay for prompts that produce large outputs, or a shorter one for quick commands.

#### `GET /sessions/:id/status`
```typescript
// Response 200
{ session_id: string; status: string; queue_depth: number; metadata?: Record<string, unknown> }

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
Array<{ session_id: string; status: string; queue_depth: number; metadata?: Record<string, unknown> }>
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
| `INSTANCE_NAME` | `"default"` | Human-readable instance identifier surfaced in `/health` response |
| `CLAUDE_BIN` | `"claude"` | Path to the Claude Code binary |
| `CLAUDE_WORKDIR` | `process.cwd()` | Default workdir for new sessions |
| `SETTLE_DELAY_MS` | `2000` | Debounce interval for response completion detection |
| `MAX_SESSIONS` | `5` | Maximum concurrent PTY sessions in the pool |
| `CLAUDE_OAUTH_TOKEN` | `null` | Anthropic OAuth token for subscription usage polling |
| `USAGE_POLL_INTERVAL_MS` | `60000` | Interval between subscription usage API polls |
| `CLAUDE_SESSIONS_DIR` | `~/.claude/projects` | Base directory for Claude Code session JSONL logs |
| `DEAD_SESSION_TTL_MS` | `300000` | Time (ms) before dead sessions are auto-removed from the pool |

### Completion Detection

Response completion is detected via debounce: no new PTY output for `SETTLE_DELAY_MS` milliseconds AND the buffer ends with the `❯` prompt character. This avoids premature extraction while Claude Code is still streaming its response.

### Graceful Shutdown

On `SIGTERM` or `SIGINT`, the bridge:
1. Stops accepting new HTTP connections (`app.close()`)
2. Stops the usage poller
3. Kills all non-dead sessions in the pool
4. Logs a shutdown summary (sessions killed, uptime) and exits with code 0

### Dead Session Auto-Cleanup

A background timer runs every 60 seconds and removes dead sessions whose `lastActivityAt` exceeds `DEAD_SESSION_TTL_MS` (default 5 minutes). This prevents unbounded memory growth from accumulated dead sessions.

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
| Methodology session ID | `@methodts/core` MethodologySessionManager | Persists across method transitions. Passed to all MCP tool calls via `session_id`. |
| Bridge session ID | `@methodts/bridge` session pool | Ephemeral per spawned agent. Created via `POST /sessions`, destroyed after method completes. |

The orchestrator maps between them. A single methodology session may spawn multiple bridge sessions (one per method execution). Bridge sessions are disposable; methodology sessions track durable state (completed methods, outputs, routing decisions).

PRD 005's MCP proxy tools (bridge_spawn, bridge_prompt, bridge_kill, bridge_list) add automatic session ID correlation via `metadata.methodology_session_id`, replacing manual orchestrator mapping. When the orchestrator spawns a bridge session through the MCP proxy, it can attach the methodology session ID as metadata, making the association queryable via `GET /sessions` and `GET /sessions/:id/status`.

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

The bridge has no dependency on `@methodts/core`. This is intentional:
- The bridge spawns *any* Claude Code agent, not just methodology-following ones
- Methodology intelligence lives in the MCP server, which the spawned agents access via their own MCP connections
- The orchestrator is the integration point — it calls both systems and composes the workflow

Adding methodology awareness to the bridge would create a circular dependency and couple agent spawning to the method system's type hierarchy.

## Instance Profiles

Instance profiles allow running multiple bridge instances on the same machine with isolated state. Each profile is a `.env` file in `.method/instances/` that defines a set of environment variables for a bridge process.

### Profile Loading Order

The bridge startup script (`scripts/start-bridge.js`) resolves configuration through this chain:

1. **`--instance <name>`** — If provided, loads `.method/instances/<name>.env`. The profile's env vars are merged with the process environment (explicit env vars take precedence over profile values).
2. **`.env.tpl` + `op` CLI** — If `.env.tpl` exists and the 1Password CLI (`op`) is on PATH, the bridge spawns via `op run --env-file=.env.tpl` so that `op://` secret references are resolved at runtime.
3. **`.env.tpl` without `op`** — If `.env.tpl` exists but `op` is not available, falls back to step 4 with a warning.
4. **`.env` file** — If `.env` exists, its key-value pairs are parsed and merged (profile values take precedence over `.env` values).
5. **Bare start** — No secrets configured. The bridge starts with whatever is in the process environment.

Steps 1 and 2-4 are not mutually exclusive: an instance profile provides isolation variables (port, root dir, instance name), while `.env.tpl` or `.env` provides secrets (API keys). Both are merged before the bridge process starts.

### Profile File Format

Profiles use simple `KEY=VALUE` syntax:

```
# Comment lines start with #
INSTANCE_NAME=test
PORT=3457
ROOT_DIR=test-fixtures/bridge-test
EVENT_LOG_PATH=/tmp/method-test-events.jsonl
GENESIS_ENABLED=false
MAX_SESSIONS=3
```

- Blank lines and `#` comment lines are skipped.
- Values may be quoted (single or double quotes are stripped).
- Variable expansion (`$VAR` or `${VAR}`) is **not** supported.
- Path-type values (`ROOT_DIR`, `EVENT_LOG_PATH`) have Windows backslashes automatically normalized to forward slashes.

### Isolation Dimensions

Each instance profile can isolate the following:

| Dimension | Env Var | Effect |
|-----------|---------|--------|
| Port | `PORT` | Separate HTTP listen port — avoids conflicts |
| Instance identity | `INSTANCE_NAME` | Surfaced in `/health` response — identifies which instance you're talking to |
| Project discovery | `ROOT_DIR` | Separate root directory for project scanning — can point to test fixtures |
| Event log | `EVENT_LOG_PATH` | Separate JSONL event persistence file |
| PID tracking | *(derived from PORT)* | PID file at `$TMPDIR/method-bridge-<PORT>.pids` — stop script targets the correct process |
| Session checkpoints | *(derived from ROOT_DIR)* | Session data stored relative to ROOT_DIR |

### Built-in Profiles

| Profile | Port | Purpose |
|---------|------|---------|
| `production.env` | 3456 | Default bridge configuration — matches bare start behavior |
| `test.env` | 3457 | Integration testing — uses fixture repos, disables genesis, limits sessions to 3 |

### Start / Stop

```bash
# Start a named instance
npm run bridge -- --instance test

# Stop a named instance (resolves port from profile)
node scripts/kill-port.js --instance test

# Convenience scripts for the test instance
npm run bridge:test          # equivalent to --instance test
npm run bridge:stop:test     # equivalent to kill-port --instance test
```

The stop script (`scripts/kill-port.js`) also accepts `--instance <name>`. It loads the profile to determine the port, then performs graceful shutdown via the `/shutdown` endpoint with PID-based fallback.
