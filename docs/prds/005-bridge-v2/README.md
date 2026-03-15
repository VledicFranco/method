# PRD 005 — Bridge v2: MCP Integration and Human Observability

**Status:** Draft
**Date:** 2026-03-14
**Scope:** Bridge MCP proxy tools + permission handling + human observability dashboard
**Depends on:** 003-dispatch (bridge implementation), 004-methodology-runtime (methodology session tools)
**Requested by:** pv-agi (steering council acceptance test blocked by bridge UX gaps)
**Evidence:** [pv-agi acceptance test report](../../../pv-agi/tmp/001-bridge-acceptance-test.md), council session 2026-03-14

---

## Contents

| File | Description |
|------|-------------|
| [README.md](README.md) | This file — the PRD specification |
| `mocks/` | UI mockups for the dashboard (to be added) |

---

## Purpose

PRD 003 built the bridge — a PTY HTTP server that spawns and manages Claude Code agent sessions. PRD 004 built the runtime methodology tools — start, route, load, transition. But the pv-agi acceptance test revealed that these two systems don't compose well:

1. **Two protocols.** The orchestrator calls MCP for methodology logic and HTTP for agent spawning. Two APIs, two error models, two sets of session IDs to correlate manually.
2. **No permission handling.** Spawned agents hit MCP tool permission prompts that the bridge can't detect or respond to. The acceptance test is blocked at Gate 1.
3. **Zero human visibility.** The operator has no way to see what spawned agents are doing, whether they're stuck, or how many are alive. Debugging requires reading raw HTTP responses.

This PRD collapses the control plane to one protocol (MCP), unblocks MCP tool permissions in spawned agents, and gives humans a live view of agent activity.

---

## Problem

After PRDs 003 + 004, an orchestrating agent can:
- Start a methodology session and route through δ_Φ (PRD 004)
- Spawn Claude Code agents via the bridge HTTP API (PRD 003)
- Send prompts and receive responses via HTTP (PRD 003)

But it **cannot**:
- Spawn agents through MCP (must use a separate HTTP client)
- Pass CLI flags to spawned agents (no `spawn_args` support — blocks permission bypass)
- Automatically correlate methodology sessions with bridge sessions
- Give the human operator visibility into agent activity
- Handle the case where the bridge is unreachable (no health check, no clear error)

The pv-agi acceptance test (steering council dispatching work) is **blocked** because spawned agents prompt for MCP tool permissions and the bridge has no mechanism to handle this.

---

## What to Build

### Phase 1: MCP Proxy + Permission Handling

#### Bridge-side: `spawn_args` support

Extend `POST /sessions` to accept a `spawn_args` field:

```
POST /sessions
{
  workdir: string,
  spawn_args?: string[],       // NEW: CLI flags passed to claude binary
  initial_prompt?: string,
  metadata?: Record<string, unknown>   // NEW: arbitrary metadata stored with session
}
```

`spawn_args` are appended to the Claude Code binary invocation. This allows:
- `["--dangerously-skip-permissions"]` — bypass all permission prompts (development)
- `["--allowedTools", "mcp__method__*"]` — allow specific MCP tools without prompting (production)

The `metadata` field is stored with the session and returned by `GET /sessions` and `GET /sessions/:id/status`. The MCP proxy uses this to store the methodology session ID for correlation.

Update `pty-session.ts` spawn logic:

```typescript
// Current
const args = process.platform === 'win32' ? ['/c', claudeBin] : ['-c', claudeBin];

// New
const cliFlags = options.spawnArgs?.join(' ') ?? '';
const fullCmd = cliFlags ? `${claudeBin} ${cliFlags}` : claudeBin;
const args = process.platform === 'win32' ? ['/c', fullCmd] : ['-c', fullCmd];
```

#### MCP-side: 4 proxy tools

Add 4 new MCP tools in `@method/mcp` that proxy to the bridge HTTP API. These are thin transport adapters — they translate MCP tool calls into HTTP requests.

**Configuration:** `BRIDGE_URL` environment variable (default: `http://localhost:3456`). Same pattern as `METHOD_ROOT`.

**HTTP client:** Node.js built-in `fetch` (available since Node 18). No new dependencies.

