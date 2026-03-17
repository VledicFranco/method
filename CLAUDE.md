# pv-method

Runtime that makes formal methodologies executable by LLM agents. Loads compiled methodology YAML specs from the registry, exposes them via MCP tools, and includes a bridge for spawning and managing Claude Code sub-agent sessions with structured visibility channels.

## Quick Start

```bash
npm install
npm run build
npm test
```

## Project Structure

```
packages/
  core/       Pure methodology logic — YAML loader, sessions, theory lookup (zero transport deps)
  mcp/        MCP server — 24 tools (14 methodology + 10 bridge proxy)
  bridge/     HTTP server — PTY session pool, channels, dashboard, token tracking
registry/     Compiled methodology YAML specs (production artifacts — do not modify casually)
theory/       Formal theory files (F1-FTH, F4-PHI)
docs/
  arch/       Architecture specs (one concern per file)
  prds/       Product requirement documents
  guides/     Usage guides (14 guides)
.method/      Methodology execution home
  project-card.yaml   Essence, delivery rules, processes, governance
  manifest.yaml       Installed methodologies and protocols
  council/            Steering council (TEAM, AGENDA, LOG)
  retros/             Retrospective artifacts (retro-YYYY-MM-DD-NNN.yaml)
  delivery/           Phases, sessions, reviews, audits
```

## Key Commands

```bash
npm run build          # TypeScript build (all packages)
npm test               # Run all tests (core + bridge)
npm run bridge         # Start bridge server (builds first)
npm run bridge:dev     # Start bridge in dev mode (tsx)
npm run bridge:stop    # Stop bridge server
```

## Bridge (Agent Session Server)

HTTP server managing a pool of Claude Code PTY sessions. REST API + browser dashboard.

### Start / Stop

```bash
npm run bridge         # Production (builds first)
npm run bridge:dev     # Development (tsx, no build step)
npm run bridge:stop    # Stop
```

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /dashboard` | Browser dashboard — live sessions, progress timelines, event feeds |
| `GET /health` | Health check — JSON with status, session count, uptime |
| `POST /sessions` | Spawn a new agent session (supports parent/child chains, budgets) |
| `POST /sessions/:id/prompt` | Send a prompt and wait for response |
| `GET /sessions/:id/status` | Session status, metadata, chain info (includes `stale` flag) |
| `GET /sessions` | List all sessions |
| `DELETE /sessions/:id` | Kill a session |
| `GET /sessions/:id/stream` | SSE stream of raw PTY output (for xterm.js rendering) |
| `GET /sessions/:id/output.html` | HTML page with embedded xterm.js terminal emulator |
| `POST /sessions/:id/channels/progress` | Agent reports structured progress |
| `POST /sessions/:id/channels/events` | Agent reports lifecycle events (with push notifications) |
| `GET /sessions/:id/channels/progress` | Parent reads child progress (cursor-based) |
| `GET /sessions/:id/channels/events` | Parent reads child events (cursor-based) |
| `GET /channels/events` | Aggregated events across all sessions |

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | HTTP listen port |
| `CLAUDE_BIN` | `claude` | Path to Claude Code binary |
| `MAX_SESSIONS` | `10` | Max concurrent PTY sessions |
| `SETTLE_DELAY_MS` | `1000` | Response completion debounce |
| `DEAD_SESSION_TTL_MS` | `300000` | Auto-cleanup TTL for dead sessions (5 min) |
| `STALE_CHECK_INTERVAL_MS` | `60000` | Interval for stale session detection (1 min) |
| `CLAUDE_OAUTH_TOKEN` | *(none)* | Enables subscription usage meters in dashboard |
| `USAGE_POLL_INTERVAL_MS` | `600000` | Subscription usage poll interval (10 min) |
| `CLAUDE_SESSIONS_DIR` | `~/.claude/projects` | Base dir for Claude Code session logs |
| `SSE_HEARTBEAT_MS` | `15000` | SSE keepalive interval for xterm.js stream |
| `MAX_TRANSCRIPT_SIZE_BYTES` | `5242880` | Transcript buffer cap (5 MB) |
| `PTY_WATCHER_ENABLED` | `true` | Enable PTY activity auto-detection (PRD 010) |
| `PTY_WATCHER_PATTERNS` | `all` | Which observation patterns to track |
| `PTY_WATCHER_RATE_LIMIT_MS` | `5000` | Rate limit for observation emissions |
| `PTY_WATCHER_DEDUP_WINDOW_MS` | `10000` | Dedup window for repeated observations |
| `PTY_WATCHER_AUTO_RETRO` | `true` | Auto-generate retrospective on session exit |
| `PTY_WATCHER_LOG_MATCHES` | `false` | Debug logging for pattern matches |
| `BATCH_STAGGER_MS` | `3000` | Default stagger between batch spawns |
| `ADAPTIVE_SETTLE_ENABLED` | `true` | Enable adaptive settle delay algorithm |
| `ADAPTIVE_SETTLE_INITIAL_MS` | `300` | Starting adaptive settle delay |
| `ADAPTIVE_SETTLE_MAX_MS` | `2000` | Maximum adaptive settle delay cap |
| `ADAPTIVE_SETTLE_BACKOFF` | `1.5` | Backoff multiplier on false-positive cutoff |

### Key Bridge Features

**Split prompt delivery (EXP-OBS02):** Long initial prompts (> 500 chars) are automatically split into two messages — a short activation prompt first, then the full commission after the agent acknowledges. Prevents Claude Code from treating long instructions as passive context.

**xterm.js terminal emulator:** Live PTY output streams as raw SSE data to browser-side xterm.js, which handles ANSI rendering (colors, cursor movement, box-drawing). Endpoints: `/sessions/:id/stream` (SSE) and `/sessions/:id/output.html` (HTML viewer).

**PTY activity auto-detection (PRD 010):** Per-session watcher detects structured patterns in PTY output (tool calls, git commits, test results, file operations, build results, errors, idle states). Observations auto-emit to channels with rate limiting and dedup. On session exit, auto-generates a retrospective YAML at `.method/retros/`. Configurable per-session via `pty_watcher` metadata key.

**Persistent sessions (PRD 011):** Sessions spawned with `persistent=true` skip stale detection and auto-kill. For long-running background agents or infrastructure that shouldn't be auto-terminated.

**Orphaned process cleanup:** `npm run bridge:stop` kills both the bridge process and any orphaned `claude.exe` processes. Graceful shutdown includes a 500ms PTY cleanup delay and a 5s force-exit timeout.

**Connection retry:** All MCP proxy tools retry once (after 1s) on connection errors to the bridge, handling transient failures automatically.

### MCP Proxy Tools

The MCP server exposes 10 bridge proxy tools. Configure with `BRIDGE_URL` env var (default `http://localhost:3456`). All tools include automatic retry (1 retry after 1s on connection error).

