# pv-method

Runtime that makes formal methodologies executable by LLM agents. Loads compiled methodology YAML specs from the registry, exposes them via MCP tools, and includes a bridge for spawning and managing Claude Code sub-agent sessions.

## Quick Start

```bash
npm install
npm run build
npm test
```

## Bridge (Agent Session Server)

The bridge is a standalone HTTP server that manages a pool of Claude Code PTY sessions. It provides a REST API + a browser dashboard for human observability.

### Start / Stop

```bash
# Production (builds first)
npm run bridge

# Development (tsx, no build step)
npm run bridge:dev

# Stop
npm run bridge:stop

# Or just Ctrl+C (graceful shutdown handles SIGTERM/SIGINT)
```

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /dashboard` | Browser dashboard — live sessions, token usage, subscription meters |
| `GET /health` | Health check — JSON with status, session count, uptime |
| `POST /sessions` | Spawn a new Claude Code agent session |
| `POST /sessions/:id/prompt` | Send a prompt and wait for response |
| `GET /sessions/:id/status` | Session status, metadata, prompt count |
| `GET /sessions` | List all sessions |
| `DELETE /sessions/:id` | Kill a session |

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | HTTP listen port |
| `CLAUDE_BIN` | `claude` | Path to Claude Code binary |
| `MAX_SESSIONS` | `5` | Max concurrent PTY sessions |
| `SETTLE_DELAY_MS` | `2000` | Response completion debounce |
| `DEAD_SESSION_TTL_MS` | `300000` | Auto-cleanup TTL for dead sessions (5 min) |
| `CLAUDE_OAUTH_TOKEN` | *(none)* | Enables subscription usage meters in dashboard |
| `USAGE_POLL_INTERVAL_MS` | `60000` | Subscription usage poll interval |
| `CLAUDE_SESSIONS_DIR` | `~/.claude/projects` | Base dir for Claude Code session logs |

### MCP Proxy Tools

The MCP server exposes 4 bridge proxy tools that let agents manage sub-agents through MCP instead of raw HTTP:

- `bridge_spawn` — spawn a session (auto-correlates methodology session ID)
- `bridge_prompt` — send prompt, wait for response
- `bridge_kill` — kill a session
- `bridge_list` — list sessions with metadata

Configure with `BRIDGE_URL` env var (default `http://localhost:3456`).

## Project Structure

```
packages/
  core/       Pure methodology logic — YAML loader, sessions, theory lookup (zero transport deps)
  mcp/        MCP server — 18 tools (14 methodology + 4 bridge proxy)
  bridge/     HTTP server — PTY session pool, dashboard, token tracking
registry/     Compiled methodology YAML specs (production artifacts — do not modify casually)
theory/       Formal theory files (F1-FTH, F4-PHI)
docs/
  arch/       Architecture specs (one concern per file)
  prds/       Product requirement documents
  guides/     Usage guides
  impl/       Implementation session logs
.method/      Methodology instance card (project-card.yaml)
```

## Key Commands

```bash
npm run build          # TypeScript build (all packages)
npm test               # Run core tests
npm run bridge         # Start bridge server (builds first)
npm run bridge:dev     # Start bridge in dev mode (tsx)
npm run bridge:stop    # Stop bridge server
```

## Delivery Rules

- **DR-03:** Core has zero transport dependencies. Bridge proxy tools go in `@method/mcp`.
- **DR-04:** MCP handlers are thin wrappers — parse input, call core/fetch, format output.
- **DR-09:** Tests use real YAML fixtures, not minimal mocks.
- **DR-12:** Architecture docs follow horizontal pattern — one file per concern in `docs/arch/`.

See `.method/project-card.yaml` for the full methodology instance (I2-METHOD, P2-SD v2.0).