##### Tool 1: `bridge_spawn`

Spawn a new Claude Code agent session via the bridge.

```
Input:  {
  workdir: string,
  spawn_args?: string[],
  initial_prompt?: string,
  session_id?: string          // methodology session ID — auto-correlated
}
Output: {
  bridge_session_id: string,
  status: string,
  message: "Agent spawned. Call bridge_prompt to send work."
}
Error: "Bridge error: connection refused — is the bridge running on {BRIDGE_URL}?"
       "Bridge error: session pool full (max {n})"
```

The handler automatically includes the MCP `session_id` (the one shared with methodology tools) in the bridge session's `metadata.methodology_session_id`. This enables automatic correlation — the orchestrator doesn't need to manage two ID spaces.

##### Tool 2: `bridge_prompt`

Send a prompt to a spawned agent and wait for the response.

```
Input:  {
  bridge_session_id: string,
  prompt: string,
  timeout_ms?: number          // default: 120000 (2 minutes)
}
Output: {
  output: string,
  timed_out: boolean,
  message: "Response received (247 chars)" | "Prompt timed out — partial output returned"
}
Error: "Bridge error: session {id} not found"
       "Bridge error: session {id} is dead"
```

##### Tool 3: `bridge_kill`

Kill a spawned agent session.

```
Input:  {
  bridge_session_id: string
}
Output: {
  bridge_session_id: string,
  killed: boolean,
  message: "Session killed"
}
Error: "Bridge error: session {id} not found"
```

##### Tool 4: `bridge_list`

List all active bridge sessions.

```
Input:  {}
Output: {
  sessions: [{
    bridge_session_id: string,
    status: string,
    queue_depth: number,
    metadata: Record<string, unknown>,
    methodology_session_id: string | null    // extracted from metadata for convenience
  }],
  capacity: { active: number, max: number },
  message: "2 of 5 sessions active"
}
```

#### Error handling pattern

All proxy tools catch `fetch` errors and wrap them with a `"Bridge error:"` prefix:

```typescript
try {
  const res = await fetch(`${BRIDGE_URL}/sessions`, { ... });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(`Bridge error: ${body.error}`);
  }
  return { ... };
} catch (e) {
  if (e instanceof TypeError) {
    // fetch network error — bridge unreachable
    throw new Error(`Bridge error: connection refused — is the bridge running on ${BRIDGE_URL}?`);
  }
  throw e;
}
```

This distinguishes bridge infrastructure errors from methodology domain errors for the orchestrating agent.

#### Implementation constraints

- **DR-03 preserved.** The proxy tools live in `@method/mcp`, not `@method/core`. Core remains transport-free.
- **DR-04 extended.** The proxy tools follow the same pattern: parse input → make HTTP call → format response. The HTTP call replaces the core function call, but the wrapper pattern is identical.
- **No bridge dependency.** `@method/mcp` does not import from `@method/bridge`. The proxy communicates via HTTP only. The two packages have no compile-time relationship.

---

### Phase 2: Human Observability Dashboard

#### `GET /dashboard`

The bridge serves a server-rendered HTML page showing live agent activity. This is a read-only supervision interface for the human operator.

**Template:** A static HTML template file (`packages/bridge/src/dashboard.html`) with placeholder tokens. The route handler reads the template, fills in data, and returns it. No template engine — simple string replacement.

**Auto-refresh:** `<meta http-equiv="refresh" content="5">` — the page reloads every 5 seconds. No WebSocket, no JavaScript framework.

**Content:**

```
+--------------------------------------------------+
| @method/bridge                    uptime: 2h 14m  |
| Sessions: 2 active / 5 max       total spawned: 7 |
+--------------------------------------------------+
| ID       | Status | Workdir        | Method SID  | Prompts | Last Activity |
|----------|--------|----------------|-------------|---------|---------------|
| 56edd62a | ready  | /pv-agi        | council-1   | 4       | 12s ago       |
| 1dc309d3 | working| /pv-method     | impl-2      | 1       | now           |
| a3f7bc01 | dead   | /pv-agi        | council-1   | 7       | 3m ago        |
+--------------------------------------------------+
```