**Session management:**
- `bridge_spawn` — spawn a session (auto-correlates methodology session ID; supports `persistent` flag)
- `bridge_spawn_batch` — spawn multiple sessions with staggered initialization (prevents API rate limit contention)
- `bridge_prompt` — send prompt, wait for response
- `bridge_kill` — kill a session
- `bridge_list` — list sessions with metadata (includes `stale` flag per session)

**Visibility channels (PRD 008):**
- `bridge_progress` — report progress (step transitions, status updates)
- `bridge_event` — report lifecycle events (completed, error, escalation, stale)
- `bridge_read_progress` — read child's progress (cursor-based)
- `bridge_read_events` — read child's events (cursor-based)
- `bridge_all_events` — aggregated events across all sessions

Push notifications: when a child emits `completed`, `error`, `escalation`, `budget_warning`, or `stale` events, the bridge auto-prompts the parent agent.

## Delivery Rules (Summary)

- **DR-01/02:** Registry files are production artifacts. Preserve compilation status and structural completeness.
- **DR-03:** Core has zero transport dependencies. Bridge proxy tools go in `@method/mcp`.
- **DR-04:** MCP handlers are thin wrappers — parse input, call core/fetch, format output.
- **DR-05:** Use js-yaml for all YAML parsing. Preserve structure faithfully.
- **DR-09:** Tests use real YAML fixtures, not minimal mocks.
- **DR-12:** Architecture docs follow horizontal pattern — one file per concern in `docs/arch/`.
- **DR-13:** Validate YAML after registry edits: `node -e "require('js-yaml').load(require('fs').readFileSync('file.yaml','utf8'))"`.

See `.method/project-card.yaml` for the full set (DR-01 through DR-13).

## Methodology & Governance

This project uses the method system it builds. Instance: I2-METHOD, methodology: P2-SD v2.0.

### Essence

- **Purpose:** The runtime that makes formal methodologies executable by LLM agents.
- **Invariant:** Theory is the source of truth. When implementation and formal theory diverge, revise the implementation — never the theory.
- **Optimize for:** Faithfulness > simplicity > registry integrity.

### Installed (`.method/manifest.yaml`)

- **P2-SD v2.0** — software delivery methodology (7 methods)
- **P1-EXEC v1.1** — execution methodology (M1-COUNCIL, M2-ORCH, M3-TMP)
- **RETRO-PROTO v1.0** — retrospective protocol (promoted)
- **STEER-PROTO v0.1** — steering council protocol (trial)

### Steering Council

Persistent governance body in `.method/council/`. Run `/steering-council` to start a session. The council:
- Reviews priorities and steers direction
- Guards the project's essence (purpose, invariant, optimize_for)
- Enforces processes (PR-01/02/03)
- Commissions agent work via `/commission`

### Processes (enforced by steering council)

- **PR-01:** Guide sync — update `docs/guides/` when `registry/` changes
- **PR-02:** Stale agenda escalation — items open 3+ sessions get resolved or archived
- **PR-03:** Retro placement — retrospectives go to `.method/retros/`, not `tmp/`

### Retrospectives

After every methodology session, produce a retrospective at `.method/retros/retro-YYYY-MM-DD-NNN.yaml`. Include: `hardest_decision`, `observations` (>= 1), `card_feedback` (with essence feedback), `proposed_deltas` (optional).

### Skills

- `/steering-council` — project governance session
- `/council-team [challenge]` — adversarial expert debate
- `/commission [task]` — generate orchestrator prompt for a fresh agent

## Sub-Agent Guidelines

If you are a sub-agent spawned for implementation work:

- **Do NOT modify registry YAML files** unless the task explicitly requires registry changes. If a registry file has a parsing error, REPORT it — do not fix it.
- **Do NOT modify** `.method/project-card.yaml`, schema files, or council artifacts.
- **Do NOT commit to files outside your task scope.** One step, one deliverable per sub-agent.
- **Scope decisions go to the orchestrator.** If the task requires decisions beyond your scope, report back.
- When in doubt about a registry change, check the method's `compilation_record` to understand what gates it passed.