**Fields per session:**
- `ID` — bridge session ID (truncated to 8 chars for display)
- `Status` — colored: green (ready), yellow (working), red (dead), gray (initializing)
- `Workdir` — the working directory the agent was spawned in
- `Method SID` — methodology session ID from metadata (if set via MCP proxy)
- `Prompts` — count of prompts sent to this session
- `Last Activity` — relative timestamp of last prompt/response

**Bridge health header:**
- Uptime since bridge started
- Active / max sessions
- Total sessions spawned (lifetime counter)

**Implementation notes:**
- Prompt count requires the bridge to track a counter per session (increment on each `prompt()` call)
- Last activity timestamp requires tracking the last prompt/response time per session
- Both are lightweight additions to the session state in `pty-session.ts`

See `mocks/` directory for visual mockups (to be added).

---

### Phase 3: Operational Polish

#### `GET /health`

```json
{
  "status": "ok",
  "active_sessions": 2,
  "max_sessions": 5,
  "uptime_ms": 8040000,
  "version": "0.2.0"
}
```

Returns 200 when healthy. Useful for monitoring and for orchestrators to pre-check bridge availability.

#### Graceful shutdown

Handle `SIGTERM` and `SIGINT`:
1. Stop accepting new sessions
2. Kill all active PTY processes
3. Log shutdown summary (sessions killed, uptime)
4. Exit cleanly

#### Dead session auto-cleanup

Configurable TTL for dead sessions (default: 5 minutes). Dead sessions are removed from the pool after the TTL expires. Prevents unbounded memory growth during long orchestration runs.

New environment variable: `DEAD_SESSION_TTL_MS` (default: `300000`).

#### Permission prompt detection (future fallback)

Pattern detection in `pty-session.ts` for Claude Code's permission prompt format. When detected:
- If the session has an allowlist configured, auto-respond
- Otherwise, return a structured response: `{ type: "permission_required", tool: "...", description: "..." }`

This is a reliability improvement for scenarios where `spawn_args` doesn't cover all cases. Deferred from Phase 1 because `spawn_args` provides the primary mechanism.

#### Per-prompt settle delay

Allow `settle_delay_ms` as a per-prompt parameter in `POST /sessions/:id/prompt`:

```json
{
  "prompt": "...",
  "timeout_ms": 120000,
  "settle_delay_ms": 5000
}
```

MCP tool calls produce longer output streams than simple text responses. A per-prompt settle delay avoids premature extraction for heavy operations.

---

## Relationship to Existing Tools

| Existing Tool / API | Change |
|---------------------|--------|
| `POST /sessions` | Extended: new `spawn_args` and `metadata` fields |
| `POST /sessions/:id/prompt` | No change (Phase 3 adds `settle_delay_ms`) |
| `GET /sessions/:id/status` | Extended: includes `metadata` in response |
| `GET /sessions` | Extended: includes `metadata` per session |
| `DELETE /sessions/:id` | No change |
| All methodology MCP tools (14) | No change |

New surfaces:

| New Tool / Endpoint | Phase |
|---------------------|-------|
| MCP `bridge_spawn` | Phase 1 |
| MCP `bridge_prompt` | Phase 1 |
| MCP `bridge_kill` | Phase 1 |
| MCP `bridge_list` | Phase 1 |
| `GET /dashboard` | Phase 2 |
| `GET /health` | Phase 3 |

After Phase 1, the MCP server exposes **18 tools** (14 methodology + 4 bridge proxy).

---

## Documentation Impact

### Architecture docs (`docs/arch/`)

| Document | Change |
|----------|--------|
| `bridge.md` | Already updated with PRD 004 integration section. Phase 1 requires adding: MCP proxy architecture, `BRIDGE_URL` config, error handling pattern, session ID correlation. Phase 2 requires: dashboard endpoint, template rendering, session tracking fields. |
| `mcp-layer.md` | Add 4 bridge proxy tools to the tool table. Add proxy error handling pattern (distinct from core error handling). Update tool count to 18. |
| `state-model.md` | No change — bridge sessions are not methodology sessions |
| `dependencies.md` | Note that `@method/mcp` now makes HTTP calls to the bridge (runtime dependency, not compile-time) |

### Guides (`docs/guides/`)

| Guide | Change |
|-------|--------|
| `10-bridge-orchestration.md` | **Major update.** Currently documents the HTTP workflow. Must be rewritten to use MCP proxy tools as the primary interface. The HTTP API becomes an implementation detail. Update the orchestration loop, session ID correlation (now automatic), error handling, and prerequisites. |
| `08-prompting-methodology-agents.md` | Minor update: add a section on sub-agent spawning via `bridge_spawn` in the sub-agent instructions template. |

### New documentation

| Document | Content |
|----------|---------|
| `docs/guides/10-bridge-orchestration.md` (rewrite) | Full guide rewrite using MCP proxy tools. Drop HTTP examples, add `bridge_spawn` / `bridge_prompt` examples. Add dashboard usage section. |

---

## Out of Scope

- **Bridge lifecycle management via MCP** — the human starts/stops the bridge independently. MCP tools assume the bridge is running. Lifecycle management (start/stop via MCP) is a future extension.
- **Prompt/response history API** — storing full transcripts per session. Deferred until logging infrastructure exists.
- **Token usage tracking** — requires Claude Code API integration we don't have. Character count proxy may be added to dashboard later.
- **Agent-readable observability MCP tool** — a `bridge_dashboard` tool returning structured summary for agents. Deferred to future PRD.
- **WebSocket real-time dashboard** — auto-refresh is sufficient for v1.
- **Multi-bridge federation** — connecting to multiple bridge instances. Single bridge instance only.

---

## Implementation Order

### Phase 1: MCP Proxy + Permission Handling

Add `spawn_args` and `metadata` to bridge. Implement 4 MCP proxy tools. This unblocks the pv-agi acceptance test — agents can be spawned with permission bypass through MCP.

### Phase 2: Human Observability Dashboard

Add `GET /dashboard` to bridge. Add prompt count and last-activity tracking to sessions. The operator opens a browser tab and sees live agent state.

### Phase 3: Operational Polish

Health endpoint, graceful shutdown, dead session cleanup, per-prompt settle delay, permission detection.

---

## Acceptance Test

**Test case:** pv-agi steering council dispatching work through MCP-only tooling.

**Scenario:**
1. Human starts the bridge: `cd packages/bridge && npm start`
2. Agent calls `methodology_start({ methodology_id: "P1-EXEC" })`
3. Agent calls `methodology_route({ challenge_predicates: { adversarial_pressure_beneficial: true } })` → M1-COUNCIL
4. Agent calls `methodology_load_method({ method_id: "M1-COUNCIL" })`
5. Agent calls `bridge_spawn({ workdir: "/path/to/pv-agi", spawn_args: ["--allowedTools", "mcp__method__*"] })`
6. For each step: agent calls `step_context` → composes prompt → calls `bridge_prompt` → parses output → calls `step_validate` → calls `step_advance`
7. Agent calls `bridge_kill` to clean up the sub-agent
8. Agent calls `methodology_transition` → routes to M3-TMP
9. Agent calls `bridge_spawn` for M3-TMP execution
10. After M3-TMP: `step_context.priorMethodOutputs` includes M1-COUNCIL's outputs
11. Agent calls `methodology_transition` → methodology complete or routes back

**Pass criteria:**
- Full loop executes through MCP only — no direct HTTP calls to the bridge
- Spawned agents execute MCP tool calls without permission prompts
- `bridge_list` shows methodology session ID correlation
- Dashboard (if Phase 2 complete) shows live session activity
- Cross-method output forwarding works (same as PRD 004 acceptance test)

**Comparison against pv-agi Session 001:**
- PO intervention frequency (lower = better orchestration)
- Time from decision to executed artifact (faster = less overhead)
- Whether output quality is maintained or improved

---

## Success Criteria

1. An orchestrating agent can spawn sub-agents via `bridge_spawn` MCP tool with permission bypass
2. The entire methodology session loop (start → route → load → spawn → execute → transition) uses MCP only
3. Bridge session metadata automatically includes the methodology session ID
4. A human operator can open `http://localhost:3456/dashboard` and see live agent activity
5. The pv-agi acceptance test (blocked since PRD 004) passes end-to-end
6. All existing bridge HTTP endpoints continue to work unchanged (backward compatible)
7. All existing MCP tools (14) continue to work unchanged
